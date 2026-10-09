/**
 * sync-presets: render the five role agent presets from their single-source
 * persona files under `prompts/agents/` — as **plugin rows**, not directories.
 *
 * Single-source discipline (borrowing-analysis A1/B1): the Chinese persona text
 * for each role lives once in `prompts/agents/<role>.persona.md`. This script
 * regenerates `presets/roles.patch.yml` from it. Never hand-edit the generated
 * file — edit the `.persona.md` source and re-run `pnpm sync:presets`, or the
 * byte-pin test red.
 *
 * Why a patch fragment and not `presets/<role>/` directories: on dsh 0.2.x an
 * agent preset is a `@deepseek-ai/dsh-agent-preset` **row** in a Cordis
 * composition, and the registry does not scan `$DSH_HOME/.agent-presets` any
 * more (README, `docs/installing-plugins.md`). `cordis.patch.yml` installs the
 * bundle itself and declares the Enhance preset; this fragment is the bundle's
 * second patch file (listed in `package.json` `dsh.bundle.patch`, exactly how
 * `dsh-web-app` ships `presets/*.patch.yml`) so each file has one writer.
 *
 * @module scripts/sync-presets
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const personasRoot = path.join(root, 'prompts', 'agents')
const presetsRoot = path.join(root, 'presets')

/** File name of the generated fragment, inside {@link presetsRoot}. */
export const PATCH_FILE = 'roles.patch.yml'

/** Role metadata: preset id, display name, `order`, and a one-line description. */
export const ROLES = {
  planner: {
    name: 'Planner',
    title: 'Planning-first agent',
    description: 'Understand, plan, then implement in small verified steps.',
    order: 6,
  },
  reviewer: {
    name: 'Reviewer',
    title: 'Review-focused agent',
    description: 'Ground reviews in the actual code; separate blocking from suggestions.',
    order: 7,
  },
  scout: {
    name: 'Scout',
    title: 'Read-only exploration agent',
    description: 'Map the repository structure and hand off a compact context.',
    order: 8,
  },
  librarian: {
    name: 'Librarian',
    title: 'External source-verification agent',
    description: 'Locate external library source and docs; local-first.',
    order: 9,
  },
  task: {
    name: 'Task',
    title: 'Focused execution worker',
    description: 'Execute a plan hyper-focused; debug via reproduce-cause-fix-regress.',
    order: 10,
  },
}

/** Indent of the preset's `plugins:` key and of each plugin row inside it. */
export const PLUGINS_INDENT = '        '
/**
 * Indent of a persona block-scalar line inside `config.plugins`:
 * a top-level preset row sits at {@link PLUGINS_INDENT}, its `text: |-` key two
 * levels in, and its content one further. Exported so the byte-pin test
 * de-indents with the same constant.
 */
export const PERSONA_SCALAR_INDENT = PLUGINS_INDENT + '      '

/** Render a string as a `|-` scalar with the given indent. */
function scalar(raw, indent) {
  return raw.replace(/\n$/, '').split('\n').map(l => indent + l).join('\n')
}

/** Re-indent a flat block by `indent`, leaving blank lines blank. */
export function indentBlock(block, indent) {
  return block.split('\n').map(line => (line === '' ? '' : indent + line)).join('\n')
}

/**
 * The model-facing tool-plane rows every session on one of these presets needs.
 * Mirrors the same skeleton used by the Enhance preset (scripts/sync-dsh-enhance-preset.mjs),
 * which in turn mirrors the shipped `standard` preset — the Web surface disables
 * every `tool-*` row in the HOST composition, so each preset must mount its tools
 * itself or its session has no file/shell/todo tools.
 */
