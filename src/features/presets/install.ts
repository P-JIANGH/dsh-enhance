/**
 * Preset installation, shared by the CLI (`scripts/install-presets.mjs`), the
 * human command `/presets`, and the package `postinstall` hook.
 *
 * Why a plugin must do this at all: agent presets are **filesystem-discovered**
 * (upstream `dsh-agent-presets` scans the configured roots plus
 * `<dshHome>/.agent-presets`, re-reading on every call) and the only authoring
 * write the presets service exposes is a whole-directory `copy()` of an existing
 * preset — a plugin cannot register its own composition in memory. Dropping the
 * shipped directories into the writable root is therefore the supported way to
 * make this bundle's presets selectable.
 *
 * The write is never implicit: the caller names the moment (the CLI, the
 * `/presets install` command, or `postinstall` when installed as a dependency).
 * Replacing or pruning a directory always backs it up first, to a sibling of the
 * target root (a sibling, not a child: a child would itself be scanned).
 *
 * @module dsh-enhance/features/presets/install
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The composition file that makes a directory a preset (upstream's constant). */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/** Pre-rename package name: old compositions still name it, and it resolves nowhere. */
export const LEGACY_PACKAGE_NAMES = ['oh-my-dsh']

/**
 * Absolute path of this package's shipped presets.
 *
 * Resolved from the compiled module (`lib/features/presets/`) three levels up, so
 * the same value serves the CLI, the command and the postinstall hook.
 */
export const PRESETS_SOURCE = fileURLToPath(new URL('../../../presets/', import.meta.url))

/** dsh harness home: `DSH_HOME` wins, else `~/.dsh` (the launcher's own rule). */
export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** The writable preset root the presets service appends by default. */
export function defaultPresetRoot(): string {
  return join(dshHome(), '.agent-presets')
}

/** True when the path exists and is a directory. */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Preset ids this package ships (non-hidden directories holding a composition). */
export function discoverPresetIds(sourceRoot: string = PRESETS_SOURCE): string[] {
  if (!isDir(sourceRoot)) return []
  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory()
      && !entry.name.startsWith('.')
      && existsSync(join(sourceRoot, entry.name, COMPOSITION_FILE)))
    .map(entry => entry.name)
    .sort()
}

