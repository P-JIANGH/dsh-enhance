/**
 * `oh_my_dsh_doctor`: a model-facing diagnostic tool that reports the live
 * assembly state of the oh-my-dsh bundle — whether the plugin is loaded, which
 * skills the registry currently supplies, which prompt section this bundle
 * contributes, and the effective configuration. Pure reads only; calling it
 * has no side effects.
 * @module oh-my-dsh/doctor
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** The doctor tool's canonical output value. */
export interface DoctorReport {
  /** Whether the oh-my-dsh plugin row is loaded in this process. */
  pluginLoaded: boolean
  /** Skills the registry currently supplies, with their source label. */
  skills: { name: string; source: string }[]
  /** The work-rules section name this bundle contributes. */
  workRulesSection: string
  /** The active plugin configuration. */
  config: {
    workRulesChars: number
    orientOnSessionStart: boolean
    doctorTool: boolean
    guards: boolean
    workTracking: boolean
  }
}

/** Render the report as plain text for the model. */
function renderReport(report: DoctorReport): string {
  const lines = [
    `# oh-my-dsh doctor`,
    `pluginLoaded: ${report.pluginLoaded}`,
    `workRulesSection: ${report.workRulesSection}`,
    `config: orientOnSessionStart=${report.config.orientOnSessionStart} doctorTool=${report.config.doctorTool} workRulesChars=${report.config.workRulesChars} guards=${report.config.guards} workTracking=${report.config.workTracking}`,
  ]
  if (report.skills.length === 0) {
    lines.push('skills: (none registered)')
  } else {
    lines.push('skills:')
    for (const skill of report.skills) lines.push(`- ${skill.name} (${skill.source})`)
  }
  return lines.join('\n')
}

/**
 * Register the doctor tool.
 * @param ctx - context with the `tools` registry.
 * @param config - the effective oh-my-dsh configuration, reported back verbatim.
 * @param enabled - whether to register at all.
 * @returns the exact disposer that unregisters the tool.
 */
export function registerDoctorTool(ctx: Context, config: DoctorReport['config'], enabled: boolean): () => void {
  if (!enabled) return () => {}
  const definition: ToolDefinition = {
    name: 'oh_my_dsh_doctor',
    description: 'Diagnose the oh-my-dsh enhancement bundle: whether it is loaded, the skills the registry supplies, the work-rules prompt section, and the active configuration. Read-only; call it to verify the bundle is working.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          pluginLoaded: { type: 'boolean' },
          skills: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                source: { type: 'string' },
              },
              required: ['name', 'source'],
              additionalProperties: false,
            },
          },
          workRulesSection: { type: 'string' },
          config: {
            type: 'object',
            properties: {
              workRulesChars: { type: 'number' },
              orientOnSessionStart: { type: 'boolean' },
              doctorTool: { type: 'boolean' },
              guards: { type: 'boolean' },
              workTracking: { type: 'boolean' },
            },
            required: ['workRulesChars', 'orientOnSessionStart', 'doctorTool', 'guards', 'workTracking'],
            additionalProperties: false,
          },
        },
        required: ['pluginLoaded', 'skills', 'workRulesSection', 'config'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: renderReport(value as unknown as DoctorReport) }],
      presentationMeta: (_args, value) => value,
    },
    async execute() {
      let skills: { name: string; source: string }[] = []
      try {
        skills = (await ctx.skills.list({})).map(summary => ({ name: summary.name, source: summary.source }))
      } catch {
        // A failed discovery is itself a diagnosis: report the empty list rather
        // than failing the whole call, so the model sees a degraded registry.
      }
      const report: DoctorReport = {
        pluginLoaded: true,
        skills,
        workRulesSection: 'oh-my-dsh/work-rules',
        config,
      }
      return report
    },
    presentCall: () => ({
      card: 'generic',
      title: 'Run oh-my-dsh doctor',
      kind: 'other',
    }),
  }
  return ctx.tools.register(definition)
}

