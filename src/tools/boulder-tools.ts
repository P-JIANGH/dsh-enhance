/**
 * Model-facing boulder + goal tools (architecture §5.3/§5.5). Reads/writes are
 * thin wrappers over the shared store so the CAS/atomic guarantees hold. Only
 * registered when workTracking is enabled.
 *
 * @module oh-my-dsh/tools/boulder-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { readBoulder, mutateBoulderState, upsertWork, type BoulderState } from '../features/boulder/store.js'
import { claimWriteToken, releaseWriteToken, readWriteToken } from '../features/boulder/write-token.js'
import { readGoal, upsertGoal } from '../features/boulder/goal.js'

/**
 * Resolve the session's boulder store root. Prefers `agent.session.header.cwd`
 * (the session's repo root) so boulder.json is written per-project; falls back
 * to process cwd when no session context is present.
 */
export function repoBaseOf(exec: ToolExecution): string {
  return exec.agent?.session?.header?.cwd ?? process.cwd()
}

/** Session id for goal scoping (the session header id, or a key fallback). */
function sessionKey(exec: ToolExecution): string {
  return String(exec.agent?.session?.header?.id ?? 'session')
}

/** Goal base dir is per-repo `.omd/goals`. */
function goalsDir(base: string): string {
  return join(base, '.omd', 'goals')
}

/**
 * Register the boulder + goal tools.
 * @param ctx - context with the `tools` registry.
 * @param enabled - whether to register (guards the workTracking switch).
 * @returns the exact disposer.
 */
export function registerBoulderTools(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  const d: Array<() => void> = []

  d.push(ctx.tools.register(defineTool({
    name: 'boulder_start',
    description: 'Start or update a tracked work item in the boulder. Records the plan name, status, a new or existing session, and an optional goal id.',
    parameters: {
      work_id: { type: 'string', required: true },
      plan_name: { type: 'string' },
      goal_id: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(args, exec) {
      const base = repoBaseOf(exec)
      const session = sessionKey(exec)
      mutateBoulderState(base, (s: BoulderState) => {
        upsertWork(s, {
          id: String(args.work_id),
          plan_name: args.plan_name,
          status: 'active',
          goal_id: args.goal_id,
          updated_at: Date.now(),
          session_ids: [session],
        })
        s.active_work_id = String(args.work_id)
      })
      const { state } = readBoulder(base)
      return { ok: true, active_work: state.works[String(args.work_id)] }
    },
  })))

  d.push(ctx.tools.register(defineTool({
    name: 'boulder_status',
    description: 'Report the current boulder: the write-token holder (exec shape) and the active work items.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(_args, exec) {
      const base = repoBaseOf(exec)
      const { state } = readBoulder(base)
      return {
        exec_holder: readWriteToken(state),
        active_work_id: state.active_work_id,
        works: Object.values(state.works).map(w => ({ id: w.id, status: w.status, updated_at: w.updated_at })),
      }
    },
  })))

  d.push(ctx.tools.register(defineTool({
    name: 'boulder_complete',
    description: 'Mark a work item completed and release this session\u2019s write token.',
    parameters: { work_id: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(args, exec) {
      const base = repoBaseOf(exec)
      const session = sessionKey(exec)
      mutateBoulderState(base, (s: BoulderState) => {
        upsertWork(s, { id: String(args.work_id), status: 'completed', updated_at: Date.now(), session_ids: [session] })
      })
      releaseWriteToken(base, session)
      return { ok: true }
    },
  })))

  d.push(ctx.tools.register(defineTool({
    name: 'goal_create',
    description: 'Create the session goal (acceptance contract). Sets status open and optional acceptance criteria.',
    parameters: {
      objective: { type: 'string', required: true },
      acceptance: { type: 'array', items: { type: 'string' } },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(args, exec) {
      const base = repoBaseOf(exec)
      const session = sessionKey(exec)
      const goal = upsertGoal(goalsDir(base), session, {
        id: session,
        objective: String(args.objective),
        status: 'open',
        acceptance: Array.isArray(args.acceptance) ? args.acceptance.map(String) : undefined,
        remaining_todos: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      return { ok: true, goal }
    },
  })))

  d.push(ctx.tools.register(defineTool({
    name: 'goal_get',
    description: 'Read this session\u2019s goal.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(_args, exec) {
      const base = repoBaseOf(exec)
      const session = sessionKey(exec)
      return { goal: readGoal(goalsDir(base), session) }
    },
  })))

  d.push(ctx.tools.register(defineTool({
    name: 'goal_update',
    description: 'Update the session goal\u2019s status and/or remaining todo count.',
    parameters: {
      status: { type: 'string', enum: ['open', 'in_progress', 'done', 'abandoned'] },
      remaining_todos: { type: 'number' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(args, exec) {
      const base = repoBaseOf(exec)
      const session = sessionKey(exec)
      const current = readGoal(goalsDir(base), session)
      if (!current) return { ok: false, error: 'no goal yet; create one first' }
      const updated = upsertGoal(goalsDir(base), session, {
        ...current,
        status: (args.status as typeof current.status) ?? current.status,
        remaining_todos: args.remaining_todos ?? current.remaining_todos,
        updated_at: Date.now(),
      })
      return { ok: true, goal: updated }
    },
  })))

  return () => { for (const fn of d) fn() }
}
