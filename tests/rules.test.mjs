// rules-injector 单测：只读本插件自己的规则目录。
//
// 触发原因（按 docs/value-assessment.md §3 做减法）：`AGENTS.md` 已由原生
// `@deepseek-ai/dsh-agent-instructions` 完整覆盖——`$DSH_HOME/AGENTS.md` + 项目根→cwd
// 的目录链 + 覆盖文件（CLAUDE.md 等）+ 嵌套重发现，并折进 durable history。本插件再
// 读一次就是把同一份内容重复塞进 prompt。下面的负向断言钉住这条边界。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverRules } from '../lib/hooks/rules-injector.js'

test('[rules] discovers .dsh-enhance/rules/*.md sorted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-rules-'))
  const rulesDir = join(dir, '.dsh-enhance', 'rules')
  mkdirSync(rulesDir, { recursive: true })
  writeFileSync(join(rulesDir, 'b.md'), 'Beta')
  writeFileSync(join(rulesDir, 'a.md'), 'Alpha')
  const out = discoverRules(dir)
  assert.ok(out.includes('a.md') && out.includes('b.md'))
  assert.ok(out.indexOf('a.md') < out.indexOf('b.md'), 'sorted by name')
  rmSync(dir, { recursive: true, force: true })
})

test('[rules] returns undefined when no rules found and caches it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-rules-'))
  assert.equal(discoverRules(dir), undefined)
  assert.equal(discoverRules(dir), undefined)
  rmSync(dir, { recursive: true, force: true })
})

test('[rules] 不读 AGENTS.md（原生指令链负责）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-rules-'))
  try {
    writeFileSync(join(dir, 'AGENTS.md'), 'Follow the repo.')
    assert.equal(discoverRules(dir), undefined, 'AGENTS.md 不属于本插件的规则目录')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[rules] AGENTS.md 与自有规则同时存在时只注入自有规则', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-rules-'))
  try {
    const rulesDir = join(dir, '.dsh-enhance', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(dir, 'AGENTS.md'), 'Root instructions')
    writeFileSync(join(rulesDir, 'own.md'), 'Own rule')
    const out = discoverRules(dir)
    assert.ok(out.includes('Own rule'))
    assert.equal(out.includes('Root instructions'), false, '不得重复注入 AGENTS.md')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
