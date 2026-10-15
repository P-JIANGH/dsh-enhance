// Advisor companion-review unit tests: severity envelope parsing and the
// emission guard (de-dupe + rate limit). These pin the pure logic that the
// runtime relies on, independent of the live dsh loop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAdvisorEmission, declaresNoEmission } from '../lib/features/advisor/severity.js'
import { createEmissionGuard } from '../lib/features/advisor/emission-guard.js'
import { runReviewCall, registerAdvisorRuntime } from '../lib/features/advisor/runtime.js'

test('[advisor-severity] NONE marker → null', () => {
  assert.equal(parseAdvisorEmission('ADVISOR: NONE'), null)
  assert.equal(parseAdvisorEmission('Some text\nADVISOR: NONE\nmore'), null)
  assert.equal(parseAdvisorEmission(''), null)
  assert.equal(parseAdvisorEmission('no marker here'), null)
})

test('[advisor-severity] declaresNoEmission 区分"明确回 NONE"与"根本没给信封"', () => {
  // parseAdvisorEmission 对两者都返回 null，所以诊断面需要这个判别器：
  // 前者是契约内的沉默（正常结局），后者才是格式问题。
  assert.equal(declaresNoEmission('ADVISOR: NONE'), true)
  assert.equal(declaresNoEmission('Some text\nADVISOR: NONE\nmore'), true)
  assert.equal(declaresNoEmission('ADVISOR: none'), true)
  assert.equal(declaresNoEmission('Looks fine to me.'), false)
  assert.equal(declaresNoEmission(''), false)
  assert.equal(declaresNoEmission('ADVISOR: nit\nTidy this up'), false)
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
  const { text, error } = await runReviewCall(llm, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    messages: [],
    system: 'sys',
  })
  assert.equal(text, 'ADVISOR: concern\nThe timeout is too aggressive.')
  assert.equal(error, null)
})

test('[advisor-run] runReviewCall 把失败原因交回来，而不是静默 null', async () => {
  // 真实形态：会话亲和的 provider 拒绝无 sessionId 的请求，返回 400 + 这行文本。
  const llm = {
    stream: () => (async function* () { throw new Error('Request is missing x-opencode-session') })(),
  }
  const { text, error } = await runReviewCall(llm, {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    messages: [],
  })
  assert.equal(text, null)
  assert.match(error, /x-opencode-session/, '失败原因必须能被回显到诊断面')
})

// ── runtime 接线：注册期捕获 llm + disposed 守卫（真实会话里出现过的缺陷） ──────────

/** 造一个够 runtime 抽取增量、回注、并带会话身份的假 main agent。 */
function fakeAgent (id = 'main-1') {
  return {
    id,
    session: {
      id,
      // 会话身份是 provider 路由的依据（OpenCode Go 靠它出 x-opencode-session）。
      header: { id: `session-${id}` },
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
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  const handler = ctx.handlers.get('agent/turn-stopping')
  assert.equal(typeof handler, 'function')

  handle.dispose()
  handler({ agent: fakeAgent() })
  await new Promise(r => setTimeout(r, 50))

  assert.equal(counter.calls, 0, 'dispose 后不得再发起审查（避免在已失活 scope 上做副作用）')
})

test('[advisor-run] enabled:false 不注册任何监听器', () => {
  const ctx = fakeCtx(concernLlm({ calls: 0 }))
  const handle = registerAdvisorRuntime(ctx, { enabled: false })
  assert.equal(ctx.handlers.size, 0)
  assert.equal(typeof handle.dispose, 'function')
  // 关掉的 runtime 也必须能被诊断面读到「关」，否则 doctor 会把它显示成未接线。
  assert.equal(handle.status().enabled, false)
})

test('[advisor-run] agent 已销毁后不再发起审查', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter))
  registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent('main-gone')

  ctx.handlers.get('agent/disposed')({ agent })
  ctx.handlers.get('agent/turn-stopping')({ agent })
  await new Promise(r => setTimeout(r, 50))

  assert.equal(counter.calls, 0, 'agent/disposed 之后的 turn 边界不得再调模型')
})

