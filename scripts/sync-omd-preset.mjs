/**
 * sync-omd-preset: render the oh-my-dsh MAIN preset (the orchestrating persona)
 * from its single-source persona file, including the four subagent tool
 * instances used to dispatch the focused sub-personas (scout / librarian /
 * reviewer / task) as in-process subagents here.
 *
 * Single-source discipline mirrors scripts/sync-presets.mjs: edit
 * `prompts/agents/oh-my-dsh.persona.md` (main) and the `<role>.persona.md`
 * sources, then re-run this script. Output goes to
 * `presets/omd/<agent.cordis.yml|preset.yml>`.
 *
 * The omd preset is a FULL agent composition, mirroring the shipped `standard`
 * preset's tool plane (shell / fs / search / jobs / skills / goals / plan /
 * compaction / delegation / ask-user / todo / web) because the Web surface
 * disables every `tool-*` row in the HOST composition and lets each session
 * mount its own tools via its preset. A preset that omits them (as v1 did)
 * leaves the session with no file/shell/todo tools — so the four subagents'
 * `toolFilter` (read/glob/grep/write/edit/todo_write) resolves to unknown
 * global tools and every delegation is rejected. This file's tool skeleton is
 * the invariant contract every session on `omd` needs.
 *
 * @module scripts/sync-omd-preset
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const personasRoot = path.join(root, 'prompts', 'agents')
const presetsRoot = path.join(root, 'presets')

/** Main preset metadata (id = directory name = preset id). Use `omd`, the short form. */
export const MAIN = {
  id: 'omd',
  personaSource: 'oh-my-dsh',
  name: 'oh-my-dsh',
  title: 'Orchestrating oh-my-dsh agent',
  description: 'oh-my-dsh orchestrator: full bundle + scout/librarian/reviewer/task subagents.',
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
  { role: 'librarian', toolName: 'subagent_librarian', filter: { allow: ['read', 'glob', 'grep'] } },
  { role: 'reviewer', toolName: 'subagent_reviewer', filter: { allow: ['read', 'glob', 'grep'] } },
  { role: 'task', toolName: 'subagent_task', filter: { allow: ['read', 'glob', 'grep', 'write', 'edit', 'todo_write'] } },
]

/** YAML block-scalar indent for a string under config.text (6 spaces). */
const SCALAR_INDENT = '      '
const LIST_INDENT = '          ' // allow/deny list items under toolFilter

/** Render a string as a `|-` scalar with the given indent. */
function scalar(raw, indent = SCALAR_INDENT) {
  return raw.replace(/\n$/, '').split('\n').map(l => indent + l).join('\n')
}

/** Render a compact YAML string array as inline flow `[a, b]`. */
function flowArray(items) {
  return '[' + items.map(i => JSON.stringify(i)).join(', ') + ']'
}

/** Build the tool-subagent composition row for one role. */
export function subagentRow(role, toolName, filter, personaText) {
  const personaIndent = '          ' // 10 spaces: under `config:` (8) inside the delegation list item
  return [
    `    # omd-scoped subagent: ${role}`,
    `    - id: omd-subagent-${role}`,
    "      name: '@deepseek-ai/dsh-tool-subagent'",
    '      config:',
    '        provider: spawn',
    `        toolName: ${toolName}`,
    '        backgroundMode: one-shot',
    '        persona: |-',
    ...scalar(personaText, personaIndent).split('\n'),
    '        toolFilter:',
    `          allow: ${flowArray(filter.allow)}`,
  ].join('\n')
}

/**
 * The model-facing tool-plane rows every session on `omd` needs. Mirrors the
 * shipped `standard` preset's tool skeleton (apps/cli/config/agent-presets/standard).
 * The omd-specific subagents are appended inside the delegation group.
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
    '    - id: workflow-worker-thread',
    "      name: '@deepseek-ai/dsh-workflow-worker-thread'",
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

/** Build the full main-preset composition file. */
export async function generate() {
  const mainPersona = await readFile(path.join(personasRoot, `${MAIN.personaSource}.persona.md`), 'utf8').catch(() => null)
  if (mainPersona === null) throw new Error(`missing main persona source: ${MAIN.personaSource}.persona.md`)

  const header = `# ${MAIN.name} preset: ${MAIN.title} (persona single-source: prompts/agents/${MAIN.personaSource}.persona.md)`
  const headerNote = [
    '#',
    '# Tool plane mirrors the shipped `standard` preset (apps/cli/config/agent-presets/standard) so an omd',
    '# session mounts fs/shell/todo/web/etc. itself — the Web surface disables every tool-* row in the host',
    '# composition and a preset that omits them leaves its subagents\' toolFilter (read/glob/grep/write/edit)',
    '# pointing at unknown global tools, which rejects every delegation.',
    '',
  ].join('\n')

  // Build the four scoped subagent rows (indented 4 under the delegation group rows).
  const subagentRows = []
  for (const sub of SUBAGENTS) {
    const personaText = await readFile(path.join(personasRoot, `${sub.role}.persona.md`), 'utf8')
    subagentRows.push(subagentRow(sub.role, sub.toolName, sub.filter, personaText))
  }

  const body = [
    header,
    headerNote,
    '- id: oh-my-dsh',
    '  name: oh-my-dsh',
    '  config:',
    '    orientOnSessionStart: true',
    '    doctorTool: true',
    '',
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    text: |-',
    scalar(mainPersona),
    '',
    toolPlane(subagentRows),
  ].join('\n')

  const agentBody = body.trimEnd() + '\n'
  const agentPath = path.join(presetsRoot, MAIN.id, 'agent.cordis.yml')
  await mkdir(path.dirname(agentPath), { recursive: true })
  await writeFile(agentPath, agentBody, 'utf8')

  const presetBody = `name: ${MAIN.name}\ndescription: ${MAIN.description}\n`
  const presetPath = path.join(presetsRoot, MAIN.id, 'preset.yml')
  await writeFile(presetPath, presetBody, 'utf8')

  return { [agentPath]: agentBody, [presetPath]: presetBody }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const written = await generate()
  const names = Object.keys(written).map(p => path.relative(root, p))
  console.log(`synced omd preset: ${names.length} files\n${names.join('\n')}`)
}
