/**
 * Write-token (exec_holder) management for exclusive workspace execution
 * (architecture §5.5.1). A token is claimed/released through the boulder CAS
 * single entry — no concurrent execute session may hold it twice.
 *
 * A holder is stale when **either** of these holds:
 * - the recorded OS pid is no longer alive (the normal case for a killed or
 *   abruptly exited dsh process — real drives showed `agent/disposed` does not
 *   fire on abrupt headless exit, so a token would otherwise leak); or
 * - the claim is older than `staleMs` (covers pid reuse and cross-machine state).
 *
 * The same staleness idea backs the file lock in `shared/atomic-write`.
 *
 * @module dsh-enhance/features/boulder/write-token
 */

import type { BoulderState } from './store.js'
import { mutateBoulderState, readBoulder } from './store.js'

/** Default age (ms) after which another session may take over the token. */
export const DEFAULT_TOKEN_STALE_MS = 30 * 60_000

/** True when `pid` looks like a live process (`EPERM` means it exists). */
export function isPidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: string })?.code === 'EPERM'
  }
}

/** Whether the recorded holder should be considered gone. */
export function isHolderStale(
  state: Pick<BoulderState, 'exec_holder_at' | 'exec_holder_pid'>,
  now: number,
  staleMs: number,
): boolean {
  if (state.exec_holder_pid !== undefined && !isPidAlive(state.exec_holder_pid)) return true
  const stampedAt = state.exec_holder_at ?? 0
  return now - stampedAt > staleMs
}

/** Why a claim attempt failed (for actionable rejections). */
export interface ClaimResult {
  ok: boolean
  /** The session currently holding the token when `ok` is false. */
  holder?: string
  /** True when the claim succeeded by taking over a stale holder. */
  tookOver?: boolean
}

/**
 * Try to claim the write token for a session via CAS.
 *
 * Reads first so the common "held by a live session" case does not churn the
 * revision; the in-mutation check still guards the race.
 *
 * @param storeDir - boulder store directory.
 * @param sessionId - the session claiming the token.
 * @param options - `staleMs` / `now` / `pid` overrides (tests).
 * @returns the claim outcome.
 */
export function claimWriteTokenDetailed(
  storeDir: string,
  sessionId: string,
  options: { staleMs?: number; now?: number; pid?: number } = {},
): ClaimResult {
  const staleMs = options.staleMs ?? DEFAULT_TOKEN_STALE_MS
  const now = options.now ?? Date.now()
  const pid = options.pid ?? process.pid

  const { state: current } = readBoulder(storeDir)
  const held = current.exec_holder
  if (held && held !== sessionId && !isHolderStale(current, now, staleMs)) {
    return { ok: false, holder: held }
  }
  const wasStale = Boolean(held && held !== sessionId)

  let ok = false
  let holder: string | undefined
  let tookOver = false
  mutateBoulderState(storeDir, (state: BoulderState) => {
    const existing = state.exec_holder
    if (existing && existing !== sessionId && !isHolderStale(state, now, staleMs)) {
      holder = existing
      return // still live: leave untouched
    }
    if (existing && existing !== sessionId) tookOver = true
    state.exec_holder = sessionId
    state.exec_holder_at = now
    state.exec_holder_pid = pid
    ok = true
  })
  return ok ? { ok: true, tookOver: tookOver || wasStale } : { ok: false, holder }
}

/**
 * Try to claim the write token for a session via CAS.
 * @param storeDir - boulder store directory.
 * @param sessionId - the session claiming the token.
 * @returns true on acquisition, false when the token is live and held elsewhere.
 */
export function claimWriteToken(storeDir: string, sessionId: string): boolean {
  return claimWriteTokenDetailed(storeDir, sessionId).ok
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
      delete state.exec_holder_at
      delete state.exec_holder_pid
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
    state.exec_holder_at = Date.now()
    state.exec_holder_pid = process.pid
    ok = true
  })
  return ok
}

/** Read the current holder (pure, no mutation). */
export function readWriteToken(state: BoulderState): string | undefined {
  return state.exec_holder
}
