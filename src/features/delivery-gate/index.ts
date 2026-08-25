/**
 * delivery-gate: completion-claim detection + a regression-review state machine
 * (architecture §5.2.1) plus verify-binding / tamper-resistance / anchor
 * resistance / jnreport helpers (§5.2.2).
 *
 * The state machine and claim heuristics are pure and compatible with the
 * original test contract in `tests/delivery-gate.test.mjs`. Goal/todo context
 * is an optional disambiguator (c13): a claim is only treated as an *overall*
 * completion when the session goal's open todos are clear.
 *
 * @module oh-my-dsh/features/delivery-gate
 */

/** Delivery-gate phases. */
export type GatePhase = 'idle' | 'review' | 'working' | 'delivered'

/** Signals used to detect a completion claim. */
export interface CompletionSignals {
  text?: string
  calledTools?: string[]
  hasDoneTag?: boolean
  /** Session goal with open todo count (optional disambiguator). */
  remainingTodos?: number
}

const COMPLETION_PHRASES = [
  '完成了', '交付', '可以了', '搞定', '做完了', '全部完成',
  'delivered', 'done', 'complete', 'finished', 'shipped',
]
const COMPLETION_TOOLS = ['git_commit', 'finish', 'end_task', 'complete']

/**
 * Detect whether the agent is claiming overall completion.
 * Goal/todo disambiguation (c13): when a goal still has open todos, a bare
 * "finished" tone is not treated as an overall completion (progress report,
 * not delivery). The heuristic matches the original contract for legacy
 * no-goal inputs.
 * @param signals - signals to classify.
 * @returns true when this reads as an overall completion claim.
 */
export function detectCompletionClaim(signals: CompletionSignals): boolean {
  const { text = '', calledTools = [], hasDoneTag = false, remainingTodos } = signals ?? {}
  const hitPhrase = COMPLETION_PHRASES.some(p => text.includes(p))
  const hitTool = calledTools.some(t => COMPLETION_TOOLS.includes(t))

  // A lingering open-todo goal overrides the phrase heuristic: "did X, moving
  // on" while N remain is a progress report, not delivery.
  if ((remainingTodos ?? 0) > 0 && hitPhrase && !hitTool && !hasDoneTag) {
    return false
  }
  return Boolean(hitPhrase || hitTool || hasDoneTag)
}

/**
 * Advance the delivery-gate state machine.
 * @param input - declared (completion), reviewPassed, current phase.
 * @returns the next phase.
 */
export function deliveryGateStep(input: {
  declared?: boolean
  reviewPassed?: boolean
  phase?: GatePhase
}): GatePhase {
  const { declared = false, reviewPassed = false, phase = 'idle' } = input
  if (phase === 'idle') return declared ? 'review' : 'working'
  if (phase === 'review') return reviewPassed ? 'delivered' : 'working'
  if (phase === 'working') return declared ? 'review' : 'working'
  if (phase === 'delivered') return 'delivered'
  return 'working'
}

// ---- §5.2.2 verify binding + tamper resistance + report ----

/** A protected-file manifest entry. */
export interface ProtectedFile {
  path: string
  sha256?: string
}

/**
 * Run a verify script, returning its observable exit code. Cross-platform: on
 * Windows the script is executed via `cmd.exe /c`, on posix via `/bin/sh`.
 * @param verifyScript - path to the verify script.
 * @param cwd - directory to run in.
 * @returns `{ ok, exitCode }`.
 */
export async function runVerify(verifyScript: string, cwd: string): Promise<{ ok: boolean; exitCode: number }> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
  const args = process.platform === 'win32' ? ['/c', verifyScript] : [verifyScript]
  try {
    await execFileAsync(shell, args, { cwd })
    return { ok: true, exitCode: 0 }
  } catch (err) {
    const e = err as { code?: number | string }
    const exitCode = typeof e.code === 'number' ? e.code : -1
    return { ok: false, exitCode }
  }
}

/**
 * Tamper check: confirm protected files' hashes were not altered after the gate
 * mounted the manifest. Pure decision over precomputed hash vs observed.
 * @param expected - map of path → sha256 expected.
 * @param observed - map of path → currently-observed sha256.
 * @returns list of paths whose hash changed (empty ⇒ no tamper).
 */
export function findTampered(expected: Record<string, string>, observed: Record<string, string>): string[] {
  const tampered: string[] = []
  for (const [p, want] of Object.entries(expected)) {
    if (observed[p] !== want) tampered.push(p)
  }
  return tampered
}

/**
 * Build a structured completion report (architecture §5.2.2.4).
 * @param claim - the completion signals that were judged.
 * @param verified - whether an executable verify passed (undefined = unmeasured).
 * @param tampered - protected files whose hash changed.
 * @returns a serializable report object.
 */
export function buildReport(
  claim: CompletionSignals,
  verified: boolean | undefined,
  tampered: string[],
): Record<string, unknown> {
  return {
    claimedAt: Date.now(),
    claimText: claim.text ?? '',
    state: verified === undefined ? 'unmeasured' : tampered.length > 0 ? 'tampered' : (verified ? 'passed' : 'failed'),
    verify: verified === undefined ? null : verified,
    tampered,
  }
}
