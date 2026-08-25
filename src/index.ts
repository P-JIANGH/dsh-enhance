/**
 * oh-my-dsh: an oh-my-zsh-style enhancement bundle for DeepSeek Harness.
 * One installable plugin that contributes packaged skills, a persistent
 * work-rules prompt section, a session-start orientation hook, and a doctor
 * tool. Everything is configurable through the plugin row's `config`.
 * @module oh-my-dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { registerDoctorTool } from './tools/doctor.js'
import { registerSessionStartHook } from './hooks/orient.js'
import { registerWorkRules } from './hooks/work-rules.js'
import { registerSkillsProvider } from './features/skills-provider.js'

/** Cordis plugin name. */
export const name = 'oh-my-dsh'

/** Services this plugin waits for before activating. */
export const inject = ['skills', 'systemPrompt', 'tools']

/** Default work-rules prose: general working discipline, project-agnostic. */
export const DEFAULT_WORK_RULES = `# Work rules

Follow the repository's own conventions first: read AGENTS.md, README.md, and
contributing guides before changing code, and prefer existing functions and
patterns over new machinery.

- Search before asking: inspect the workspace and history before asking the user.
- Make small, reviewable steps; keep each change focused and tested.
- Report failures honestly, with the exact error, and propose the next attempt.
- Keep changes minimal and symmetric; do not leave dead code or debug output.`

/** Plugin configuration. */
export interface Config {
  /** Work-rules prose for the persistent prompt section. Empty text drops the section at render. */
  workRules?: string
  /** Inject a one-time orientation message at each session start, naming the packaged skills. */
  orientOnSessionStart?: boolean
  /** Register the model-facing oh_my_dsh_doctor diagnostic tool. */
  doctorTool?: boolean
}

/** Runtime schema for the plugin row. */
export const Config: z<Config> = z.object({
  workRules: z.string().default(DEFAULT_WORK_RULES),
  orientOnSessionStart: z.boolean().default(true),
  doctorTool: z.boolean().default(true),
})

/**
 * Apply the oh-my-dsh bundle to one context.
 * @param ctx - context with the `skills`, `systemPrompt`, and `tools` services.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const workRules = config.workRules ?? ''
  const orientOnSessionStart = config.orientOnSessionStart ?? true
  const doctorTool = config.doctorTool ?? true
  registerSkillsProvider(ctx)
  if (workRules) registerWorkRules(ctx, workRules)
  registerSessionStartHook(ctx, { enabled: orientOnSessionStart })
  registerDoctorTool(ctx, {
    workRulesChars: workRules.length,
    orientOnSessionStart,
    doctorTool,
  }, doctorTool)
}
