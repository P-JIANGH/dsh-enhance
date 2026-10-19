/**
 * sync-dsh-enhance-preset: render this bundle's whole `cordis.patch.yml` —
 * the plugin install row, the four scoped-subagent **child presets**, and the
 * `preset-enhance` agent-preset row.
 *
 * Why the patch file is the artifact: on dsh 0.2.x an agent preset is a
 * *plugin row*, not a directory. `@deepseek-ai/dsh-agent-preset` takes
 * `{ id, name, description, order, plugins }` and registers it into
 * `ctx.agentPresets` when the row activates; the retired directory mechanism
 * (`$DSH_HOME/.agent-presets/<id>/`) is not scanned any more. So the preset
 * must ship as a row inside the same bundle patch that installs the plugin —
 * exactly how the built-in `standard` / `ptc` / `minimal` / `cordis` presets
 * ship inside `dsh-web-app`'s `presets/*.patch.yml`. Generating the whole
 * `cordis.patch.yml` (rather than a fragment some hand-written file includes)
 * keeps one writer per file and one artifact the byte-pin test can lock.
 *
 * The preset's `config.plugins` is the session's **entire** composition —
 * there is no inheritance — so it restates the persona single-source
 * (`prompts/agents/dsh-enhance.persona.md`), the tool plane the Web surface
 * disables on the host plane (mirroring the shipped `standard` preset), the
 * four scoped subagent rows (scout / librarian / reviewer / task), this
 * bundle's own plugin row, and the `@p-jiangh/dsh-enhance/enhance-mode` row
 * that makes the deep-work contract a permanent system-prompt section of every
 * session on this preset.
 *
 * **Scoped subagents are child presets since dsh 0.2.1.** `dsh-tool-subagent`
 * removed its `persona` and `toolFilter` config fields; a row that still sets
 * either now fails activation with
 * `tool-subagent: persona is no longer supported; configure persona and tool
 * plugins in an Agent Preset and select it with agentPreset (spawn only)`.
 * Because one failed row makes the whole preset `broken` (the session picker
 * shows "load failed" and sessions bound to that preset refuse to open), each
 * role's persona + tool surface moved into its own
 * `@deepseek-ai/dsh-agent-preset` row, and the tool row now selects it with
 * `agentPreset`. The cost is upstream's own design: every registered preset is
 * listed in the roster, so the four role compositions are visible beside
 * `Enhance` (they are independently usable session compositions, not private
 * plumbing). See `docs/roles.md` for the role table and `AGENTS.md` for the
 * settings-surface discipline.
 *
 * @module scripts/sync-dsh-enhance-preset
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const personasRoot = path.join(root, 'prompts', 'agents')

/** Where the generated patch file lives, relative to the package root. */
export const PATCH_FILE = 'cordis.patch.yml'

/** Main preset metadata (`config.id` is the preset identity; the row id is `preset-<id>`). */
export const MAIN = {
  id: 'enhance',
  rowId: 'preset-enhance',
  personaSource: 'dsh-enhance',
  name: 'Enhance',
  title: 'Enhance（dsh-enhance 编排者）',
  description: '开箱即用的增强模式：常驻深度工作提示词段 + 工作纪律 + 打包技能 + 交付门卫，并按需编排 scout/librarian/reviewer/task 子代理。',
  order: 5,
}

/**
 * Sub-persona scoped subagents, keyed by role.
 *
 * Each entry renders **two** rows: a child `@deepseek-ai/dsh-agent-preset`
 * carrying the role's persona single-source and its tool surface, and a
 * `@deepseek-ai/dsh-tool-subagent` tool row that selects that preset with
 * `agentPreset`. Both belong inside the parent preset's `delegation` group so
 * the tool rows share its isolate realm and the host `subagents` registry with
 * the generic `subagent` tool.
 *
 * `fs` maps onto `@deepseek-ai/dsh-tool-fs`'s `read`/`readImage`/`write`/`edit`
 * switches and `web`/`todo` onto `@deepseek-ai/dsh-tool-web`'s `search` (fetch
 * stays off: the tool plane disables `web_fetch`, so allowing it would point a
 * child at an unmounted tool) and `@deepseek-ai/dsh-tool-todo`. Together they
 * reproduce the retired `toolFilter.allow` lists exactly **on 0.2.1 hosts**:
 * scout/reviewer = read/glob/grep, librarian = + web_search, task = +
 * write/edit/todo_write. On a 0.2.0 host neither the switches nor `agentPreset`
 * exist yet; schemastery passes the unknown keys through, so those hosts get a
 * degraded — not broken — composition (children inherit the parent's surface).
 */
