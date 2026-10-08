/**
 * dsh-enhance: an oh-my-zsh-style enhancement bundle for DeepSeek Harness.
 * One installable plugin that contributes packaged skills, a persistent
 * work-rules prompt section, a session-start orientation hook, human commands,
 * and a doctor tool. Everything is configurable through the plugin row's
 * `config`.
 * @module dsh-enhance
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { registerDoctorTool } from './tools/doctor.js'
import { registerSessionStartHook } from './hooks/orient.js'
import { registerWorkRules } from './hooks/work-rules.js'
import { registerSkillsProvider } from './features/skills-provider.js'
import { registerToolGuards } from './tools/guard-register.js'
import { registerWriteTokenGuard } from './tools/write-token-guard.js'
import { registerBoulderTools } from './tools/boulder-tools.js'
import { registerWorktreeTools } from './tools/worktree-tools.js'
import { registerRulesInjector } from './hooks/rules-injector.js'
import { registerStartWorkHook } from './hooks/start-work.js'
import { registerDeliveryGateHook } from './hooks/delivery-gate.js'
import { registerSkillTrigger } from './features/skill-trigger.js'
import { registerAdvisorRuntime } from './features/advisor/runtime.js'
import { registerHumanCommands, COMMAND_NAMES } from './features/commands.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The Loader committed a `volatile()`-only config change in place instead
     * of re-applying the plugin (`cordis-plugin-loader`'s `Entry._commitVolatile`).
     * Emitted on the owning plugin's own fiber, so only that plugin hears it.
     */
    'loader/volatile-update': (paths: string[][]) => void
  }
}

/** Cordis plugin name. */
export const name = 'dsh-enhance'

/**
 * Services this plugin waits for before activating.
 *
 * `commands` is the registry behind the UI `/` menu and `goals` is the native
 * same-session goal service; both belong to the shipped `dsh-base` bundle like
 * the other five, so requiring them adds no new class of deployment requirement
 * (a bundle-less deployment has no skills or tools either). Without `commands`
 * the human surface cannot exist; without `goals` the delivery gate would lose
 * its completion-claim disambiguator.
 */
export const inject = ['skills', 'systemPrompt', 'tools', 'agents', 'llm', 'commands', 'goals']

/** Default work-rules prose: general working discipline, project-agnostic. */
export const DEFAULT_WORK_RULES = `# 工作准则
1. 仓库约定优先：改代码前先读 AGENTS.md、README 与贡献指南；优先沿用现有函数与既有模式，不新造机制。
2. 先搜索后提问：查工作区与历史记录之后仍无解，才问用户。
3. 小步可审查：每次改动小而聚焦，保持可独立评审与测试。
4. 诚实报告：失败就报失败，附上确切错误与下一步尝试。
5. 最小化改动：不留死代码、不留调试输出，改动对称。
6. 事实永远在文件：上下文/会话记录不一定是事实；关键事实以文件为准（代码、配置、AGENTS.md、测试），行动前先读文件核实。
7. 不臆想、不编造：信息不足时多提问，不猜；宁可多问，不要假设。`

/**
 * Plugin configuration as a profile document writes it: plain values, every
 * field optional. This is the shape a user edits in the profile patch and the
 * shape `dsh_enhance_doctor` echoes back. At runtime the fields marked
 * `volatile()` in {@link Config} reach {@link apply} as accessors instead —
 * see {@link ResolvedConfig}.
 */
