// skill-trigger 单测：ulw 触发词判定 + 入口契约与单源逐字一致（防漂移）。
//
// 背景：ULTRAWORK_ENTRY 是为了「运行时不依赖打包后的文件布局」而从
// prompts/modes/ultrawork.md 镜像出来的常量。镜像一旦与源稿漂移，注入给模型的
// 契约就不再是审查过的那一份——实测漂移过一次（丢了「列成问题清单请用户确认」
// 「上下文/会话记录不一定是事实」与结尾指向 ultrawork-review.md 的一句）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ULTRAWORK_ENTRY, detectUlw, registerSkillTrigger } from '../lib/features/skill-trigger.js'

/** 单源里 `<ultrawork-mode>` 之后（含标记）的全部内容，去掉首尾空白。 */
function entryFromSource () {
  const src = readFileSync('prompts/modes/ultrawork.md', 'utf8')
  const start = src.indexOf('<ultrawork-mode>')
  assert.ok(start >= 0, 'prompts/modes/ultrawork.md 必须包含 <ultrawork-mode> 标记')
  return src.slice(start).trim()
}

test('[skill-trigger] ULTRAWORK_ENTRY 与 prompts/modes/ultrawork.md 逐字一致', () => {
  assert.equal(
    ULTRAWORK_ENTRY,
    entryFromSource(),
    'prompts/modes/ultrawork.md 是单源：改它之后必须同步 src/features/skill-trigger.ts 的 ULTRAWORK_ENTRY',
  )
})

test('[skill-trigger] 入口契约包含关键纪律句（漂移回归钉）', () => {
  // 这三个片段正是历史漂移中丢失的部分。
  assert.match(ULTRAWORK_ENTRY, /列成问题清单请用户确认/)
  assert.match(ULTRAWORK_ENTRY, /上下文\/会话记录不一定是事实/)
  assert.match(ULTRAWORK_ENTRY, /ultrawork-review\.md/)
  assert.match(ULTRAWORK_ENTRY, /^<ultrawork-mode>/)
  assert.match(ULTRAWORK_ENTRY, /<\/ultrawork-mode>$|<\/ultrawork-mode>[\s\S]*$/)
})

test('[skill-trigger] detectUlw 只在整词出现时触发', () => {
  assert.equal(detectUlw('please use ulw for this'), true)
  assert.equal(detectUlw('ULW'), true)
  assert.equal(detectUlw('switch to ultrawork mode'), true)
  assert.equal(detectUlw('ULTRAWORK'), true)
  // 子串不得误触发
  assert.equal(detectUlw('anultraworkflow'), false)
  assert.equal(detectUlw('bulwrap'), false)
  assert.equal(detectUlw(''), false)
  assert.equal(detectUlw('just a normal request'), false)
})

/** 假 ctx：只捕获 `agent/pre-step` 的 waterfall 监听器。 */
function triggerCtx () {
  const handlers = new Map()
  return {
    handlers,
    on (event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
  }
}

/** 造一条"别人注入的上下文"消息（kind 各异，正文都含触发词）。 */
function injected (kind, text) {
  const source = kind === 'plugin:other' ? { kind: 'plugin:other' } : { kind }
  return createUserMessage({ content: [{ type: 'text', text }], source })
}

/** 造一条用户真实输入。 */
function human (text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** 跑一次 pre-step，返回监听器的返回值。 */
async function runTrigger (messages, { agentId = 'a1', entry } = {}) {
  const ctx = triggerCtx()
  registerSkillTrigger(ctx, { enabled: true, ...(entry === undefined ? {} : { entry }) })
  const handler = ctx.handlers.get('agent/pre-step')
  const decision = { kind: 'enter', messages }
  const result = await handler({ agent: { id: agentId }, step: 1 }, async () => decision)
  return { result, decision }
}

test('[skill-trigger] 用户自己打的 ulw 才注入入口契约', async () => {
  const { result } = await runTrigger([human('用 ulw 干这件事')])
  assert.equal(result.kind, 'enter')
  assert.equal(result.messages.length, 2, '注入的消息排在用户消息之前')
  assert.match(result.messages[0].content[0].text, /^<ultrawork-mode>/)
  assert.equal(result.messages[1].content[0].text, '用 ulw 干这件事')
})

// 真机回归（2026-10-08）：第一个 step 的 messages 里除了用户输入，还有
// agent-instructions（本仓库 AGENTS.md 里就写着 ulw）、skill-catalog、
// runtime-context、会话标题请求。旧实现把它们全当"用户提示词"扫，于是**新会话
// 必进深度工作模式**，与用户说了什么无关。
test('[skill-trigger] 别人注入的上下文里出现触发词不得点燃模式', async () => {
  const { result, decision } = await runTrigger([
    injected('agent-instructions', 'AGENTS.md 里提到 ulw 深度工作模式'),
    injected('skill-catalog', '可用技能：ulw 入口'),
    injected('runtime-context', 'ultrawork 相关上下文'),
    injected('plugin:other', '别的插件通知里也写了 ulw'),
    human('只是一句普通请求'),
  ])
  assert.equal(result, decision, '不应改动 decision')
  assert.equal(result.messages.length, 5)
})

test('[skill-trigger] 注入的入口契约本身不是 user 来源（防 fork 后再点燃）', async () => {
  const { result } = await runTrigger([human('ulw')])
  assert.equal(result.messages[0].source.kind, 'plugin:dsh-enhance')
  assert.notEqual(result.messages[0].source.kind, 'user')
})

test('[skill-trigger] 每个 agent 只点燃一次', async () => {
  const ctx = triggerCtx()
  registerSkillTrigger(ctx, { enabled: true })
  const handler = ctx.handlers.get('agent/pre-step')
  const decision = { kind: 'enter', messages: [human('ulw')] }
  const first = await handler({ agent: { id: 'b1' }, step: 1 }, async () => decision)
  const second = await handler({ agent: { id: 'b1' }, step: 1 }, async () => decision)
  assert.equal(first.kind, 'enter')
  assert.equal(second, decision, '同一 agent 不再注入')
})

test('[skill-trigger] enabled:false 不注册监听器', () => {
  const ctx = triggerCtx()
  const dispose = registerSkillTrigger(ctx, { enabled: false })
  assert.equal(ctx.handlers.size, 0)
  assert.equal(typeof dispose, 'function')
})