function toolPlane() {
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
    '              You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Explore first with non-mutating reads. Do not edit or write files. When ready, call exit_plan_mode with the complete plan.',
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
    // ── delegation (generic subagent only; no dsh-enhance scoped rows here) ────────
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
    // The workflow engine the delegation realm isolates: mirror the shipped
    // `standard` preset (`workflow-ptc`), not the stale `workflow-worker-thread`
    // row the pre-row generator named — see scripts/sync-dsh-enhance-preset.mjs.
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
 * The `config.plugins` entry list for one role, flat (0-indent). Exported so
 * the byte-pin test can re-indent it with {@link PLUGINS_INDENT} instead of
 * re-deriving the nesting.
 * @param role - a key of {@link ROLES}.
 * @returns the flat plugin-row block.
 */
export async function pluginsBlock(role) {
  const source = await readFile(path.join(personasRoot, `${role}.persona.md`), 'utf8')
  return [
    '- id: dsh-enhance',
    "  name: '@dsh-enhance/dsh-enhance'",
    '',
    // `dsh-persona` is scope-only and takes `prefix` (required), not `text`;
    // the persona prose is the prefix and the suffix restates the deployment's
    // `{{cwd}}` line this row shadows. Same shape as the Enhance preset.
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: |-',
    scalar(source, '      '),
    '    suffix: Your working directory is {{cwd}}.',
    '',
    // The Web/desktop surface disables the host-plane `agent-instructions` row,
    // so each preset mounts its own (mirrors the shipped `standard` preset).
    '- id: agent-instructions',
    "  name: '@deepseek-ai/dsh-agent-instructions'",
    '  config:',
    '    maxBytes: 65536',
    '',
    toolPlane(),
  ].join('\n').trimEnd()
}

/** The comment header plus one `insert:` list per role. */
function header() {
  return `# dsh-enhance role agent presets: five @deepseek-ai/dsh-agent-preset declarations.
#
# GENERATED FILE — do not hand-edit. Rendered by
#   node scripts/sync-presets.mjs
# from prompts/agents/<role>.persona.md (planner / reviewer / scout / librarian
# / task); tests/presets-pin.test.mjs pins it byte-for-byte. The bundle's
# cordis.patch.yml (rendered by scripts/sync-dsh-enhance-preset.mjs) owns the
# Enhance preset; this file is the second patch file in package.json's
# dsh.bundle.patch list, matching how dsh-web-app ships presets/*.patch.yml.
- insert:
`
}

/**
 * Render the whole `presets/roles.patch.yml` **without touching the disk**.
 *
 * Splitting render from write is what makes the byte-pin test meaningful: a test
 * that calls a writing `generate()` and then reads the file back only compares
 * the file against what it just wrote, so a hand-edited preset is silently
 * overwritten instead of being reported (`tests/presets-pin.test.mjs` locks this).
 *
 * @returns {Promise<Record<string, string>>} absolute path -> content that should be there.
 * @param options - \`presetsRoot\` overrides the output root (tests render into a temp dir
 *   so they can prove purity without touching the tracked preset fragment).
 */
export async function render({ presetsRoot: outRoot = presetsRoot } = {}) {
  const rows = []
  for (const [role, meta] of Object.entries(ROLES)) {
    rows.push([
      `    - id: preset-${role}`,
      "      name: '@deepseek-ai/dsh-agent-preset'",
      '      config:',
      `        id: ${role}`,
      `        name: ${meta.name}`,
      `        description: ${meta.description}`,
      `        order: ${meta.order}`,
      '        plugins:',
      indentBlock(await pluginsBlock(role), PLUGINS_INDENT),
      '',
    ].join('\n'))
  }
  const content = header() + rows.join('\n').trimEnd() + '\n'
  return { [path.join(outRoot, PATCH_FILE)]: content }
}

/**
 * Render + write `presets/roles.patch.yml`.
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

// Executed directly: `node scripts/sync-presets.mjs`
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const written = await generate()
  const names = Object.keys(written).map(p => path.relative(root, p))
  console.log(`synced presets: ${names.length} file\n${names.join('\n')}`)
}
