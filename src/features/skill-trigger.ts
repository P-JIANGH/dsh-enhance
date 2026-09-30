/**
 * skill-trigger routing (architecture §5.4): declarative input-intent → mode
 * injection. Currently ships the `ulw` / `ultrawork` (deep-work) trigger: when a
 * user prompt mentions the trigger word, the ultrawork entry contract is
 * injected ahead of the model's first step.
 *
 * The entry contract source of truth is `prompts/modes/ultrawork.md`; the text is
 * mirrored here as a module constant so runtime injection never depends on a
 * filesystem layout that changes after packaging.
 *
 * @module dsh-enhance/features/skill-trigger
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'

/**
 * The ultrawork entry contract injected on trigger.
 *
 * Single source: `prompts/modes/ultrawork.md` — the text is exactly what follows
 * the `<ultrawork-mode>` marker in that file, trimmed. It is mirrored here as a
 * module constant so runtime injection never depends on a filesystem layout that
 * changes after packaging; `tests/skill-trigger.test.mjs` pins the two together,
 * so editing the `.md` without updating this constant goes red.
 */
export const ULTRAWORK_ENTRY = `<ultrawork-mode>

## 总则
本模式用于重大任务：先彻底理解，再规划，再执行，全程留下可验证证据。禁止在理解不足时动手。

## 一、动手前确认（不可跳过）
1. 写任何代码前必须同时满足：完全理解用户真实意图（而非假设）；已读文件核实事实（上下文/会话记录不一定是事实，以代码、配置、AGENTS.md、测试为准）；已探索代码库；有清晰工作计划；所有歧义已解决。
2. 确认阶段尽可能多提问：把范围、验收标准、约束、偏好逐项问清楚，列成问题清单请用户确认；宁可多问，不要假设。
3. 出现以下任一信号 = 没准备好：在猜需求；不确定改哪些文件；不理解现有代码如何工作；计划里有"大概/可能"；说不出具体执行步骤。
4. 没准备好时按序处理：深入思考 → 全面探索 → 咨询可用专家 → 仍不确定就问用户，禁止猜。

## 二、交付边界（不可妥协）
5. 用户要 X 就交付 X。禁止：缩减范围的简化版/演示版、留待以后的骨架、声称"受限于…"、擅自假设、提前停手说"可后续扩展"。
6. 遇阻塞：不放弃、不交付妥协版；按序尝试：咨询专家 → 探索替代方案 → 向用户说明并请求指引。

## 三、委派与执行方式
7. 动手前先盘点可用技能，选用真正适用的并说明理由（一行即可）；任务匹配却未用的技能 = 缺陷。
8. 能委派就委派：探索、查证、规划、难题咨询优先交给对应 agent/技能；只有任务极简单、上下文已全载、或委派开销超过任务本身时才自己做。

## 四、规划（非平凡任务强制）
9. 满足任一条件必须先规划再动手：步骤 ≥2；范围不清；需要实现；涉及架构决策。
10. 先估规模（surface 数、文件数、步骤数）再决定是否规划；计划必须包含按依赖排序的执行波次、每步验证方式、结构化待办。
11. 执行严格按计划的波次顺序与并行分组；不得自创顺序或跳过其验证。
12. 规划 agent 的追问/补充用其 continuation id 续接，不另起新会话（保留上下文、省 token）。

</ultrawork-mode>

> 进入执行后，只牢记三条最小护栏（避免中段规则混淆）：**一个 in_progress、做完即验证、增量即提交**。完整的证据/QA/零容忍纪律在交付前回归审查时集中核对（见 \`docs/prompts-review/ultrawork-review.md\`）。`

/**
 * Detect whether a prompt asks for the deep-work (`ultrawork`) mode.
 * Word-boundary matching avoids substring false positives: `ulw` / `ultrawork`
 * only match as whole words, so "anultraworkflow" or "bulwrap" never trigger.
 * @param input - the raw user prompt text.
 * @returns true when the deep-work trigger word is present.
 */
export function detectUlw(input: string): boolean {
  if (!input) return false
  // eslint-disable-next-line no-control-regex
  return /\bulw\b|\bultrawork\b/i.test(input)
}

/** Relay a UserMessage body into plain text (best-effort, for trigger scanning). */
function bodyToText(msg: { content?: ReadonlyArray<{ type: string; text?: string }> }): string {
  if (!Array.isArray(msg.content)) return ''
  return msg.content.map((block) => ('text' in block && typeof block.text === 'string' ? block.text : '')).join('\n')
}

/** skill-trigger routing options. */
export interface SkillTriggerOptions {
  /** Master switch: false installs a no-op and skips the listener. Default on. */
  enabled: boolean
  /** The exact entry-contract text to inject on trigger (defaults to {@link ULTRAWORK_ENTRY}). */
  entry?: string
}

/**
 * Register the skill-trigger pre-step listener: when a user prompt contains the
 * `ulw` / `ultrawork` trigger, the ultrawork entry contract is injected ahead of
 * the model's first step (once per agent, idempotent via a live-set).
 * @param ctx - context broadcasting `agent/pre-step`.
 * @param options - trigger behavior.
 * @returns the exact disposer that removes the listener.
 */
export function registerSkillTrigger(ctx: Context, options: SkillTriggerOptions): () => void {
  if (!options.enabled) return () => {}
  const entry = options.entry ?? ULTRAWORK_ENTRY
  /** Agents that already received the contract this process lifetime. */
  const primed = new Set<string>()

  return ctx.on('agent/pre-step', async ({ agent, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || step !== 1) return decision
    // Skip companion/advisor children: they are peer reviewers, not executors,
    // and must not receive the executor-only deep-work entry contract.
    if (typeof agent.id === 'string' && agent.id.endsWith('__advisor')) return decision
    // The first step's messages carry the user's fresh prompt; scan their text.
    const input = decision.messages.map(bodyToText).join('\n')
    if (!detectUlw(input)) return decision
    if (primed.has(agent.id)) return decision
    primed.add(agent.id)
    return {
      kind: 'enter',
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: entry }],
          source: { kind: 'user' },
        }),
        ...decision.messages,
      ],
    }
  })
}
