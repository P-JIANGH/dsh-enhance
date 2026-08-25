/**
 * rules-injector (architecture §5.2-B): at session start, discover the
 * workspace rules (AGENTS.md, .omd/rules/*.md) and inject them as a system
 * prompt section. Own finder (cached, distance-sorted) rather than re-using a
 * harness-specific loader.
 *
 * @module oh-my-dsh/hooks/rules-injector
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Cache: absolute cwd → rules text (or null when none). Bounded by size. */
const rulesCache = new Map<string, string | null>()

/** Maximum cached entries to keep around. */
const CACHE_CAP = 64

/**
 * Discover workspace-level rules for a directory. Prefers AGENTS.md, then
 * `.omd/rules/` files (sorted by name), concatenated.
 * @param base - session working directory.
 * @returns combined rules text, or undefined when none found.
 */
export function discoverRules(base: string): string | undefined {
  const cached = rulesCache.get(base)
  if (cached !== undefined) return cached === null ? undefined : cached
  const parts: string[] = []
  const agents = join(base, 'AGENTS.md')
  if (existsSync(agents)) {
    try { parts.push(`# AGENTS.md\n${readFileSync(agents, 'utf8')}`) } catch { /* ignore */ }
  }
  const rulesDir = join(base, '.omd', 'rules')
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
  return ctx.on('agent/session-start', ({ agent }) => {
    injectFor(agent)
  })
}

/** Discover and inject rules for one session. */
async function injectFor(agent: Agent): Promise<void> {
  try {
    const cwd = agent.session.header.cwd
    if (!cwd) return
    const rules = discoverRules(cwd)
    if (!rules) return
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: `## 工作区规则\n${rules}` }],
      source: { kind: 'user' },
    }))
  } catch {
    // Injection must never block session start.
  }
}
