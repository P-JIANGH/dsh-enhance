/**
 * Write-token guard (architecture §5.5.1): enforce "one writer per workspace".
 *
 * The boulder CAS protects the *state file*; it does not protect the working tree.
 * Two sessions that both plan+execute on the same repo would interleave writes and
 * commits. The discipline is:
 *
 * - read-only roles may run in parallel (no token needed);
 * - an execute session must hold the write token **unless** its work has an
 *   independent worktree (physical isolation is the parallel channel);
 * - therefore this guard only fires when a repo has an *active boulder work
 *   without a worktree* — sessions that never use boulder are unaffected.
 *
 * The first writer claims the token lazily, so a session that missed `start-work`
 * is not locked out; a second session is rejected with an actionable message.
 *
 * @module dsh-enhance/tools/write-token-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import { readBoulder } from '../features/boulder/store.js'
import { claimWriteToken, readWriteToken, releaseWriteToken } from '../features/boulder/write-token.js'

/**
 * Tools that write the workspace. `todo_write` and other `*_write` helpers are
 * deliberately excluded — only file mutations take the token.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['write', 'edit'])

/** Why a write was refused. */
export interface WriteTokenDecision {
  ok: boolean
  reason?: string
  holder?: string
}

/**
 * Pure-ish decision for the write-token guard (fs reads via the store; no writes
 * unless it can claim the free token).
 * @param args - tool name, session cwd/id, and the claim function (injectable for tests).
 * @returns the decision.
 */
export function decideWriteToken(
  args: { name: string; cwd?: string; sessionId: string },
  deps: {
    read: (cwd: string) => ReturnType<typeof readBoulder>['state']
    claim: (cwd: string, sessionId: string) => boolean
  } = { read: (cwd) => readBoulder(cwd).state, claim: claimWriteToken },
): WriteTokenDecision {
  if (!WRITE_TOOLS.has(args.name)) return { ok: true }
  if (!args.cwd) return { ok: true }

  const state = deps.read(args.cwd)
  const work = state.active_work_id ? state.works[state.active_work_id] : undefined
  if (!work) return { ok: true }
  // An independent worktree is the parallel channel: no token required.
  if (work.worktree_path) return { ok: true }

  const holder = readWriteToken(state)
  if (holder === args.sessionId) return { ok: true }
  if (!holder && deps.claim(args.cwd, args.sessionId)) return { ok: true }

  return {
    ok: false,
    holder,
    reason: `写令牌被占用：work「${work.id}」的执行权当前在会话 ${holder ?? '其他会话'} 手上（架构 §5.5.1 写串行纪律）。`
      + '请等其释放，或先用 worktree_create 为该 work 建独立 worktree（隔离工作区可并行，不需要令牌）。',
  }
}

/**
 * Register the write-token guard on the tool pipeline.
 *
 * Also releases the token when the holding agent is disposed: without this a
 * session that simply stops would keep the repository's execute right until the
 * staleness window elapsed.
 *
 * @param ctx - context with the `tools` registry.
 * @param enabled - master switch (workTracking).
 * @returns the exact disposer.
 */
export function registerWriteTokenGuard(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}

  const offGuard = ctx.tools.guard((exec) => {
    try {
      const header = exec.agent?.session?.header
      const decision = decideWriteToken({
        name: exec.name,
        cwd: header?.cwd,
        sessionId: String(header?.id ?? 'session'),
      })
      return decision.ok ? undefined : decision.reason
    } catch {
      // A guard must never break a tool call on its own failure.
      return undefined
    }
  })

  const offDisposed = ctx.on('agent/disposed', ({ agent }: { agent: { session: { header: { cwd?: string; id?: unknown } } } }) => {
    try {
      const cwd = agent?.session?.header?.cwd
      if (!cwd) return
      releaseWriteToken(cwd, String(agent.session.header.id ?? 'session'))
    } catch {
      // Disposal cleanup must never throw back into the machine.
    }
  })

  return () => { offGuard?.(); offDisposed?.() }
}
