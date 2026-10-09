// 文档内部链接钉：markdown 里指向仓库内文件的 `](target)` 必须真实存在。
//
// 为什么需要它：修复前 `docs/known-issues.md` 有 **16 个坏链接**（它把 `../X` 当成自己
// 在一层更深的目录里），而没有任何测试会因此变红——公开发布的文档里点不动的链接就是这种
// "没人看就不存在"的缺陷。
//
// 光有"扫一遍真文档"还不够：**扫描器自己**也必须被钉住。本文件因此带一组夹具用例，钉住
// 剥代码的两种行为——正文里引用 markdown 语法不该被当成链接（原缺陷），而正文里出现孤立的
// ``` 时**不得**吞掉后续真实链接（否则扫描器会静默漏报，出现假绿）。
//
// 实现放在 scripts/lib/markdown-links.mjs，就是为了让夹具能直接喂它。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { findBrokenLinks, findLocalLinkTargets, stripCode } from '../scripts/lib/markdown-links.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const DEPS = {
  exists: existsSync,
  resolve,
  dirname,
  readFileSync,
}

/** 参与检查的文档：仓库根的几篇 + docs/ 全树。 */
function markdownFiles() {
  const found = ['README.md', 'README.en.md', 'CHANGELOG.md', 'AGENTS.md'].map(f => join(ROOT, f))
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) found.push(path)
    }
  }
  const docs = join(ROOT, 'docs')
  if (existsSync(docs) && statSync(docs).isDirectory()) walk(docs)
  return found.filter(existsSync)
}

test('[docs] 每一条指向仓库内文件的链接都真实存在', () => {
  const { checked, broken } = findBrokenLinks(ROOT, markdownFiles(), DEPS)
  const report = broken.map(b => `${relative(ROOT, b.file).replace(/\\/g, '/')} → ${b.target}`)

  // 非真空：正则或剥代码失效、文档被删空时，这个测试不能悄悄通过。
  assert.ok(checked.length >= 20, `只检查到 ${checked.length} 条仓库内链接，说明扫描本身失效了`)
  assert.deepEqual(report, [], '文档链接指向了不存在的文件：\n' + report.join('\n'))
})

test('[docs] 参与检查的文档集合非空且包含两份 README', () => {
  const files = markdownFiles().map(f => relative(ROOT, f).replace(/\\/g, '/'))
  assert.ok(files.includes('README.md'))
  assert.ok(files.includes('README.en.md'))
  assert.ok(files.length >= 10, `只找到 ${files.length} 篇文档`)
  assert.ok(files.every(f => !f.startsWith('node_modules' + sep) && !f.startsWith('lib' + sep)))
})

// ── 扫描器自身的夹具（这组用例是 advisor 指出的假绿方向） ─────────────────────

/** 在临时目录里造一个文档集合并扫描它。 */
function scanFixture(bodies) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-links-'))
  try {
    for (const [name, body] of Object.entries(bodies)) {
      const path = join(root, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body)
    }
    return findBrokenLinks(root, Object.keys(bodies).map(n => join(root, n)), DEPS)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('[docs] 正文里引用的 markdown 语法示例不算链接', () => {
  assert.deepEqual(findLocalLinkTargets('写法是 `](target)` 这样。\n'), [])
  assert.deepEqual(findLocalLinkTargets('```\n](nope.md)\n```\n'), [])
  // 而行内代码包住链接文本时，真实目标仍要被认出来。
  assert.deepEqual(findLocalLinkTargets('见 [`docs/a.md`](docs/a.md)。\n'), ['docs/a.md'])
})

test('[docs] 孤立的 ``` 不得让后续真实链接被漏报', () => {
  // 危险形态是"奇数个围栏 + 坏链夹在中间"：左右配对的剥法会把从孤立 ``` 到下一个围栏
  // 之间的**真实正文**整段吞掉，于是坏链检不到（假绿）。这里必须仍然报出来。
  const misaligned = [
    '正文里引用了一个孤立围栏 ``` 作为示例。',
    '',
    '见 [坏链](missing.md)。',
    '',
    '```js',
    'const a = 1',
    '```',
    '',
  ].join('\n')
  const { broken } = scanFixture({ 'doc.md': misaligned })
  assert.deepEqual(broken.map(b => b.target), ['missing.md'],
    '围栏不成对时必须放弃整块剥离：宁可多报，不可漏掉真实坏链（假绿）')

  // 成对围栏时，围栏内部的东西不算链接。
  const paired = '```\n见 [坏链](missing.md)\n```\n\n见 [好链自身](self.md)。\n'
  const pairedScan = scanFixture({ 'doc.md': paired, 'self.md': '# self\n' })
  assert.deepEqual(pairedScan.broken, [], '成对围栏内部的内容不该被当成链接')
  assert.deepEqual(pairedScan.checked.map(c => c.target), ['self.md'])
})

test('[docs] stripCode 对不成对围栏的选择是显式的', () => {
  const text = 'a ``` b\n[link](x.md)\n'
  assert.ok(stripCode(text).includes('[link](x.md)'), '不成对时不剥围栏，正文保留')
  assert.ok(stripCode('```\n[link](x.md)\n```\n').includes('[link]') === false, '成对时整块剥掉')
})
