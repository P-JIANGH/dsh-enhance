// delivery-gate 交付门卫 —— 单测（反向测试 + 真实实现契约）
//
// 目的：把"完成声明拦截"做成可回归验证的契约。测试直接从真实
// delivery-gate 模块 import，覆盖状态机 + 完成声明启发式 + goal 消歧。
// 反向场景（用户要求重点覆盖）：
//   - agent "声称完成"但无证据 → 必须判定为未通过并触发回灌（不能放行）
//   - 同理，靠启发式完成声明最容易误放行，测试先从"恶意通过"角度攻击
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectCompletionClaim,
  deliveryGateStep,
  findTampered,
  buildReport,
  runVerify,
} from '../lib/features/delivery-gate/index.js'

// ---- 反向测试：假完成声明必须被拦 ----

test('[delivery-gate] 假完成声明(无证据) 触发回归审查而非直接放行', () => {
  // agent 宣称完成，但回归审查未过 → 应回到 working（回灌契约），不得 delivered
  assert.equal(deliveryGateStep({ declared: true, reviewPassed: false, phase: 'review' }), 'working')
})

test('[delivery-gate] 完成声明才进入审查；未声明保持在 working', () => {
  assert.equal(deliveryGateStep({ declared: false, reviewPassed: false, phase: 'idle' }), 'working')
  assert.equal(deliveryGateStep({ declared: true, reviewPassed: false, phase: 'idle' }), 'review')
})

test('[delivery-gate] 仅当回归审查通过才放行交付', () => {
  assert.equal(deliveryGateStep({ declared: true, reviewPassed: true, phase: 'review' }), 'delivered')
})

test('[delivery-gate] 未过 → 回到 working，等待重注入契约后新一轮声明', () => {
  // 模拟：审查未过 → working → 压缩+重注入 → 新一轮仍未声明 → 保持 working
  assert.equal(deliveryGateStep({ phase: 'working', declared: false, reviewPassed: false }), 'working')
  // 新一轮完成声明且通过 → delivered
  assert.equal(deliveryGateStep({ phase: 'working', declared: true, reviewPassed: true }), 'review')
  // 但不能跳过审查
  assert.notEqual(deliveryGateStep({ phase: 'working', declared: true, reviewPassed: true }), 'delivered')
})

// ---- 完成声明检测启发式：恶意攻击角度 ----

test('[completion-claim] 检出显式完成语态', () => {
  assert.equal(detectCompletionClaim({ text: '我已经全部完成了', hasDoneTag: false }), true)
  assert.equal(detectCompletionClaim({ text: '这个功能可以交付了' }), true)
})

test('[completion-claim] 检出提交/结束工具调用', () => {
  assert.equal(detectCompletionClaim({ calledTools: ['git_commit'] }), true)
  assert.equal(detectCompletionClaim({ calledTools: ['finish'] }), true)
})

test('[completion-claim] 检出 done 标记', () => {
  assert.equal(detectCompletionClaim({ hasDoneTag: true }), true)
})

test('[completion-claim] false-positive：不含完成信号的不触发', () => {
  assert.equal(detectCompletionClaim({ text: '正在处理，稍等' }), false)
  assert.equal(detectCompletionClaim({ text: '', calledTools: ['read'], hasDoneTag: false }), false)
})

test('[completion-claim] goal 消歧：进展汇报+未清todo 不误判为完成(c13)', () => {
  // 原占位中的已知误判场景：文本含"完成了X"但实际是进展汇报。
  // 真实实现结合 goal 的 remainingTodos>0 消歧 → 应判为 false。
  assert.equal(
    detectCompletionClaim({ text: '我已经完成了第一个文件的修改，接下来继续看第二个', remainingTodos: 3 }),
    false,
  )
})

// ---- §5.2.2 verify 绑定 / 反攻击 / 轨迹 ----

test('[delivery-gate] findTampered 检出被改的受保护文件并放行未改', () => {
  assert.deepEqual(findTampered({ a: 'h1', b: 'h2' }, { a: 'h1', b: 'h2' }), [])
  assert.deepEqual(findTampered({ a: 'h1' }, { a: 'hX' }), ['a'])
})

test('[delivery-gate] buildReport 用状态标记 unmeasured/tampered/passed', () => {
  const unmeasured = buildReport({ text: 'done' }, undefined, [])
  assert.equal(unmeasured.state, 'unmeasured')
  const tampered = buildReport({ text: 'done' }, true, ['x'])
  assert.equal(tampered.state, 'tampered')
  const passed = buildReport({ text: 'done' }, true, [])
  assert.equal(passed.state, 'passed')
  const failed = buildReport({ text: 'done' }, false, [])
  assert.equal(failed.state, 'failed')
})

test('[delivery-gate] runVerify 通过 exit 0 判 ok、非 0 判 fail', async () => {
  const { writeFileSync, chmodSync, mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'omd-verify-'))
  // Build tiny executable wrappers that exit 0 / 1.
  const ext = process.platform === 'win32' ? '.cmd' : '.sh'
  const ok = join(dir, `ok${ext}`)
  const bad = join(dir, `bad${ext}`)
  const okBody = process.platform === 'win32'
    ? '@echo off\nexit /b 0\n'
    : '#!/bin/sh\nexit 0\n'
  const badBody = process.platform === 'win32'
    ? '@echo off\nexit /b 1\n'
    : '#!/bin/sh\nexit 1\n'
  writeFileSync(ok, okBody)
  writeFileSync(bad, badBody)
  if (process.platform !== 'win32') { chmodSync(ok, 0o755); chmodSync(bad, 0o755) }

  const okRes = await runVerify(ok, dir)
  const badRes = await runVerify(bad, dir)
  assert.equal(okRes.ok, true)
  assert.equal(badRes.ok, false)
  assert.equal(badRes.exitCode, 1)
})

// ---- 提示：反向契约核心断言集合 ----
//   [] 假完成声明（无证据）→ 回归审查，未过回灌
//   [] 完成声明是唯一进入审查的入口
//   [] 仅审查通过才 delivered
//   [] completion-claim 检测对"进展汇报"不误触发（false-positive 最小化，c13 已实现）
