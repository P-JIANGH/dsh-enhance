import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverRules } from '../lib/hooks/rules-injector.js'

test('[rules] discovers AGENTS.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omd-rules-'))
  writeFileSync(join(dir, 'AGENTS.md'), 'Follow the repo.')
  const out = discoverRules(dir)
  assert.ok(out.includes('AGENTS.md'))
  assert.ok(out.includes('Follow the repo.'))
  rmSync(dir, { recursive: true, force: true })
})

test('[rules] discovers .omd/rules/*.md sorted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omd-rules-'))
  const rulesDir = join(dir, '.omd', 'rules')
  mkdirSync(rulesDir, { recursive: true })
  writeFileSync(join(rulesDir, 'b.md'), 'Beta')
  writeFileSync(join(rulesDir, 'a.md'), 'Alpha')
  const out = discoverRules(dir)
  assert.ok(out.includes('a.md') && out.includes('b.md'))
  assert.ok(out.indexOf('a.md') < out.indexOf('b.md'), 'sorted by name')
  rmSync(dir, { recursive: true, force: true })
})

test('[rules] returns undefined when no rules found and caches it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omd-rules-'))
  assert.equal(discoverRules(dir), undefined)
  assert.equal(discoverRules(dir), undefined)
  rmSync(dir, { recursive: true, force: true })
})

test('[rules] combines AGENTS + .omd/rules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omd-rules-'))
  const rulesDir = join(dir, '.omd', 'rules')
  mkdirSync(rulesDir, { recursive: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Root')
  writeFileSync(join(rulesDir, 'deep.md'), 'Deep')
  const out = discoverRules(dir)
  assert.ok(out.includes('Root') && out.includes('Deep'))
  rmSync(dir, { recursive: true, force: true })
})
