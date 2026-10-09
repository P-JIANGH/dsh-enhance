/**
 * Which sessions a session-seeding hook may seed.
 *
 * `agent/created` fires for **every** entered agent, including the one-shot
 * children the delegation drivers start (`dsh-subagent-in-process-driver` and
 * `dsh-subagent-fork-in-process` both create through `startInProcessRun` →
 * `childSessionMeta`). A child is a short-lived working session of its parent's
 * task: seeding it with workspace rules and boulder continuation context would
 * duplicate its parent's context, and the write-token claim that continuation
 * seeding performs must never be taken by a delegated child.
 *
 * `SessionHeader` carries two independent marks of that lineage — `origin`
 * (written by `childSessionMeta`) and the persisted `delegationDepth` (which a
 * resumed child keeps, so counting it from zero cannot promote it back to
 * top-level). Either one is enough; a top-level session has neither.
 *
 * @module dsh-enhance/shared/session-scope
 */

/** The session-header fields that mark a delegated (subagent) session. */
export interface DelegationHeader {
  /** Durable coarse origin; `childSessionMeta` writes `'subagent'`. */
  readonly origin?: 'subagent'
  /** Persisted recursion depth; absent for a top-level session. */
  readonly delegationDepth?: number
}

/**
 * Whether this session belongs to a delegated child rather than a top-level session.
 * @param header - a session header (`agent.session.header`).
 * @returns true when the session is a subagent child.
 */
export function isDelegatedSession(header: DelegationHeader): boolean {
  return header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0
}
