/**
 * 人可见指令面（human commands）：把 dsh-enhance 的只读状态做成 `/` 菜单里的条目，
 * 让用户不必经过模型就能确认插件在工作。
 *
 * 为什么需要它：本包的能力面几乎全是「模型可见」的——提示词段、技能、模型工具、
 * 钩子；用户在 UI 里没有任何属于本包的入口（实机上表现为「装了插件但感知不到」）。
 * 上游 `@deepseek-ai/dsh-commands` 的 `ctx.commands.register` 正是补这一层的地方。
 *
 * 契约要点（上游 README / d.ts）：指令由 UI adapter 直接渲染，**不进入模型历史、
 * 不消耗 token**；未声明 `input` 的指令在客户端是 `execute` 派发（回车即执行）；
 * 同一层重名会在注册时失败——所以名字必须先确认无冲突（当前上游占用
 * compact / feedback / goal / plan / export / permission）。
 *
 * @module dsh-enhance/features/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import { collectDoctorReport, renderReport, type DoctorReport } from '../tools/doctor.js'
import { readBoulder } from './boulder/store.js'
import { readWriteToken } from './boulder/write-token.js'
import {
  PRESETS_SOURCE,
  defaultPresetRoot,
  installPresets,
  planPresetInstall,
  renderInstallReport,
  renderPresetStatus,
} from './presets/install.js'

/** 本包注册的指令名（不含前导斜杠）。 */
export const COMMAND_NAMES: readonly string[] = ['doctor', 'boulder', 'presets']

/** 人可见指令面的选项。 */
export interface HumanCommandOptions {
  /** 总开关：false 时一条都不注册（doctor 回显里显示为「指令=关」）。 */
  enabled: boolean
  /** 工作追踪开关：关闭时不注册 `/boulder`——它没有可读的状态。 */
  workTracking: boolean
  /** `/doctor` 回显用的生效配置（与模型侧 doctor 工具同一份）。 */
  doctorConfig: DoctorReport['config']
  /** advisor 是否开启：`/doctor` 的「下一步建议」需要它。 */
  advisorEnabled: boolean
  /** 预设源目录（默认本包打包的 `presets/`；供单测注入）。 */
  presetsSource?: string
  /** 预设目标根（默认 `$DSH_HOME/.agent-presets`；供单测注入）。 */
  presetRoot?: string
}

/** 取会话仓库根：优先会话自身 cwd，缺失时退回进程 cwd。 */
function repoBaseOf(agent: { session?: { header?: { cwd?: string } } } | undefined): string {
  return agent?.session?.header?.cwd ?? process.cwd()
}

/**
 * 渲染 boulder 工作追踪状态（只读）。
 *
 * 状态文件路径一并给出，用户才能自己去看 `.dsh-enhance/boulder.json`
 * （该目录被 `.gitignore` 覆盖，不会污染仓库根）。
 *
 * @param repoRoot - 仓库根；状态文件为 `<repoRoot>/.dsh-enhance/boulder.json`。
 * @returns 可直接渲染到 UI 的中文文本。
 */
export function renderBoulderStatus(repoRoot: string): string {
  const { state, file } = readBoulder(repoRoot)
  const holder = readWriteToken(state)
  const works = Object.values(state.works).sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
  const lines = [
    '# dsh-enhance 工作追踪',
    `状态文件：${file}`,
    `写令牌持有者：${holder ?? '无'}`,
    `进行中的工作：${state.active_work_id ?? '无'}`,
  ]
  if (works.length === 0) {
    lines.push('工作项：无（模型侧可用 boulder_start 开始一项受追踪的工作）')
  } else {
    lines.push(`工作项（${works.length}）：`)
    for (const w of works) {
      const bits = [`[${w.status}]`]
      if (w.goal_id) bits.push(`goal=${w.goal_id}`)
      if (w.verify) bits.push(`verify=${w.verify}`)
      if (w.worktree_path) bits.push(`worktree=${w.worktree_path}`)
      lines.push(`- ${w.id} ${bits.join(' ')} 更新于 ${new Date(w.updated_at ?? 0).toISOString()}`)
    }
  }
  const reports = (state.completion_log ?? []).length
  if (reports > 0) lines.push(`交付报告（completion_log）：${reports} 条`)
  return lines.join('\n')
}

