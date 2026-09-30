/**
 * delivery-gate turn-stopping hook (architecture §5.2.1 / §5.2.2).
 *
 * Wires the tested decision functions in `features/delivery-gate` to the live dsh
 * event machine. On every turn-stop boundary it:
 *
 * 1. reads the agent's newest assistant text and classifies it as a completion
 *    claim or ordinary progress (`detectCompletionClaim`, with the **native**
 *    session goal's phase as the c13 disambiguator);
 * 2. advances a per-session gate phase (`deliveryGateStep`) so the gate is a real
 *    state machine rather than a one-shot check;
 * 3. when a claim lands and no native goal is still open, runs the work's bound
 *    `verify` script if any (`runVerify`) and builds a structured report
 *    (`buildReport`) — **no verify bound means `unmeasured`, never a claimed pass**;
 * 4. on a passing/unmeasured delivery records the report, marks the work completed
 *    and releases the session's write token; on a *failed* verify it records the
 *    failure and steers one regression reminder (rate-limited) instead.
 *
 * An open goal stays with upstream: `dsh-goal-round-driver` turns an active goal
 * into further rounds (its prompt demands evidence before completion), so the gate
 * only judges once no goal is open. This hook used to read dsh-enhance's own
 * goal/todo store; that store is retired — goals are the native `ctx.goals`
 * service, so there is exactly one goal API in the session.
 *
 * @module dsh-enhance/hooks/delivery-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mutateBoulderState, readBoulder, type BoulderWork } from '../features/boulder/store.js'
import { releaseWriteToken } from '../features/boulder/write-token.js'
import {
  buildReport,
  detectCompletionClaim,
  deliveryGateStep,
  runVerify,
  type CompletionSignals,
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
  const offStop = ctx.on('agent/turn-stopping', async ({ agent, turn }: { agent: Agent; turn: number }) => {
    try {
      await evaluateTurn(ctx, agent, turn)
    } catch {
      // The gate must never break turn stopping.
    }
  })
  // Per-session memory must not outlive the session.
  const offDisposed = ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => {
    forgetSession(String(agent?.session?.header?.id ?? 'session'))
  })
  return () => { offStop?.(); offDisposed?.() }
}

/** Drop all gate memory for one session. */
function forgetSession(session: string): void {
  phases.delete(session)
  evaluated.delete(session)
  regressedAt.delete(session)
}

/** Evaluate one turn-stop boundary for the given agent. */
async function evaluateTurn(ctx: Context, agent: Agent, turn: number): Promise<void> {
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

  const goal = readGoalPhase(ctx, agent)
  const goalOpen = goal !== undefined && goal !== 'complete'
  const claimText = lastAssistantText(agent.session.deriveMessages())
  const signals: CompletionSignals = { text: claimText, calledTools: [], hasDoneTag: false, goalOpen }
  const declared = detectCompletionClaim(signals)

  const priorPhase = phases.get(session) ?? 'idle'
  phases.set(session, deliveryGateStep({ declared, reviewPassed: false, phase: priorPhase }))

  if (!declared) return
  // An open goal is not a delivery: continuation belongs to the native round driver.
  if (goalOpen) return

  await reviewAndRecord(agent, cwd, session, work, signals)
}

/**
 * Read the native goal phase for one agent.
 *
 * A `goals` service that cannot resolve this exact live agent — or a session that
 * never created a goal — reports no goal instead of failing the turn boundary.
 */
function readGoalPhase(ctx: Context, agent: Agent): string | undefined {
  try {
    return ctx.goals.get(agent)?.phase
  } catch {
    return undefined
  }
}

/** Run the bound verify (if any), record the report, and settle the work. */
async function reviewAndRecord(
  agent: Agent,
  cwd: string,
  session: string,
  work: BoulderWork,
  signals: CompletionSignals,
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
