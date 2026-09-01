/**
 * sync-presets: render the packaged agent presets from their single-source
 * persona files under `prompts/agents/`.
 *
 * Single-source discipline (borrowing-analysis A1/B1): the Chinese persona text
 * for each role lives once in `prompts/agents/<role>.persona.md`. This script
 * regenerates `presets/<role>/agent.cordis.yml` (+ `preset.yml`) from it. Never
 * hand-edit the generated `agent.cordis.yml` persona text — edit the `.persona.md`
 * source and re-run `pnpm sync:presets`, or the byte-pin test red.
 *
 * @module scripts/sync-presets
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const personasRoot = path.join(root, 'prompts', 'agents')
const presetsRoot = path.join(root, 'presets')

/** Role metadata: preset name, comment title, and one-line preset description. */
const ROLES = {
  planner: {
    name: 'Planner',
    title: 'Planning-first agent',
    description: 'Understand, plan, then implement in small verified steps.',
  },
  reviewer: {
    name: 'Reviewer',
    title: 'Review-focused agent',
    description: 'Ground reviews in the actual code; separate blocking from suggestions.',
  },
  scout: {
    name: 'Scout',
    title: 'Read-only exploration agent',
    description: 'Map the repository structure and hand off a compact context.',
  },
  librarian: {
    name: 'Librarian',
    title: 'External source-verification agent',
    description: 'Locate external library source and docs; local-first.',
  },
  task: {
    name: 'Task',
    title: 'Focused execution worker',
    description: 'Execute a plan hyper-focused; debug via reproduce-cause-fix-regress.',
  },
}

/** YAML block-scalar indent (6 spaces: 2 for `.persona`, 4 for `config.text`). */
const SCALAR_INDENT = '      '

/** Render the `text: |-` scalar from a persona source (each line +6 indent). */
function renderPersonaScalar(persona) {
  return persona
    .replace(/\n$/, '')
    .split('\n')
    .map(line => SCALAR_INDENT + line)
    .join('\n')
}

/**
 * The model-facing tool-plane rows every session on one of these preset need.
 * Mirrors the same skeleton used by the dsh-enhance main preset (scripts/sync-dsh-enhance-preset.mjs),
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

/**
 * Generate all presets from the persona sources.
 * @returns {Promise<Record<string, string>>} absolute path -> content written.
 */
export async function generate() {
  const written = {}

  for (const [role, meta] of Object.entries(ROLES)) {
    const source = await readFile(path.join(personasRoot, `${role}.persona.md`), 'utf8')

    const header = `# ${meta.name} preset: ${meta.title} (persona single-source: prompts/agents/${role}.persona.md)`
    const headerNote = [
      '#',
      '# Tool plane mirrors the shipped `standard` preset so a Web session on this persona mounts',
      '# fs/shell/todo/web itself (the Web surface disables every tool-* row in the host composition).',
      '',
    ].join('\n')

    const agentBody = [
      header,
      headerNote,
      '- id: dsh-enhance',
      '  name: dsh-enhance',
      '  config:',
      '    orientOnSessionStart: true',
      '    doctorTool: true',
      '',
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    text: |-',
      renderPersonaScalar(source),
      '',
      toolPlane(),
    ].join('\n').trimEnd() + '\n'
    const agentPath = path.join(presetsRoot, role, 'agent.cordis.yml')
    await mkdir(path.dirname(agentPath), { recursive: true })
    await writeFile(agentPath, agentBody, 'utf8')

    const presetBody = `name: ${meta.name}\ndescription: ${meta.description}\n`
    const presetPath = path.join(presetsRoot, role, 'preset.yml')
    await writeFile(presetPath, presetBody, 'utf8')

    written[agentPath] = agentBody
    written[presetPath] = presetBody
  }

  return written
}

// Executed directly: `node scripts/sync-presets.mjs`
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const written = await generate()
  const names = Object.keys(written).map(p => path.relative(root, p))
  console.log(`synced presets: ${names.length} files\n${names.join('\n')}`)
}
