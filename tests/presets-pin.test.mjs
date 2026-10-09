import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
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
import {
  PERSONA_SCALAR_INDENT as ROLES_SCALAR_INDENT,
  ROLES,
  generate as generateRolePresets,
  render as renderRolePresets,
} from '../scripts/sync-presets.mjs'

/**
 * Byte-pin test (borrowing-analysis A1): the generated agent-preset artifacts
 * checked into the repository must be byte-for-byte identical to what the sync
 * scripts render from the `prompts/agents/*.persona.md` single sources.
 *
 * The artifacts are no longer `presets/<role>/` directories: on dsh 0.2.x a
 * preset is a `@deepseek-ai/dsh-agent-preset` **row**, so the bundle ships
 * `cordis.patch.yml` (plugin install row + the Enhance preset) and
 * `presets/roles.patch.yml` (the five role presets), both generated.
 *
 * IMPORTANT: these tests must use `render()` (pure) and never `generate()` (writes).
 * An earlier version called the writing `generate()` and then read the file back,
 * so it compared the file against what it had just written — a hand-edited preset
 * was silently overwritten instead of reported, and `pnpm test` dirtied the tree.
 * The last tests lock that regression without touching tracked files.
 */
test('agent presets are regenerable byte-for-byte from persona sources', async () => {
  const bundle = await renderBundlePatch()
  const roles = await renderRolePresets()
  const entries = Object.entries({ ...bundle, ...roles })
  assert.equal(entries.length, 2, `expected cordis.patch.yml + presets/roles.patch.yml, got ${entries.length}`)

  for (const [genPath, content] of entries) {
    const onDisk = await readFile(genPath, 'utf8')
    assert.equal(
      onDisk,
      content,
      `${path.relative(process.cwd(), genPath)} is out of sync with the persona sources — run pnpm sync:presets && pnpm sync:enhance-preset`,
    )
  }
})

/** Assert one persona source is embedded verbatim under the given indent. */
async function assertEmbedded (body, role, indent, where) {
  const source = await readFile(path.join('prompts', 'agents', `${role}.persona.md`), 'utf8')
  const embedded = source.replace(/\n$/, '').split('\n').map(l => indent + l).join('\n')
  assert.ok(body.includes(embedded), `persona text for '${role}' not embedded at the expected indent in ${where}`)
}

test('every persona source is embedded by its generated preset at the generated indent', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]
  // The main orchestrator persona, then the four scoped sub-personas.
  await assertEmbedded(bundle, DSH_ENHANCE_MAIN.personaSource, PERSONA_SCALAR_INDENT, 'cordis.patch.yml')
  for (const sub of DSH_ENHANCE_SUBAGENTS) {
    await assertEmbedded(bundle, sub.role, SUBAGENT_PERSONA_INDENT, 'cordis.patch.yml')
  }

  const roles = Object.values(await renderRolePresets())[0]
  for (const role of Object.keys(ROLES)) {
    await assertEmbedded(roles, role, ROLES_SCALAR_INDENT, 'presets/roles.patch.yml')
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
  assert.match(bundle, /name: '@dsh-enhance\/dsh-enhance\/enhance-mode'/)
  // The plugin install row itself must stay in the same patch layer.
  assert.match(bundle, /^ {4}- id: dsh-enhance$/m)
})

test('only the Enhance preset mounts the enhance-mode row', async () => {
  const roles = Object.values(await renderRolePresets())[0]
  assert.equal(roles.includes('enhance-mode'), false, '角色预设不得挂 enhance-mode：没选 Enhance 的会话看不到这段')
  assert.match(roles, /@dsh-enhance\/dsh-enhance/)
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
  const roles = Object.values(await renderRolePresets())[0]

  for (const [name, body] of [['cordis.patch.yml', bundle], ['presets/roles.patch.yml', roles]]) {
    assert.match(body, /^ {8}- id: persona$/m, `${name}: persona row present`)
    assert.match(body, /^ {12}prefix: \|-$/m, `${name}: persona carries a prefix block scalar`)
    assert.match(body, /^ {12}suffix: Your working directory is \{\{cwd\}\}\.$/m, `${name}: persona restates the deployment suffix`)
    assert.doesNotMatch(body, /^ {12}text: \|-$/m, `${name}: dsh-persona has no \`text\` key`)
    assert.match(body, /^ {8}- id: agent-instructions$/m, `${name}: agent-instructions row present`)
    assert.match(body, /name: '@deepseek-ai\/dsh-workflow-ptc'/, `${name}: shipped workflow engine row`)
    assert.doesNotMatch(body, /dsh-workflow-worker-thread/, `${name}: stale worker-thread row must not come back`)
  }
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
    const rolesDir = path.join(tmp, 'presets')
    mkdirSync(rolesDir, { recursive: true })
    writeFileSync(path.join(rolesDir, 'roles.patch.yml'), tampered, 'utf8')

    const renderedBundle = await renderBundlePatch({ root: tmp })
    const renderedRoles = await renderRolePresets({ presetsRoot: rolesDir })

    assert.equal(
      readFileSync(path.join(tmp, 'cordis.patch.yml'), 'utf8'),
      tampered,
      'render() 必须是纯函数：不得改写已存在的补丁文件',
    )
    assert.notEqual(renderedBundle[path.join(tmp, 'cordis.patch.yml')], tampered, '被手改的内容必须与渲染结果不同')
    assert.notEqual(renderedRoles[path.join(rolesDir, 'roles.patch.yml')], tampered, '被手改的内容必须与渲染结果不同')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

/**
 * 纯度断言：`render()` 绝不写盘。用 mtime 而非内容比较——即使写入内容完全相同，
 * mtime 也会变化，因此这能抓到"悄悄重写"的行为。
 */
test('render() does not write: the generated artifacts keep their mtimes', async () => {
  const files = ['cordis.patch.yml', path.join('presets', 'roles.patch.yml')]
  const before = new Map(files.map(f => [f, statSync(f).mtimeMs]))
  await renderBundlePatch()
  await renderRolePresets()
  const after = new Map(files.map(f => [f, statSync(f).mtimeMs]))
  assert.deepEqual(after, before, 'render() 不应写盘；写盘只属于 generate()')
})

// generate() 仍是写盘入口（两个 sync:* 脚本用），此处只断言其存在性与形状，
// 不实际调用以免污染工作树。
test('generate() remains the writing entry point', () => {
  assert.equal(typeof generateBundlePatch, 'function')
  assert.equal(typeof generateRolePresets, 'function')
})

// 生成区的缩进常量是脚本与测试共用的同一份契约：改缩进必须两侧同时改。
test('the shared indent constants describe the generated nesting', () => {
  assert.equal(PLUGINS_INDENT.length, 8)
  assert.equal(PERSONA_SCALAR_INDENT.length, PLUGINS_INDENT.length + 6)
  assert.equal(SUBAGENT_PERSONA_INDENT.length, PLUGINS_INDENT.length + 10)
  assert.equal(ROLES_SCALAR_INDENT.length, PLUGINS_INDENT.length + 6)
})
