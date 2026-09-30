// Advisor companion-review unit tests: severity envelope parsing and the
// emission guard (de-dupe + rate limit). These pin the pure logic that the
// runtime relies on, independent of the live dsh loop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAdvisorEmission } from '../lib/features/advisor/severity.js'
import { createEmissionGuard } from '../lib/features/advisor/emission-guard.js'
import { runReviewCall, registerAdvisorRuntime } from '../lib/features/advisor/runtime.js'

test('[advisor-severity] NONE marker → null', () => {
  assert.equal(parseAdvisorEmission('ADVISOR: NONE'), null)
  assert.equal(parseAdvisorEmission('Some text\nADVISOR: NONE\nmore'), null)
  assert.equal(parseAdvisorEmission(''), null)
  assert.equal(parseAdvisorEmission('no marker here'), null)
})

test('[advisor-severity] parses severity + body', () => {
  const e = parseAdvisorEmission('ADVISOR: concern\nThe edge case with empty inputs is unhandled.')
  assert.deepEqual(e, { severity: 'concern', body: 'The edge case with empty inputs is unhandled.' })
})

test('[advisor-severity] accepts nit/blocker and lower/upper case', () => {
  assert.equal(parseAdvisorEmission('ADVISOR: nit\nTidy this').severity, 'nit')
  assert.equal(parseAdvisorEmission('ADVISOR: BLOCKER\nStop').severity, 'blocker')
})

test('[advisor-severity] marker without a body is not actionable', () => {
  assert.equal(parseAdvisorEmission('ADVISOR: concern'), null)
})

test('[advisor-guard] allows first emission then de-dupes a repeat within window', () => {
  let t = 0
  const guard = createEmissionGuard(() => t, 1000)
  assert.equal(guard.gate('a1', 'same advice'), true)
  assert.equal(guard.gate('a1', 'same advice'), false) // duplicate in cooldown
  assert.equal(guard.gate('a1', 'different advice'), true) // new body passes
})

test('[advisor-guard] rate-limits a recurring body until the window elapses', () => {
  let t = 0
  const guard = createEmissionGuard(() => t, 1000)
  assert.equal(guard.gate('a2', 'advice'), true)
  t = 500
  assert.equal(guard.gate('a2', 'advice'), false) // same body, within window
  t = 1001
  assert.equal(guard.gate('a2', 'advice'), true) // window elapsed → allowed again
})

test('[advisor-guard] per-agent isolation', () => {
  let t = 0
  const guard = createEmissionGuard(() => t, 1000)
  assert.equal(guard.gate('mainA', 'advice'), true)
  assert.equal(guard.gate('mainB', 'advice'), true) // different agent unaffected
})

test('[advisor-guard] ignore empty bodies', () => {
  const guard = createEmissionGuard(() => 0, 1000)
  assert.equal(guard.gate('a', ''), false)
})

test('[advisor-run] runReviewCall assembles text from a stream', async () => {
  async function* fakeStream() {
    yield { type: 'text-delta', index: 0, text: 'ADVISOR: concern\n' }
    yield { type: 'text-delta', index: 0, text: 'The timeout is too aggressive.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const llm = { stream: () => fakeStream() }
  const raw = await runReviewCall(llm, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    messages: [],
    system: 'sys',
  })
  assert.equal(raw, 'ADVISOR: concern\nThe timeout is too aggressive.')
})

test('[advisor-run] runReviewCall returns null on stream failure', async () => {
  const llm = {
    stream: () => (async function* () { throw new Error('NO_ADAPTER') })(),
  }
  const raw = await runReviewCall(llm, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    messages: [],
  })
  assert.equal(raw, null)
})

// ── runtime 接线：注册期捕获 llm + disposed 守卫（真实会话里出现过的缺陷） ──────────

/** 造一个够 runtime 抽取增量与回注的假 main agent。 */
function fakeAgent (id = 'main-1') {
  return {
    id,
    session: {
      id,
      deriveMessages: () => ([
        { role: 'user', content: [{ type: 'text', text: 'please review this' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'here is my work' }] },
      ]),
    },
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    injected: [],
    steered: [],
    inject (m) { this.injected.push(m) },
    steer (m) { this.steered.push(m) },
  }
}

/**
 * 假 ctx：`llm` 是 getter，可配置成「第二次访问就抛 inactive context」，
 * 用来证明运行时必须在注册期捕获服务而不是在异步回调里惰性访问。
 */
function fakeCtx (llm, { failAfterFirstAccess = false } = {}) {
  let accesses = 0
  const handlers = new Map()
  return {
    get llm () {
      accesses++
      if (failAfterFirstAccess && accesses > 1) {
        throw new Error('cannot get required service "llm" in inactive context')
      }
      return llm
    },
    on (event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    handlers,
    accesses: () => accesses,
  }
}

/** concern/blocker → steer；nit → inject。这里只跑一条得到 concern。 */
function concernLlm (counter) {
  return {
    stream: () => {
      counter.calls++
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: 'ADVISOR: concern\n' }
        yield { type: 'text-delta', index: 0, text: 'timeout too aggressive' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

async function waitFor (fn, ms = 2000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (fn()) return true
    await new Promise(r => setTimeout(r, 5))
  }
  return fn()
}

test('[advisor-run] llm 在注册期捕获：回调里再访问 ctx.llm 不应发生', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter), { failAfterFirstAccess: true })
  registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent()

  ctx.handlers.get('agent/turn-stopping')({ agent })
  await waitFor(() => agent.steered.length > 0)

  assert.equal(counter.calls, 1, '应完成一次审查调用（惰性访问 ctx.llm 会抛 inactive context 并静默失败）')
  assert.equal(agent.steered.length, 1, 'concern 应经 steer 回注')
  assert.equal(ctx.accesses(), 1, 'ctx.llm 只允许在注册期被访问一次')
})

test('[advisor-run] dispose 之后不再触发审查', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter))
  const dispose = registerAdvisorRuntime(ctx, { enabled: true })
  const handler = ctx.handlers.get('agent/turn-stopping')
  assert.equal(typeof handler, 'function')

  dispose()
  handler({ agent: fakeAgent() })
  await new Promise(r => setTimeout(r, 50))

  assert.equal(counter.calls, 0, 'dispose 后不得再发起审查（避免在已失活 scope 上做副作用）')
})

test('[advisor-run] enabled:false 不注册任何监听器', () => {
  const ctx = fakeCtx(concernLlm({ calls: 0 }))
  const dispose = registerAdvisorRuntime(ctx, { enabled: false })
  assert.equal(ctx.handlers.size, 0)
  assert.equal(typeof dispose, 'function')
})
