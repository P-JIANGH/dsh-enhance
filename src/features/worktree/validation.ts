/**
 * Worktree path validation (architecture §5.6 `validation.ts`): a worktree
 * spec may only reference `./` / `../` relative or absolute paths, and the
 * resolved directory must live under the configured baseDir. Rejects
 * symlink escape (via realpath) and `..` overflow (via containment).
 *
 * @module oh-my-dsh/features/worktree/validation
 */

import path from 'node:path'
import { isContained, isContainedRobust, compareKey } from '../../shared/path.js'

/**
 * Validate and resolve a worktree spec against a base dir.
 * @param spec - a `./` `../` relative or absolute path supplied by config.
 * @param baseDir - the configured worktree storage root.
 * @returns the resolved absolute path, or throws with a reason.
 */
export function validateWorktreeSpec(spec: string, baseDir: string): string {
  if (!spec || typeof spec !== 'string') {
    throw new Error('worktree spec must be a non-empty string')
  }
  const resolved = path.isAbsolute(spec) ? path.resolve(spec) : path.resolve(baseDir, spec)
  if (!isContained(resolved, baseDir)) {
    throw new Error(`worktree spec escapes base dir: ${spec}`)
  }
  if (!isContainedRobust(resolved, baseDir)) {
    throw new Error(`worktree spec resolves outside base dir via symlink: ${spec}`)
  }
  return resolved
}

/**
 * Reject a work id / directory name that could do path traversal or collide
 * with a parent. Names must be flat (no separators, no `..`).
 * @param name - candidate directory/branch component.
 */
export function assertSafeWorkName(name: string): void {
  if (!name) throw new Error('work name must be non-empty')
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`unsafe work name: ${name}`)
  }
}

/** Resolve a worktree path for a work id under baseDir. */
export function worktreePathFor(baseDir: string, dirName: string): string {
  return path.join(baseDir, dirName)
}

/** Normalized comparison key reused for path identity checks. */
export function keyOf(p: string): string {
  return compareKey(p)
}