export const SUBAGENTS = [
  {
    role: 'scout',
    toolName: 'subagent_scout',
    presetId: 'dsh-enhance-scout',
    presetName: 'Scout',
    presetDescription: 'Enhance 的只读侦察组合：subagent_scout 工具用它塑造子会话（read/glob/grep）。',
    order: 11,
    fs: { read: true, readImage: false, write: false, edit: false },
    web: false,
    todo: false,
  },
  {
    role: 'librarian',
    toolName: 'subagent_librarian',
    presetId: 'dsh-enhance-librarian',
    presetName: 'Librarian',
    presetDescription: 'Enhance 的查证组合：subagent_librarian 工具用它塑造子会话（read/glob/grep/web_search）。',
    order: 12,
    fs: { read: true, readImage: false, write: false, edit: false },
    web: true,
    todo: false,
  },
  {
    role: 'reviewer',
    toolName: 'subagent_reviewer',
    presetId: 'dsh-enhance-reviewer',
    presetName: 'Reviewer',
    presetDescription: 'Enhance 的审查组合：subagent_reviewer 工具用它塑造子会话（read/glob/grep）。',
    order: 13,
    fs: { read: true, readImage: false, write: false, edit: false },
    web: false,
    todo: false,
  },
  {
    role: 'task',
    toolName: 'subagent_task',
    presetId: 'dsh-enhance-task',
    presetName: 'Task',
    presetDescription: 'Enhance 的执行组合：subagent_task 工具用它塑造子会话（read/glob/grep/write/edit/todo_write）。',
    order: 14,
    fs: { read: true, readImage: false, write: true, edit: true },
    web: false,
    todo: true,
  },
]

/** Indent of the preset's `plugins:` key and of each plugin row inside it. */
export const PLUGINS_INDENT = '        '
/**
 * Indent of a persona block-scalar line inside `config.plugins`: a preset row
 * sits at four spaces, its `plugins:` key at {@link PLUGINS_INDENT}, and the
 * persona's `prefix: |-` content six further. Exported so the byte-pin test
 * de-indents with the same constant.
 */
export const PERSONA_SCALAR_INDENT = PLUGINS_INDENT + '      '

/** Render a string as a `|-` scalar with the given indent. */
function scalar(raw, indent) {
  return raw.replace(/\n$/, '').split('\n').map(l => indent + l).join('\n')
}

/**
 * Re-indent a flat (0-indent) entry list by `indent`, leaving blank lines
 * blank. Uniform indentation preserves every nested structure and block
 * scalar, so the flat renderers above stay readable and testable.
 */
export function indentBlock(block, indent) {
  return block.split('\n').map(line => (line === '' ? '' : indent + line)).join('\n')
}

/**
 * Build the tool-subagent row for one role. The row carries no persona and no
 * tool filter: on dsh >= 0.2.1 those fields are gone, and both live in the
 * role's child preset ({@link rolePresetRow}), selected here by `agentPreset`.
 */
export function subagentRow(sub) {
  return [
    `    # dsh-enhance-scoped subagent: ${sub.role} (composition: ${sub.presetId})`,
    `    - id: dsh-enhance-subagent-${sub.role}`,
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    '        provider: spawn',
    `        toolName: ${sub.toolName}`,
    `        agentPreset: ${sub.presetId}`,
  ].join('\n')
}

