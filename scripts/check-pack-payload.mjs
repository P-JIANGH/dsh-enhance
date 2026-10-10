// 发布载荷形状检查：`npm pack --dry-run` 的清单里该有的必须有、该没的必须没有。
//
// 为什么需要它：曾经发生过"源码删了、lib/ 里旧编译产物还在"，而那 4 个陈旧模块一路
// 被打进 tarball（lib/hooks/orient.js、lib/features/skill-trigger.js、
// lib/features/presets/install.js、当时的 lib/shared/provenance.js）。单测只看源码，
// 看不见载荷；这个脚本看载荷本身。
//
// 运行：node scripts/check-pack-payload.mjs

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 载荷里必须存在的路径（前缀匹配）。 */
const REQUIRED = [
  'lib/index.js',
  'lib/enhance-mode.js',
  'lib/shared/provenance.js',
  'lib/shared/session-scope.js',
  'client/client.js',
  'skills/',
  'cordis.patch.yml',
]

/** 已删除源码的编译产物：出现过就必须失败。 */
const FORBIDDEN = [
  'lib/hooks/orient.js',
  'lib/features/skill-trigger.js',
  'lib/features/presets/install.js',
]

/**
 * npm 的可执行入口。Windows 上 `spawnSync('npm.cmd', …)` 会 EINVAL，
 * 所以走 `node <npm-cli.js>`；`npm_execpath` 在经由 npm/pnpm 运行时已经给出正确路径。
 *
 * 兜底必须**同时**覆盖两种 Node 安装布局：Windows 是 `<nodeDir>/node_modules/npm/…`，
 * POSIX（官方 tar、apt、`actions/setup-node`）是 `<nodeDir>/lib/node_modules/npm/…`。
 * 只写前者时，本脚本在 Linux 上会直接抛"找不到 npm 的 CLI 入口"——CI 的 ubuntu 腿就是这样红的
 * （2026-10-10，第一次跑 Linux 时把三处平台假设逐一暴露出来）。
 *
 * @returns `{ cmd, prefix }`。
 */
function npmArgv() {
  // 两种安装布局的**前缀**不同：
  //   Windows 官方安装：`<prefix>\node.exe`            → npm 在 `<prefix>\node_modules\npm\…`
  //   POSIX（官方 tar / apt / actions/setup-node）：`<prefix>/bin/node` → npm 在 `<prefix>/lib/node_modules/npm/…`
  // 所以 POSIX 要用 `dirname(dirname(execPath))`，写成 `dirname(execPath)/lib/…` 会多一层 `bin/`
  // ——2026-10-10 就是这么在 CI 的 ubuntu 腿上又红了一次的。
  const nodeDir = dirname(process.execPath)
  const prefixDir = resolve(nodeDir, '..')
  const execpath = process.env.npm_execpath
  // `npm_execpath` 只在它**确实是 npm 的 JS 入口**时才可用：在 pnpm 下它指向
  // `@pnpm/exe/pnpm.exe`（本机实测），交给 `node` 会报 `Unknown file extension ".exe"` ——
  // 于是 `pnpm check:pack` 一直是坏的（既有缺陷，2026-10-10 顺手修掉）。
  // 而且这个脚本要检查的是**npm 打出来的载荷**（`npm publish` 用的就是 npm 的打包器），
  // 所以 Node 自带的那份 npm 优先。
  const execpathIsNpmJs =
    typeof execpath === 'string' && /\.(c|m)?js$/i.test(execpath) && /(^|[\\/])npm[\\/][^\\/]*$/.test(execpath)
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows 官方安装
    join(prefixDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // POSIX 官方安装
    join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // 少数把 node 装在 prefix 根、npm 放 lib/ 的布局
    execpathIsNpmJs ? execpath : undefined,
    join(process.cwd(), 'node_modules', 'npm', 'bin', 'npm-cli.js'), // 本仓库自带
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { cmd: process.execPath, prefix: [candidate], shell: false }
  }
  // 最后兜底：PATH 上的 npm。CI 上一定有（发布步骤就是直接跑 `npm publish` 的）。
  // Windows 直接 spawn `npm.cmd` 会 EINVAL，所以这一条必须过 shell。
  return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [], shell: true }
}

const npm = npmArgv()
const packed = spawnSync(npm.cmd, [...npm.prefix, 'pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  cwd: process.cwd(),
  shell: npm.shell,
})
if (packed.error) {
  console.error(`check-pack-payload: npm pack 启动失败：${packed.error.message}`)
  process.exit(2)
}
if (packed.status !== 0) {
  console.error(`check-pack-payload: npm pack 退出码 ${packed.status}\n${packed.stderr}`)
  process.exit(2)
}

let report
try {
  report = JSON.parse(packed.stdout)
} catch (err) {
  console.error(`check-pack-payload: 无法解析 npm pack --json 输出（${err.message}）\n${packed.stdout.slice(0, 400)}`)
  process.exit(2)
}
const paths = (Array.isArray(report) ? report[0]?.files : undefined)?.map(file => String(file.path)) ?? []
if (paths.length === 0) {
  console.error('check-pack-payload: 载荷清单为空 —— 不把"空"当成通过')
  process.exit(1)
}

const failures = []
for (const required of REQUIRED) {
  if (!paths.some(p => p === required || p.startsWith(required))) failures.push(`缺少必需文件：${required}`)
}
for (const forbidden of FORBIDDEN) {
  if (paths.includes(forbidden)) failures.push(`仍包含已删除源码的编译产物：${forbidden}`)
}
// 不该被打包的目录（.dsh-enhance 是运行痕迹、src/tests/docs 不进载荷）。
for (const prefix of ['.dsh-enhance/', 'src/', 'tests/', 'docs/']) {
  if (paths.some(p => p.startsWith(prefix))) failures.push(`载荷里出现了不该有的目录：${prefix}`)
}

if (failures.length > 0) {
  console.error('check-pack-payload: FAIL')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`check-pack-payload: PASS（${paths.length} 个文件，必需项齐备、无陈旧产物）`)
