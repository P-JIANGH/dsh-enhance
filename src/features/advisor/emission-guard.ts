/**
 * Advisor emission guard (architecture advisor). dsh has no built-in equivalent
 * to omp's emission guard, so this module installs a per-agent policy that:
 * 1. de-duplicates suggestions by a stable hash of the normalized body (same
 *    concern twice in a row is suppressed), and
 * 2. rate-limits emissions so we never gate the main agent more than once per
 *    rolling window (avoids advisor churn while the main agent is mid-flight).
 *
 * Pure logic with an injectable clock, so it is directly unit-testable.
 * @module oh-my-dsh/features/advisor/emission-guard
 */

/** Rolled-back window (ms) over which at most one emission may pass. */
export const DEFAULT_EMISSION_WINDOW_MS = 30_000

/** Emission-guard state for one agent. Lives for the plugin lifetime. */
export interface EmissionGuardState {
  lastEmittedAt: number
  lastHash?: string
}

/** A rolling de-dupe + rate-limit gate against per-agent emissions. */
export function createEmissionGuard(now: () => number = Date.now, windowMs = DEFAULT_EMISSION_WINDOW_MS) {
  const perAgent = new Map<string, EmissionGuardState>()

  /**
   * Decide whether an emission with the given body may be surfaced for `agentId`.
   * - Suppressed when the window has not elapsed since the last emission AND the
   *   body is a near-duplicate of the last one (cooldown + de-dupe).
   * - Otherwise allowed once the window passes, or for a genuinely new body.
   * @param agentId - main-agent identity to key on.
   * @param body - advisor suggestion body (used for the de-dupe hash).
   * @returns true when the emission may be delivered.
   */
  function gate(agentId: string, body: string): boolean {
    if (!body) return false
    const t = now()
    const st = perAgent.get(agentId) ?? { lastEmittedAt: 0 }
    const withinWindow = t - st.lastEmittedAt < windowMs
    const sameBody = st.lastHash !== undefined && st.lastHash === hash(body)
    if (withinWindow && sameBody) return false // de-dupe during cooldown
    perAgent.set(agentId, { lastEmittedAt: t, lastHash: hash(body) })
    return true
  }

  /** Forget an agent's guard state (on agent disposal). */
  function clear(agentId: string): void {
    perAgent.delete(agentId)
  }

  return { gate, clear }
}

/** Stable enough hash for de-dupe: short FNV-1a over the normalized body. */
function hash(s: string): string {
  let h = 0x811c9dc5
  const norm = s.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