/**
 * The `@deepseek-ai/dsh-compaction-basic` group both the main preset and every
 * role preset mount, flat (0-indent). Mirrors the shipped `standard` preset's
 * compaction group so long sessions — including one-shot children — prune
 * instead of overflowing.
 */
export function compactionGroup() {
  return [
    '- id: compaction',
    '  name: cordis:group',
    '  group: true',
    '  isolate:',
    '    compaction: true',
    '    toolResultPruner: true',
    '  config:',
    '    - id: compaction-basic',
    "      name: '@deepseek-ai/dsh-compaction-basic'",
    '',
    '    - id: command-compact',
    "      name: '@deepseek-ai/dsh-command-compact'",
    '',
    '    - id: tool-result-pruner',
    "      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'",
    '      config:',
    '        thresholdChars: 8192',
    '        headChars: 4096',
    '        tailChars: 1024',
  ]
}

/**
 * A role child preset's `config.plugins` entry list, flat (0-indent).
 *
 * Deliberately minimal: the role persona (which *shadows* the preset's own
 * persona section — it does not set `complete`, because the old subagent
 * `persona` option was a scoping shadow and the child still needs the runtime
 * sections), the AGENTS.md instruction chain, the time-context section, the
 * role's tool rows, and the compaction group. It does **not** mount
 * `enhance-mode` or this bundle's plugin row: those are the orchestrator's
 * contract, not a worker's.
 */
export function rolePresetPlugins(sub, personaText) {
  const rows = [
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: |-',
    scalar(personaText, '      '),
    '',
    // The Web/desktop surface disables the host-plane agent-instructions row and
    // lets each preset mount its own, so a preset that omits it loses the
    // AGENTS.md chain.
    '- id: agent-instructions',
    "  name: '@deepseek-ai/dsh-agent-instructions'",
    '  config:',
    '    maxBytes: 65536',
    '',
    // Added to the shipped `standard` composition in 0.2.1; children want it too.
    '- id: time-context',
    "  name: '@deepseek-ai/dsh-time-context'",
    '',
    '- id: tool-fs',
    "  name: '@deepseek-ai/dsh-tool-fs'",
    '  config:',
    `    read: ${sub.fs.read}`,
    `    readImage: ${sub.fs.readImage}`,
    `    write: ${sub.fs.write}`,
    `    edit: ${sub.fs.edit}`,
    '',
    '- id: tool-fs-search',
    "  name: '@deepseek-ai/dsh-tool-fs-search'",
    '  config:',
    '    sampleOverCapGlobResults: false',
    '',
  ]
  if (sub.web) {
    // Search only: the preset's `tool-web` row turns `fetch` off, so a child
    // authorized for `web_fetch` would be pointed at an unmounted tool.
    rows.push(
      '- id: tool-web',
      "  name: '@deepseek-ai/dsh-tool-web'",
      '  config:',
      '    search: true',
      '    fetch: false',
      '',
    )
  }
  if (sub.todo) {
    rows.push(
      '- id: tool-todo',
      "  name: '@deepseek-ai/dsh-tool-todo'",
      '  config:',
      '    allowParallelInProgress: true',
      '',
    )
  }
  rows.push(...compactionGroup())
  return rows.join('\n')
}

/**
 * One `@deepseek-ai/dsh-agent-preset` row with its complete `plugins:` block,
 * at the indentation an `insert` list item needs.
 */
export function presetRow(meta, pluginsFlat) {
  return [
    `    - id: ${meta.rowId}`,
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    `        id: ${meta.id}`,
    `        name: ${meta.name}`,
    `        description: ${meta.description}`,
    `        order: ${meta.order}`,
    '        plugins:',
    indentBlock(pluginsFlat, PLUGINS_INDENT),
    '',
  ].join('\n')
}

/**
 * The model-facing tool-plane rows every session on `dsh-enhance` needs.
 * Mirrors the shipped `standard` preset's tool skeleton
 * (`dsh-web-app/presets/standard.patch.yml` on 0.2.1). The dsh-enhance-specific
 * subagents are appended inside the delegation group.
 * Returned flat (0-indent); the caller re-indents the whole block.
 */
