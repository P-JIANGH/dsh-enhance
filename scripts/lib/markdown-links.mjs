// markdown 内部链接扫描（供 tests/doc-links.test.mjs 使用；放在 scripts/lib/ 便于单测夹具直接喂它）。
//
// 为什么需要"剥代码"：文档在正文里引用 markdown 语法本身（例如写一个 `](target)` 作示例）
// 不是一条链接。但剥法必须**偏保守**——漏报（静默假绿）比多报（响亮失败）危险得多：
//
//   * 行内代码：剥掉（成对的反引号是明确边界）。
//   * 围栏代码块：只有当围栏定界行**成对**时才剥。正文里引一个孤立的 ``` 会让"左右配对"
//     的剥法错位，把两个孤立围栏之间的**真实正文**整段吞掉，于是真实链接再也检不到——
//     这正是本模块要避免的假绿。不成对时干脆不剥围栏，多报就让它多报。
//
// @module scripts/lib/markdown-links

/** 围栏定界行（``` 或 ~~~，允许缩进）。 */
const FENCE = /^\s*(?:```|~~~)/

/**
 * 剥掉行内代码；围栏代码块仅在定界行成对时整体剥掉。
 * @param text - markdown 原文。
 * @returns 供链接扫描用的文本。
 */
export function stripCode(text) {
  const lines = String(text).split(/\r?\n/)
  const inline = line => line.replace(/`[^`\n]*`/g, '')
  const fenceLines = lines.filter(line => FENCE.test(line)).length

  if (fenceLines % 2 !== 0) {
    // 围栏不成对：不做整块剥离（否则会吞掉真实正文），只剥行内代码。
    return lines.map(inline).join('\n')
  }

  const kept = []
  let fenced = false
  for (const line of lines) {
    if (FENCE.test(line)) { fenced = !fenced; continue }
    if (!fenced) kept.push(inline(line))
  }
  return kept.join('\n')
}

/**
 * 抽出指向仓库内文件的链接目标（外部 URL 与纯锚点跳过）。
 * @param text - markdown 原文。
 * @returns 目标字符串数组（可能重复）。
 */
export function findLocalLinkTargets(text) {
  const targets = []
  for (const match of stripCode(text).matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // http(s):, mailto:, …
    const path = target.split('#')[0]
    if (path === '') continue // 纯锚点
    targets.push(target)
  }
  return targets
}

/**
 * 扫描一组文档，找出指向不存在文件的链接。
 * @param root - 仓库根（绝对路径）。
 * @param files - 要扫描的 markdown 文件（绝对路径）。
 * @param deps - `{ exists, resolve, dirname }`（默认取自 node:fs/node:path，便于测试注入）。
 * @returns `{ checked, broken }`；`broken` 每项为 `{ file, target }`。
 */
export function findBrokenLinks(root, files, deps = {}) {
  const exists = deps.exists
  const resolvePath = deps.resolve
  const dir = deps.dirname
  const checked = []
  const broken = []
  for (const file of files) {
    let text
    try { text = deps.readFileSync(file, 'utf8') } catch { continue }
    for (const target of findLocalLinkTargets(text)) {
      checked.push({ file, target })
      const path = target.split('#')[0]
      if (!exists(resolvePath(dir(file), path))) broken.push({ file, target })
    }
  }
  return { checked, broken, root }
}
