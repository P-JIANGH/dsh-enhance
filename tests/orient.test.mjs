// orient 开场钩子单测：注入消息只点名**本插件打包**的技能。
//
// 触发原因：真实 --llm 实驱里，主模型自己报出——启动钩子把会话里全部 31 个技能
// （含 user-agents 用户池）都称作「打包技能」，而 doctor 只认 3 个 bundled。
// 把别人的技能算作本插件的贡献，是用户可见的错误陈述。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerSessionStartHook } from '../lib/hooks/orient.js'

/** 假 ctx：只提供 skills.list + 事件捕获。 */
function fakeCtx (skills) {
  const handlers = new Map()
  return {
    skills: { list: async () => skills },
    on (event, handler) { handlers.set(event, handler); return () => handlers.delete(event) },
    handlers,
  }
}

/** 假 agent：记录注入的消息文本。 */
function fakeAgent (cwd = '/repo') {
  const injected = []
  return {
    injected,
    session: { header: { cwd, id: 's1' } },
    inject (msg) { injected.push(msg) },
  }
}

/** 取注入消息里的纯文本。 */
function textOf (msg) {
  return (msg?.content ?? []).map(b => b.text ?? '').join('\n')
}

/** 触发一次会话开始并取回注入文本。 */
async function orientText (skills) {
  const ctx = fakeCtx(skills)
  registerSessionStartHook(ctx, { enabled: true })
  const agent = fakeAgent()
  await ctx.handlers.get('agent/session-start')({ agent })
  // inject 在 async 回调里，等一个微任务队列排空。
  await new Promise(r => setTimeout(r, 10))
  return agent.injected.map(textOf).join('\n')
}

test('[orient] 只点名本插件提供的技能，不含其它 provider', async () => {
  const text = await orientText([
    { name: 'code-review', source: 'bundled', provider: 'dsh-enhance' },
    { name: 'git-workflow', source: 'bundled', provider: 'dsh-enhance' },
    { name: 'tdd', source: 'bundled', provider: 'dsh-enhance' },
    // 关键回归：其它 provider 的 source 同样是 bundled —— 按 source 过滤会误收。
    { name: 'office-docx', source: 'bundled', provider: 'desktop-office' },
    { name: 'dingtalk-robot', source: 'user-agents', provider: 'user-agents' },
  ])
  assert.match(text, /打包技能：code-review、git-workflow、tdd/)
  assert.doesNotMatch(text, /office-docx/)
  assert.doesNotMatch(text, /dingtalk-robot/)
})

test('[orient] 没有任何本插件技能时不出现"打包技能"列举行', async () => {
  const text = await orientText([{ name: 'office-docx', source: 'bundled', provider: 'desktop-office' }])
  assert.doesNotMatch(text, /本会话可用的打包技能/)
  // 仍然要有开场信息与可执行起点
  assert.match(text, /dsh-enhance 已在本会话生效/)
  assert.match(text, /ulw/)
})

test('[orient] 技能发现失败不影响开场（降级为无技能行）', async () => {
  const ctx = fakeCtx([])
  ctx.skills.list = async () => { throw new Error('registry down') }
  registerSessionStartHook(ctx, { enabled: true })
  const agent = fakeAgent()
  await ctx.handlers.get('agent/session-start')({ agent })
  await new Promise(r => setTimeout(r, 10))
  const text = agent.injected.map(textOf).join('\n')
  assert.match(text, /dsh-enhance 已在本会话生效/)
  assert.doesNotMatch(text, /本会话可用的打包技能/)
})

test('[orient] enabled:false 不注册监听器', () => {
  const ctx = fakeCtx([])
  const dispose = registerSessionStartHook(ctx, { enabled: false })
  assert.equal(ctx.handlers.size, 0)
  assert.equal(typeof dispose, 'function')
})
