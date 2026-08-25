/**
 * WorktreeManager (architecture §5.6 `manager.ts`): create / list / find /
 * cleanup / reuse over the native `git worktree` command, with the injected git
 * runner, safe naming + validation, and boulder linkage.
 *
 * @module oh-my-dsh/features/worktree/manager
 */

import { join } from 'node:path'
import type { GitRunner } from './git-runner.js'
import { worktreeDirName } from './naming.js'
import { validateWorktreeSpec, assertSafeWorkName } from './validation.js'
import { setWorktreePath, getWorktreePath } from './boulder-link.js'

/** A parsed worktree entry from `git worktree list --porcelain`. */
export interface GitWorktree {
  path: string
  head?: string
  branch?: string
  detached: boolean
}

/** Options for creating a worktree. */
export interface CreateWorktreeOptions {
  /** The boulder work id. */
  workId: string
  /** Human-readable slug appended to the directory name. */
  slug?: string
  /** Storage root for worktrees (must be the boulder store dir or a configured base). */
  baseDir: string
}

/**
 * Factory for a WorktreeManager bound to a git runner and a boulder store dir.
 */
export function createWorktreeManager(storeDir: string, git: GitRunner) {
  return {
    /**
     * Create a detached worktree for a work and register it on the boulder.
     * @param repoRoot - the main repository path (the session cwd / repo root).
     * @param opts - work id + base dir for the worktree.
     * @returns the absolute worktree path.
     */
    async create(repoRoot: string, opts: CreateWorktreeOptions): Promise<string> {
      assertSafeWorkName(opts.workId)
      const dirName = worktreeDirName(opts.workId, opts.slug)
      const dir = join(opts.baseDir, dirName)
      validateWorktreeSpec(dir, opts.baseDir)
      // `git worktree add --detach <dir>` — detached (detached + -b conflict;
      // branch naming is available via worktreeBranch for attach-based flows).
      await git.must(['worktree', 'add', '--detach', dir], repoRoot)
      setWorktreePath(storeDir, opts.workId, dir)
      return dir
    },

    /**
     * List worktrees for a repository via porcelain.
     * @param repoRoot - repository path.
     * @returns parsed worktree entries.
     */
    async list(repoRoot: string): Promise<GitWorktree[]> {
      const out = await git.must(['worktree', 'list', '--porcelain'], repoRoot)
      return parsePorcelain(out)
    },

    /**
     * Find a worktree by matching its directory name against a work id.
     * @param repoRoot - repository path.
     * @param workId - boulder work id.
     * @returns the matching entry, or undefined.
     */
    async find(repoRoot: string, workId: string): Promise<GitWorktree | undefined> {
      const entries = await this.list(repoRoot)
      const dirName = worktreeDirName(workId)
      return entries.find(e => {
        const seg = e.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
        return seg === dirName || seg.startsWith(`${dirName}-`) || seg.startsWith(`${dirName}_`)
      })
    },

    /**
     * Clean up a worktree: `git worktree remove` + `git worktree prune`, then
     * clear the boulder work's worktree_path.
     * @param repoRoot - repository path.
     * @param workId - work id.
     * @param path - the worktree path (from boulder linkage).
     * @returns true when removed.
     */
    async cleanup(repoRoot: string, workId: string, path: string): Promise<boolean> {
      await git.must(['worktree', 'remove', path], repoRoot)
      await git.must(['worktree', 'prune'], repoRoot)
      setWorktreePath(storeDir, workId, null)
      return true
    },

    /**
     * Reuse an existing worktree for a work: return the registered path if the
     * directory still exists; otherwise return a rebuild instruction (never
     * silently recreate — architecture §5.6 reuse).
     * @param workId - work id.
     * @param exists - an fs-exists predicate (injectable for tests).
     * @returns `{ path }` when usable, or `{ rebuild: <instruction> }`.
     */
    reuse(workId: string, exists: (p: string) => boolean): { path: string } | { rebuild: string } {
      const registered = getWorktreePath(storeDir, workId)
      if (registered && exists(registered)) return { path: registered }
      const dirName = worktreeDirName(workId)
      return { rebuild: `git worktree add --detach <${dirName}> then re-register it` }
    },
  }
}

/**
 * Parse `git worktree list --porcelain` output.
 * @param out - porcelain text.
 * @returns parsed entries.
 */
export function parsePorcelain(out: string): GitWorktree[] {
  const entries: GitWorktree[] = []
  let current: Partial<GitWorktree> | null = null
  for (const line of out.split(/\r?\n/)) {
    if (line.trim() === '') {
      if (current) { entries.push(current as GitWorktree); current = null }
      continue
    }
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), detached: true }
    } else if (line.startsWith('HEAD ')) {
      if (current) current.head = line.slice('HEAD '.length).trim()
    } else if (line.startsWith('branch ')) {
      if (current) {
        current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
        current.detached = false
      }
    }
  }
  if (current) entries.push(current as GitWorktree)
  return entries
}
