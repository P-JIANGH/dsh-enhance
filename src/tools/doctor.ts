/**
 * `dsh_enhance_doctor`: a model-facing diagnostic tool that reports the live
 * assembly state of the dsh-enhance bundle — whether the plugin is loaded, which
 * skills the registry currently supplies, which prompt section this bundle
 * contributes, and the effective configuration. Pure reads only; calling it
 * has no side effects.
 * @module dsh-enhance/doctor
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PROVIDER as BUNDLED_PROVIDER } from '../features/skills-provider.js'

/** One skill visible to the session, with its registry labels. */
export interface SkillEntry {
  name: string
  /** Registration label (`bundled`, `user-agents`, …) — NOT an owner signal. */
  source: string
  /** Provider that owns the body; this is the accurate ownership signal. */
  provider: string
}

/** The doctor tool's canonical output value. */
export interface DoctorReport {
  /** Whether the dsh-enhance plugin row is loaded in this process. */
  pluginLoaded: boolean
  /** Skills the registry currently supplies, with their source label. */
  skills: SkillEntry[]
  /** The work-rules section name this bundle contributes. */
  workRulesSection: string
  /** The active plugin configuration. */
  config: {
    workRulesChars: number
    orientOnSessionStart: boolean
    doctorTool: boolean
    guards: boolean
    workTracking: boolean
    worktree: boolean
    commands: boolean
  }
}

/**
 * Read the live report (pure reads; a failed skill discovery degrades to an
 * empty list instead of failing the whole report).
 * @param ctx - context with the `skills` registry.
 * @param config - the effective configuration, echoed back verbatim.
 * @returns the assembled report value.
 */
export async function collectDoctorReport(ctx: Context, config: DoctorReport['config']): Promise<DoctorReport> {
  let skills: SkillEntry[] = []
  try {
    skills = (await ctx.skills.list({})).map(summary => ({
      name: summary.name,
      source: summary.source,
      provider: summary.provider,
    }))
  } catch {
    // A failed discovery is itself a diagnosis: report the empty list rather
    // than failing the whole call, so the model sees a degraded registry.
  }
  return {
    pluginLoaded: true,
    skills,
    workRulesSection: 'dsh-enhance/work-rules',
    config,
  }
}

/**
 * Render the report as plain text for the model (中文小节式). 导出供单元测试。
 * @param report - the assembled report.
 * @param advisorEnabled - advisor runtime state (not part of the echo config).
 * @param humanCommands - command names this bundle registers, without the slash;
 *   empty when the human-command surface is off or the caller has none.
 */
export function renderReport(
  report: DoctorReport,
  advisorEnabled: boolean,
  humanCommands: readonly string[] = [],
): string {
  const lines = [
    '# dsh-enhance 诊断',
    `插件已加载：${report.pluginLoaded ? '是' : '否'}`,
    `工作准则段落：${report.workRulesSection}`,
    '生效配置：' +
      `会话开场提示=${report.config.orientOnSessionStart ? '开' : '关'} ` +
      `doctor 工具=${report.config.doctorTool ? '开' : '关'} ` +
      `工作准则长度=${report.config.workRulesChars} 字 ` +
      `守卫=${report.config.guards ? '开' : '关'} ` +
      `工作追踪=${report.config.workTracking ? '开' : '关'} ` +
      `worktree=${report.config.worktree ? '开' : '关'} ` +
      `人类指令=${report.config.commands ? '开' : '关'} ` +
      `advisor=${advisorEnabled ? '开' : '关'}`,
  ]
  // The human-command surface is the one entry point the user sees without the
  // model, so the diagnosis names it whenever it is live.
  if (report.config.commands && humanCommands.length > 0) {
    lines.push(`人类指令（${humanCommands.length}）：${humanCommands.map(n => `/${n}`).join('、')}（在输入框打 / 可见）`)
  }
  if (report.skills.length === 0) {
    lines.push('技能：无（检查插件装配是否完整）')
  } else {
    // Separate "what this bundle contributes" from "what else is visible": a
    // profile can expose several unrelated providers, and reporting them all as
    // this plugin's skills is exactly the misattribution users notice.
    const ours = report.skills.filter(s => s.provider === BUNDLED_PROVIDER)
    const others = report.skills.filter(s => s.provider !== BUNDLED_PROVIDER)
    lines.push(ours.length > 0
      ? `本插件打包技能（${ours.length}）：${ours.map(s => s.name).join('、')}`
      : '本插件打包技能：无（检查插件装配是否完整）')
    if (others.length > 0) {
      lines.push(`会话内其它来源技能：${others.length} 个（非本插件提供，如需详情见 skill 工具）`)
    }
  }
  const next = suggestNext(report.config, advisorEnabled)
  if (next.length > 0) {
    lines.push('下一步建议：')
    for (const s of next) lines.push(`- ${s}`)
  }
  return lines.join('\n')
}

