/**
 * start-work continuation hook (architecture §5.2-C): when a top-level agent is
 * created, if the repo has an active boulder work item, inject its context (plan,
 * goal, status, worktree path) so a resumed session picks up cleanly. Seeding via
 * `agent.inject` (no wake) is correct here: the driver is about to start a turn.
 *
 * Bound to `agent/created` — the 0.2.0 catalogue has no `agent/session-start`, so
 * the previous binding never fired. The event carries two contracts: it is awaited
 * *before agent creation resolves* (so this runs synchronously and never throws —
 * "a throw or rejection fails creation and skips later listeners"), and it also
 * fires for delegated children, which are skipped: the write-token claim below
 * belongs to the session a human is driving, never to a subagent.
 *
 * @module dsh-enhance/hooks/start-work
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readBoulder } from '../features/boulder/store.js'
import { claimWriteToken, readWriteToken } from '../features/boulder/write-token.js'
import { hasInjectedText } from '../shared/messages.js'
import { CONTEXT_SOURCE_KIND } from '../shared/provenance.js'
import { isDelegatedSession } from '../shared/session-scope.js'

/**
 * Register the start-work listener.
 * @param ctx - context.
 * @param enabled - master switch (workTracking).
 * @returns disposer.
 */
export function registerStartWorkHook(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  // The declared return type is the event's contract: `undefined |
  // Promise<undefined>`, never `void` — creation waits on this dispatch.
  return ctx.on('agent/created', ({ agent }): undefined => {
    if (isDelegatedSession(agent.session.header)) return
    startWorkFor(agent)
  })
}

/**
 * Inject continuation context when an active boulder work exists. Synchronous by
 * contract (see the module doc): the write-token claim must be settled before the
 * session's first turn, and no failure may reach the serial creation dispatch.
 * @param agent - the newly created top-level agent.
 */
function startWorkFor(agent: Agent): void {
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

    const text = lines.join('\n')
    // The block reports live state — which session holds the write token — so a
    // copy already in the surface that still says the same thing adds nothing.
    if (hasInjectedText(agent.session.deriveMessages(), text)) return

    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: CONTEXT_SOURCE_KIND },
    }))
  } catch {
    // A read failure must not fail agent creation.
  }
}
