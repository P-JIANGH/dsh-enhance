/**
 * System-prompt contribution: a persistent work-rules section rendered at the
 * persona layer of every assembly. Static text resolved once at registration,
 * so the section is cheap and replay-safe.
 * @module oh-my-dsh/prompt
 */

import type { Context } from '@deepseek-ai/cordis'

/** Unique section name; a duplicate registration throws. */
export const WORK_RULES_SECTION = 'oh-my-dsh/work-rules'

/** Render order: the persona layer (0), before tool guidance (100–199). */
export const WORK_RULES_ORDER = 0

/**
 * Register the work-rules prompt section in the calling context's scope.
 * @param ctx - context with the `systemPrompt` service.
 * @param text - the work-rules prose; empty text is still registered and drops
 *   at render, matching the registry contract.
 * @returns the exact disposer that unregisters the section.
 */
export function registerWorkRules(ctx: Context, text: string): () => void {
  return ctx.effect(() => ctx.systemPrompt.section({
    name: WORK_RULES_SECTION,
    order: WORK_RULES_ORDER,
    text,
  }), 'oh-my-dsh: work-rules section')
}
