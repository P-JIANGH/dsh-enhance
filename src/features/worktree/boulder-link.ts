/**
 * boulder↔worktree linkage (architecture §5.6 `boulder-link.ts`): registers /
 * clears `work.worktree_path` on the boulder work, and coordinates with the
 * write token. Setting a worktree path marks the work as a parallel-channel
 * candidate (no write token needed per §5.5.1); clearing it returns the work to
 * the serial (token) path when appropriate.
 *
 * @module dsh-enhance/features/worktree/boulder-link
 */

import { readBoulder, mutateBoulderState } from '../boulder/store.js'

/**
 * Register a worktree path on a work.
 * @param storeDir - boulder store directory.
 * @param workId - work to update.
 * @param worktreePath - absolute worktree path (or null to clear).
 * @returns true when the boulder state was updated.
 */
export function setWorktreePath(storeDir: string, workId: string, worktreePath: string | null): boolean {
  let ok = false
  mutateBoulderState(storeDir, (s) => {
    let w = s.works[workId]
    if (!w) {
      w = { id: workId, status: 'active', updated_at: Date.now(), session_ids: [] }
      s.works[workId] = w
    }
    w.worktree_path = worktreePath
    w.updated_at = Date.now()
    ok = true
  })
  return ok
}

/**
 * Read the registered worktree path for a work.
 * @param storeDir - boulder store directory.
 * @param workId - work id.
 * @returns the worktree path, or null when unset.
 */
export function getWorktreePath(storeDir: string, workId: string): string | null {
  const { state } = readBoulder(storeDir)
  const w = state.works[workId]
  return w?.worktree_path ?? null
}

/**
 * Whether a work currently has a registered worktree (parallel channel per
 * §5.5.1 — no write token required when an independent worktree is present).
 * @param storeDir - boulder store directory.
 * @param workId - work id.
 */
export function hasWorktree(storeDir: string, workId: string): boolean {
  const p = getWorktreePath(storeDir, workId)
  return Boolean(p && p.length > 0)
}
