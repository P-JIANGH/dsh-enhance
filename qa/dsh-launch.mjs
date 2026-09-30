/**
 * 共享的 dsh 启动定位 + QA profile 自检（供 qa/ 下三个实驱脚本复用）。
 *
 * 为什么需要它：
 * - 原实现只走 `where.exe dsh.cmd`，在 dsh shim 目录不在 PATH 的机器上会回退到裸
 *   `dsh.cmd` 并抛 `spawnSync dsh.cmd EINVAL`，实驱静默不可用。
 * - 原实现不检查 profile 是否挂了 app bundle；只挂 dsh-base 的 profile 会让
 *   `dsh --profile X "<task>"` 装配完插件树后没有 app 执行任务 —— 表现为"无输出且不退出"，
 *   很容易被误判成 dsh 版本缺陷。
 *
 * @module qa/dsh-launch
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

/** dsh 的包内入口相对路径（相对 npm 前缀）。 */
const BIN_REL = ['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js']

/** 由 shim 路径推出 bin.js（shim 可能在 <prefix>\ 或 <prefix>\bin\）。 */
function binFromShim(shim) {
  return [
    join(dirname(shim), ...BIN_REL),
    join(dirname(shim), '..', ...BIN_REL),
  ].find(existsSync)
}

/** 扫描 nvm 风格的版本目录（<root>/v*），取版本号最高的一个。 */
function scanNvmRoot(root) {
  if (!root || !existsSync(root)) return undefined
  let versions = []
  try {
    versions = readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^v\d+\.\d+\.\d+$/.test(e.name))
      .map(e => e.name)
      .sort((a, b) => {
        const pa = a.slice(1).split('.').map(Number)
        const pb = b.slice(1).split('.').map(Number)
        return (pb[0] - pa[0]) || (pb[1] - pa[1]) || (pb[2] - pa[2])
      })
  } catch {
    return undefined
  }
  for (const v of versions) {
    const bin = join(root, v, ...BIN_REL)
    if (existsSync(bin)) return { bin, shim: join(root, v, process.platform === 'win32' ? 'dsh.cmd' : 'dsh') }
  }
  return undefined
}

/**
 * 解析如何启动 dsh。优先用当前 node 直接跑 `@deepseek-ai/dsh/lib/bin.js`
 * （无 shell 蹦床，避免 Windows 上 spawnSync 直接拉 `.cmd` 的 EINVAL）。
 *
 * 顺序：`DSH_BIN` → `where/which dsh` → PATH 目录直扫 → nvm（NVM_HOME / PATH 中的 nvm 根）
 * → 与当前 node 同级的全局安装。
 *
 * @returns `{ cmd, prefix, shim?, missing? }`；`missing: true` 表示一个都没找到。
 */
export function resolveDsh() {
  if (process.env.DSH_BIN) return { cmd: process.env.DSH_BIN, prefix: [] }

  const isWin = process.platform === 'win32'
  const shimName = isWin ? 'dsh.cmd' : 'dsh'
  const pathSep = isWin ? ';' : ':'

  // 1) where / which
  const finder = isWin ? 'where.exe' : 'which'
  const info = spawnSync(finder, [shimName], { encoding: 'utf8' })
  if (!info.error && info.status === 0 && info.stdout) {
    for (const line of info.stdout.split(/\r?\n/)) {
      const shim = line.trim()
      if (!shim) continue
      const bin = binFromShim(shim)
      if (bin) return { cmd: process.execPath, prefix: [bin], shim }
    }
  }

  // 2) 直接扫描 PATH 目录（where 不可用，或 shim 不在 PATH 但 bin.js 在某个前缀下）
  const pathDirs = (process.env.PATH ?? '').split(pathSep).filter(Boolean)
  for (const dir of pathDirs) {
    for (const name of isWin ? ['dsh.cmd', 'dsh.exe', 'dsh'] : ['dsh']) {
      const cand = join(dir, name)
      if (!existsSync(cand)) continue
      const bin = binFromShim(cand)
      if (bin) return { cmd: process.execPath, prefix: [bin], shim: cand }
    }
  }

  // 3) nvm 布局：NVM_HOME 显式给出，或 PATH 里出现 nvm 根（nvm-windows 只把根放进 PATH，
  //    真正的 shim 在 <root>/v<版本>/ 下）。
  const nvmRoots = [
    process.env.NVM_HOME,
    process.env.NVM_SYMLINK,
    ...pathDirs.filter(d => /(^|[\\/])nvm([\\/]|$)/i.test(d)),
  ].filter(Boolean)
  for (const root of nvmRoots) {
    const found = scanNvmRoot(root)
    if (found) return { cmd: process.execPath, prefix: [found.bin], shim: found.shim }
  }

  // 4) 与当前 node 同级的全局安装
  const sibling = join(dirname(process.execPath), ...BIN_REL)
  if (existsSync(sibling)) return { cmd: process.execPath, prefix: [sibling] }

  return { cmd: shimName, prefix: [], missing: true }
}

