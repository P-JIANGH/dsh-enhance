/**
 * delivery-gate turn-stopping hook (architecture §5.2.1): when the agent claims
 * completion, evaluate whether the session goal is actually clear (remaining
 * todos == 0); a valid delivery is recorded into boulder.completion_log as a
 * structured report (trajectory audit), and the session's write token released.
 *
 * This hook is thin: the decision functions live in the tested delivery-gate
 * module; here we wire them to the dsh event + boulder storage.
 *
 * @module oh-my-dsh/hooks/delivery-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { join } from 'node:path'
import { readBoulder, mutateBoulderState } from '../features/boulder/store.js'
import { readGoal } from '../features/boulder/goal.js'
import { releaseWriteToken } from '../features/boulder/write-token.js'

/**
 * Register the delivery-gate listener.
 * @param ctx - context.
 * @param enabled - master switch (delivery gate is gated by workTracking here,
 *   since it reads goal + boulder).
 * @returns disposer.
 */
export function registerDeliveryGateHook(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  return ctx.on('agent/turn-stopping', ({ agent }) => {
    recordIfDelivered(agent)
  })
}

/** If the agent's final text claims completion and the goal is clear, record it. */
function recordIfDelivered(agent: Agent): void {
  try {
    const cwd = agent.session.header.cwd
    const session = String(agent.session.header.id ?? 'session')
    if (!cwd) return

    const { state } = readBoulder(cwd)
    const work = state.active_work_id ? state.works[state.active_work_id] : undefined
    if (!work) return

    const goal = readGoal(join(cwd, '.omd', 'goals'), session)
    const remaining = goal?.remaining_todos ?? 0
    // Claim detection: use the latest assistant message text as the signal.
    // (Model-facing text is not directly available in this serial hook; treat
    // a goal being fully clear as the operative completion condition here.)
    const claimed = remaining === 0 && goal?.status === 'done'
    if (!claimed) return

    mutateBoulderState(cwd, (s) => {
      s.completion_log = [...(s.completion_log ?? []), { work_id: work.id, at: Date.now(), state: 'passed' }]
      if (s.active_work_id === work.id) delete s.active_work_id
    })
    releaseWriteToken(cwd, session)
  } catch {
    // Never break turn stopping.
  }
}
