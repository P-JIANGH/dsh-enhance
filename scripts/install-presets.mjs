#!/usr/bin/env node
/**
 * 把本包的 `presets/` 安装到 harness-home 的预设根（`$DSH_HOME/.agent-presets`）。
 *
 * 为什么必须是脚本：预设是**文件系统发现**的（上游 `dsh-agent-presets`：配置 roots +
 * `includeUserRoot` 默认追加 `<dshHome>/.agent-presets`，每次读取重新扫描、按 id
 * 先到先得）。插件作为 bundle 挂载时**不会**把预设写进用户家目录——所以 README
 * 一直教人手工 `cp`，而实机上仓库里的 6 个预设一个都没装，用户家目录里只剩指向旧
 * 包名的残留（`name: oh-my-dsh`，包已改名 → 不可解析 → 选中即挂载失败）。
 *
 * 本脚本是幂等的：内容一致就跳过；要覆盖或清理的目录先整份备份到目标根的**同级**
 * `agent-presets-backup-<时间戳>/`（同级而非内部：预设根的子目录会被扫描，
 * 备份不该出现在名册里）。
 *
 * @module dsh-enhance/scripts/install-presets
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本包自带的预设目录。 */
export const SOURCE_ROOT = fileURLToPath(new URL('../presets/', import.meta.url))

/** 让一个目录成为预设的 composition 文件名（上游 `COMPOSITION_FILE`）。 */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/** 改动前的包名：历史预设的 composition 仍指向它，而它已不可解析。 */
export const LEGACY_PACKAGE_NAMES = ['oh-my-dsh']

/** dsh 的 harness home（与 launcher 一致：`DSH_HOME` 优先，否则 `~/.dsh`）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 上游默认追加的用户预设根。 */
export function defaultTargetRoot() {
  return join(dshHome(), '.agent-presets')
}

/** 目录探测（不存在/不可访问 → false，不抛）。 */
function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 可安装的预设 id：非隐藏目录且带 composition 文件。 */
export function discoverPresetIds(sourceRoot = SOURCE_ROOT) {
  if (!isDir(sourceRoot)) return []
  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()
      && !entry.name.startsWith('.')
      && existsSync(join(sourceRoot, entry.name, COMPOSITION_FILE)))
    .map(entry => entry.name)
    .sort()
}

