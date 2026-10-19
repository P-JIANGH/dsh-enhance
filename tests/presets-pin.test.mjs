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
  generate as generateBundlePatch,
  render as renderBundlePatch,
} from '../scripts/sync-dsh-enhance-preset.mjs'

/**
 * Byte-pin test (borrowing-analysis A1): the generated agent-preset artifact
 * checked into the repository must be byte-for-byte identical to what the sync
 * script renders from the `prompts/agents/*.persona.md` single sources.
 *
 * The artifact is `cordis.patch.yml` — the plugin install row, the four scoped
 * subagent rows, the four role **child presets** those rows select, and the
 * **Enhance** preset row (on dsh 0.2.x a preset is a row, not a `presets/<id>/`
 * directory). The five old standalone role presets were removed on 2026-10-09;
 * the four child presets came back on 2026-10-19 because dsh 0.2.1 deleted
 * `dsh-tool-subagent`'s `persona`/`toolFilter` fields — a scoped subagent's
 * persona and tool surface can only live in an agent preset now (see the
 * `scoped subagents select a child preset` test below).
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
  // The main orchestrator persona (inside the Enhance preset) and the four role
  // personas (each inside its own child preset) all sit at the same nesting.
  await assertEmbedded(bundle, DSH_ENHANCE_MAIN.personaSource, PERSONA_SCALAR_INDENT, 'cordis.patch.yml')
  for (const sub of DSH_ENHANCE_SUBAGENTS) {
    await assertEmbedded(bundle, sub.role, PERSONA_SCALAR_INDENT, `cordis.patch.yml (preset ${sub.presetId})`)
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
 * 名单契约（2026-10-19 重写）。旧契约是"本插件在名单里只有一条预设"，那在 0.2.1 上
 * 已不可能：宿主删掉了 `tool-subagent` 的 `persona`/`toolFilter`，角色人格与工具面
 * 只能由子预设承载，而宿主把**每一条**注册的预设都列进名单（没有隐藏字段）。现在的
 * 契约是：五条预设 = Enhance + 四条角色组合，每条角色组合都被一个 scoped 工具用
 * `agentPreset` 引用（不存在"声明了却没人用"的孤儿预设），且补丁文件仍然只有一个。
 */
test('the roster is Enhance plus the four role compositions, each referenced by a scoped tool', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]
  const rows = bundle.match(/name: '@deepseek-ai\/dsh-agent-preset'/g) ?? []
  assert.equal(rows.length, 1 + DSH_ENHANCE_SUBAGENTS.length, `expected 1 + ${DSH_ENHANCE_SUBAGENTS.length} agent-preset rows`)
  assert.match(bundle, /^ {4}- id: preset-enhance$/m, 'the orchestrator row stays preset-enhance')
  for (const sub of DSH_ENHANCE_SUBAGENTS) {
    assert.match(bundle, new RegExp(`^ {4}- id: preset-enhance-${sub.role}$`, 'm'), `row for ${sub.role}`)
    assert.match(bundle, new RegExp(`^ {8}id: ${sub.presetId}$`, 'm'), `preset id for ${sub.role}`)
  }

  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(patch, './cordis.patch.yml', 'the bundle declares exactly one patch file')
  await assert.rejects(stat('presets/roles.patch.yml'), 'the retired role-preset fragment must not exist')
})

/**
 * 宿主形状契约（2026-10-19，桌面宿主 `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.2`）。
 *
 * `@deepseek-ai/dsh-tool-subagent` 删除了 `persona` 与 `toolFilter` 两个 config
 * 字段；带上其中任何一个的行在激活时直接抛错（宿主原文：
 * `tool-subagent: persona is no longer supported; configure persona and tool
 * plugins in an Agent Preset and select it with agentPreset (spawn only)`）。
 * 预设只要有一行 failed 就整体 broken —— 选择器显示"加载失败"、绑定该预设的会话
 * 打不开（`agent-preset/invalid`）。所以角色人格+工具面必须落在子预设里，工具行用
 * `agentPreset` 选中它。这条契约两侧都钉：旧字段不得回来；出现 `agentPreset` 就必须
 * 有对应的预设声明。
 */