export interface Config {
  /** Work-rules prose for the persistent prompt section. Empty text drops the section at render. */
  workRules?: string
  /** Inject a one-time orientation message at each session start, naming the packaged skills. */
  orientOnSessionStart?: boolean
  /** Register the model-facing dsh_enhance_doctor diagnostic tool. */
  doctorTool?: boolean
  /**
   * Register the human-command surface (`/doctor`, `/boulder`) into the UI
   * command registry. Results render in the UI only — no model tokens, no
   * session-log payload. Default on.
   */
  commands?: boolean
  /**
   * Master switch for the security/quality guard hooks (write-existing,
   * path-traversal, bash-file-read, output truncator, rules injector) and the
   * delivery gate. Architecture §5.2/§5.3. Default on.
   */
  guards?: boolean
  /**
   * Master switch for work tracking (boulder storage, write token, start-work /
   * delivery-gate hooks). Architecture §5.5. Goals are the native `ctx.goals`
   * service and are unaffected by this switch. Default on.
   */
  workTracking?: boolean
  /**
   * Worktree support (architecture §5.6): worktree_create/list/cleanup tools and
   * the start-work "you are in a worktree" continuation note. Requires
   * workTracking (boulder records own the worktree_path). Default on.
   */
  worktree?: boolean
  /**
   * Advisor companion-review runtime (the 6th agent / advisor mode): spawns a
   * peer-shadow sub-agent per main session that reviews transcript increments
   * and steers/injects suggestions back. Default on.
   */
  advisor?: boolean
  /** Independent model for the advisor sub-agent. Undefined → inherit the main route. */
  advisorModel?: string
}

/**
 * Runtime schema for the plugin row.
 *
 * The eight user-facing fields are `volatile()`: the Host's configuration form
 * owns them, renders them on the Plugins page (`plugins.row.config`, keyed by
 * `<package>#<row id>`, see `docs/design-web-settings-card.md`), and writes a
 * change back into this profile's patch, which hot-reloads this entry — so a
 * toggle takes effect without a restart. `workRules` stays a plain document
 * value: it is long prose, not a switch, and is edited in the patch itself.
 */
export const Config = z.object({
  workRules: z.string().default(DEFAULT_WORK_RULES),
  orientOnSessionStart: z.boolean().default(true).volatile(),
  doctorTool: z.boolean().default(true).volatile(),
  commands: z.boolean().default(true).volatile(),
  guards: z.boolean().default(true).volatile(),
  workTracking: z.boolean().default(true).volatile(),
  worktree: z.boolean().default(true).volatile(),
  advisor: z.boolean().default(true).volatile(),
  advisorModel: z.string().volatile(),
})

/** One `volatile()` field as schemastery resolves it: an accessor the settings surface updates in place. */
interface VolatileField<T> {
  /** @returns the field's current value. */
  get(): T
}

/**
 * Plugin configuration as the Loader hands it to `apply`: the plain document
 * fields, and an accessor for each `volatile()` field. Upstream
 * `dsh-agent-loop` reads its own volatile `maxParallelToolCalls` the same way.
 */
export interface ResolvedConfig {
  /** @see Config.workRules */
  workRules?: string
  /** @see Config.orientOnSessionStart */
  orientOnSessionStart?: VolatileField<boolean>
  /** @see Config.doctorTool */
  doctorTool?: VolatileField<boolean>
  /** @see Config.commands */
  commands?: VolatileField<boolean>
  /** @see Config.guards */
  guards?: VolatileField<boolean>
  /** @see Config.workTracking */
  workTracking?: VolatileField<boolean>
  /** @see Config.worktree */
  worktree?: VolatileField<boolean>
  /** @see Config.advisor */
  advisor?: VolatileField<boolean>
  /** @see Config.advisorModel */
  advisorModel?: VolatileField<string>
}

/**
 * Read one configuration field, whichever shape it arrived in.
 * @param field - a plain document value, a `volatile()` accessor, or absent.
 * @returns the field's current plain value.
 */
function fieldValue<T>(field: T | VolatileField<T> | undefined): T | undefined {
  if (field === undefined) return undefined
  if (typeof field === 'object' && field !== null && typeof (field as VolatileField<T>).get === 'function') {
    return (field as VolatileField<T>).get()
  }
  return field as T
}

/** One generation of the feature wiring: re-mounted whenever a `volatile()` field changes. */
const Features: Plugin<ResolvedConfig> = {
  name: 'dsh-enhance/features',
  apply: applyFeatures,
}