function toolPlane(subagentRows) {
  return [
    // ── runtime context ────────────────────────────────────────────────────
    // Added to the shipped `standard` composition in 0.2.1.
    '- id: time-context',
    "  name: '@deepseek-ai/dsh-time-context'",
    '',
    // ── shell ──────────────────────────────────────────────────────────────
    '- id: tool-bash',
    "  name: '@deepseek-ai/dsh-tool-bash'",
    "  disabled: !!js process.platform === 'win32'",
    '',
    '- id: tool-pwsh',
    "  name: '@deepseek-ai/dsh-tool-pwsh'",
    "  disabled: !!js process.platform !== 'win32'",
    '',
    // ── filesystem ─────────────────────────────────────────────────────────
    '- id: tool-fs',
    "  name: '@deepseek-ai/dsh-tool-fs'",
    '',
    '- id: tool-fs-search',
    "  name: '@deepseek-ai/dsh-tool-fs-search'",
    '  config:',
    '    sampleOverCapGlobResults: false',
    '',
    // ── background jobs ────────────────────────────────────────────────────
    '- id: tool-jobs',
    "  name: '@deepseek-ai/dsh-tool-jobs'",
    '',
    // `tool-schedule` (@deepseek-ai/dsh-tool-schedule) is deliberately absent:
    // there is no `@deepseek-ai/dsh-tool-schedule@0.2.0-rc.2` build (the older
    // `0.0.1-rc.2` line is unrelated), and a preset row naming a package the
    // host does not carry fails its import — which makes the whole preset
    // broken. Keep the composition loadable on 0.2.0-rc.2 hosts too; add the
    // row when the supported host floor moves to 0.2.1.
    //
    // ── skills ─────────────────────────────────────────────────────────────
    '- id: skill-filesystem',
    "  name: '@deepseek-ai/dsh-skill-filesystem'",
    '',
    '- id: tool-skill',
    "  name: '@deepseek-ai/dsh-tool-skill'",
    '',
    // ── goals ──────────────────────────────────────────────────────────────
    '- id: command-goal',
    "  name: '@deepseek-ai/dsh-command-goal'",
    '',
    '- id: tool-goal',
    "  name: '@deepseek-ai/dsh-tool-goal'",
    '',
    // ── plan mode ──────────────────────────────────────────────────────────
    '- id: planning',
    '  name: cordis:group',
    '  group: true',
    '  isolate:',
    '    planMode: true',
    '  config:',
    '    - id: plan-mode',
    "      name: '@deepseek-ai/dsh-plan-mode'",
    '      config:',
    '        section: |',
    '          You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user\'s conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.',
    '',
    '          Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.',
    '',
    '          The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.',
    '',
    '          Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.',
    '',
    '          Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.',
    '',
    '          When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.',
    '',
    // ── compaction ──────────────────────────────────────────────────────────
    ...compactionGroup(),
    '',
    // ── delegation and workflows ────────────────────────────────────────────
    '- id: delegation',
    '  name: cordis:group',
    '  group: true',
    '  isolate:',
    '    workflowEngine: true',
    '  config:',
    '    - id: tool-subagent-control',
    "      name: '@deepseek-ai/dsh-tool-subagent-control'",
    '',
    '    - id: tool-subagent-list-agents',
    "      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'",
    '',
    // `backgroundMode` was dropped from dsh-tool-subagent's schema in 0.2.1
    // (delegation is managed and continuable unconditionally), and the shipped
    // `standard` row carries neither it nor `modelSelectionSettings` for us:
    // this plugin deliberately keeps the child route inherited instead of
    // exposing the Host's child-model picker.
    '    - id: tool-subagent',
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    '        provider: spawn',
    '        toolName: subagent',
    '',
    '    - id: tool-subagent-fork',
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    '        provider: fork',
    '        toolName: subagent_fork',
    '',
    ...subagentRows,
    '',
    // The workflow engine the delegation realm isolates. The shipped
    // `standard`/`ptc` presets use `@deepseek-ai/dsh-workflow-ptc` here; the
    // pre-row generator named `@deepseek-ai/dsh-workflow-worker-thread`, which
    // is not the shipped row and — as the real-runtime probe found — resolves
    // to a stale 0.1.x copy in a profile that still carries one, gets disabled
    // by the compatibility preflight, and leaves `tool-workflow` permanently
    // waiting for `workflowEngine` (which makes the whole preset unusable:
    // `agent-presets/invalid`). Mirror the shipped preset instead.
    '    - id: workflow-ptc',
    "      name: '@deepseek-ai/dsh-workflow-ptc'",
    '      config:',
    '        provider: spawn',
    '',
    '    - id: tool-workflow',
    "      name: '@deepseek-ai/dsh-tool-workflow'",
    '',
    // ── remaining model-facing rows ─────────────────────────────────────────
    '- id: tool-ask-user',
    "  name: '@deepseek-ai/dsh-tool-ask-user'",
    '',
    '- id: tool-todo',
    "  name: '@deepseek-ai/dsh-tool-todo'",
    '  config:',
    '    allowParallelInProgress: true',
    '',
    '- id: tool-web',
    "  name: '@deepseek-ai/dsh-tool-web'",
    '  config:',
    '    fetch: false',
    '    searchTimeoutMs: 60000',
    '',
    // Added to the shipped `standard` composition in 0.2.1 (the tool exists on
    // 0.2.0 as well). Without it an Enhance session cannot offer a deliverable.
    '- id: present',
    "  name: '@deepseek-ai/dsh-tool-present'",
    '',
  ].join('\n')
}

