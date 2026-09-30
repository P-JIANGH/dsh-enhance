/**
 * Boulder work-plan storage with conflict-safe writes (architecture §5.5).
 *
 * A single repo-wide store lives at `<repo root>/.dsh-enhance/boulder.json`
 * (architecture §5.5 "存储位置"). Keeping it inside `.dsh-enhance/` matters: that
 * directory is what `.gitignore` covers, so the store never shows up as an
 * untracked file in the user's repository — the same reason goals already live
 * under `.dsh-enhance/goals/`.
 *
 * All mutation flows through {@link mutateBoulderState}: read latest → deep copy →
 * apply → validate → CAS(revision) → atomic write, retrying on revision conflict
 * (≤3). Merges are at work granularity: session sets are unioned, scalars are
 * writer-wins, and the root active_work_id is the last successful writer.
 *
 * @module dsh-enhance/features/boulder/store
 */

import { join } from 'node:path'
import { atomicWriteFile, readJsonOrNull } from '../../shared/atomic-write.js'
import { isNonEmptyString, isNonNegInt, isPlainObject, isOneOf } from '../../shared/validate.js'

/** Work status values. */
export type WorkStatus = 'planned' | 'active' | 'blocked' | 'completed'

/** One tracked work item. */
export interface BoulderWork {
  id: string
  plan_name?: string
  status: WorkStatus
  worktree_path?: string | null
  goal_id?: string
  /**
   * Executable verification bound to this work (architecture §5.2.2-1): a script
   * path run by the delivery gate; exit code 0 means the deliverable meets its
   * criteria. Absent ⇒ the gate records `unmeasured` instead of claiming a pass.
   */
  verify?: string
  updated_at: number
  session_ids: string[]
  task_sessions?: string[]
  session_origins?: Record<string, string>
}

/** One structured delivery report appended to `completion_log` (§5.2.2-4). */
export interface CompletionEntry {
  work_id: string
  at: number
  /** `passed` | `failed` | `unmeasured` | `tampered`. */
  state: string
  /** Gate phase the report was produced in. */
  phase?: string
  /** The claim text that was judged. */
  claim?: string
}

/** The whole boulder document. */
export interface BoulderState {
  revision: number
  active_work_id?: string
  /** Write token: the session id currently holding exclusive execute right. */
  exec_holder?: string
  /** When the current holder claimed the token (drives stale-holder takeover). */
  exec_holder_at?: number
  /**
   * OS pid of the claiming process. A token whose pid is gone is treated as stale
   * immediately — otherwise an abruptly killed session would keep the repo's
   * execute right for the whole staleness window (observed in real drives:
   * `agent/disposed` does not fire on an abrupt headless exit).
   */
  exec_holder_pid?: number
  works: Record<string, BoulderWork>
  conflict_log?: Array<{ at: number; field: string; kept: unknown }>
  /** Structured delivery reports (trajectory audit, architecture §5.2.2.4). */
  completion_log?: CompletionEntry[]
}

/** Maximum CAS retries before a mutation gives up. */
export const MAX_CAS_RETRIES = 3

/** Repo-relative directory holding all dsh-enhance state (gitignored by convention). */
export const STATE_DIR = '.dsh-enhance'

/** The on-disk filename under {@link STATE_DIR}. */
export const BOULDER_FILE = 'boulder.json'

/** Absolute path of the boulder store for a repository root. */
export function boulderFileFor(repoRoot: string): string {
  return join(repoRoot, STATE_DIR, BOULDER_FILE)
}

/** Initial empty state. */
export function emptyState(): BoulderState {
  return { revision: 0, works: {} }
}

/** Validate one work record; returns reason on invalid, undefined when ok. */
export function validateWork(w: unknown): string | undefined {
  if (!isPlainObject(w)) return 'work is not an object'
  if (!isNonEmptyString(w.id)) return 'work.id must be a non-empty string'
  if (!isOneOf(w.status, ['planned', 'active', 'blocked', 'completed'])) return `invalid work.status: ${String(w.status)}`
  if (w.updated_at !== undefined && !isNonNegInt(w.updated_at)) return 'work.updated_at must be non-negative int'
  if (w.session_ids !== undefined && !Array.isArray(w.session_ids)) return 'work.session_ids must be an array'
  if (w.worktree_path !== undefined && w.worktree_path !== null && !isNonEmptyString(w.worktree_path)) return 'work.worktree_path must be a string or null'
  if (w.goal_id !== undefined && !isNonEmptyString(w.goal_id)) return 'work.goal_id must be a non-empty string'
  if (w.verify !== undefined && !isNonEmptyString(w.verify)) return 'work.verify must be a non-empty string'
  return undefined
}

/** Validate a complete boulder document. */
export function validateState(s: unknown): string | undefined {
  if (!isPlainObject(s)) return 'state is not an object'
  if (!isNonNegInt(s.revision)) return 'state.revision must be a non-negative int'
  if (s.active_work_id !== undefined && !isNonEmptyString(s.active_work_id)) return 'state.active_work_id must be a non-empty string'
  if (s.exec_holder !== undefined && !isNonEmptyString(s.exec_holder)) return 'state.exec_holder must be a non-empty string'
  if (s.exec_holder_at !== undefined && !isNonNegInt(s.exec_holder_at)) return 'state.exec_holder_at must be a non-negative int'
  if (s.exec_holder_pid !== undefined && !isNonNegInt(s.exec_holder_pid)) return 'state.exec_holder_pid must be a non-negative int'
  if (!isPlainObject(s.works)) return 'state.works must be an object'
  for (const [k, v] of Object.entries(s.works as Record<string, unknown>)) {
    const err = validateWork(v)
    if (err) return `work ${k}: ${err}`
  }
  if (s.conflict_log !== undefined && !Array.isArray(s.conflict_log)) return 'state.conflict_log must be an array'
  if (s.completion_log !== undefined && !Array.isArray(s.completion_log)) return 'state.completion_log must be an array'
  return undefined
}

