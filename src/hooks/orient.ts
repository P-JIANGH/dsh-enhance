/**
 * Session-start orientation hook: when an agent session begins, inject one
 * durable user-role message telling the model dsh-enhance is active and naming
 * the packaged skills. `agent.inject()` is the documented seeded-context path
 * (the same mechanism AGENTS.md subdirectory notices use), so the injection is
 * logged and replay-safe.
 * @module dsh-enhance/hooks
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { PROVIDER as BUNDLED_PROVIDER } from '../features/skills-provider.js'

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
    // `ctx.skills.list({})` returns every provider's skills. Filter by *provider*,
    // not by `source`: `source: 'bundled'` only means "came from a bundled root"
    // and several unrelated providers use it (the desktop profile ships its own
    // `bundled` office-* skills), so filtering on it still overstates what this
    // plugin contributes.
    skills = (await ctx.skills.list({}))
      .filter(summary => summary.provider === BUNDLED_PROVIDER)
      .map(summary => summary.name)
  } catch {
    // A failed discovery must not block orientation; the message is still useful
    // without the skill names, so the swallow is bounded to this one list call.
  }
  const parts = [
    'dsh-enhance 已在本会话生效：本系统提示包含工作准则段落；通过 skill 工具提供打包技能；并提供 dsh_enhance_doctor 诊断工具。',
    '从何开始：调 `dsh_enhance_doctor` 查看装配与可开启项；输入 `ulw` 进入深度工作模式。',
  ]
  if (skills.length > 0) {
    parts.splice(1, 0, `本会话可用的打包技能：${skills.join('、')}。`)
  }
  if (extra) parts.push(extra)
  agent.inject(createUserMessage({
    content: [{ type: 'text', text: parts.join('\n\n') }],
    source: { kind: 'user' },
  }))
}
