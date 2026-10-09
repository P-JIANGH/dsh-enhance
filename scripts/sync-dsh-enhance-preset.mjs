/**
 * sync-dsh-enhance-preset: render this bundle's whole `cordis.patch.yml` —
 * the plugin install row **and** the `preset-enhance` agent-preset row.
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
 * disables on the host plane (mirroring the shipped `standard` preset, so the
 * scoped subagents' `toolFilter` resolves), the four scoped subagent rows
 * (scout / librarian / reviewer / task), this bundle's own plugin row, and the
 * `@dsh-enhance/dsh-enhance/enhance-mode` row that makes the deep-work
 * contract a permanent system-prompt section of every session on this preset.
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
 * Sub-persona subagent tool instances, keyed by role. Each becomes a
 * tool-subagent row with a distinct toolName, its own persona text (from the
 * role's persona single-source), and a scoped tool filter. These are injected
 * into the `delegation` group so they share its isolate realm and the host
 * `subagents` registry with the generic `subagent` tool.
 */
export const SUBAGENTS = [
  { role: 'scout', toolName: 'subagent_scout', filter: { allow: ['read', 'glob', 'grep'] } },
  // librarian 要查外部依赖，必须能搜索网页；tool plane 里 dsh-tool-web 的 fetch 关闭，
  // 所以只授权 web_search（授权 web_fetch 会指向未挂载的工具，导致委派被拒）。
  { role: 'librarian', toolName: 'subagent_librarian', filter: { allow: ['read', 'glob', 'grep', 'web_search'] } },
  { role: 'reviewer', toolName: 'subagent_reviewer', filter: { allow: ['read', 'glob', 'grep'] } },
  { role: 'task', toolName: 'subagent_task', filter: { allow: ['read', 'glob', 'grep', 'write', 'edit', 'todo_write'] } },
]

/** Indent of the preset's `plugins:` key and of each plugin row inside it. */
export const PLUGINS_INDENT = '        '
/**
 * Indent of a persona block-scalar line inside `config.plugins`:
 * a top-level preset row sits at {@link PLUGINS_INDENT}, its `text: |-` key two
 * levels in, and its content one further. Exported so the byte-pin test
 * de-indents with the same constant.
 */
export const PERSONA_SCALAR_INDENT = PLUGINS_INDENT + '      '
/**
 * Indent of a scoped subagent's persona block-scalar line: those rows are
 * nested one level deeper (inside the `delegation` group's `config`).
 */
export const SUBAGENT_PERSONA_INDENT = PLUGINS_INDENT + '          '

/** Render a string as a `|-` scalar with the given indent. */
function scalar(raw, indent) {
  return raw.replace(/\n$/, '').split('\n').map(l => indent + l).join('\n')
}

/** Render a compact YAML string array as inline flow `[a, b]`. */
function flowArray(items) {
  return '[' + items.map(i => JSON.stringify(i)).join(', ') + ']'
}

/**
 * Build the tool-subagent composition row for one role. Indented to sit beside
 * the `delegation` group's other `config` items (the flat renderers here keep
 * the shape the pre-row generator emitted).
 */
export function subagentRow(role, toolName, filter, personaText) {
  return [
    `    # dsh-enhance-scoped subagent: ${role}`,
    `    - id: dsh-enhance-subagent-${role}`,
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    '        provider: spawn',
    `        toolName: ${toolName}`,
    '        backgroundMode: one-shot',
    '        persona: |-',
    ...scalar(personaText, '          ').split('\n'),
    '        toolFilter:',
    `          allow: ${flowArray(filter.allow)}`,
  ].join('\n')
}

/**
 * The model-facing tool-plane rows every session on `dsh-enhance` needs. Mirrors the
 * shipped `standard` preset's tool skeleton (apps/cli/config/agent-presets/standard).
 * The dsh-enhance-specific subagents are appended inside the delegation group.
 * Returned flat (0-indent); the caller re-indents the whole block.
 */
