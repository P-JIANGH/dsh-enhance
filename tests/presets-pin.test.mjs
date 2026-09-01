import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { generate } from '../scripts/sync-presets.mjs'
import { generate as generateDshEnhance } from '../scripts/sync-dsh-enhance-preset.mjs'
import { MAIN as DSH_ENHANCE_MAIN, SUBAGENTS as DSH_ENHANCE_SUBAGENTS } from '../scripts/sync-dsh-enhance-preset.mjs'

/**
 * Byte-pin test (borrowing-analysis A1): the generated preset files checked into
 * `presets/` must be byte-for-byte identical to what `scripts/sync-presets.mjs`
 * produces from the `prompts/agents/*.persona.md` single sources. If the source
 * changed without a re-run — or someone hand-edited a generated persona — this
 * test goes red. Fix by editing the `.persona.md` and running `pnpm sync:presets`.
 */
test('presets are regenerable byte-for-byte from persona sources', async () => {
  const generated = await generate()
  const dshEnhance = await generateDshEnhance()
  const entries = Object.entries({ ...generated, ...dshEnhance })
  assert.ok(entries.length >= 12, `expected 5 roles x2 files + dsh-enhance x2, got ${entries.length}`)

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
  const dshEnhance = await generateDshEnhance()
  const agentFiles = Object.keys({ ...generated, ...dshEnhance }).filter(p => p.endsWith('agent.cordis.yml'))

  for (const agentFile of agentFiles) {
    const role = path.basename(path.dirname(agentFile))
    const body = (generated[agentFile] ?? dshEnhance[agentFile])
    // Every role this preset embodies must have its persona source embedded.
    const roles = role === DSH_ENHANCE_MAIN.id ? [DSH_ENHANCE_MAIN.personaSource, ...DSH_ENHANCE_SUBAGENTS.map(s => s.role)] : [role]
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
