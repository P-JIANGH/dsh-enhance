/**
 * Wire the M3 guard decision functions onto dsh's tool pipeline
 * (architecture §5.2-A). Maintains a per-session set of read paths (from `read`
 * and bash reads) purely for the (tested) write-existing decision; at runtime we
 * enforce the path-traversal containment guard via `ctx.tools.guard`, while the
 * read-first / write-exists policy is owned by dsh's fs-observation-policy.
 * Deep defense: dsh's own fs/observation and sandbox remain authoritative; this
 * layer is behind `config.guards`.
 *
 * @module dsh-enhance/tools/guard-register
 */

import type { Context } from '@deepseek-ai/cordis'
import { filePathOf, guardPathTraversal, bashReadPaths, READ_TRACK_CAP } from './guards.js'

/**
 * Register the guards. `guardsOn` is the master switch; the whole set is a
 * no-op when disabled so a trust-dsh deployment can leave them off.
 * @param ctx - context with the `tools` service.
 * @param guardsOn - whether guards are enabled.
 * @param rootBase - session workspace root (from header.cwd or a fixed base).
 * @returns disposer.
 */
export function registerToolGuards(ctx: Context, guardsOn: boolean): () => void {
  if (!guardsOn) return () => {}

  /** Per-session → read paths observed so far (bounded). */
  const readSet = new Map<string, Set<string>>()

  function setFor(exec: { agent?: { session?: { header?: { id?: unknown } } } }): Set<string> {
    const key = String(exec.agent?.session?.header?.id ?? 'global')
    let s = readSet.get(key)
    if (!s) {
      s = new Set()
      readSet.set(key, s)
    }
    return s
  }

  const disposers: Array<() => void> = []

  // Observe reads to build the read-set.
  disposers.push(ctx.on('tools/result', (exec) => {
    try {
      const p = filePathOf(exec.arguments)
      if (p && exec.name === 'read') {
        const s = setFor(exec)
        if (s.size < READ_TRACK_CAP) s.add(p)
      }
      if (exec.name === 'bash') {
        const cmd = typeof (exec.arguments as Record<string, unknown>).command === 'string'
          ? String((exec.arguments as Record<string, unknown>).command)
          : ''
        const s = setFor(exec)
        for (const r of bashReadPaths(cmd)) {
          if (s.size < READ_TRACK_CAP) s.add(r)
        }
      }
    } catch {
      // Observing must never break the result pipeline.
    }
  }))

  // Writer-side rejection: path-traversal. (Write-exists / read-first is owned
  // by dsh's fs-observation-policy; we do not double-enforce it to avoid a
  // conflicting second policy. `guardWriteExisting` is exercised by tests but
  // intentionally not wired force-enabled here.)
  disposers.push(ctx.tools.guard((exec) => {
    const p = filePathOf(exec.arguments)
    if (!p || exec.name !== 'write') return undefined
    const root = exec.agent?.session?.header?.cwd ?? process.cwd()
    return guardPathTraversal(exec.arguments, root)
  }))

  return () => { for (const d of disposers) d() }
}
