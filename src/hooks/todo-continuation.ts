/**
 * todo-continuation enforcer (architecture §5.2-C): at turn-stop, if the
 * session goal still has open todo items and the work is not blocked, steer
 * the next step to continue. A progression guard prevents a death loop: we only
 * steer again when the recorded todo count has actually decreased since the
 * last steer (no progress ⇒ stay silent, so an infinite won\u2019t spin).
 *
 * @module oh-my-dsh/hooks/todo-continuation
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { readGoal } from '../features/boulder/goal.js'
import { readBoulder } from '../features/boulder/store.js'

/** Per-session last-seen todo count, to drive the progression guard. */
const lastSeenTodos = new Map<string, number>()

/** Per-session timestamp of the last steer, for the steering cooldown. */
const lastSteerAt = new Map<string, number>()

/** Minimum milliseconds between steers for the same session. */
export const MIN_STEER_GAP_MS = 2000

/**
 * Pure decision for whether to steer a continuation reminder. Exported for
 * unit testing the progression guard (architecture §8: pure logic first).
 * @param todos - current open todo count.
 * @param workStatus - the active work's status.
 * @param prior - last-seen todo count for the session (undefined = no prior).
 * @param now - current timestamp.
 * @param lastSteer - timestamp of the last steer (0 = none).
 * @returns true when a continuation reminder should be steered now.
 */
export function decideContinue(
  todos: number,
  workStatus: string | undefined,
  prior: number | undefined,
  now: number,
  lastSteer: number,
): boolean {
  if (todos <= 0) return false
  if (workStatus === 'blocked') return false
  const madeProgress = prior === undefined || todos < prior
  if (!madeProgress) return false
  if (lastSteer > 0 && now - lastSteer < MIN_STEER_GAP_MS) return false
  return true
}

/**
 * Register the todo-continuation listener.
 * @param ctx - context.
 * @param enabled - master switch (workTracking).
 * @returns disposer.
 */
export function registerTodoContinuationHook(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  return ctx.on('agent/turn-stopping', ({ agent }) => {
    tryContinue(agent)
  })
}

/** Decide whether to steer a continuation reminder at this turn boundary. */
function tryContinue(agent: Agent): void {
  const cwd = agent.session.header.cwd
  const session = String(agent.session.header.id ?? 'session')
  if (!cwd) return
  const key = `${cwd}::${session}`

  const { state } = readBoulder(cwd)
  const work = state.active_work_id ? state.works[state.active_work_id] : undefined

  const goal = readGoal(join(cwd, '.omd', 'goals'), session)
  const todos = goal?.remaining_todos ?? 0

  const prior = lastSeenTodos.get(key)
  const now = Date.now()
  const lastSteer = lastSteerAt.get(key) ?? 0

  if (decideContinue(todos, work?.status, prior, now, lastSteer)) {
    lastSeenTodos.set(key, todos)
    lastSteerAt.set(key, now)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: `继续：该 work 仍有 ${todos} 个待办未清。若非阻塞状态，请继续完成；若确实受阻，请将 work 标记为 blocked 或说明原因。` }],
      source: { kind: 'user' },
    }))
    return
  }

  // No steer: record current count as the progression baseline, stay silent.
  lastSeenTodos.set(key, todos)
}

