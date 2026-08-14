/**
 * Session-start orientation hook: when an agent session begins, inject one
 * durable user-role message telling the model oh-my-dsh is active and naming
 * the packaged skills. `agent.inject()` is the documented seeded-context path
 * (the same mechanism AGENTS.md subdirectory notices use), so the injection is
 * logged and replay-safe.
 * @module oh-my-dsh/hooks
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Orientation-hook configuration. */
export interface OrientationOptions {
  /** Master switch: false installs a no-op and skips the event listener. */
  enabled: boolean
  /** Extra prose appended to the orientation message, e.g. project-specific guidance. */
  extra?: string
}

/**
 * Register the session-start orientation listener.
 * @param ctx - context with the `skills` service.
 * @param options - orientation behavior.
 * @returns the exact disposer that removes the listener.
 */
export function registerSessionStartHook(ctx: Context, options: OrientationOptions): () => void {
  if (!options.enabled) return () => {}
  return ctx.on('agent/session-start', ({ agent }) => {
    void orientAgent(ctx, agent, options.extra)
  })
}

/** Build and inject the orientation message for one agent. */
async function orientAgent(ctx: Context, agent: Agent, extra?: string): Promise<void> {
  let skills: string[] = []
  try {
    skills = (await ctx.skills.list({})).map(summary => summary.name)
  } catch {
    // A failed discovery must not block orientation; the message is still useful
    // without the skill names, so the swallow is bounded to this one list call.
  }
  const parts = [
    'oh-my-dsh is active in this session: it contributes the work-rules section of this system prompt, packaged skills, and the `oh_my_dsh_doctor` tool.',
  ]
  if (skills.length > 0) {
    parts.push(`Packaged skills available through the \`skill\` tool: ${skills.join(', ')}.`)
  }
  if (extra) parts.push(extra)
  agent.inject(createUserMessage({
    content: [{ type: 'text', text: parts.join('\n\n') }],
    source: { kind: 'user' },
  }))
}