/**
 * The `config.plugins` entry list of the **Enhance** preset, flat (0-indent).
 * Exported so the byte-pin test can re-indent it with {@link PLUGINS_INDENT}
 * instead of re-deriving it.
 */
export async function pluginsBlock() {
  const mainPersona = await readFile(path.join(personasRoot, `${MAIN.personaSource}.persona.md`), 'utf8').catch(() => null)
  if (mainPersona === null) throw new Error(`missing main persona source: ${MAIN.personaSource}.persona.md`)

  const subagentRows = SUBAGENTS.map(sub => subagentRow(sub))

  return [
    '- id: dsh-enhance',
    "  name: '@p-jiangh/dsh-enhance'",
    '',
    // The preset-scoped system-prompt section: this row is what makes the
    // deep-work contract permanent for sessions on this preset only.
    '- id: enhance-mode',
    "  name: '@p-jiangh/dsh-enhance/enhance-mode'",
    '',
    // The persona row is SCOPE-ONLY and its schema is `prefix` (required) /
    // `suffix` / `complete` / `includeRuntimeContext` — there is no `text` key
    // (the pre-row generator emitted `text`, which dsh-persona rejects with
    // "$.prefix missing required value"; the directory mechanism never loaded
    // it, so the defect was latent). The persona prose is the prefix; 0.2.1's
    // shipped `standard` preset dropped the `{{cwd}}` suffix (the runtime
    // context already carries the working directory), so this preset does too.
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: |-',
    scalar(mainPersona, '      '),
    '',
    // The Web/desktop surface disables the host-plane `agent-instructions` row
    // and lets each preset mount its own; without this row a session on this
    // preset would silently lose the AGENTS.md instruction chain. Mirrors the
    // shipped `standard` preset's row.
    '- id: agent-instructions',
    "  name: '@deepseek-ai/dsh-agent-instructions'",
    '  config:',
    '    maxBytes: 65536',
    '',
    toolPlane(subagentRows),
  ].join('\n').trimEnd()
}

/**
 * The comment header plus the inserted top-level rows — the plugin install
 * row, the four role child presets, and everything of the **Enhance** preset
 * before its `plugins:` key (whose block `render()` appends). Generated here
 * (rather than kept hand-written around a sentinel) because this file is owned
 * by one writer; the byte-pin test then locks the whole file.
 */
