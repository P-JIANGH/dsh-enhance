import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// CRLF 回归：Windows 检出（git 默认 core.autocrlf=true，CI 的 Windows runner 亦然）会把
// SKILL.md 取成 CRLF。解析器曾按 `\n` 锚定围栏，于是 list() 静默返回空——插件看着健康、
// 一条技能都没贡献（CI 第一次跑就是这么红的）。这条钉住"CRLF 与 LF 等价"。
test('parseSkillBody treats CRLF exactly like LF', () => {
  const lf = '---\nname: a-b\ndescription: d\n---\n# Body\n'
  const crlf = lf.replace(/\n/g, '\r\n')
  assert.deepEqual(parseSkillBody(crlf), parseSkillBody(lf))
  assert.equal(parseSkillBody(crlf).name, 'a-b')
  assert.equal(parseSkillBody(crlf).content, '# Body\n')
})

test('provider reads a CRLF skill tree end to end', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skills-crlf-'))
  try {
    for (const [name, eol] of [['lf-skill', '\n'], ['crlf-skill', '\r\n']]) {
      const dir = join(root, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), ['---', `name: ${name}`, 'description: d', '---', '# Body', `body of ${name}`].join(eol) + eol)
    }
    const provider = createSkillsProvider(control, root)
    const names = (await provider.list()).map(c => c.name).sort()
    assert.deepEqual(names, ['crlf-skill', 'lf-skill'], 'Checkout line endings must not decide whether a packaged skill exists')
    const crlf = (await provider.list()).find(c => c.name === 'crlf-skill')
    assert.ok((await provider.get(crlf))?.content.includes('body of crlf-skill'))
  } finally { rmSync(root, { recursive: true, force: true }) }
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