test('[advisor-run] transcript 不可读时为 skip，不是 FAILED 噪声', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter))
  registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent('main-throws')
  // 真实会话在关机竞争里会这样抛：读已销毁 agent 的 transcript。
  agent.session.deriveMessages = () => { throw new Error('cannot get required service "agents" in inactive context') }

  ctx.handlers.get('agent/turn-stopping')({ agent })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(counter.calls, 0, '读不到 transcript 应跳过审查')
})

test('[advisor-run] 回注时 agent 已失活 → 丢弃而非 FAILED（实驱定位的真实缺陷）', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter))
  registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent('main-dead')
  // 会话关闭时 agent.steer 会抛 inactive context；此时建议只能丢弃。
  agent.steer = () => { throw new Error('cannot get required service "agents" in inactive context') }

  const logs = []
  const origError = console.error
  console.error = (...args) => { logs.push(args.join(' ')) }
  try {
    ctx.handlers.get('agent/turn-stopping')({ agent })
    await new Promise(r => setTimeout(r, 80))
  } finally {
    console.error = origError
  }

  assert.equal(counter.calls, 1, '建议已经算出来了（这一步是异步的，无法预知会话会关闭）')
  // 不得报 review FAILED（那会把"送不到"误报成"审查失败"）；应记为丢弃 skip。
  assert.equal(logs.some(l => l.includes('review FAILED')), false, `不应报 FAILED：\n${logs.join('\n')}`)
  assert.equal(logs.some(l => l.includes('no longer accepts messages')), true, `应记为丢弃 skip：\n${logs.join('\n')}`)
})

// ── 会话身份 + 诊断状态（2026-10-15 实机定位的静默失效） ────────────────────────
// 实机现象：advisor「没有动作」。根因是复核请求不带 sessionId，而默认路由的
// provider（opencode-go）要求会话亲和头——端点回 400 `missing x-opencode-session`，
// 运行时只往 stderr 写 trace。这两组测试把「带上身份」和「失败可见」钉住。

test('[advisor-run] 复核请求带主会话 id（会话亲和 provider 的硬要求）', async () => {
  const seen = []
  const llm = {
    stream: (options) => {
      seen.push(options)
      return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })()
    },
  }
  const ctx = fakeCtx(llm)
  registerAdvisorRuntime(ctx, { enabled: true })
  ctx.handlers.get('agent/turn-stopping')({ agent: fakeAgent('main-sid') })

  assert.equal(await waitFor(() => seen.length > 0), true, '应发起一次复核调用')
  assert.equal(
    seen[0].sessionId,
    'session-main-sid',
    '缺 sessionId 时 OpenCode Go 会回 400 missing x-opencode-session —— 复核必须带上会话身份',
  )
})

test('[advisor-run] 复核调用失败时记录 failed + 原因 + 路由（诊断面据此回显）', async () => {
  const llm = {
    stream: () => (async function* () { throw new Error('Request is missing x-opencode-session') })(),
  }
  const ctx = fakeCtx(llm)
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  ctx.handlers.get('agent/turn-stopping')({ agent: fakeAgent('main-fail') })

  await waitFor(() => handle.status().outcome !== null)
  const status = handle.status()
  assert.equal(status.outcome, 'failed')
  assert.equal(status.reviews, 1, '真正打到模型的调用才计入 reviews')
  assert.match(status.detail, /x-opencode-session/)
  assert.equal(status.route, 'deepseek-official/deepseek-v4-flash')
  assert.equal(typeof status.lastReviewAt, 'string')
})

test('[advisor-run] 成功回注后状态记为 delivered，且 status 返回副本', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter))
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent('main-ok')
  ctx.handlers.get('agent/turn-stopping')({ agent })

  await waitFor(() => agent.steered.length > 0)
  const status = handle.status()
  assert.equal(status.outcome, 'delivered')
  assert.match(status.detail, /concern/)
  status.reviews = 999
  assert.equal(handle.status().reviews, 1, 'status 必须是副本，调用方改不动运行时状态')
})

