// delivery-gate **hook** 集成测试：把 features/delivery-gate 的纯判定接到
// agent/turn-stopping 之后，钩子必须真的拦截声明、落结构化报告、结算 work 与写令牌。
//
// 覆盖（对应 docs/known-issues.md P0-6/P0-7）：
// - 无 verify 绑定 → 报告记 unmeasured（绝不假装 passed）；
// - verify 通过 → passed + work 置 completed + active_work 清空 + 令牌释放；
// - verify 失败 → failed + work 保持 active + 只 steer 一次（冷却期内不重复）；
// - 非完成语态 / 仍有未清 todo → 不产生任何记录；
// - 同一 turn 只判定一次（幂等）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerDeliveryGateHook, resetDeliveryGateState } from '../lib/hooks/delivery-gate.js'
import { boulderFileFor } from '../lib/features/boulder/store.js'

const SESSION = 'session-hooktest'

/** 造一个隔离工作目录：.dsh-enhance/boulder.json + .dsh-enhance/goals/goal_<session>.json。 */
function sandbox ({ goalStatus = 'done', remainingTodos = 0, verify } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-gate-hook-'))
  // 状态目录必须先建：store 自己的原子写会递归建目录，但这里是我们手工预置。
  mkdirSync(join(dir, '.dsh-enhance'), { recursive: true })
  const work = {
    id: 'w1',
    plan_name: 'hook test',
    status: 'active',
    updated_at: Date.now(),
    session_ids: [SESSION],
  }
  if (verify) work.verify = verify
  writeFileSync(boulderFileFor(dir), JSON.stringify({
    revision: 1,
    active_work_id: 'w1',
    exec_holder: SESSION,
    works: { w1: work },
  }, null, 2))
  const goals = join(dir, '.dsh-enhance', 'goals')
  mkdirSync(goals, { recursive: true })
  writeFileSync(join(goals, `goal_${SESSION}.json`), JSON.stringify({
    id: SESSION,
    objective: 'hook acceptance',
    status: goalStatus,
    remaining_todos: remainingTodos,
    created_at: Date.now(),
    updated_at: Date.now(),
  }, null, 2))
  return dir
}

/** 假 agent：够钩子读 header / 消息并回注。 */
function fakeAgent (cwd, text) {
  const steered = []
  return {
    id: 'main',
    steered,
    session: {
      header: { cwd, id: SESSION },
      deriveMessages: () => (text === null ? [] : [
        { role: 'user', content: [{ type: 'text', text: 'do the work' }] },
        { role: 'assistant', content: [{ type: 'text', text }] },
      ]),
    },
    steer (m) { steered.push(m) },
    inject () {},
  }
}

/** 假 ctx：捕获 turn-stopping 监听器。 */
function hookFor () {
  const handlers = new Map()
  const ctx = { on (event, handler) { handlers.set(event, handler); return () => handlers.delete(event) } }
  registerDeliveryGateHook(ctx, true)
  return handlers.get('agent/turn-stopping')
}

function readBoulder (dir) {
  return JSON.parse(readFileSync(boulderFileFor(dir), 'utf8'))
}

/** 写一个固定退出码的 verify 脚本。 */
function verifyScript (dir, exitCode) {
  const ext = process.platform === 'win32' ? '.cmd' : '.sh'
  const p = join(dir, `verify-${exitCode}${ext}`)
  writeFileSync(p, process.platform === 'win32'
    ? `@echo off\nexit /b ${exitCode}\n`
    : `#!/bin/sh\nexit ${exitCode}\n`)
  return p
}

const CLAIM = '全部完成了，可以交付了。'

