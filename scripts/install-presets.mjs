#!/usr/bin/env node
/**
 * CLI over the shared preset installer (`src/features/presets/install.ts`,
 * compiled to `lib/`): put this package's `presets/` into the harness-home preset
 * root — the only supported way to make them selectable, because presets are
 * filesystem-discovered and the presets service can only `copy()` an existing one.
 *
 * The implementation lives in `lib/` so this CLI, the plugin's `/presets` command,
 * the `/doctor` status line and the `postinstall` hook share exactly one copy of
 * the plan/backup logic.
 *
 * @module dsh-enhance/scripts/install-presets
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRESETS_SOURCE,
  backupRootFor,
  dirsEqual,
  discoverPresetIds,
  findRenamedPresets,
  installPresets,
  planPresetInstall,
  renderInstallReport,
  renderPresetStatus,
} from '../lib/features/presets/install.js'

// Re-exported for `tests/install-presets.test.mjs` (the CLI stays the documented entry).
export {
  PRESETS_SOURCE as SOURCE_ROOT,
  backupRootFor,
  dirsEqual,
  discoverPresetIds,
  findRenamedPresets,
  installPresets,
  planPresetInstall,
}

export const USAGE = `用法：node scripts/install-presets.mjs [选项]

把本包的 presets/ 装进 $DSH_HOME/.agent-presets（$DSH_HOME 默认 ~/.dsh）。

选项：
  --target <dir>     覆盖目标预设根
  --prune-renamed    备份后删除 composition 指向旧包名 oh-my-dsh 的残留
  --status           只打印每个预设的安装状态，不写盘
  --dry-run          只打印安装计划，不写任何文件
  --check            只判定是否已安装且为最新（非最新则退出码 1）
  --if-installed     仅当本包位于 node_modules 下才执行（postinstall 用；否则静默跳过）
  -h, --help         显示本帮助`

/** Parse argv; unknown options fail loud instead of being ignored. */
export function parseArgs(argv) {
  const options = { targetRoot: undefined, pruneRenamed: false, status: false, dryRun: false, check: false, ifInstalled: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target') {
      const value = argv[++i]
      if (!value) throw new Error('--target 需要一个目录参数')
      options.targetRoot = resolve(value)
    } else if (arg === '--prune-renamed') options.pruneRenamed = true
    else if (arg === '--status') options.status = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--check') options.check = true
    else if (arg === '--if-installed') options.ifInstalled = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else throw new Error(`未知参数：${arg}\n\n${USAGE}`)
  }
  return options
}

/**
 * Whether this copy was installed as a dependency (a `node_modules` path segment).
 *
 * `link:` installs resolve to the real repository path, so they read as NOT
 * installed and the postinstall hook stays quiet — a linked checkout is a
 * development tree, where writing the user's home must be an explicit action.
 */
export function installedAsDependency() {
  return /[\\/]node_modules[\\/]/.test(fileURLToPath(import.meta.url))
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
    return
  }
  if (options.help) {
    process.stdout.write(USAGE + '\n')
    return
  }
  // Install-time half of the write contract: act only when installed as a dependency.
  if (options.ifInstalled && !installedAsDependency()) return
  try {
    if (options.status) {
      process.stdout.write(renderPresetStatus(planPresetInstall(options)) + '\n')
      return
    }
    const result = installPresets(options)
    process.stdout.write(renderInstallReport(result, options) + '\n')
    if (options.check && !result.current) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`安装失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

// 仅在被直接执行时跑 main（导入本模块做单测不应触发安装）。
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()
