// delivery-gate 交付门卫 —— 单测占位（反向测试）
//
// 目的：把"完成声明拦截"做成可回归验证的契约。当前 M3 未落地真实
// delivery-gate 实现，此处先用占位 stub 定义判定与状态机的期望行为，
// 作为后续实现的规范（TDD 先行）。M3 落地后把 import 指向真实实现。
//
// 反向场景（用户要求重点覆盖）：
//   - agent "声称完成"但无证据 → 必须判定为未通过并触发回灌（不能放行）
//   - 同理，靠启发式完成声明最容易误放行，测试先从"恶意通过"角度攻击
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ---- 占位实现：M3 落地后替换为真实 delivery-gate 模块 ----

// 完成声明判定：给定 agent 的输出信号，判断它是否"宣称完成/交付"。
// 启发式特征（架构 5.2.1）：
//   - 陈述句带完成语态（"完成了""交付""可以了""搞定"）
//   - 调用提交/结束类工具
//   - 出现 goal done / completion 标记
export function detectCompletionClaim (signals) {
  const { text = '', calledTools = [], hasDoneTag = false } = signals ?? {}
  const completionPhrases = [
    '完成了', '交付', '可以了', '搞定', '做完了', '全部完成',
    'delivered', 'done', 'complete', 'finished', 'shipped'
  ]
  const hitPhrase = completionPhrases.some(p => text.includes(p))
  const completionTools = ['git_commit', 'finish', 'end_task', 'complete']
  const hitTool = calledTools.some(t => completionTools.includes(t))
  return Boolean(hitPhrase || hitTool || hasDoneTag)
}

// delivery-gate 状态转移：返回下一阶段。
//   phases: 'idle' | 'review' | 'working' | 'delivered'
//   输入: 是否检测到完成声明 + 回归审查是否通过
export function deliveryGateStep ({ declared = false, reviewPassed = false, phase = 'idle' }) {
  if (phase === 'idle') {
    // 入口契约已注入，待执行；等完成声明
    return declared ? 'review' : 'working'
  }
  if (phase === 'review') {
    // 回归审查核验证据
    return reviewPassed ? 'delivered' : 'working'
  }
  if (phase === 'working') {
    // 压缩上下文 + 重注入入口契约，等下一轮完成声明
    return declared ? 'review' : 'working'
  }
  if (phase === 'delivered') return 'delivered'
  return 'working'
}

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

test('[completion-claim] TODO(已知局限)：进展汇报含"完成了X"会被误判', () => {
  // 已知歧义：启发式只看关键词，会把"已完成第一个文件的修改，继续第二个"
  // 误判为完整完成声明。M3 实现应结合 goal 状态/ todo 清况消歧——
  // 完成声明 ="goal 达成 + 证据齐全"，而非仅文本含"完成"。
  assert.equal(detectCompletionClaim({ text: '我已经完成了第一个文件的修改，接下来继续看第二个' }), true)
  // 期望改进后为 false，但当前启发式命中为 true —— 记录为已知局限
})

// ---- 提示：M3 落地接真实实现时，替换上方占位 import 并保持反向契约 ----
// 核心断言集合（不应随实现改动而放宽）：
//   [] 假完成声明（无证据）→ 回归审查，未过回灌
//   [] 完成声明是唯一进入审查的入口
//   [] 仅审查通过才 delivered
//   [] completion-claim 检测对"进展汇报"不误触发（false-positive 最小化）
