/**
 * start-work continuation hook (architecture §5.2-C): on session start, if the
 * repo has an active boulder work item, inject its context (plan, goal, status,
 * worktree path) so a resumed session picks up cleanly. Seeding via
 * `agent.inject` (no wake) is correct here: the driver is about to start a turn.
 *
 * @module dsh-enhance/hooks/start-work
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readBoulder } from '../features/boulder/store.js'
import { claimWriteToken, readWriteToken } from '../features/boulder/write-token.js'

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

    // §5.5.1: an execute session must hold the write token unless its work has an
    // independent worktree. Claim here so a resumed session can keep working; the
    // tool guard rejects writes when the token is live elsewhere.
    const session = String(agent.session.header.id ?? 'session')
    let tokenLine = ''
    if (work.worktree_path) {
      tokenLine = 'worktree：' + work.worktree_path + '（独立 worktree，走并行通道，不需要写令牌）'
    } else {
      const holder = readWriteToken(state)
      if (holder === session) {
        tokenLine = '写令牌：本会话持有（独占执行权）'
      } else if (!holder && claimWriteToken(cwd, session)) {
        tokenLine = '写令牌：本会话已取得（独占执行权）'
      } else {
        tokenLine = `写令牌：由会话 ${holder ?? '其他会话'} 持有——本会话的 write/edit 会被写令牌门卫拒绝，请等其释放或先建 worktree`
      }
    }

    const lines = [
      '## 续作上下文（start-work）',
      `正在继续的工作：${work.id}`,
      work.plan_name ? `计划：${work.plan_name}` : '',
      `状态：${work.status}`,
      tokenLine,
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
