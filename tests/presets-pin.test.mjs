import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  MAIN as DSH_ENHANCE_MAIN,
  PERSONA_SCALAR_INDENT,
  PLUGINS_INDENT,
  SUBAGENTS as DSH_ENHANCE_SUBAGENTS,
  SUBAGENT_PERSONA_INDENT,
  generate as generateBundlePatch,
  render as renderBundlePatch,
} from '../scripts/sync-dsh-enhance-preset.mjs'

/**
 * Byte-pin test (borrowing-analysis A1): the generated agent-preset artifact
 * checked into the repository must be byte-for-byte identical to what the sync
 * script renders from the `prompts/agents/*.persona.md` single sources.
 *
 * The artifact is `cordis.patch.yml` — the plugin install row plus the one
 * **Enhance** preset row (a `@deepseek-ai/dsh-agent-preset` row; on dsh 0.2.x a
 * preset is a row, not a `presets/<id>/` directory). The five role presets were
 * removed on 2026-10-09: the user wants exactly one preset of ours in the
 * roster, and the negative pins below are what keep it that way.
 *
 * IMPORTANT: these tests must use `render()` (pure) and never `generate()` (writes).
 * An earlier version called the writing `generate()` and then read the file back,
 * so it compared the file against what it had just written — a hand-edited preset
 * was silently overwritten instead of reported, and `pnpm test` dirtied the tree.
 * The last tests lock that regression without touching tracked files.
 */
test('the bundle patch is regenerable byte-for-byte from persona sources', async () => {
  const bundle = await renderBundlePatch()
  const entries = Object.entries(bundle)
  assert.equal(entries.length, 1, `expected exactly cordis.patch.yml, got ${entries.length} artifact(s)`)

  for (const [genPath, content] of entries) {
    const onDisk = await readFile(genPath, 'utf8')
    assert.equal(
      onDisk,
      content,
      `${path.relative(process.cwd(), genPath)} is out of sync with the persona sources — run pnpm sync:enhance-preset`,
    )
  }
})

/** Assert one persona source is embedded verbatim under the given indent. */
async function assertEmbedded (body, role, indent, where) {
  const source = await readFile(path.join('prompts', 'agents', `${role}.persona.md`), 'utf8')
  const embedded = source.replace(/\n$/, '').split('\n').map(l => indent + l).join('\n')
  assert.ok(body.includes(embedded), `persona text for '${role}' not embedded at the expected indent in ${where}`)
}

test('every persona source is embedded by the generated preset at the generated indent', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]
  // The main orchestrator persona, then the four scoped sub-personas.
  await assertEmbedded(bundle, DSH_ENHANCE_MAIN.personaSource, PERSONA_SCALAR_INDENT, 'cordis.patch.yml')
  for (const sub of DSH_ENHANCE_SUBAGENTS) {
    await assertEmbedded(bundle, sub.role, SUBAGENT_PERSONA_INDENT, 'cordis.patch.yml')
  }
})

test('the Enhance preset row carries the plugin row and the enhance-mode section row', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]
  // Declarative preset identity on 0.2.x.
  assert.match(bundle, new RegExp(`- id: ${DSH_ENHANCE_MAIN.rowId}\\n      name: '@deepseek-ai/dsh-agent-preset'`))
  assert.match(bundle, new RegExp(`^        id: ${DSH_ENHANCE_MAIN.id}$`, 'm'))
  assert.match(bundle, /^        name: Enhance$/m)
  // The row that turns the deep-work contract into a preset-scoped prompt section.
  assert.match(bundle, /^ {8}- id: enhance-mode$/m)
  assert.match(bundle, /name: '@p-jiangh\/dsh-enhance\/enhance-mode'/)
  // The plugin install row itself must stay in the same patch layer.
  assert.match(bundle, /^ {4}- id: dsh-enhance$/m)
})

/**
 * The roster the user asked for: exactly one preset of ours. This is a negative
 * pin on purpose — adding a second `@deepseek-ai/dsh-agent-preset` row (the old
 * planner/scout/librarian/task/reviewer role presets) must go red, and so must
 * re-introducing a second patch file that carries more of them.
 */
test('the repository ships exactly one preset row of ours, and it is Enhance', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]
  const rows = bundle.match(/name: '@deepseek-ai\/dsh-agent-preset'/g) ?? []
  assert.equal(rows.length, 1, `expected one agent-preset row, found ${rows.length}`)
  assert.match(bundle, /^ {4}- id: preset-enhance$/m, 'the single row is preset-enhance')

  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(patch, './cordis.patch.yml', 'the bundle declares exactly one patch file')
  await assert.rejects(stat('presets/roles.patch.yml'), 'the retired role-preset fragment must not exist')
})