test('[advisor-run] 明确回 NONE → none（契约内的沉默，与"格式不符"分开记）', async () => {
  const llm = {
    stream: () => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'ADVISOR: NONE' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
  const ctx = fakeCtx(llm)
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent('main-none')
  ctx.handlers.get('agent/turn-stopping')({ agent })

  await waitFor(() => handle.status().outcome !== null)
  const status = handle.status()
  assert.equal(status.outcome, 'none', '13 字的 ADVISOR: NONE 是正常结局，不是格式失败')
  assert.match(status.detail, /NONE/)
  assert.equal(agent.injected.length + agent.steered.length, 0, '沉默不产生任何回注')
})

test('[advisor-run] 回答里没有信封 → no-emission，并把回答样本回显出来', async () => {
  const llm = {
    stream: () => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'Looks fine to me.\nNothing  to\nraise.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
  const ctx = fakeCtx(llm)
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  ctx.handlers.get('agent/turn-stopping')({ agent: fakeAgent('main-quiet') })

  await waitFor(() => handle.status().outcome !== null)
  const status = handle.status()
  assert.equal(status.outcome, 'no-emission')
  // 样本要单行化（诊断回显是一行），并带上模型真正说了什么。
  assert.match(status.detail, /Looks fine to me\. Nothing to raise\./)
})

test('[advisor-run] 负控制：请求不带 sessionId 时，provider 的 400 会被如实记为 failed', async () => {
  // 这条钉住因果链：把 sessionId 透传删掉，OpenCode Go 会拒（实测文本见下），
  // 而运行时必须把「调用失败 + 原因」记下来，而不是继续静默。
  const seen = []
  const llm = {
    stream: (options) => {
      seen.push(options)
      if (options.sessionId === undefined) {
        return (async function* () { throw new Error('400: Request is missing x-opencode-session') })()
      }
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: 'ADVISOR: NONE' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const ctx = fakeCtx(llm)
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent('main-no-sid')
  // 先证明带 identity 时不会被拒：
  ctx.handlers.get('agent/turn-stopping')({ agent })
  await waitFor(() => handle.status().outcome !== null)
  assert.equal(seen[0].sessionId, 'session-main-no-sid')
  assert.equal(handle.status().outcome, 'none', '带 sessionId 的调用成功（模型回 NONE → 契约内的沉默）')

  // 再把 identity 抽掉（模拟"忘了透传"），断言失败被如实记录：
  delete agent.session.header
  agent.session.deriveMessages = () => ([
    { role: 'user', content: [{ type: 'text', text: 'second turn please review' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'more work' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'even more work' }] },
  ])
  ctx.handlers.get('agent/turn-stopping')({ agent })
  await waitFor(() => handle.status().outcome === 'failed')
  const status = handle.status()
  assert.equal(status.outcome, 'failed')
  assert.match(status.detail, /x-opencode-session/)
  assert.equal(status.reviews, 2)
})

test('[advisor-run] 结局 dropped：建议算出但 agent 已不再接收', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter))
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  const agent = fakeAgent('main-drop')
  agent.steer = () => { throw new Error('cannot get required service "agents" in inactive context') }

  const origError = console.error
  console.error = () => {}
  try {
    ctx.handlers.get('agent/turn-stopping')({ agent })
    await waitFor(() => handle.status().outcome === 'dropped')
  } finally {
    console.error = origError
  }
  assert.equal(handle.status().outcome, 'dropped', '送不到 ≠ 审查失败，诊断面必须区分')
  assert.match(handle.status().detail, /concern/)
})

test('[advisor-run] 结局 guarded：同一建议在冷却窗口内被抑制', async () => {
  const counter = { calls: 0 }
  const ctx = fakeCtx(concernLlm(counter))
  const handle = registerAdvisorRuntime(ctx, { enabled: true })
  const msgs = [
    { role: 'user', content: [{ type: 'text', text: 'first ask' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'first work' }] },
  ]
  const agent = fakeAgent('main-guard')
  agent.session.deriveMessages = () => msgs

  ctx.handlers.get('agent/turn-stopping')({ agent })
  await waitFor(() => handle.status().outcome === 'delivered')

  // 让增量非空（否则第二轮会被记为"没有可审的增量"），但建议正文完全相同。
  msgs.push({ role: 'assistant', content: [{ type: 'text', text: 'second work' }] })
  ctx.handlers.get('agent/turn-stopping')({ agent })
  await waitFor(() => handle.status().outcome === 'guarded')

  assert.equal(handle.status().outcome, 'guarded')
  assert.equal(agent.steered.length, 1, '被节流的那条不得回注')
})