/** 可执行下一步建议，由现有 config 开关驱动（不新增配置）。 导出供单元测试。 */
export function suggestNext(config: DoctorReport['config'], advisorEnabled: boolean): string[] {
  const out: string[] = []
  if (!config.guards) out.push('守卫已关闭：开启 guards 以启用写保护与交付门。')
  if (!config.workTracking) out.push('工作追踪已关闭：开启后可建 goal/boulder 追踪工作进度。')
  if (!config.worktree) out.push('worktree 已关闭：开启后可为每项工作建立独立工作区。')
  if (!config.commands) out.push('人类指令已关闭：开启后可在输入框打 / 直接调用 /doctor、/boulder。')
  if (!advisorEnabled) out.push('advisor 已关闭：开启后每轮结束有伴随审查建议。')
  if (!config.orientOnSessionStart) out.push('会话开场提示已关闭：开启后每次会话有入场引导。')
  if (out.length === 0) out.push('一切就绪：可用 /doctor 看装配、/boulder 看工作追踪，或输入 ulw 进入深度工作模式。')
  return out
}

/**
 * Register the doctor tool.
 * @param ctx - context with the `tools` registry.
 * @param config - the effective dsh-enhance configuration, reported back verbatim.
 * @param enabled - whether to register at all.
 * @param advisorEnabled - advisor runtime switch (drives the 下一步建议 without
 *   widening the output schema).
 * @param humanCommands - command names this bundle registers (rendered in the
 *   report; empty when the surface is off).
 * @returns the exact disposer that unregisters the tool.
 */
export function registerDoctorTool(
  ctx: Context,
  config: DoctorReport['config'],
  enabled: boolean,
  advisorEnabled = false,
  humanCommands: readonly string[] = [],
): () => void {
  if (!enabled) return () => {}
  const definition: ToolDefinition = {
    name: 'dsh_enhance_doctor',
    description: '诊断 dsh-enhance 增强包的装配状态：插件是否加载、注册的技能、工作准则段落与生效配置，并给出可执行的下一步建议。只读；调用它即可确认插件工作正常。',
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
                provider: { type: 'string' },
              },
              required: ['name', 'source', 'provider'],
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
              worktree: { type: 'boolean' },
              commands: { type: 'boolean' },
            },
            required: ['workRulesChars', 'orientOnSessionStart', 'doctorTool', 'guards', 'workTracking', 'worktree', 'commands'],
            additionalProperties: false,
          },
        },
        required: ['pluginLoaded', 'skills', 'workRulesSection', 'config'],
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderReport(value as unknown as DoctorReport, advisorEnabled, humanCommands),
      }],
      presentationMeta: (_args, value) => value,
    },
    async execute() {
      return collectDoctorReport(ctx, config)
    },
    presentCall: () => ({
      card: 'generic',
      title: '运行 dsh-enhance 诊断',
      kind: 'other',
    }),
  }
  return ctx.tools.register(definition)
}
