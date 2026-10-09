/**
 * rules-injector (architecture §5.2-B): when a top-level agent is created,
 * discover this bundle's own rules (`.dsh-enhance/rules/*.md`) and inject them
 * as one prompt section.
 *
 * Bound to `agent/created`: the 0.2.0 event catalogue has no
 * `agent/session-start`, and a listener registered on a name nobody emits never
 * fires. The listener is synchronous and catch-all on purpose — `agent/created`
 * is dispatched serially and awaited *before agent creation resolves* ("a throw or
 * rejection fails creation and skips later listeners"), so the injection has to
 * land inline and nothing may escape. Delegated children are skipped: they are
 * their parent's task, not a session this bundle seeds.
 *
 * `AGENTS.md` is deliberately **not** read here: the native
 * `@deepseek-ai/dsh-agent-instructions` plugin already loads `$DSH_HOME/AGENTS.md`
 * plus every directory from the project root to the session cwd (including local
 * overlays), re-discovers nested files after filesystem touches, and folds that
 * baseline into durable history. Reading it here again duplicated the same content
 * in the prompt — see `docs/value-assessment.md` §3.
 *
 * @module dsh-enhance/hooks/rules-injector
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { hasInjectedText } from '../shared/messages.js'
import { CONTEXT_SOURCE_KIND } from '../shared/provenance.js'
import { isDelegatedSession } from '../shared/session-scope.js'

/** Cache: absolute cwd → rules text (or null when none). Bounded by size. */
const rulesCache = new Map<string, string | null>()

/** Maximum cached entries to keep around. */
const CACHE_CAP = 64

/**
 * Discover this bundle's own rules for a directory: `.dsh-enhance/rules/*.md`
 * (sorted by name, concatenated). AGENTS.md belongs to the native instruction
 * chain and is not read here.
 * @param base - session working directory.
 * @returns combined rules text, or undefined when none found.
 */
export function discoverRules(base: string): string | undefined {
  const cached = rulesCache.get(base)
  if (cached !== undefined) return cached === null ? undefined : cached
  const parts: string[] = []
  const rulesDir = join(base, '.dsh-enhance', 'rules')
  if (existsSync(rulesDir)) {
    let files: string[] = []
    try { files = readdirSync(rulesDir).filter(f => f.endsWith('.md')).sort() } catch { /* ignore */ }
    for (const f of files) {
      try { parts.push(`# ${f}\n${readFileSync(join(rulesDir, f), 'utf8')}`) } catch { /* ignore */ }
    }
  }
  if (parts.length === 0) {
    if (rulesCache.size >= CACHE_CAP) rulesCache.clear()
    rulesCache.set(base, null)
    return undefined
  }
  const text = parts.join('\n\n')
  if (rulesCache.size >= CACHE_CAP) rulesCache.clear()
  rulesCache.set(base, text)
  return text
}

/**
 * Register the rules-injector.
 * @param ctx - context.
 * @param enabled - master switch (guards/rules).
 * @returns disposer.
 */
export function registerRulesInjector(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  // The declared return type is the event's contract: `undefined |
  // Promise<undefined>`, never `void` — creation waits on this dispatch.
  return ctx.on('agent/created', ({ agent }): undefined => {
    if (isDelegatedSession(agent.session.header)) return
    injectFor(agent)
  })
}

/**
 * Discover and inject rules for one session. Synchronous by contract: it is local
 * file reads, and `agent/created` is awaited before agent creation resolves.
 * @param agent - the newly created top-level agent.
 */
function injectFor(agent: Agent): void {
  try {
    const cwd = agent.session.header.cwd
    if (!cwd) return
    const rules = discoverRules(cwd)
    if (!rules) return
    const text = `## 工作区规则\n${rules}`
    // A resumed session replays its own earlier injection; seeding it twice buys
    // nothing. A session whose copy did not survive a surface rewrite is seeded
    // again — that is why the check reads the live messages, not the event source.
    if (hasInjectedText(agent.session.deriveMessages(), text)) return
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: CONTEXT_SOURCE_KIND },
    }))
  } catch {
    // Injection must never fail agent creation.
  }
}
