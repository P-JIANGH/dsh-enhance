// 文档内部链接钉：markdown 里指向仓库内文件的 `](target)` 必须真实存在。
//
// 为什么需要它：本轮修复前 `docs/known-issues.md` 有 **16 个坏链接**（它把 `../X`
// 当成自己在一层更深的目录里），而没有任何测试会因此变红——公开发布的文档里点不动
// 的链接就是这种"没人看就不存在"的缺陷。这个测试让它们变成红灯。
//
// 只检查**仓库内**的相对路径；`http(s)://`、`mailto:` 等外部链接与 `#anchor` 跳过。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

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
  const broken = []
  let checked = 0
  for (const file of markdownFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // http(s):, mailto:, …
      const path = target.split('#')[0]
      if (path === '') continue // 纯锚点
      checked++
      if (!existsSync(resolve(dirname(file), path))) {
        broken.push(`${relative(ROOT, file).replace(/\\/g, '/')} → ${target}`)
      }
    }
  }

  // 非真空：正则失效或文档被删空时，这个测试必须不能悄悄通过。
  assert.ok(checked >= 20, `只检查到 ${checked} 条仓库内链接，说明扫描本身失效了`)
  assert.deepEqual(broken, [], '文档链接指向了不存在的文件：\n' + broken.join('\n'))
})

test('[docs] 参与检查的文档集合非空且包含两份 README', () => {
  const files = markdownFiles().map(f => relative(ROOT, f).replace(/\\/g, '/'))
  assert.ok(files.includes('README.md'))
  assert.ok(files.includes('README.en.md'))
  assert.ok(files.length >= 10, `只找到 ${files.length} 篇文档`)
  assert.ok(files.every(f => !f.startsWith('node_modules' + sep) && !f.startsWith('lib' + sep)))
})
