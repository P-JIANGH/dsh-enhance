/**
 * Advisor severity parsing (architecture advisor). The advisor sub-model emits a
 * strict `ADVISOR: <severity>\n<body>` envelope (see prompts/modes/advisor.md).
 * This parser extracts the severity and suggestion body so the runtime can map
 * `concern`/`blocker` → `agent.steer()` and `nit` → `agent.inject()`, and lets
 * unit tests pin the contract independent of the live loop.
 * @module oh-my-dsh/features/advisor/severity
 */

/** The three supported advisor severities. */
export type AdvisorSeverity = 'nit' | 'concern' | 'blocker'

/** A parsed advisor emission, or null when the text carries no emission (`NONE`). */
export interface AdvisorEmission {
  /** The severity the advisor wants. */
  severity: AdvisorSeverity
  /** The trimmed suggestion body following the marker line. */
  body: string
}

/** Severity order used for binding decisions: blocker most forceful. */
export const SEVERITY_ORDER: Record<AdvisorSeverity, number> = { nit: 0, concern: 1, blocker: 2 }

/** Parse the base marker; returns matched severity text or undefined. */
const MARKER = /^\s*ADVISOR:\s*(nit|concern|blocker|NONE)\s*$/im

/**
 * Parse an advisor output envelope.
 * - No marker or an explicit `NONE` marker → `null` (nothing to emit).
 * - A `nit|concern|blocker` marker yields an {@link AdvisorEmission}; the body is
 *   everything after the marker line, trimmed.
 * @param text - the advisor's raw review output.
 * @returns the parsed emission, or `null` when there is nothing to surface.
 */
export function parseAdvisorEmission(text: string): AdvisorEmission | null {
  if (!text) return null
  const m = MARKER.exec(text)
  if (!m) return null
  const sev = (m[1] ?? '').toLowerCase()
  if (sev === 'none') return null
  // Body = lines strictly after the marker line.
  const markerIndex = text.search(MARKER)
  const rest = text.slice(markerIndex)
  const nl = rest.indexOf('\n')
  const body = (nl === -1 ? '' : rest.slice(nl + 1)).trim()
  if (!body) return null // a marker with no body carries no actionable advice
  return { severity: sev as AdvisorSeverity, body }
}