test('[gate-hook] 无 verify 绑定 → 记 unmeasured，不假装 passed', async () => {
  resetDeliveryGateState()
  const dir = sandbox()
  try {
    const handler = hookFor()
    const agent = fakeAgent(dir, CLAIM)
    await handler({ agent, turn: 1 })

    const b = readBoulder(dir)
    assert.equal(b.completion_log.length, 1)
    assert.equal(b.completion_log[0].state, 'unmeasured', '没有可执行证据时必须是 unmeasured')
    assert.equal(b.completion_log[0].phase, 'review')
    assert.match(b.completion_log[0].claim, /完成/)
    assert.equal(b.works.w1.status, 'completed', 'P0-7：完成时必须同步 work 状态')
    assert.equal(b.active_work_id, undefined)
    assert.equal(b.exec_holder, undefined, '交付后应释放写令牌')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[gate-hook] verify 通过 → passed', async () => {
  resetDeliveryGateState()
  const dir = sandbox()
  try {
    const script = verifyScript(dir, 0)
    const b0 = readBoulder(dir)
    b0.works.w1.verify = script
    writeFileSync(boulderFileFor(dir), JSON.stringify(b0, null, 2))

    const handler = hookFor()
    await handler({ agent: fakeAgent(dir, CLAIM), turn: 1 })

    const b = readBoulder(dir)
    assert.equal(b.completion_log[0].state, 'passed')
    assert.equal(b.works.w1.status, 'completed')
    assert.equal(b.active_work_id, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[gate-hook] verify 失败 → failed、不放行、只 steer 一次', async () => {
  resetDeliveryGateState()
  const dir = sandbox()
  try {
    const script = verifyScript(dir, 1)
    const b0 = readBoulder(dir)
    b0.works.w1.verify = script
    writeFileSync(boulderFileFor(dir), JSON.stringify(b0, null, 2))

    const handler = hookFor()
    const agent = fakeAgent(dir, CLAIM)
    await handler({ agent, turn: 1 })

    const b = readBoulder(dir)
    assert.equal(b.completion_log[0].state, 'failed')
    assert.equal(b.works.w1.status, 'active', '未过不得把 work 标成 completed')
    assert.equal(b.active_work_id, 'w1', '未过不得清除 active_work')
    assert.equal(b.exec_holder, SESSION, '未过不得释放写令牌')
    assert.equal(agent.steered.length, 1, '应回注一次回归提醒')

    // 冷却期内再来一个 turn：不再重复 steer。
    await handler({ agent, turn: 2 })
    assert.equal(agent.steered.length, 1, '冷却期内不得重复 steer（防死循环）')
    const b2 = readBoulder(dir)
    assert.equal(b2.completion_log.length, 2, '失败应逐轮留痕')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[gate-hook] 非完成语态 → 不判定、不记录', async () => {
  resetDeliveryGateState()
  const dir = sandbox()
  try {
    const handler = hookFor()
    await handler({ agent: fakeAgent(dir, '我先把接口写完了，接下来继续处理测试。'), turn: 1 })

    const b = readBoulder(dir)
    assert.equal(b.completion_log, undefined, '进展汇报不应产生交付记录')
    assert.equal(b.works.w1.status, 'active')
    assert.equal(b.active_work_id, 'w1')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[gate-hook] 有未清 todo 的完成声明 → 交给 todo-continuation，门卫不启动', async () => {
  resetDeliveryGateState()
  const dir = sandbox({ remainingTodos: 2 })
  try {
    const handler = hookFor()
    await handler({ agent: fakeAgent(dir, CLAIM), turn: 1 })

    const b = readBoulder(dir)
    assert.equal(b.completion_log, undefined)
    assert.equal(b.works.w1.status, 'active')
    assert.equal(b.active_work_id, 'w1')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[gate-hook] 同一 turn 幂等：只判定一次', async () => {
  resetDeliveryGateState()
  const dir = sandbox()
  try {
    const handler = hookFor()
    const agent = fakeAgent(dir, CLAIM)
    await handler({ agent, turn: 7 })
    await handler({ agent, turn: 7 })

    const b = readBoulder(dir)
    assert.equal(b.completion_log.length, 1, '同一 turn 边界不得重复记录')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[gate-hook] 没有活跃 work 时完全不动', async () => {
  resetDeliveryGateState()
  const dir = sandbox()
  try {
    const b0 = readBoulder(dir)
    delete b0.active_work_id
    writeFileSync(boulderFileFor(dir), JSON.stringify(b0, null, 2))

    const handler = hookFor()
    await handler({ agent: fakeAgent(dir, CLAIM), turn: 1 })
    const b = readBoulder(dir)
    assert.equal(b.completion_log, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[gate-hook] enabled:false 不注册监听器', () => {
  const handlers = new Map()
  const ctx = { on (event, handler) { handlers.set(event, handler); return () => handlers.delete(event) } }
  const dispose = registerDeliveryGateHook(ctx, false)
  assert.equal(handlers.size, 0)
  assert.equal(typeof dispose, 'function')
})

test('[gate-hook] 目录里没有 boulder.json 时静默不抛', async () => {
  resetDeliveryGateState()
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-gate-empty-'))
  try {
    const handler = hookFor()
    await handler({ agent: fakeAgent(dir, CLAIM), turn: 1 })
    assert.equal(existsSync(boulderFileFor(dir)), false, '无 work 不应凭空建 boulder.json')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
