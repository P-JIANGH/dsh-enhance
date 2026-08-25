import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { generate } from '../scripts/sync-presets.mjs'

/**
 * Byte-pin test (borrowing-analysis A1): the generated preset files checked into
 * `presets/` must be byte-for-byte identical to what `scripts/sync-presets.mjs`
 * produces from the `prompts/agents/*.persona.md` single sources. If the source
 * changed without a re-run — or someone hand-edited a generated persona — this
 * test goes red. Fix by editing the `.persona.md` and running `pnpm sync:presets`.
 */
test('presets are regenerable byte-for-byte from persona sources', async () => {
  const generated = await generate()
  const entries = Object.entries(generated)
  assert.ok(entries.length >= 10, `expected at least 5 roles x2 files, got ${entries.length}`)

  for (const [genPath, content] of entries) {
    const onDisk = await readFile(genPath, 'utf8')
    assert.equal(
      onDisk,
      content,
      `${path.relative(process.cwd(), genPath)} is out of sync with prompts/agents sources — run pnpm sync:presets`,
    )
  }
})

test('every persona source is referenced by exactly one generated preset', async () => {
  const generated = await generate()
  const agentFiles = Object.keys(generated).filter(p => p.endsWith('agent.cordis.yml'))

  for (const agentFile of agentFiles) {
    const role = path.basename(path.dirname(agentFile))
    const source = await readFile(path.join('prompts', 'agents', `${role}.persona.md`), 'utf8')
    const generatedBody = generated[agentFile]

    // The generated scalar must embed the persona text (indented 6 spaces).
    const embedded = generatedBody
      .split('\n')
      .filter(l => l.startsWith('      '))
      .map(l => l.slice(6))
      .join('\n')
    assert.equal(embedded, source.replace(/\n$/, ''), `persona text for '${role}' drifted from its source`)
  }
})
