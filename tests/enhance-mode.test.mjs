// enhance-mode 单测：常驻系统提示词段与单源逐字一致（防漂移），且注册契约正确。
//
// 背景：ENHANCE_MODE_TEXT 是为了「运行时不依赖打包后的文件布局」而从
// prompts/modes/enhance-mode.md 镜像出来的常量。镜像一旦与源稿漂移，模型看到的
// 契约就不再是审查过的那一份——历史上漂移过一次（丢了「列成问题清单请用户确认」
// 「上下文/会话记录不一定是事实」与结尾指向 review 文档的一句），所以这里是
// 逐字 pin，而不是「大致包含」。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ENHANCE_MODE_ORDER,
  ENHANCE_MODE_SECTION,
  ENHANCE_MODE_TEXT,
  apply,
  inject,
  name,
  registerEnhanceMode,
} from '../lib/enhance-mode.js'

/** 单源里 `<enhance-mode>` 之后（含标记）的全部内容，去掉首尾空白。 */
function entryFromSource () {
  const src = readFileSync('prompts/modes/enhance-mode.md', 'utf8')
  const start = src.indexOf('<enhance-mode>')
  assert.ok(start >= 0, 'prompts/modes/enhance-mode.md 必须包含 <enhance-mode> 标记')
  return src.slice(start).trim()
}

test('[enhance-mode] ENHANCE_MODE_TEXT 与 prompts/modes/enhance-mode.md 逐字一致', () => {
  assert.equal(
    ENHANCE_MODE_TEXT,
    entryFromSource(),
    'prompts/modes/enhance-mode.md 是单源：改它之后必须同步 src/enhance-mode.ts 的 ENHANCE_MODE_TEXT',
  )
})

test('[enhance-mode] 契约包含关键纪律句与结尾的 review 指向（漂移回归钉）', () => {
  // 这几个片段正是历史漂移中丢失的部分。
  assert.match(ENHANCE_MODE_TEXT, /列成问题清单请用户确认/)
  assert.match(ENHANCE_MODE_TEXT, /上下文\/会话记录不一定是事实/)
  assert.match(ENHANCE_MODE_TEXT, /docs\/prompts-review\/enhance-mode-review\.md/)
  assert.match(ENHANCE_MODE_TEXT, /^<enhance-mode>/)
  assert.match(ENHANCE_MODE_TEXT, /<\/enhance-mode>[\s\S]*$/)
})

test('[enhance-mode] 改名彻底：契约正文里不再出现 ulw / ultrawork', () => {
  assert.doesNotMatch(ENHANCE_MODE_TEXT, /ulw|ultrawork/i)
  assert.doesNotMatch(ENHANCE_MODE_TEXT, /<ultrawork-mode>/i)
})

/** 假 ctx：捕获 `systemPrompt.section` 与 `effect` 两处调用。 */
function fakeCtx () {
  const sections = []
  const effects = []
  return {
    sections,
    effects,
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    effect (factory, label) { effects.push(label); return factory() },
  }
}

test('[enhance-mode] 注册一个命名的常驻段落，文本就是单源正文', () => {
  const ctx = fakeCtx()
  const dispose = registerEnhanceMode(ctx)
  assert.equal(typeof dispose, 'function')
  assert.deepEqual(ctx.sections, [{
    name: ENHANCE_MODE_SECTION,
    order: ENHANCE_MODE_ORDER,
    text: ENHANCE_MODE_TEXT,
  }])
  assert.equal(ENHANCE_MODE_SECTION, 'dsh-enhance/enhance-mode')
  assert.equal(ENHANCE_MODE_ORDER, 1)
  // 段落注册必须挂在 effect 上（上游 systemPrompt.section 的 disposer 契约）。
  assert.equal(ctx.effects.length, 1)
  assert.match(ctx.effects[0], /enhance-mode/)
})

test('[enhance-mode] 模块导出就是一行可直接被 loader 挂载的插件', () => {
  assert.equal(name, 'dsh-enhance/enhance-mode')
  assert.deepEqual(inject, ['systemPrompt'])
  const ctx = fakeCtx()
  apply(ctx)
  assert.equal(ctx.sections.length, 1)
})