/** 递归列出一个目录下的全部文件（相对路径，排序）。 */
function listFiles(root, prefix = '') {
  const out = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) out.push(...listFiles(root, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

/** 两份预设目录是否逐字节一致（文件集合 + 内容）。 */
export function dirsEqual(left, right) {
  if (!isDir(left) || !isDir(right)) return false
  const leftFiles = listFiles(left)
  const rightFiles = listFiles(right)
  if (leftFiles.length !== rightFiles.length) return false
  for (let i = 0; i < leftFiles.length; i++) {
    if (leftFiles[i] !== rightFiles[i]) return false
    if (!readFileSync(join(left, leftFiles[i])).equals(readFileSync(join(right, rightFiles[i])))) return false
  }
  return true
}

/** 目标根里 composition 指向旧包名的预设（改名残留，选中即挂载失败）。 */
export function findRenamedPresets(targetRoot = defaultTargetRoot(), legacyNames = LEGACY_PACKAGE_NAMES) {
  if (!isDir(targetRoot)) return []
  const found = []
  for (const entry of readdirSync(targetRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const composition = join(targetRoot, entry.name, COMPOSITION_FILE)
    if (!existsSync(composition)) continue
    const text = readFileSync(composition, 'utf8')
    const hit = legacyNames.find(name => new RegExp(`^\\s*name:\\s*['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm').test(text))
    if (hit) found.push({ id: entry.name, legacyName: hit, composition })
  }
  return found.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * 计算安装计划（纯读，不写盘）。
 * @param options - 源/目标根与是否清理改名残留。
 * @returns 计划：每个预设的动作 + 待清理的残留。
 */
export function planPresetInstall(options = {}) {
  const sourceRoot = options.sourceRoot ?? SOURCE_ROOT
  const targetRoot = options.targetRoot ?? defaultTargetRoot()
  const entries = discoverPresetIds(sourceRoot).map(id => {
    const from = join(sourceRoot, id)
    const to = join(targetRoot, id)
    const action = !isDir(to) ? 'install' : dirsEqual(from, to) ? 'up-to-date' : 'replace'
    return { id, from, to, action }
  })
  // 同名预设属于「更新」而不是「残留」：旧副本由 entries 覆盖，不能被清理
  // （否则会先装上再删掉）。只有 id 不在本包名册里的旧名目录才叫残留。
  const ours = new Set(entries.map(entry => entry.id))
  const renamed = options.pruneRenamed
    ? findRenamedPresets(targetRoot).filter(preset => !ours.has(preset.id))
    : []
  return { sourceRoot, targetRoot, entries, renamed }
}

/** 同一秒内的第二次备份也不该互相覆盖。 */
function uniqueDir(base) {
  if (!existsSync(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`无法为备份找到可用目录：${base}`)
}

/** 备份目录名：目标根的同级，避免被预设扫描当成名册条目。 */
export function backupRootFor(targetRoot, date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '')
  return uniqueDir(join(dirname(targetRoot), `agent-presets-backup-${stamp}`))
}

/**
 * 执行安装计划。
 * @param options - `dryRun`（只报计划）/ `check`（只判定，非最新即失败）/ `pruneRenamed`。
 * @returns 计划、备份根与摘要；`check` 模式下不写盘。
 */
export function installPresets(options = {}) {
  const dryRun = options.dryRun ?? false
  const check = options.check ?? false
  const plan = planPresetInstall({ ...options, pruneRenamed: options.pruneRenamed ?? false })
  const summary = { installed: 0, replaced: 0, unchanged: 0, pruned: 0 }
  const needsWrite = plan.entries.filter(e => e.action !== 'up-to-date').length + plan.renamed.length
  const current = needsWrite === 0

  if (dryRun || check) {
    for (const entry of plan.entries) if (entry.action === 'up-to-date') summary.unchanged++
    return { plan, backupRoot: null, summary, current, checkOk: current, wrote: false }
  }

  mkdirSync(plan.targetRoot, { recursive: true })
  let backupRoot = null
  if (needsWrite > 0) {
    backupRoot = backupRootFor(plan.targetRoot, options.now?.() ?? new Date())
    mkdirSync(backupRoot, { recursive: true })
  }
  for (const entry of plan.entries) {
    if (entry.action === 'up-to-date') {
      summary.unchanged++
      continue
    }
    if (entry.action === 'replace') {
      cpSync(entry.to, join(backupRoot, entry.id), { recursive: true })
      rmSync(entry.to, { recursive: true, force: true })
      summary.replaced++
    } else {
      summary.installed++
    }
    cpSync(entry.from, entry.to, { recursive: true })
  }
  for (const stale of plan.renamed) {
    cpSync(join(plan.targetRoot, stale.id), join(backupRoot, stale.id), { recursive: true })
    rmSync(join(plan.targetRoot, stale.id), { recursive: true, force: true })
    summary.pruned++
  }
  return { plan, backupRoot, summary, current: true, checkOk: true, wrote: needsWrite > 0 }
}

const USAGE = `用法：node scripts/install-presets.mjs [选项]

把本包的 presets/ 安装到 $DSH_HOME/.agent-presets（$DSH_HOME 默认 ~/.dsh）。

选项：
  --target <dir>     覆盖目标预设根
  --prune-renamed    备份后删除 composition 指向旧包名 ${LEGACY_PACKAGE_NAMES.join('、')} 的残留
  --dry-run          只打印计划，不写任何文件
  --check            只判定是否已安装且为最新（非最新则退出码 1）
  -h, --help         显示本帮助`

/** 解析 argv（未知参数直接失败，避免静默忽略）。 */
export function parseArgs(argv) {
  const options = { targetRoot: undefined, pruneRenamed: false, dryRun: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target') {
      const value = argv[++i]
      if (!value) throw new Error('--target 需要一个目录参数')
      options.targetRoot = resolve(value)
    } else if (arg === '--prune-renamed') options.pruneRenamed = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--check') options.check = true
    else if (arg === '-h' || arg === '--help') options.help = true
    else throw new Error(`未知参数：${arg}\n\n${USAGE}`)
  }
  return options
}

/** 打印计划与摘要。 */
function report(result, { dryRun, check }) {
  const { plan, summary, backupRoot } = result
  const lines = [
    '# dsh-enhance 预设安装',
    `源：${plan.sourceRoot}`,
    `目标：${plan.targetRoot}`,
  ]
  const label = { install: '安装', replace: '更新（旧副本将备份）', 'up-to-date': '已是最新' }
  for (const entry of plan.entries) lines.push(`- ${entry.id}：${label[entry.action]}`)
  for (const stale of plan.renamed) lines.push(`- ${stale.id}：清理改名残留（composition 指向无法解析的 ${stale.legacyName}）`)
  if (backupRoot) lines.push(`备份：${backupRoot}`)
  if (plan.entries.length === 0) lines.push('（源目录里没有可安装的预设）')
  if (dryRun) lines.push('预演模式：未写入任何文件。')
  else if (check) lines.push(result.checkOk ? '检查通过：预设已安装且为最新。' : '检查失败：预设缺失或已过期，运行不带 --check 的同一命令即可安装。')
  else lines.push(`完成：新增 ${summary.installed}，更新 ${summary.replaced}，已是最新 ${summary.unchanged}，清理 ${summary.pruned}`)
  process.stdout.write(lines.join('\n') + '\n')
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
  try {
    const result = installPresets(options)
    report(result, options)
    if (options.check && !result.checkOk) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`安装失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

// 仅在被直接执行时跑 main（导入本模块做单测不应触发安装）。
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main()

export { USAGE }
