import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSkillsProvider, parseSkillBody, SKILLS_ROOT } from '../lib/features/skills-provider.js'
import { DEFAULT_WORK_RULES } from '../lib/index.js'

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
    assert.equal(candidate.provider, 'dsh-enhance')
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

test('DEFAULT_WORK_RULES carries the key working-discipline constraints', () => {
  // Content pin (borrowing-analysis A3): guards against accidental rewording of the
  // shipped work-rules prose. This is a regression guard, not a behavior assertion.
  for (const phrase of [
    'AGENTS.md',
    '先搜索后提问',
    '小步可审查',
    '诚实报告',
    '最小化改动',
    '事实永远在文件',
    '不臆想',
  ]) {
    assert.ok(DEFAULT_WORK_RULES.includes(phrase), `DEFAULT_WORK_RULES should mention: ${phrase}`)
  }
})