/**
 * Apply the dsh-enhance bundle to one context.
 *
 * Every switch here gates a *registration* (tools, commands, hooks, the
 * advisor runtime). The Loader adopts a `volatile()` change without
 * re-applying this plugin: it commits the new value into the field accessors
 * in place and emits `loader/volatile-update` on this plugin's own fiber
 * (`cordis-plugin-loader`'s `Entry._commitVolatile`). Left alone, a toggle
 * would therefore stay inert until the next restart, so the feature wiring
 * lives in a child plugin that is unmounted and re-mounted on that event. A
 * deployment whose loader never emits the event degrades to exactly that: the
 * value is stored and applies at the next start.
 *
 * @param ctx - context with the `skills`, `systemPrompt`, `tools` and `commands` services.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: ResolvedConfig): void {
  let mounted = ctx.plugin(Features, config)
  let queue: Promise<void> = Promise.resolve()
  ctx.on('loader/volatile-update', () => {
    queue = queue
      .then(async () => {
        const previous = mounted
        await previous.dispose()
        mounted = ctx.plugin(Features, config)
      })
      .catch((error: unknown) => {
        ctx.logger.warn('dsh-enhance: rebuilding the feature wiring after a settings change failed')
        ctx.logger.warn(error)
      })
  })
}

/**
 * Register the whole feature surface for the configuration as it stands now.
 * @param ctx - the child context owning this generation's registrations.
 * @param config - validated plugin configuration; volatile fields are read here.
 */
function applyFeatures(ctx: Context, config: ResolvedConfig): void {
  const workRules = config.workRules ?? ''
  const orientOnSessionStart = fieldValue(config.orientOnSessionStart) ?? true
  const doctorTool = fieldValue(config.doctorTool) ?? true
  const commands = fieldValue(config.commands) ?? true
  const guards = fieldValue(config.guards) ?? true
  const workTracking = fieldValue(config.workTracking) ?? true
  const worktree = fieldValue(config.worktree) ?? true
  const advisor = fieldValue(config.advisor) ?? true
  const advisorModel = fieldValue(config.advisorModel)

  registerSkillsProvider(ctx)
  if (workRules) registerWorkRules(ctx, workRules)
  registerSessionStartHook(ctx, { enabled: orientOnSessionStart })

  // M3: tool guards (write-read/path-traversal) + rules injector.
  registerToolGuards(ctx, guards)
  registerRulesInjector(ctx, guards)

  // M4: boulder tools + start-work hook. Goals are native (`ctx.goals`), so this
  // bundle carries no goal storage and no goal tools of its own.
  registerBoulderTools(ctx, workTracking)
  registerStartWorkHook(ctx, workTracking)
  // §5.5.1: one writer per workspace — enforced at the tool pipeline, not just in
  // the state file. Only fires when an active boulder work has no worktree.
  registerWriteTokenGuard(ctx, workTracking)
  // M3: the delivery gate reads boulder + the native goal, so it rides the same switch.
  registerDeliveryGateHook(ctx, workTracking)

  // M5: worktree tools (depend on boulder linkage).
  registerWorktreeTools(ctx, workTracking && worktree)

  // §5.4: skill-trigger mode routing (ulw / ultrawork).
  registerSkillTrigger(ctx, { enabled: true })

  // §advisor: companion-review runtime (the 6th agent / advisor mode).
  registerAdvisorRuntime(ctx, { enabled: advisor, model: advisorModel })

  // The human surface: the only entry point that needs no model turn at all.
  registerHumanCommands(ctx, {
    enabled: commands,
    workTracking,
    doctorConfig: {
      workRulesChars: workRules.length,
      orientOnSessionStart,
      doctorTool,
      guards,
      workTracking,
      worktree,
      commands,
    },
    advisorEnabled: advisor,
  })

  registerDoctorTool(ctx, {
    workRulesChars: workRules.length,
    orientOnSessionStart,
    doctorTool,
    guards,
    workTracking,
    worktree,
    commands,
  }, doctorTool, advisor, COMMAND_NAMES)
}
