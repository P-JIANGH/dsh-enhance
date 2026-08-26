import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { generate } from '../scripts/sync-presets.mjs'
import { generate as generateOmd } from '../scripts/sync-omd-preset.mjs'
import { MAIN as OMD_MAIN, SUBAGENTS as OMD_SUBAGENTS } from '../scripts/sync-omd-preset.mjs'

/**
 * Byte-pin test (borrowing-analysis A1): the generated preset files checked into
 * `presets/` must be byte-for-byte identical to what `scripts/sync-presets.mjs`
 * produces from the `prompts/agents/*.persona.md` single sources. If the source
 * changed without a re-run — or someone hand-edited a generated persona — this
 * test goes red. Fix by editing the `.persona.md` and running `pnpm sync:presets`.
 */
test('presets are regenerable byte-for-byte from persona sources', async () => {
  const generated = await generate()
  const omd = await generateOmd()
  const entries = Object.entries({ ...generated, ...omd })
  assert.ok(entries.length >= 12, `expected 5 roles x2 files + oh-my-dsh x2, got ${entries.length}`)

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
  const generated = await generate()
  const omd = await generateOmd()
  const agentFiles = Object.keys({ ...generated, ...omd }).filter(p => p.endsWith('agent.cordis.yml'))

  for (const agentFile of agentFiles) {
    const role = path.basename(path.dirname(agentFile))
    const body = (generated[agentFile] ?? omd[agentFile])
    // Every role this preset embodies must have its persona source embedded.
    const roles = role === OMD_MAIN.id ? [OMD_MAIN.personaSource, ...OMD_SUBAGENTS.map(s => s.role)] : [role]
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
