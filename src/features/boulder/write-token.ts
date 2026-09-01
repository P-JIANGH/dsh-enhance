/**
 * Write-token (exec_holder) management for exclusive workspace execution
 * (architecture §5.5.1). A token is claimed/released through the boulder CAS
 * single entry — no concurrent execute session may hold it twice.
 *
 * @module dsh-enhance/features/boulder/write-token
 */

import type { BoulderState } from './store.js'
import { mutateBoulderState } from './store.js'

/**
 * Try to claim the write token for a session via CAS.
 * @param storeDir - boulder store directory.
 * @param sessionId - the session claiming the token.
 * @returns true on acquisition, false when the token is already held.
 */
export function claimWriteToken(storeDir: string, sessionId: string): boolean {
  let ok = false
  mutateBoulderState(storeDir, (state: BoulderState) => {
    if (state.exec_holder && state.exec_holder !== sessionId) {
      return // taken by another session; leave unchanged
    }
    state.exec_holder = sessionId
    ok = ok || state.exec_holder === sessionId
  })
  return ok
}

/**
 * Release the write token if it is currently held by `sessionId`.
 * @param storeDir - boulder store directory.
 * @param sessionId - the session releasing.
 * @returns true when the token was released.
 */
export function releaseWriteToken(storeDir: string, sessionId: string): boolean {
  let released = false
  mutateBoulderState(storeDir, (state: BoulderState) => {
    if (state.exec_holder === sessionId) {
      delete state.exec_holder
      released = true
    }
  })
  return released
}

/**
 * Steal a stale write token (holder no longer live). The caller decides
 * staleness (e.g. via acquired-lock absence or a watchdog); this performs the
 * token's reassignment.
 * @param storeDir - boulder store directory.
 * @param newHolder - session id taking over.
 * @returns true when the token was moved.
 */
export function stealWriteToken(storeDir: string, newHolder: string): boolean {
  let ok = false
  mutateBoulderState(storeDir, (state: BoulderState) => {
    state.exec_holder = newHolder
    ok = true
  })
  return ok
}

/** Read the current holder (pure, no mutation). */
export function readWriteToken(state: BoulderState): string | undefined {
  return state.exec_holder
}
