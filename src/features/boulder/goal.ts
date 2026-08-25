/**
 * Goal storage: session-scoped acceptance contracts (architecture §5.5).
 * Each session owns `goal_<sessionID>.json` under a base dir; goals are a
 * session's objective/status/tokens and reference boulder works via goal_id.
 *
 * @module oh-my-dsh/features/boulder/goal
 */

import { join } from 'node:path'
import { atomicWriteFile, readJsonOrNull } from '../../shared/atomic-write.js'
import { isNonEmptyString, isNonNegInt, isPlainObject } from '../../shared/validate.js'

/** Goal lifecycle status. */
export type GoalStatus = 'open' | 'in_progress' | 'done' | 'abandoned'

/** A session goal (acceptance contract). */
export interface Goal {
  id: string
  objective: string
  status: GoalStatus
  /** Acceptance criteria the work must satisfy. */
  acceptance?: string[]
  /** How many todo items remain (0 ⇒ clear, drives delivery-gate disambiguation). */
  remaining_todos?: number
  work_id?: string
  created_at: number
  updated_at: number
}

/** Base name prefix on disk. */
export const GOAL_PREFIX = 'goal_'

/** Validate a goal; returns reason when invalid, undefined when ok. */
export function validateGoal(g: unknown): string | undefined {
  if (!isPlainObject(g)) return 'goal is not an object'
  if (!isNonEmptyString(g.objective)) return 'goal.objective must be a non-empty string'
  if (g.status !== undefined && !['open', 'in_progress', 'done', 'abandoned'].includes(String(g.status))) {
    return `invalid goal.status: ${String(g.status)}`
  }
  if (g.created_at !== undefined && !isNonNegInt(g.created_at)) return 'goal.created_at must be non-negative int'
  if (g.updated_at !== undefined && !isNonNegInt(g.updated_at)) return 'goal.updated_at must be non-negative int'
  if (g.remaining_todos !== undefined && !isNonNegInt(g.remaining_todos)) return 'goal.remaining_todos must be non-negative int'
  if (g.acceptance !== undefined && !Array.isArray(g.acceptance)) return 'goal.acceptance must be an array'
  return undefined
}

/** Resolve the on-disk goal file for a session. */
export function goalFile(baseDir: string, sessionId: string): string {
  return join(baseDir, `${GOAL_PREFIX}${sessionId}.json`)
}

/**
 * Read a session's goal (missing/malformed → null).
 * @param baseDir - goals base directory.
 * @param sessionId - session id.
 */
export function readGoal(baseDir: string, sessionId: string): Goal | null {
  const raw = readJsonOrNull<unknown>(goalFile(baseDir, sessionId))
  return raw && validateGoal(raw) === undefined ? raw as Goal : null
}

/**
 * Write a goal atomically, keyed by an explicit session id.
 * @param baseDir - goals base directory.
 * @param sessionId - the owning session id (names the file).
 * @param goal - goal to persist.
 */
export function writeSessionGoal(baseDir: string, sessionId: string, goal: Goal): void {
  atomicWriteFile(goalFile(baseDir, sessionId), JSON.stringify(goal, null, 2) + '\n')
}

/**
 * Create or update a session goal with an updated_at stamp.
 * @param baseDir - goals base directory.
 * @param sessionId - owning session id.
 * @param goal - goal body.
 * @returns the persisted goal.
 */
export function upsertGoal(baseDir: string, sessionId: string, goal: Goal): Goal {
  const now = Date.now()
  const persisted: Goal = { ...goal, id: goal.id ?? sessionId, updated_at: now, created_at: goal.created_at ?? now }
  if (validateGoal(persisted) !== undefined) throw new Error('goal is invalid')
  writeSessionGoal(baseDir, sessionId, persisted)
  return persisted
}
