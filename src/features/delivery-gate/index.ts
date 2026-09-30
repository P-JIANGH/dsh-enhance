/**
 * delivery-gate: completion-claim detection + a regression-review state machine
 * (architecture §5.2.1) plus verify-binding / tamper-resistance / anchor
 * resistance / jnreport helpers (§5.2.2).
 *
 * The state machine and claim heuristics are pure and compatible with the
 * original test contract in `tests/delivery-gate.test.mjs`. Goal context is an
 * optional disambiguator (c13): while the session's **native** goal is still
 * open (`phase !== 'complete'`), a bare "finished" tone reads as a progress
 * report rather than an overall delivery.
 *
 * @module dsh-enhance/features/delivery-gate
 */

/** Delivery-gate phases. */
export type GatePhase = 'idle' | 'review' | 'working' | 'delivered'

/** Signals used to detect a completion claim. */
export interface CompletionSignals {
  text?: string
  calledTools?: string[]
  hasDoneTag?: boolean
  /**
   * Whether the session's native dsh goal is still open (`phase !== 'complete'`).
   * Absent/false means no goal or a completed one (optional c13 disambiguator).
   */
  goalOpen?: boolean
}

const COMPLETION_PHRASES = [
  '完成了', '交付', '可以了', '搞定', '做完了', '全部完成',
  'delivered', 'done', 'complete', 'finished', 'shipped',
]
const COMPLETION_TOOLS = ['git_commit', 'finish', 'end_task', 'complete']

/**
 * Detect whether the agent is claiming overall completion.
 * Goal disambiguation (c13): while a native goal is still open, a bare
 * "finished" tone is not treated as an overall completion (progress report,
 * not delivery). The heuristic matches the original contract for no-goal inputs.
 * @param signals - signals to classify.
 * @returns true when this reads as an overall completion claim.
 */
export function detectCompletionClaim(signals: CompletionSignals): boolean {
  const { text = '', calledTools = [], hasDoneTag = false, goalOpen } = signals ?? {}
  const hitPhrase = COMPLETION_PHRASES.some(p => text.includes(p))
  const hitTool = calledTools.some(t => COMPLETION_TOOLS.includes(t))

  // An open goal overrides the phrase heuristic: "did X, moving on" while the
  // goal is still open is a progress report, not delivery.
  if (goalOpen === true && hitPhrase && !hitTool && !hasDoneTag) {
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
 * Hash one file's bytes (sha256 hex). Unreadable files report `undefined`, so a
 * comparison against the manifest flags them as changed instead of crashing.
 * @param path - absolute path to the file.
 * @returns the digest, or `undefined` when the file cannot be read.
 */
export async function hashFile(path: string): Promise<string | undefined> {
  try {
    const { createHash } = await import('node:crypto')
    const { readFile } = await import('node:fs/promises')
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch {
    return undefined
  }
}

/**
 * Snapshot hashes for a manifest of repo-relative paths — the gate's mount moment
 * (§5.2.2-2). Only readable files enter the snapshot: a file that later disappears
 * then fails the comparison instead of silently leaving the manifest.
 * @param paths - repo-relative manifest paths.
 * @param cwd - repository root.
 * @returns map of manifest path → sha256 (readable entries only).
 */
export async function hashFiles(paths: readonly string[], cwd: string): Promise<Record<string, string>> {
  const { isAbsolute, join } = await import('node:path')
  const out: Record<string, string> = {}
  for (const p of paths) {
    const digest = await hashFile(isAbsolute(p) ? p : join(cwd, p))
    if (digest !== undefined) out[p] = digest
  }
  return out
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
 *
 * `tampered` outranks every other state: a modified protected file is an observed
 * fact, so it is reported as `tampered` even when no executable verify is bound.
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
    state: tampered.length > 0 ? 'tampered' : verified === undefined ? 'unmeasured' : (verified ? 'passed' : 'failed'),
    verify: verified === undefined ? null : verified,
    tampered,
  }
}