function toolPlane(subagentRows) {
  return [
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
    // ── skills ─────────────────────────────────────────────────────────────
    '- id: skill-filesystem',
    "  name: '@deepseek-ai/dsh-skill-filesystem'",
    '',
    '- id: tool-skill',
    "  name: '@deepseek-ai/dsh-tool-skill'",
    '',
    // ── goals ──────────────────────────────────────────────────────────────
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
    '        section: |-',
    '              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it.',
    '',
    '              Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.',
    '',
    '              The tool catalog stays the same across modes for request-cache stability. Do not use todo_write to track this planning phase.',
    '',
    '              When ready, call exit_plan_mode with the complete plan markdown, starting with a # title.',
    '',
    // ── compaction ──────────────────────────────────────────────────────────
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
    '    - id: tool-subagent',
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    '        provider: spawn',
    '        toolName: subagent',
    '        backgroundMode: continuable',
    '',
    '    - id: tool-subagent-fork',
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    '        provider: fork',
    '        toolName: subagent_fork',
    '        backgroundMode: continuable',
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
  ].join('\n')
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
 * The `config.plugins` entry list, flat (0-indent). Exported so the byte-pin
 * test can re-indent it with {@link PLUGINS_INDENT} instead of re-deriving it.
 */
export async function pluginsBlock() {
  const mainPersona = await readFile(path.join(personasRoot, `${MAIN.personaSource}.persona.md`), 'utf8').catch(() => null)
  if (mainPersona === null) throw new Error(`missing main persona source: ${MAIN.personaSource}.persona.md`)

  const subagentRows = []
  for (const sub of SUBAGENTS) {
    const personaText = await readFile(path.join(personasRoot, `${sub.role}.persona.md`), 'utf8')
    subagentRows.push(subagentRow(sub.role, sub.toolName, sub.filter, personaText))
  }

  return [
    '- id: dsh-enhance',
    "  name: '@dsh-enhance/dsh-enhance'",
    '',
    // The preset-scoped system-prompt section: this row is what makes the
    // deep-work contract permanent for sessions on this preset only.
    '- id: enhance-mode',
    "  name: '@dsh-enhance/dsh-enhance/enhance-mode'",
    '',
    // The persona row is SCOPE-ONLY and its schema is `prefix` (required) /
    // `suffix` / `complete` / `includeRuntimeContext` — there is no `text` key
    // (the pre-row generator emitted `text`, which dsh-persona rejects with
    // "$.prefix missing required value"; the directory mechanism never loaded
    // it, so the defect was latent). The persona prose is the prefix, and the
    // suffix restates the deployment's `{{cwd}}` line the preset shadows.
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: |-',
    scalar(mainPersona, '      '),
    '    suffix: Your working directory is {{cwd}}.',
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
 * The comment header plus the two inserted top-level rows — everything before
 * the preset's `plugins:` key. Generated here (rather than kept hand-written
 * around a sentinel) because this file is owned by one writer; the byte-pin
 * test then locks the whole file.
 */
function header() {
  return `# dsh-enhance bundle patch: the plugin install row plus the Enhance agent preset.
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
# The \`preset-enhance\` row is a *declarative* preset: @deepseek-ai/dsh-agent-preset
# registers \`config\` into ctx.agentPresets when the row activates. That service
# is declared by the dsh-web-app / desktop bundles, i.e. it exists on
# dsh >= 0.2.0 only; on an older CLI (whose preset mechanism is the retired
# directory scan) this row resolves nowhere and stays an inactive entry rather
# than breaking the profile.
#
# \`config.plugins\` is the session's ENTIRE composition — there is no
# inheritance — so it restates the persona (dsh-persona prefix plus the
# deployment suffix it shadows), the agent-instructions row the Web surface
# disables on the host plane, the tool plane, the four scoped subagents, this
# bundle's plugin row, and the enhance-mode section row.
- insert:
    - id: dsh-enhance
      name: '@dsh-enhance/dsh-enhance'

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
  const content = header() + indentBlock(await pluginsBlock(), PLUGINS_INDENT) + '\n'
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
