/**
 * Path primitives shared by guards and work tracking: canonicalization with
 * Windows-aware comparison, and containment checks against a session/workspace
 * root. Pure functions (sync fs access only for realpath fallback, injected).
 * @module oh-my-dsh/shared/path
 */

import path from 'node:path'
import { realpathSync } from 'node:fs'

/** Whether the platform compares paths case-insensitively (Windows/macOS). */
export const IS_CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/**
 * Normalize a path for comparison: resolve `..` and `.`, and lowercase it for
 * case-insensitive platforms. Never throws; falls back to the input.
 * @param p - raw path.
 * @returns a comparable canonical string.
 */
export function compareKey(p: string): string {
  if (!p) return ''
  try {
    const normalized = path.resolve(p)
    return IS_CASE_INSENSITIVE ? normalized.toLowerCase() : normalized
  } catch {
    return IS_CASE_INSENSITIVE ? p.toLowerCase() : p
  }
}

/**
 * Resolve realpath for symlink detection, honoring a case-insensitive fallback.
 * @param p - path.
 * @returns the real absolute path, or `p` resolved when realpath fails.
 */
export function realPath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * Resolve an absolute root for containment checks. When `base` is absolute we
 * use it directly; otherwise resolve against cwd.
 * @param base - workspace/session root (absolute path).
 * @returns absolute base path.
 */
export function absoluteRoot(base: string): string {
  return path.isAbsolute(base) ? path.resolve(base) : path.resolve(process.cwd(), base)
}

/**
 * Check that a target path stays inside a containment root.
 * Lexical (compareKey) containment of the resolved target under the resolved
 * root — accounts for `..` and case/enum normalization. Symlink escape is left
 * to the caller via {@link realPath} (needs fs); this pure check covers lexical.
 * @param target - candidate path.
 * @param root - containment root.
 * @returns true when the target is within (or equal to) the root.
 */
export function isContained(target: string, root: string): boolean {
  const t = compareKey(target)
  const r = compareKey(root)
  if (!t || !r) return false
  if (t === r) return true
  const prefix = r.endsWith(path.sep) ? r : r + path.sep
  return t.startsWith(prefix)
}

/**
 * Check a target stays inside the root AND its realpath also stays inside a
 * resolved real root (symlink escape defense).
 * @param target - candidate path.
 * @param root - containment root.
 * @returns true when both lexical and real containment hold.
 */
export function isContainedRobust(target: string, root: string): boolean {
  if (!isContained(target, root)) return false
  try {
    const realTarget = realPath(target)
    const realRoot = realPath(root)
    return isContained(realTarget, realRoot)
  } catch {
    // realpath unavailable: rely on lexical containment.
    return isContained(target, root)
  }
}

/** Clamp a numeric byte budget. */
export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
