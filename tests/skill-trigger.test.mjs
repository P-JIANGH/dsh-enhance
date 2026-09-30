// skill-trigger 单测：ulw 触发词判定 + 入口契约与单源逐字一致（防漂移）。
//
// 背景：ULTRAWORK_ENTRY 是为了「运行时不依赖打包后的文件布局」而从
// prompts/modes/ultrawork.md 镜像出来的常量。镜像一旦与源稿漂移，注入给模型的
// 契约就不再是审查过的那一份——实测漂移过一次（丢了「列成问题清单请用户确认」
// 「上下文/会话记录不一定是事实」与结尾指向 ultrawork-review.md 的一句）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ULTRAWORK_ENTRY, detectUlw } from '../lib/features/skill-trigger.js'

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
