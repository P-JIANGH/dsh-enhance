/**
 * start-work continuation hook (architecture §5.2-C): on session start, if the
 * repo has an active boulder work item, inject its context (plan, goal, status,
 * worktree path) so a resumed session picks up cleanly. Seeding via
 * `agent.inject` (no wake) is correct here: the driver is about to start a turn.
 *
 * @module oh-my-dsh/hooks/start-work
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readBoulder } from '../features/boulder/store.js'

/**
 * Register the start-work listener.
 * @param ctx - context.
 * @param enabled - master switch (workTracking).
 * @returns disposer.
 */
export function registerStartWorkHook(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  return ctx.on('agent/session-start', ({ agent }) => {
    void startWorkFor(agent)
  })
}

/** Inject continuation context when an active boulder work exists. */
async function startWorkFor(agent: Agent): Promise<void> {
  try {
    const cwd = agent.session.header.cwd
    if (!cwd) return
    const { state } = readBoulder(cwd)
    if (!state.active_work_id) return
    const work = state.works[state.active_work_id]
    if (!work) return

    const lines = [
      '## 续作上下文（start-work）',
      `正在继续的工作：${work.id}`,
      work.plan_name ? `计划：${work.plan_name}` : '',
      `状态：${work.status}`,
      work.worktree_path ? `worktree：${work.worktree_path}` : '',
      `关注的会话：${(work.session_ids ?? []).length} 个`,
    ].filter(Boolean)

    agent.inject(createUserMessage({
      content: [{ type: 'text', text: lines.join('\n') }],
      source: { kind: 'user' },
    }))
  } catch {
    // A read failure must not block session start.
  }
}
