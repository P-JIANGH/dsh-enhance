/**
 * 共享的 dsh 启动定位 + QA profile 自检（供 qa/ 下三个实驱脚本复用）。
 *
 * 为什么需要它：
 * - 原实现只走 `where.exe dsh.cmd`，在 dsh shim 目录不在 PATH 的机器上会回退到裸
 *   `dsh.cmd` 并抛 `spawnSync dsh.cmd EINVAL`，实驱静默不可用。
 * - 原实现不检查 profile 是否挂了 app bundle；只挂 dsh-base 的 profile 会让
 *   `dsh --profile X "<task>"` 装配完插件树后没有 app 执行任务 —— 表现为"无输出且不退出"，
 *   很容易被误判成 dsh 版本缺陷。
 * - 目标默认值曾落在真实 `~/.dsh`：不带环境变量直接跑实驱会在真实环境里找一个不含
 *   本插件的 profile，然后报"未发现 dsh-enhance 层"——把人引向完全错误的方向（实际发生过）。
 *   现在 {@link resolveQaTarget} 隔离优先：仓库内隔离 home 存在就只碰它。
 *
 * @module qa/dsh-launch
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** dsh 的包内入口相对路径（相对 npm 前缀）。 */
const BIN_REL = ['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js']

/** 桌面版（Electron 应用）自带的 CLI shim，相对应用根目录。 */
export const DESKTOP_SHIM_REL = ['resources', 'runtime', 'cli', 'bin', 'dsh.cmd']

/** 桌面版 CLI 的真实入口（由应用自带的 Electron 以 node 模式运行）。 */
export const DESKTOP_HOST_CLI_REL = [
  'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js',
]

/** 隔离 QA home（仓库内、`.gitignore` 覆盖）：实驱默认只碰它。 */
export const QA_HOME = fileURLToPath(new URL('../.dsh-enhance/desktop-test-home/', import.meta.url))

/** 隔离 QA home 里挂本插件的 profile 名。 */
export const QA_PROFILE = 'qa'

/**
 * 解析实驱要用的 `$DSH_HOME` 与 profile：**隔离优先**。
 *
 * 显式 `DSH_HOME` / `DSH_ENHANCE_PROFILE` 优先；否则若仓库内的隔离 QA home 存在就用它
 * （配 `QA_PROFILE`），不存在才退回真实 `~/.dsh` —— 目的是实驱不可能意外污染真实环境。
 *
 * @param options - `qaHome` / `env` 覆盖（单测用）。
 * @returns `{ home, profile, env, isolated, explicitHome }`；`env` 是要注入子进程的环境变量。
 */
export function resolveQaTarget(options = {}) {
  const env = options.env ?? process.env
  const qaHome = options.qaHome ?? QA_HOME
  const explicitHome = typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0
  const home = explicitHome ? env.DSH_HOME : existsSync(qaHome) ? qaHome : join(homedir(), '.dsh')
  const profile = env.DSH_ENHANCE_PROFILE || (home === qaHome ? QA_PROFILE : 'dsh-enhance')
  return { home, profile, env: { DSH_HOME: home }, isolated: home === qaHome, explicitHome }
}

/**
 * 桌面版应用根目录探测：`DSH_BIN` 指向桌面 shim 时，反推应用根。
 * 布局：`<root>/resources/runtime/cli/bin/dsh.cmd`。
 */
export function desktopRootOf(bin) {
  if (!bin || !/resources[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh\.cmd$/i.test(bin)) return undefined
  let root = bin
  for (let i = 0; i < DESKTOP_SHIM_REL.length; i++) root = dirname(root)
  return root
}

/**
 * 由桌面版应用根目录构造启动命令。
 *
 * 桌面版不能像普通 shim 那样直接 spawn：它的 `dsh.cmd` 会再拉一次
 * `"<App>.exe" --expose-internals <app.asar>/…/dsh-desktop-host/lib/cli.js`，还带
 * `ELECTRON_RUN_AS_NODE=1`。这里直接复刻那三条事实（exe + --expose-internals + cli.js + env），
 * 不经过 `.cmd`，避开 Windows 上 spawnSync 拉 `.cmd` 的 EINVAL。
 *
 * @param root - 应用根目录（含 `resources/`）。
 * @returns `{ cmd, prefix, env, kind, shim }`，布局不符时返回 undefined。
 */
export function desktopLaunchFrom(root) {
  if (!root || !existsSync(root)) return undefined
  const shim = join(root, ...DESKTOP_SHIM_REL)
  const cliJs = join(root, ...DESKTOP_HOST_CLI_REL)
  if (!existsSync(shim) || !existsSync(cliJs)) return undefined
  let exe
  try {
    // 应用根下的可执行文件；优先与应用目录同名的那个（避开 elevate.exe 之类助手程序）。
    const candidates = readdirSync(root).filter(f => f.toLowerCase().endsWith('.exe')).sort()
    const named = candidates.find(f => basename(root).toLowerCase().startsWith(basename(f, '.exe').toLowerCase()))
    exe = named ?? candidates[0]
  } catch {
    return undefined
  }
  if (!exe) return undefined
  return {
    kind: 'desktop',
    shim,
    cmd: join(root, exe),
    prefix: ['--expose-internals', cliJs],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

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
 * 顺序：`DSH_DESKTOP_ROOT` → `DSH_BIN`（桌面 shim 会转成 exe+cli.js）→ `where/which dsh`
 * → PATH 目录直扫 → nvm（NVM_HOME / PATH 中的 nvm 根）→ 与当前 node 同级的全局安装。
 *
 * @returns `{ cmd, prefix, env?, kind?, shim?, missing? }`；`missing: true` 表示一个都没找到。
 */
export function resolveDsh() {
  // 桌面版应用根（显式指定，或由 DSH_BIN 指向桌面 shim 反推）。
  const desktopRoot = process.env.DSH_DESKTOP_ROOT || desktopRootOf(process.env.DSH_BIN)
  if (desktopRoot) {
    const desktop = desktopLaunchFrom(desktopRoot)
    if (desktop) return desktop
  }
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
    '  - 或设置 DSH_BIN 指向桌面版 shim（…\\resources\\runtime\\cli\\bin\\dsh.cmd），或直接设 DSH_DESKTOP_ROOT 指向应用根',
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
 * @param options - `requireApp` 默认 true；`dshHome` 覆盖自检用的 home（默认环境变量或 `~/.dsh`）。
 * @returns 解析出的启动器信息。
 */
export function preflight(profile, { requireApp = true, dshHome } = {}) {
  const dsh = resolveDsh()
  if (dsh.missing) failFast(dshMissingHint())
  if (requireApp) {
    const prof = checkProfileApp(profile, dshHome)
    if (!prof.ok) failFast(prof.reason)
  }
  return dsh
}