/**
 * Real-runtime row contract (2026-10-09). The byte-pin above only locks bytes;
 * these assertions lock the row *shapes* the live 0.2.0-rc.2 runtime actually
 * accepts, because the pre-row generator's shapes were latent defects that the
 * retired directory mechanism never loaded:
 *  - `@deepseek-ai/dsh-persona` is scope-only and takes `prefix` (required) /
 *    `suffix`; it has no `text` key, so the old `text: |-` row made every preset
 *    fail activation with "$.prefix missing required value";
 *  - the Web/desktop surface disables the host-plane `agent-instructions` row,
 *    so a preset that omits it loses the AGENTS.md chain;
 *  - `workflow-worker-thread` is not the shipped engine row (the shipped
 *    `standard`/`ptc` presets use `workflow-ptc`) and a stale copy in a profile
 *    resolves to 0.1.x, gets disabled by the compatibility preflight, and
 *    leaves `tool-workflow` waiting for `workflowEngine` forever.
 */
test('preset rows keep the shapes the live runtime accepts (persona prefix, agent-instructions, workflow-ptc)', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]
  const name = 'cordis.patch.yml'

  assert.match(bundle, /^ {8}- id: persona$/m, `${name}: persona row present`)
  assert.match(bundle, /^ {12}prefix: \|-$/m, `${name}: persona carries a prefix block scalar`)
  assert.match(bundle, /^ {12}suffix: Your working directory is \{\{cwd\}\}\.$/m, `${name}: persona restates the deployment suffix`)
  assert.doesNotMatch(bundle, /^ {12}text: \|-$/m, `${name}: dsh-persona has no \`text\` key`)
  assert.match(bundle, /^ {8}- id: agent-instructions$/m, `${name}: agent-instructions row present`)
  assert.match(bundle, /name: '@deepseek-ai\/dsh-workflow-ptc'/, `${name}: shipped workflow engine row`)
  assert.doesNotMatch(bundle, /dsh-workflow-worker-thread/, `${name}: stale worker-thread row must not come back`)
})

/**
 * Regression lock for the self-fulfilling byte-pin defect: a hand-edited preset
 * must be *detected*, not silently regenerated. Renders into a throwaway root
 * that already contains a tampered artifact and asserts (a) `render()` did not
 * rewrite it and (b) the rendered content differs from the tampered bytes — so the
 * comparison in test 1 would fail. Uses a temp dir so tracked files stay untouched.
 */
test('a hand-edited patch is detected, not silently overwritten (byte-pin is real)', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'presets-pin-'))
  try {
    const tampered = '- insert:\n    - id: TAMPER_MARKER_XYZ\n'
    writeFileSync(path.join(tmp, 'cordis.patch.yml'), tampered, 'utf8')

    const rendered = await renderBundlePatch({ root: tmp })

    assert.equal(
      readFileSync(path.join(tmp, 'cordis.patch.yml'), 'utf8'),
      tampered,
      'render() 必须是纯函数：不得改写已存在的补丁文件',
    )
    assert.notEqual(rendered[path.join(tmp, 'cordis.patch.yml')], tampered, '被手改的内容必须与渲染结果不同')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

/**
 * 纯度断言：`render()` 绝不写盘。用 mtime 而非内容比较——即使写入内容完全相同，
 * mtime 也会变化，因此这能抓到"悄悄重写"的行为。
 */
test('render() does not write: the generated artifact keeps its mtime', async () => {
  const file = 'cordis.patch.yml'
  const before = statSync(file).mtimeMs
  await renderBundlePatch()
  const after = statSync(file).mtimeMs
  assert.equal(after, before, 'render() 不应写盘；写盘只属于 generate()')
})

// generate() 仍是写盘入口（sync:enhance-preset 脚本用），此处只断言其存在性与形状，
// 不实际调用以免污染工作树。
test('generate() remains the writing entry point', () => {
  assert.equal(typeof generateBundlePatch, 'function')
})

// 生成区的缩进常量是脚本与测试共用的同一份契约：改缩进必须两侧同时改。
test('the shared indent constants describe the generated nesting', () => {
  assert.equal(PLUGINS_INDENT.length, 8)
  assert.equal(PERSONA_SCALAR_INDENT.length, PLUGINS_INDENT.length + 6)
  assert.equal(SUBAGENT_PERSONA_INDENT.length, PLUGINS_INDENT.length + 10)
})