/** 预设安装与状态共用的源/目标解析（单测可注入）。 */
function presetArgs(options: HumanCommandOptions): { sourceRoot: string; targetRoot: string } {
  return {
    sourceRoot: options.presetsSource ?? PRESETS_SOURCE,
    targetRoot: options.presetRoot ?? defaultPresetRoot(),
  }
}

/** 计算预设计划（纯读）。 */
function presetPlan(options: HumanCommandOptions, pruneRenamed = false) {
  return planPresetInstall({ ...presetArgs(options), pruneRenamed })
}

/** `/doctor` 用的一行预设状态：用户不必猜"预设到底装没装"。 */
function presetSummaryLine(options: HumanCommandOptions): string {
  try {
    const plan = presetPlan(options)
    const missing = plan.entries.filter(entry => entry.action !== 'up-to-date').length
    return missing === 0
      ? `预设：${plan.entries.length} 个已就绪（目标 ${plan.targetRoot}）`
      : `预设：${missing}/${plan.entries.length} 个未安装或已过期 —— 执行 /presets install（目标 ${plan.targetRoot}）`
  } catch (error) {
    return `预设：状态读取失败（${error instanceof Error ? error.message : String(error)}）`
  }
}

/**
 * 注册人可见指令（`/doctor`、`/boulder`）。
 *
 * 两条都是纯读：`/doctor` 复用模型侧诊断的同一份报告与渲染器，`/boulder` 读
 * `.dsh-enhance/boulder.json`。注册为**全局**（apply 的普通 ctx），任何会话都可用。
 *
 * @param ctx - 具备 `commands` 服务的上下文。
 * @param options - 开关与回显配置。
 * @returns 精确的 disposer：注销本次注册的每一条指令。
 */
export function registerHumanCommands(ctx: Context, options: HumanCommandOptions): () => void {
  if (!options.enabled) return () => {}
  const disposers: Array<() => void> = [
    ctx.commands.register({
      name: 'doctor',
      description: '诊断 dsh-enhance 装配状态：插件加载、打包技能、工作准则段落与生效配置（只读，不进入模型历史）',
      async handler() {
        const report = await collectDoctorReport(ctx, options.doctorConfig)
        const text = renderReport(report, options.advisorEnabled, COMMAND_NAMES)
        return { kind: 'success', text: `${text}\n${presetSummaryLine(options)}` }
      },
    }),
  ]
  if (options.workTracking) {
    disposers.push(ctx.commands.register({
      name: 'boulder',
      description: '显示 dsh-enhance 工作追踪状态：写令牌持有者、进行中的工作与工作项（只读，不进入模型历史）',
      handler(invocation) {
        return { kind: 'success', text: renderBoulderStatus(repoBaseOf(invocation.agent)) }
      },
    }))
  }
  // 预设装机是「显式动作」：插件不会在启动时暗中写用户家目录（写盘的另一半是
  // 安装期的 postinstall，见 scripts/install-presets.mjs --if-installed）。
  disposers.push(ctx.commands.register({
    name: 'presets',
    description: '查看或安装 dsh-enhance 的 Agent 预设（「Enhance 模式」+ 5 个角色预设）：把包内 presets/ 幂等地装进 $DSH_HOME/.agent-presets，覆盖或清理前先备份',
    input: { hint: '[install [prune] | status]' },
    handler(invocation) {
      const sub = String(invocation.rawInput ?? '').trim().toLowerCase()
      try {
        if (sub === '' || sub === 'status') {
          return { kind: 'success', text: renderPresetStatus(presetPlan(options)) }
        }
        if (sub === 'install' || sub === 'install prune' || sub === 'prune') {
          const result = installPresets({ ...presetArgs(options), pruneRenamed: sub.includes('prune') })
          return { kind: 'success', text: renderInstallReport(result) }
        }
        return { kind: 'error', text: `未知子命令「${sub}」。用法：/presets [install [prune] | status]` }
      } catch (error) {
        return { kind: 'error', text: `预设操作失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }))
  return () => { for (const dispose of disposers) dispose() }
}
