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
 * Generate all presets from the persona sources.
 * @returns {Promise<Record<string, string>>} absolute path -> content written.
 */
export async function generate() {
  const written = {}

  for (const [role, meta] of Object.entries(ROLES)) {
    const source = await readFile(path.join(personasRoot, `${role}.persona.md`), 'utf8')

    const header = `# ${meta.name} preset: ${meta.title} (persona single-source: prompts/agents/${role}.persona.md)`

    const agentBody = [
      header,
      '',
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
      renderPersonaScalar(source),
      '',
    ].join('\n')
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
