/**
 * delivery-gate turn-stopping hook (architecture §5.2.1 / §5.2.2).
 *
 * Wires the tested decision functions in `features/delivery-gate` to the live dsh
 * event machine. On every turn-stop boundary it:
 *
 * 1. reads the agent's newest assistant text and classifies it as a completion
 *    claim or ordinary progress (`detectCompletionClaim`, with the goal's open-todo
 *    count as the c13 disambiguator);
 * 2. advances a per-session gate phase (`deliveryGateStep`) so the gate is a real
 *    state machine rather than a one-shot check;
 * 3. when a claim lands and the goal's todos are clear, runs the work's bound
 *    `verify` script if any (`runVerify`) and builds a structured report
 *    (`buildReport`) — **no verify bound means `unmeasured`, never a claimed pass**;
 * 4. on a passing/unmeasured delivery records the report, marks the work completed
 *    and releases the session's write token; on a *failed* verify it records the
 *    failure and steers one regression reminder (rate-limited) instead.
 *
 * Open todos stay with `todo-continuation` (architecture: run the todo check
 * first; the delivery gate only judges once todos are clear), so this hook never
 * competes with it for the same turn.
 *
 * @module dsh-enhance/hooks/delivery-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { join } from 'node:path'
import { mutateBoulderState, readBoulder, type BoulderWork } from '../features/boulder/store.js'
import { readGoal } from '../features/boulder/goal.js'
import { releaseWriteToken } from '../features/boulder/write-token.js'
import {
  buildReport,
  detectCompletionClaim,
  deliveryGateStep,
  runVerify,
  type GatePhase,
} from '../features/delivery-gate/index.js'
import { lastAssistantText } from '../shared/messages.js'

/** Minimum ms between two regression reminders for the same session. */
export const REGRESSION_COOLDOWN_MS = 60_000

/** Gate phase per session id (the state machine's memory). */
const phases = new Map<string, GatePhase>()

/** Turn numbers already evaluated, per session — idempotency (§5.2.1-5: no double run). */
const evaluated = new Map<string, Set<number>>()

/** Last regression-reminder timestamp per session, for the loop guard. */
const regressedAt = new Map<string, number>()

/** Test/teardown helper: forget all per-session gate memory. */
export function resetDeliveryGateState(): void {
  phases.clear()
  evaluated.clear()
  regressedAt.clear()
}

/**
 * Register the delivery-gate listener.
 * @param ctx - context.
 * @param enabled - master switch (the gate reads goal + boulder, so it rides the
 *   workTracking switch in `apply`).
 * @returns disposer.
 */
export function registerDeliveryGateHook(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  return ctx.on('agent/turn-stopping', async ({ agent, turn }: { agent: Agent; turn: number }) => {
    try {
      await evaluateTurn(agent, turn)
    } catch {
      // The gate must never break turn stopping.
    }
  })
}

/** Evaluate one turn-stop boundary for the given agent. */
async function evaluateTurn(agent: Agent, turn: number): Promise<void> {
  const cwd = agent.session.header.cwd
  const session = String(agent.session.header.id ?? 'session')
  if (!cwd) return

  // Idempotency: the same turn boundary is only judged once.
  let seen = evaluated.get(session)
  if (!seen) {
    seen = new Set()
    evaluated.set(session, seen)
  }
  if (seen.has(turn)) return
  seen.add(turn)

  const { state } = readBoulder(cwd)
  const work = state.active_work_id ? state.works[state.active_work_id] : undefined
  if (!work) return

  const goal = readGoal(join(cwd, '.dsh-enhance', 'goals'), session)
  const remainingTodos = goal?.remaining_todos ?? 0
  const claimText = lastAssistantText(agent.session.deriveMessages())
  const signals = { text: claimText, calledTools: [] as string[], hasDoneTag: false, remainingTodos }
  const declared = detectCompletionClaim(signals)

  const priorPhase = phases.get(session) ?? 'idle'
  phases.set(session, deliveryGateStep({ declared, reviewPassed: false, phase: priorPhase }))

  if (!declared) return
  // Open todos are todo-continuation's job: do not start the gate (architecture §5.2.1).
  if (remainingTodos > 0) return
  // A goal that is not done yet is not a delivery either.
  if (goal && goal.status !== 'done') return

  await reviewAndRecord(agent, cwd, session, work, signals)
}

/** Run the bound verify (if any), record the report, and settle the work. */
async function reviewAndRecord(
  agent: Agent,
  cwd: string,
  session: string,
  work: BoulderWork,
  signals: { text?: string; remainingTodos?: number },
): Promise<void> {
  // §5.2.2-1: an executable verify is the observable fact. No binding ⇒ unmeasured.
  let verified: boolean | undefined
  if (work.verify) {
    const result = await runVerify(work.verify, cwd)
    verified = result.ok
  }
  // Protected-file manifests are not bound yet (roadmap): nothing to compare.
  const tampered: string[] = []
  const report = buildReport(signals, verified, tampered)
  const state = String(report.state)

  if (state === 'failed') {
    // Do not complete, do not release: record the failure and ask for a fix once.
    mutateBoulderState(cwd, (s) => {
      s.completion_log = [...(s.completion_log ?? []), {
        work_id: work.id,
        at: Date.now(),
        state,
        phase: 'review',
        claim: signals.text ?? '',
      }]
    })
    steerRegression(agent, session, work)
    return
  }

  mutateBoulderState(cwd, (s) => {
    s.completion_log = [...(s.completion_log ?? []), {
      work_id: work.id,
      at: Date.now(),
      state,
      phase: 'review',
      claim: signals.text ?? '',
    }]
    const w = s.works[work.id]
    if (w) {
      w.status = 'completed'
      w.updated_at = Date.now()
    }
    if (s.active_work_id === work.id) delete s.active_work_id
  })
  phases.set(session, deliveryGateStep({ declared: true, reviewPassed: true, phase: 'review' }))
  releaseWriteToken(cwd, session)
}

/**
 * Steer one regression reminder, rate-limited per session so a repeatedly failing
 * verify cannot spin the loop.
 */
function steerRegression(agent: Agent, session: string, work: BoulderWork): void {
  const now = Date.now()
  const last = regressedAt.get(session) ?? 0
  if (now - last < REGRESSION_COOLDOWN_MS) return
  regressedAt.set(session, now)
  agent.steer(createUserMessage({
    content: [{
      type: 'text',
      text: `交付门卫未放行：work「${work.id}」声明的完成未通过绑定的 verify（${work.verify}）。`
        + '请修正后重跑 verify；未通过前不要宣称交付完成。',
    }],
    source: { kind: 'user' },
  }))
}