test('scoped subagents select a child preset instead of the retired persona/toolFilter fields', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]

  assert.doesNotMatch(bundle, /^\s+persona: \|-$/m, 'tool-subagent 的 persona 字段已被宿主删除')
  assert.doesNotMatch(bundle, /^\s+toolFilter:$/m, 'tool-subagent 的 toolFilter 字段已被宿主删除')
  assert.doesNotMatch(bundle, /backgroundMode/, 'dsh-tool-subagent 0.2.1 的 schema 里没有 backgroundMode')

  const declared = new Set([...bundle.matchAll(/^ {8}id: (dsh-enhance-[a-z]+)$/gm)].map(m => m[1]))
  const declaredIds = new Set(DSH_ENHANCE_SUBAGENTS.map(sub => sub.presetId))
  for (const id of declaredIds) assert.ok(declared.has(id), `preset ${id} must be declared`)

  const refs = [...bundle.matchAll(/^\s+agentPreset: (\S+)$/gm)].map(m => m[1])
  assert.equal(refs.length, DSH_ENHANCE_SUBAGENTS.length, 'one agentPreset per scoped subagent')
  for (const ref of refs) assert.ok(declared.has(ref), `agentPreset ${ref} must name a declared preset`)

  // 工具面由子预设的插件行表达：read-only 角色不得带写工具，librarian 必须能搜网页。
  const roleBlocks = new Map()
  for (const sub of DSH_ENHANCE_SUBAGENTS) {
    const start = bundle.indexOf(`id: preset-enhance-${sub.role}\n`)
    assert.ok(start > 0, `${sub.role}: preset row present`)
    const next = bundle.indexOf('\n    - id: preset-', start + 1)
    roleBlocks.set(sub.role, bundle.slice(start, next === -1 ? undefined : next))
  }
  for (const role of ['scout', 'reviewer']) {
    const block = roleBlocks.get(role)
    assert.match(block, /write: false\n\s+edit: false/, `${role}: read-only tool surface`)
    assert.doesNotMatch(block, /dsh-tool-web/, `${role}: no web tools`)
  }
  assert.match(roleBlocks.get('librarian'), /dsh-tool-web/, 'librarian: web_search available')
  assert.match(roleBlocks.get('librarian'), /fetch: false/, 'librarian: web_fetch stays off (unmounted on the tool plane)')
  assert.match(roleBlocks.get('task'), /write: true\n\s+edit: true/, 'task: write/edit available')
  assert.match(roleBlocks.get('task'), /dsh-tool-todo/, 'task: todo_write available')
})

/**
 * Real-runtime row contract (2026-10-09, extended 2026-10-19). The byte-pin
 * above only locks bytes; these assertions lock the row *shapes* the live
 * runtime actually accepts, because the pre-row generator's shapes were latent
 * defects that the retired directory mechanism never loaded:
 *  - `@deepseek-ai/dsh-persona` is scope-only and takes `prefix` (required) /
 *    `suffix`; it has no `text` key, so the old `text: |-` row made every preset
 *    fail activation with "$.prefix missing required value";
 *  - the Web/desktop surface disables the host-plane `agent-instructions` row,
 *    so a preset that omits it loses the AGENTS.md chain;
 *  - `workflow-worker-thread` is not the shipped engine row (the shipped
 *    `standard`/`ptc` presets use `workflow-ptc`) and a stale copy in a profile
 *    resolves to 0.1.x, gets disabled by the compatibility preflight, and
 *    leaves `tool-workflow` waiting for `workflowEngine` forever;
 *  - 0.2.1's shipped `standard` composition added `time-context`,
 *    `tool-schedule`, `command-goal` and `present`, and dropped the persona's
 *    `{{cwd}}` suffix (the runtime context carries the working directory). We
 *    mirror all of it except `tool-schedule`, which has no 0.2.0-rc.2 build: a
 *    preset row naming a package the host lacks fails its import and breaks the
 *    whole preset, so that one row waits for the supported-host floor to move. This test is what makes the omission a decision instead of
 *    an oversight.
 */
test('preset rows keep the shapes the live runtime accepts (persona prefix, agent-instructions, 0.2.1 baseline)', async () => {
  const bundle = Object.values(await renderBundlePatch())[0]
  const name = 'cordis.patch.yml'

  assert.match(bundle, /^ {8}- id: persona$/m, `${name}: persona row present`)
  assert.match(bundle, /^ {12}prefix: \|-$/m, `${name}: persona carries a prefix block scalar`)
  assert.doesNotMatch(bundle, /^ {12}text: \|-$/m, `${name}: dsh-persona has no \`text\` key`)
  assert.doesNotMatch(bundle, /suffix: Your working directory is \{\{cwd\}\}/, `${name}: 0.2.1 standard dropped the persona suffix`)
  assert.match(bundle, /^ {8}- id: agent-instructions$/m, `${name}: agent-instructions row present`)
  assert.match(bundle, /^ {8}- id: time-context$/m, `${name}: 0.2.1 time-context row present`)
  assert.match(bundle, /^ {8}- id: command-goal$/m, `${name}: 0.2.1 command-goal row present`)
  assert.match(bundle, /^ {8}- id: present$/m, `${name}: 0.2.1 present row present`)
  assert.doesNotMatch(bundle, /dsh-tool-schedule/, `${name}: tool-schedule has no 0.2.0-rc.2 build; keep the preset loadable on 0.2.0 hosts`)
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
})
