import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { render as renderPresets, generate as generatePresets } from '../scripts/sync-presets.mjs'
import { render as renderDshEnhance, generate as generateDshEnhance } from '../scripts/sync-dsh-enhance-preset.mjs'
import { MAIN as DSH_ENHANCE_MAIN, SUBAGENTS as DSH_ENHANCE_SUBAGENTS } from '../scripts/sync-dsh-enhance-preset.mjs'

/**
 * Byte-pin test (borrowing-analysis A1): the generated preset files checked into
 * `presets/` must be byte-for-byte identical to what the sync scripts render from
 * the `prompts/agents/*.persona.md` single sources.
 *
 * IMPORTANT: these tests must use `render()` (pure) and never `generate()` (writes).
 * An earlier version called the writing `generate()` and then read the file back,
 * so it compared the file against what it had just written — a hand-edited preset
 * was silently overwritten instead of reported, and `pnpm test` dirtied the tree.
 * The last two tests lock that regression without touching tracked files.
 */
test('presets are regenerable byte-for-byte from persona sources', async () => {
  const generated = await renderPresets()
  const dshEnhance = await renderDshEnhance()
  const entries = Object.entries({ ...generated, ...dshEnhance })
  assert.ok(entries.length >= 12, `expected 5 roles x2 files + dsh-enhance x2, got ${entries.length}`)

  for (const [genPath, content] of entries) {
    const onDisk = await readFile(genPath, 'utf8')
    assert.equal(
      onDisk,
      content,
      `${path.relative(process.cwd(), genPath)} is out of sync with prompts/agents sources — run pnpm sync:presets`,
    )
  }
})

test('every persona source is referenced by its generated preset', async () => {
  const generated = await renderPresets()
  const dshEnhance = await renderDshEnhance()
  const agentFiles = Object.keys({ ...generated, ...dshEnhance }).filter(p => p.endsWith('agent.cordis.yml'))

  for (const agentFile of agentFiles) {
    const role = path.basename(path.dirname(agentFile))
    const body = (generated[agentFile] ?? dshEnhance[agentFile])
    // Every role this preset embodies must have its persona source embedded.
    const roles = role === DSH_ENHANCE_MAIN.id ? [DSH_ENHANCE_MAIN.personaSource, ...DSH_ENHANCE_SUBAGENTS.map(s => s.role)] : [role]
    for (const srcRole of roles) {
      const source = await readFile(path.join('prompts', 'agents', `${srcRole}.persona.md`), 'utf8')
      const plain = source.replace(/\n$/, '')
      // The generated file embeds the persona text (indented 6 spaces); compare
      // against the de-indented 6-space lines so whitespace is exact.
      const embedded = body
        .split('\n')
        .filter(l => l.startsWith('      '))
        .map(l => l.slice(6))
        .join('\n')
      assert.ok(embedded.includes(plain), `persona text for '${srcRole}' not found in generated ${path.relative(process.cwd(), agentFile)}`)
    }
  }
})

/**
 * Regression lock for the self-fulfilling byte-pin defect: a hand-edited preset
 * must be *detected*, not silently regenerated. Renders into a throwaway root
 * that already contains a tampered preset and asserts (a) `render()` did not
 * rewrite it and (b) the rendered content differs from the tampered bytes — so the
 * comparison in test 1 would fail. Uses a temp dir so tracked files stay untouched.
 */
test('a hand-edited preset is detected, not silently overwritten (byte-pin is real)', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'presets-pin-'))
  try {
    const tampered = 'name: Planner\ndescription: TAMPER_MARKER_XYZ\n'
    mkdirSync(path.join(tmp, 'planner'), { recursive: true })
    writeFileSync(path.join(tmp, 'planner', 'preset.yml'), tampered, 'utf8')

    const rendered = await renderPresets({ presetsRoot: tmp })
    const renderedContent = rendered[path.join(tmp, 'planner', 'preset.yml')]

    assert.equal(
      readFileSync(path.join(tmp, 'planner', 'preset.yml'), 'utf8'),
      tampered,
      'render() 必须是纯函数：不得改写已存在的预设文件',
    )
    assert.notEqual(
      renderedContent,
      tampered,
      '被手改的内容必须与渲染结果不同，否则 pin 断言无法发现手改',
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

/** 递归收集目录下所有文件。 */
function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/**
 * 纯度断言：`render()` 绝不写盘。用 mtime 而非内容比较——即使写入内容完全相同，
 * mtime 也会变化，因此这能抓到"悄悄重写"的行为。
 */
test('render() does not write: presets/ mtimes are unchanged', async () => {
  const files = walk(path.join('presets'))
  const before = new Map(files.map(f => [f, statSync(f).mtimeMs]))
  await renderPresets()
  await renderDshEnhance()
  const after = new Map(files.map(f => [f, statSync(f).mtimeMs]))
  assert.deepEqual(after, before, 'render() 不应写盘；写盘只属于 generate()')
})

// generate() 仍是写盘入口（pnpm sync:presets 用），此处只断言其存在性与形状，
// 不实际调用以免污染工作树。
test('generate() remains the writing entry point', () => {
  assert.equal(typeof generatePresets, 'function')
  assert.equal(typeof generateDshEnhance, 'function')
})