async function header() {
  const roleRows = []
  for (const sub of SUBAGENTS) {
    const personaText = await readFile(path.join(personasRoot, `${sub.role}.persona.md`), 'utf8')
    roleRows.push(presetRow({
      rowId: `preset-enhance-${sub.role}`,
      id: sub.presetId,
      name: sub.presetName,
      description: sub.presetDescription,
      order: sub.order,
    }, rolePresetPlugins(sub, personaText)))
  }

  return `# dsh-enhance bundle patch: the plugin install row, the four scoped-subagent agent presets, and the Enhance preset.
#
# GENERATED FILE — do not hand-edit. Rendered by
#   node scripts/sync-dsh-enhance-preset.mjs
# from prompts/agents/dsh-enhance.persona.md (plus the four scoped sub-personas)
# and the enhance-mode section source; tests/presets-pin.test.mjs pins it
# byte-for-byte.
#
# \`name\` MUST be the full package name, matching the upstream convention
# (base/web-app patches reference '@deepseek-ai/dsh-*'). The Cordis loader
# resolves this as a module specifier from the profile directory, so a bare
# \`dsh-enhance\` would fail with ERR_MODULE_NOT_FOUND unless the profile also
# carried an extra alias dependency. The row \`id\` stays short — ids are what
# user patches target, names are what the loader imports.
#
# The \`preset-*\` rows are *declarative* presets: @deepseek-ai/dsh-agent-preset
# registers \`config\` into ctx.agentPresets when the row activates. That service
# is declared by the dsh-web-app / desktop bundles, i.e. it exists on
# dsh >= 0.2.0 only; on an older CLI (whose preset mechanism is the retired
# directory scan) these rows resolve nowhere and stay inactive entries rather
# than breaking the profile.
#
# Why four extra presets: on dsh >= 0.2.1 @deepseek-ai/dsh-tool-subagent
# removed \`persona\` and \`toolFilter\`, so a scoped subagent's persona and tool
# surface can only live in an Agent Preset that the tool row names through
# \`agentPreset\`. Every registered preset is listed in the session roster, so
# \`Scout\` / \`Librarian\` / \`Reviewer\` / \`Task\` are visible compositions of
# their own — see docs/roles.md.
#
# \`config.plugins\` is the session's ENTIRE composition — there is no
# inheritance — so it restates the persona, the agent-instructions row the Web
# surface disables on the host plane, the tool plane (mirroring the shipped
# \`standard\` preset), the four scoped subagents, this bundle's plugin row, and
# the enhance-mode section row.
- insert:
    - id: dsh-enhance
      name: '@p-jiangh/dsh-enhance'

${roleRows.join('\n')}
    - id: ${MAIN.rowId}
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: ${MAIN.id}
        name: ${MAIN.name}
        description: ${MAIN.description}
        order: ${MAIN.order}
        plugins:
`
}

/**
 * Render the whole `cordis.patch.yml` **without touching the disk**.
 *
 * Splitting render from write is what makes the byte-pin test meaningful: a test
 * that calls a writing `generate()` and then reads the file back only compares
 * the file against what it just wrote, so a hand-edited patch is silently
 * overwritten instead of being reported (`tests/presets-pin.test.mjs` locks this).
 *
 * @returns {Promise<Record<string, string>>} absolute path -> content that should be there.
 * @param options - `root` overrides the output root (tests render into a temp dir
 *   so they can prove purity without touching the tracked patch).
 */
export async function render({ root: outRoot = root } = {}) {
  const content = (await header()) + indentBlock(await pluginsBlock(), PLUGINS_INDENT) + '\n'
  return { [path.join(outRoot, PATCH_FILE)]: content }
}

/**
 * Render + write `cordis.patch.yml`.
 * @param options - forwarded to {@link render}.
 * @returns {Promise<Record<string, string>>} absolute path -> content written.
 */
export async function generate(options = {}) {
  const written = await render(options)
  for (const [file, content] of Object.entries(written)) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content, 'utf8')
  }
  return written
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const written = await generate()
  const names = Object.keys(written).map(p => path.relative(root, p))
  console.log(`synced dsh-enhance bundle patch: ${names.length} file\n${names.join('\n')}`)
}