/** Every file under a directory, as sorted relative paths. */
function listFiles(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) out.push(...listFiles(root, rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

/** Whether two preset directories are byte-identical (file set + content). */
export function dirsEqual(left: string, right: string): boolean {
  if (!isDir(left) || !isDir(right)) return false
  const leftFiles = listFiles(left)
  const rightFiles = listFiles(right)
  if (leftFiles.length !== rightFiles.length) return false
  for (let i = 0; i < leftFiles.length; i++) {
    if (leftFiles[i] !== rightFiles[i]) return false
    const rel = leftFiles[i]!
    if (!readFileSync(join(left, rel)).equals(readFileSync(join(right, rel)))) return false
  }
  return true
}

/** A target-root preset whose composition still names the pre-rename package. */
export interface RenamedPreset {
  id: string
  legacyName: string
  composition: string
}

/**
 * Find pre-rename residue in the target root: a preset whose composition names a
 * package that no longer resolves (selecting it fails to mount).
 */
export function findRenamedPresets(
  targetRoot: string = defaultPresetRoot(),
  legacyNames: readonly string[] = LEGACY_PACKAGE_NAMES,
): RenamedPreset[] {
  if (!isDir(targetRoot)) return []
  const found: RenamedPreset[] = []
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

/** One preset's planned action. */
export interface PresetPlanEntry {
  id: string
  from: string
  to: string
  action: 'install' | 'replace' | 'up-to-date'
}

/** The whole plan (pure reads). */
export interface PresetPlan {
  sourceRoot: string
  targetRoot: string
  entries: PresetPlanEntry[]
  renamed: RenamedPreset[]
}

/** Options shared by planning and installing. */
export interface PresetInstallOptions {
  sourceRoot?: string
  targetRoot?: string
  /** Also prune pre-rename residue (backed up first). */
  pruneRenamed?: boolean
}

/**
 * Compute the install plan without touching the disk.
 *
 * A preset we ship under the same id is a *replace*, never "residue": pruning it
 * after installing would delete what was just written.
 */
export function planPresetInstall(options: PresetInstallOptions = {}): PresetPlan {
  const sourceRoot = options.sourceRoot ?? PRESETS_SOURCE
  const targetRoot = options.targetRoot ?? defaultPresetRoot()
  const entries: PresetPlanEntry[] = discoverPresetIds(sourceRoot).map(id => {
    const from = join(sourceRoot, id)
    const to = join(targetRoot, id)
    const action: PresetPlanEntry['action'] = !isDir(to) ? 'install' : dirsEqual(from, to) ? 'up-to-date' : 'replace'
    return { id, from, to, action }
  })
  const ours = new Set(entries.map(entry => entry.id))
  const renamed = options.pruneRenamed
    ? findRenamedPresets(targetRoot).filter(preset => !ours.has(preset.id))
    : []
  return { sourceRoot, targetRoot, entries, renamed }
}

/** Per-action counts of one install run. */
export interface InstallSummary {
  installed: number
  replaced: number
  unchanged: number
  pruned: number
}

/** Outcome of one install run. */
export interface InstallResult {
  plan: PresetPlan
  /** Backup directory holding every replaced/pruned preset, when the run wrote. */
  backupRoot: string | null
  summary: InstallSummary
  /** True when nothing needed writing (i.e. the target root is current). */
  current: boolean
  wrote: boolean
}

/** A directory name no current process has taken yet. */
function uniqueDir(base: string): string {
  if (!existsSync(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`无法为备份找到可用目录：${base}`)
}

/** Sibling backup directory name for one run (never inside the scanned root). */
export function backupRootFor(targetRoot: string, date: Date = new Date()): string {
  const stamp = date.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '')
  return uniqueDir(join(dirname(targetRoot), `agent-presets-backup-${stamp}`))
}

/**
 * Execute the plan. `dryRun` and `check` report without writing.
 * @param options - roots, prune switch, and the two report-only modes.
 */
export function installPresets(
  options: PresetInstallOptions & { dryRun?: boolean; check?: boolean; now?: () => Date } = {},
): InstallResult {
  const plan = planPresetInstall(options)
  const summary: InstallSummary = { installed: 0, replaced: 0, unchanged: 0, pruned: 0 }
  const pending = plan.entries.filter(entry => entry.action !== 'up-to-date').length + plan.renamed.length
  if (options.dryRun || options.check) {
    for (const entry of plan.entries) if (entry.action === 'up-to-date') summary.unchanged++
    const current = pending === 0
    return { plan, backupRoot: null, summary, current, wrote: false }
  }

  mkdirSync(plan.targetRoot, { recursive: true })
  let backupRoot: string | null = null
  if (pending > 0) {
    backupRoot = backupRootFor(plan.targetRoot, options.now?.() ?? new Date())
    mkdirSync(backupRoot, { recursive: true })
  }
  for (const entry of plan.entries) {
    if (entry.action === 'up-to-date') {
      summary.unchanged++
      continue
    }
    if (entry.action === 'replace') {
      cpSync(entry.to, join(backupRoot as string, entry.id), { recursive: true })
      rmSync(entry.to, { recursive: true, force: true })
      summary.replaced++
    } else {
      summary.installed++
    }
    cpSync(entry.from, entry.to, { recursive: true })
  }
  for (const stale of plan.renamed) {
    cpSync(join(plan.targetRoot, stale.id), join(backupRoot as string, stale.id), { recursive: true })
    rmSync(join(plan.targetRoot, stale.id), { recursive: true, force: true })
    summary.pruned++
  }
  return { plan, backupRoot, summary, current: true, wrote: pending > 0 }
}

/**
 * One-line-per-preset status of the target root, derived from a plan. Used by the
 * `/presets` command and by `/doctor`, so both report the same facts.
 */
export function renderPresetStatus(plan: PresetPlan): string {
  const label: Record<PresetPlanEntry['action'], string> = {
    install: '未安装',
    replace: '需更新',
    'up-to-date': '已是最新',
  }
  const lines = [
    `预设源：${plan.sourceRoot}`,
    `预设目标：${plan.targetRoot}`,
    ...plan.entries.map(entry => `- ${entry.id}：${label[entry.action]}`),
  ]
  if (plan.entries.length === 0) lines.push('（包里没有可安装的预设）')
  const missing = plan.entries.filter(entry => entry.action !== 'up-to-date')
  lines.push(missing.length === 0
    ? '结论：预设已安装且为最新，预设菜单里应能看到它们（新会话生效）。'
    : `结论：${missing.length} 个预设未安装或已过期。执行 /presets install 安装（覆盖前会先备份）。`)
  return lines.join('\n')
}

/** Human-readable report of one install run (shared by the CLI and `/presets`). */
export function renderInstallReport(result: InstallResult, options: { dryRun?: boolean; check?: boolean } = {}): string {
  const { plan, summary, backupRoot } = result
  const label: Record<PresetPlanEntry['action'], string> = {
    install: '安装',
    replace: '更新（旧副本将备份）',
    'up-to-date': '已是最新',
  }
  const lines = [
    '# dsh-enhance 预设安装',
    `源：${plan.sourceRoot}`,
    `目标：${plan.targetRoot}`,
    ...plan.entries.map(entry => `- ${entry.id}：${label[entry.action]}`),
    ...plan.renamed.map(stale => `- ${stale.id}：清理改名残留（composition 指向无法解析的 ${stale.legacyName}）`),
  ]
  if (plan.entries.length === 0) lines.push('（源目录里没有可安装的预设）')
  if (backupRoot) lines.push(`备份：${backupRoot}`)
  if (options.dryRun) lines.push('预演模式：未写入任何文件。')
  else if (options.check) lines.push(result.current ? '检查通过：预设已安装且为最新。' : '检查失败：预设缺失或已过期，执行 install 即可安装。')
  else lines.push(`完成：新增 ${summary.installed}，更新 ${summary.replaced}，已是最新 ${summary.unchanged}，清理 ${summary.pruned}`)
  return lines.join('\n')
}
