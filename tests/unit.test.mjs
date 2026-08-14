import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSkillsProvider, parseSkillBody, SKILLS_ROOT } from '../lib/skills-provider.js'

const control = { signal: new AbortController().signal, invalidate: () => {} }

test('parseSkillBody parses frontmatter and body', () => {
  const parsed = parseSkillBody('---\nname: foo-bar\ndescription: Does foo.\ndisable-model-invocation: true\nuser-invocable: false\n---\n# Body\ncontent here\n')
  assert.equal(parsed.name, 'foo-bar')
  assert.equal(parsed.description, 'Does foo.')
  assert.deepEqual(parsed.invocation, { modelInvocable: false, userInvocable: false })
  assert.ok(parsed.content.includes('content here'))
})

test('parseSkillBody tolerates a body without frontmatter', () => {
  const parsed = parseSkillBody('# Just a body\n')
  assert.equal(parsed.name, '')
  assert.equal(parsed.content, '# Just a body\n')
})

test('provider lists the three packaged skills', async () => {
  const provider = createSkillsProvider(control)
  const candidates = await provider.list()
  const names = candidates.map(c => c.name).sort()
  assert.deepEqual(names, ['code-review', 'git-workflow', 'tdd'])
  for (const candidate of candidates) {
    assert.equal(candidate.source, 'bundled')
    assert.equal(candidate.provider, 'oh-my-dsh')
    assert.ok(candidate.description.length > 0)
  }
})

test('provider loads a full skill body for a listed candidate', async () => {
  const provider = createSkillsProvider(control)
  const candidates = await provider.list()
  const review = candidates.find(c => c.name === 'code-review')
  assert.ok(review)
  const definition = await provider.get(review)
  assert.equal(definition?.name, 'code-review')
  assert.ok(definition?.content.includes('# Code review'))
})

test('packaged skills directory exists next to the published code', () => {
  assert.ok(SKILLS_ROOT.length > 0)
})