/** 启动器不可用时的可执行报错文案。 */
export function dshMissingHint() {
  return [
    '找不到 dsh 可执行入口。请任选其一：',
    '  - 把 dsh 的 shim 目录加进 PATH（本机为 F:\\nvm\\v24.13.0）',
    '  - 或设置 DSH_BIN 指向 dsh 的 lib/bin.js',
    '  - 或设置 NVM_HOME 指向 nvm 根目录',
  ].join('\n')
}

/** QA 使用的 profile 是否挂了 app bundle（没有 app 的 profile 无法跑 headless 任务）。 */
const APP_BUNDLE_RE = /(^|\/)dsh-(headless|web-app)$|-app$/

/**
 * 校验 profile 能跑 headless 任务。
 * @param profile - profile 名。
 * @param dshHome - `$DSH_HOME`（默认环境变量或 `~/.dsh`）。
 * @returns `{ ok, app?, reason?, pkg? }`。
 */
export function checkProfileApp(profile, dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const pkg = join(dshHome, 'profiles', profile, 'package.json')
  if (!existsSync(pkg)) {
    return { ok: false, pkg, reason: `profile '${profile}' 不存在：${pkg}` }
  }
  let bundles = []
  try {
    bundles = JSON.parse(readFileSync(pkg, 'utf8'))?.dsh?.profile?.bundles ?? []
  } catch {
    return { ok: false, pkg, reason: `无法解析 profile package.json：${pkg}` }
  }
  const app = bundles.find(b => APP_BUNDLE_RE.test(String(b)))
  if (app) return { ok: true, app, pkg }
  return {
    ok: false,
    pkg,
    reason: [
      `profile '${profile}' 没有挂任何 app bundle（bundles: ${bundles.join(', ') || '(空)'}）。`,
      '这样的 profile 装配完插件树后没有 app 执行任务，表现为「无输出且不退出」，',
      `请补 @deepseek-ai/dsh-headless：${pkg}`,
    ].join(''),
  }
}

/** 统一的启动失败报告：打印原因并以给定码退出。 */
export function failFast(message, code = 2) {
  console.error(message)
  process.exit(code)
}

/**
 * 运行前自检：启动器可用（+ 可选地要求 profile 可跑 headless）。
 * `--dump-config` 这类不启动 app 的用法应传 `requireApp: false`。
 * @param profile - profile 名。
 * @param options - `requireApp` 默认 true。
 * @returns 解析出的启动器信息。
 */
export function preflight(profile, { requireApp = true } = {}) {
  const dsh = resolveDsh()
  if (dsh.missing) failFast(dshMissingHint())
  if (requireApp) {
    const prof = checkProfileApp(profile)
    if (!prof.ok) failFast(prof.reason)
  }
  return dsh
}