/** True when a boulder document is structurally valid. */
export function isValidState(s: unknown): s is BoulderState {
  return validateState(s) === undefined
}

/**
 * Read the current boulder state from disk (missing/malformed → empty, never throws).
 * @param repoRoot - repository root; the file is `<repoRoot>/.dsh-enhance/boulder.json`.
 * @returns current state plus the store file path.
 */
export function readBoulder(repoRoot: string): { state: BoulderState; file: string } {
  const file = boulderFileFor(repoRoot)
  const raw = readJsonOrNull<unknown>(file)
  const state = raw && isValidState(raw) ? raw : emptyState()
  return { state, file }
}

/** Deep clone via structured clone (JSON-safe state). */
export function cloneState<T>(s: T): T {
  return JSON.parse(JSON.stringify(s)) as T
}

/** Step revision up safely. */
export function bumpRevision(s: BoulderState): void {
  s.revision = (s.revision ?? 0) + 1
}

/**
 * Mutate boulder state with a single CAS entry point. Reads latest, deep-copies,
 * applies `mutateFn`, validates, then writes back atomically under a matching
 * revision; on conflict it re-reads and retries (≤ {@link MAX_CAS_RETRIES}).
 *
 * @param repoRoot - repository root; the file is `<repoRoot>/.dsh-enhance/boulder.json`.
 * @param mutateFn - applied to a deep-copied state; must mutate in place.
 * @returns true when the mutation committed, false when it exhausted retries.
 */
export function mutateBoulderState(storeDir: string, mutateFn: (state: BoulderState) => void | Promise<void>): boolean {
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const { state, file } = readBoulder(storeDir)
    const baseRevision = state.revision
    const next = cloneState(state)
    mutateFn(next)
    bumpRevision(next)
    const err = validateState(next)
    if (err) {
      // A mutation produced an invalid document: surface loudly instead of committing.
      throw new Error(`boulder mutation produced invalid state: ${err}`)
    }
    // Write-then-verify: reread? For CAS we re-read before writing and only
    // commit when the on-disk revision still matches the base we read.
    const current = readBoulder(storeDir).state
    if (current.revision !== baseRevision) continue // conflict → retry
    atomicWriteFile(file, JSON.stringify(next, null, 2) + '\n')
    return true
  }
  return false
}

/**
 * Upsert a work record (writer-wins, session union). Sets `updated_at`.
 * @param state - mutable state (already cloned by caller).
 * @param work - work fields.
 */
export function upsertWork(state: BoulderState, work: BoulderWork): void {
  const existing = state.works[work.id]
  const sessionUnion = existing
    ? Array.from(new Set([...(existing.session_ids ?? []), ...(work.session_ids ?? [])]))
    : [...(work.session_ids ?? [])]
  state.works[work.id] = {
    ...existing,
    ...work,
    session_ids: sessionUnion,
    updated_at: work.updated_at ?? Date.now(),
  }
}

/**
 * Merge two state documents at work granularity (architecture §5.5.4). Used by
 * tests for the cross-session CAS scenario: returns the merged document.
 * @param a - writer A's latest known state.
 * @param b - writer B's latest known state.
 * @returns merged state; independent writes are preserved union-wise.
 */
export function mergeStates(a: BoulderState, b: BoulderState): BoulderState {
  const merged: BoulderState = { revision: Math.max(a.revision, b.revision), works: {} }
  // Works union: for each id pick the later-updated, else union sessions.
  const ids = new Set([...Object.keys(a.works), ...Object.keys(b.works)])
  for (const id of ids) {
    const wa = a.works[id]
    const wb = b.works[id]
    if (!wa) { merged.works[id] = cloneState(wb!) ; continue }
    if (!wb) { merged.works[id] = cloneState(wa) ; continue }
    const later = (wa.updated_at ?? 0) >= (wb.updated_at ?? 0) ? wa : wb
    const other = later === wa ? wb : wa
    merged.works[id] = {
      ...cloneState(other),
      ...cloneState(later),
      session_ids: Array.from(new Set([...(wa.session_ids ?? []), ...(wb.session_ids ?? [])])),
    }
  }
  // active_work_id: last successful writer wins when they differ.
  merged.active_work_id = a.active_work_id ?? b.active_work_id
  // exec_holder (write token): keep the newest non-empty holder.
  merged.exec_holder = b.exec_holder ?? a.exec_holder
  const tokenFromB = merged.exec_holder === b.exec_holder
  merged.exec_holder_at = tokenFromB ? b.exec_holder_at : a.exec_holder_at
  merged.exec_holder_pid = tokenFromB ? b.exec_holder_pid : a.exec_holder_pid
  merged.conflict_log = [...(a.conflict_log ?? []), ...(b.conflict_log ?? [])]
  merged.completion_log = [...(a.completion_log ?? []), ...(b.completion_log ?? [])]
  if (a.active_work_id !== undefined && b.active_work_id !== undefined && a.active_work_id !== b.active_work_id) {
    merged.conflict_log!.push({ at: Date.now(), field: 'active_work_id', kept: merged.active_work_id })
  }
  return merged
}
