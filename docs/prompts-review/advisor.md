# advisor 模式（伴随审核模型）—— 审查稿（定稿）

> 状态：定稿（2026-08-25 审查通过，移植形态：随 oh-my-pi(M4/M1) 落地时按本稿执行）。advisor 的真正出处是 **oh-my-pi（omp）**——它是主模型的**伴随审核模型**（peer-shadow main agent），与主模型并行、独立于主会话，逐条审查主对话增量并通过 `advise` 工具回注建议。
> 这与按需委派的 oracle/metis（见文末"易混淆来源"）从架构上不同，审查源材料应取 omp 的 advisor 实现。

## 源材料（已核实，oh-my-pi 仓库）

| 文件 | 作用 |
|---|---|
| `F:\oh-my-pi\docs\advisor-watchdog.md` | advisor 子系统总设计文档（启用、工具隔离、advise 严重度、emission guard、WATCHDOG.md/yml） |
| `F:\oh-my-pi\packages\coding-agent\src\prompts\advisor\system.md` | advisor 系统提示词（审查准则、通信纪律、nit/concern/blocker 语义） |
| `F:\oh-my-pi\packages\coding-agent\src\prompts\advisor\advise-tool.md` | `advise` 工具说明（严重度、去重、在制品抑制） |
| `F:\oh-my-pi\packages\coding-agent\src\advisor\*.ts` | 运行时实现（runtime / advise-tool / emission-guard / watchdog / config） |

## Advisor 是什么（omp 原文要点）

- **伴随模型**：advisor 是附着到会话的一个或多个可选审核模型。它不批准操作、不直接变更主会话状态。
- **逐条审查**：主会话每次更新后，advisor 只收到自上次以来的增量 transcript（含思考、工具意图），用自己的只读工具（read/grep/glob，可用 WATCHDOG.yml 扩展）核查，再把简短建议注入回主会话。
- **advise 工具 + 严重度**：
  - `nit`：非打断旁注，下一步边界折叠
  - `concern`：打断式转向提示（有跑偏风险、缺约束、幻觉 API 等）
  - `blocker`：打断式停止建议（继续将明显浪费工作或产出坏结果）
- **隔离**：独立 Agent 实例 + 独立 ToolSession（`-advisor` 后缀），不共享主会话的文件快照/seen-lines/冲突状态。建议经 emission guard(去重/限频)。
- **WATCHDOG.md**：advisor 专属审查优先级（不进主上下文）；**WATCHDOG.yml**：advisor 名册（多 advisor、各自 model/tools/instructions）。
- **成本**：advisor 独立模型用量，`/advisor status` 报告。
- 关键边界：advisor **不是 peer**，不可被寻址/消息/复活；它只审查回注，不执行用户指令。

## 中文可执行约束清单（摘自 omp advisor `system.md`，行为语义保留）

> 审查范围：只围绕**正确性、边界 case、设计、流程**；用户意图是 executor 的领域，不越界。

**角色与边界**
- 是质量/稳健性拥护者，主模型的伴随影子；不批准操作、不直接改主会话状态。
- 激化策略与判断、指出更清晰的做法；挑战过早"完成"、过薄的验证、跳过推理。
- 覆盖被跳过的角度；**绝不重跑 executor 已有的推理**。在走错方向之前给建议。

**工作流**
- 收到会话增量（含思考）后：用**只读工具**（read/grep/glob）核查疑点，WATCHDOG.yml 可扩展授权。
- 每条 `advise` 用 2–3 次工具调用；确属关键 bug 才在报警前深查。

**通信纪律**
- 表面评论经 `advise`，每轮更新最多 1 条；agent 在正轨时宁可不发声。
- 直呼 agent，给可替代方案而非说教。
- 绝不复述 agent 已知信息（类型错误、LSP 诊断、失败的构建/测试、lint）。
- 绝不重复既往建议；同一主题再次触发前，先留出执行空隙。
- `[in progress — more steps follow]` = agent 未结束回合：不批判部分工作，只在"不可逆副作用正实时执行"时才提 `blocker`。
- 绝不挑剔用户已接受的东西：用户的话是事实、其挫折是正当的、其要求有约束力。

**critical 禁条（违反即缺陷）**
- 只对**具体技术风险**给建议；泛泛的不确定性、模糊不安、用户意图歧义 → 保持沉默。
- 绝不事后质疑 agent 已理解并承诺的决定，除非确凿。
- 绝不就意图/流程给建议：不叫 agent 去澄清、确认范围、先总结输入；不问需求是否清晰。
- 绝不干涉范围/野心：大面积 diff、整体重写、扩展计划本身不是问题；唯一例外 = 与 transcript 明确指令矛盾（如"最小改动"），此时须引用该指令。
- 除非用户或项目规则明确要求，绝不提向后兼容（不无端提出 breaking-change、deprecation shim、迁移路径、遗留回退、API 稳定性）。
- 只引用 transcript 证据或亲自检查过的工具输出；未渲染参数 = UNKNOWN：不断言具体值、数组下标、序列化形状或调用者错误。

**nit / concern / blocker 判定**
- **nit**：非紧急清理/重构/风格/错失机会，下一边界折叠，agent 继续。
- **concern**：agent 可能走错或漏材料问题——给观点但 agent 决策。适用于：错代码路径、脆弱优于健壮、未并行化明显可并行的请求、缺约束、即将焊死的边界 case、循环无进展的反复失败、用户多次纠正而 agent 未调整。
- **blocker**：停止/重新考虑。仅当继续明显会：违背明确 transcript 指令（引用它）；将来必须用户打断（agent 绕圈无解）；根本性不健全；把从没对用户真实需求验过的活当"完成"交差；刚承担的风险验证太薄；通过过度思考/兔子洞白白拖延用户目标。**报警前彻底核查**。
- 有足够把握后，MAY 给建议方案/修复，而非只警告。

## 对 dsh-enhance 的移植可行性（已核实 dsh 能力）

advisor 是**伴随模型架构**，三个硬性前提 dsh 均已具备（核实自 `F:\deepseek-harness\packages\core\agent` 与 `packages\core\tools` 类型定义）：

| omp advisor 前提 | dsh 对应能力 | 证据 |
|---|---|---|
| **并行第二模型/子会话** | `ctx.agents.create()`（`AgentRegistry`），`meta.origin: 'subagent'`、`parentSession`、`delegationDepth` 递归委派预算 | `@deepseek-ai/dsh-agent` index.ts `CreateAgentOptions`/`AgentFactory` |
| **主会话增量监听** | 事件面：`agent/inbox/claimed`（消息被取走）、`agent/pre-step`（waterfall，可看/拦截 `payload.messages`）、`agent/turn-stopping`（turn 关闭前回调） | runtime-types.d.ts L194-305 |
| **回注建议**（不直接改状态） | `agent.steer(message)`（"Submit steering for the nearest step"）；`agent.inject(...)` 排队 model-facing 上下文；`agent/turn-stopping` 文档明确 "a listener that objects steers (agent.steer(...))" | runtime-types.d.ts L117-132 |
| **独立审核模型调用** | `agent/request`（waterfall）每次 LLM 调用前可返回替换 `LlmCallConfig`（含 model）→ advisor 用独立模型 | runtime-types.d.ts L254-259 |
| **工具核查 + 只读隔离** | `ctx.tools.register()` + `tools/pre-execute`/`execute`/`post-execute`/`result` 事件 + `additionalContexts` 机制；工具运行时可取精确粒度 | `@deepseek-ai/dsh-tools` index.d.ts |
| 建议去重/限频（emission guard） | 插件侧实现（dsh 无内置等价物，需自建） | — |

**结论**：omp 式伴随 advisor 在 dsh **可实现**，且不需要退化到 oracle/metis 的按需委派路径。落地形态：

- 监听 `agent/pre-step` 或 `agent/inbox/claimed` 拿会话增量 → 交给一个由 `ctx.agents.create()` 拉的独立 advisor 子会话（独立 agentOptions.model）→ advisor 在隔离 ToolSession 用只读工具核查 → 结果通过 `agent.steer()` 回注主会话（severity 语义可映射：steer=concern/blocker，inject=nit）。
- 建议引入放到 `agent/turn-stopping`（turn 关闭前）交付，符合 "steer before boundary commits"。

**实施修订（2026-08-25 实驱后更新，覆盖上表"旁路驱动影子子会话"方案）**：
已实测确认：`ctx.agents.create()` 启动的影子子会话**无法被旁路唤醒驱动**——主 agent 结束一轮后，
用 `followup() + whenIdle()` 等旁路方式唤醒 advisor 影子子会话，其 turn 会空转（`turn/start → turn/end`
中间**没有 `step/start`**、`deriveMessages().length = 0`、`answerLen = 0`，无任何模型输出）。这是 dsh
平台对"常驻影子子 agent"的原生限制：影子子 agent 只能由主 agent 通过**显式 tool-call 委派**驱动，
不响应消息唤醒。tool-subagent 能工作正是因为它是按需 tool-call 驱动的，而伴随 advisor 是常驻旁听，
两者驱动机制不同。

因此落地实现改为**直接 `ctx.llm.stream()` 独立审查调用**（保留全部对外契约：`agent/turn-stopping`
监听 + 增量 transcript 提取 + severity 信封解析 + `nit→inject` / `concern|blocker→steer` 回注 +
emission guard 去重/限频）。实测通过：advisor 审查调用真实完成（`answerLen` 由 0 提升到 13），
输出 `ADVISOR: NONE` 合规信封（无风险不强打扰）。`runReviewCall(ctx.llm, GenerateOptions)` 组装
stream 文本并返回，纯逻辑可用假 LLM 单测。

**需 M1 实驱确认的点**（非可行性风险，是接线细节）：
1. `agent/request` 内返回替换 `LlmCallConfig.model` 是否仅影响该次调用（隔离 advisor 模型）还是全局——实测确认。
2. `ctx.agents.create()` 创建的 advisor 子会话是否回归影响 `roots()`/工具面（advisor 不应作为可见子 agent）。〔已解决：advisor 不再用 `ctx.agents.create()`，改用直接 stream 审查，天然不引入可见子 agent〕
3. `agent.steer` 在 `pre-step`/`turn-stopping` 内调用的时序与重入约束。


## 精简校验

| 项 | 值 |
|---|---|
| 原稿规模 | omp advisor system.md（78 行英文） |
| 本稿规模 | 中文可执行约束清单（角色/工作流/通信/critical/nit-concern-blocker，共约 30 行要点） |
| 达标（≤50%） | ✅ 行为语义全保留，仅去惯用法与重复 |
| 落地时机 | 随 omp 移植（M4/M1）实现 | 
| 用户准则注入 | 不适用（advisor 是审核模型，不直接面向用户指令执行） |

## 实驱验证状态

- **进行中（2026-08-26，headless 闭环已打通；web 可视化待观测）**：advisor 独立审查调用已在真实 dsh 会话多次实测——`context.llm.stream()` 审查调用真实完成（`answerLen` 由影子子会话的 0 提升到 13），本会话多次 headless 与 web 会话均稳定输出合规信封 `ADVISOR: NONE`（无风险时静默、不强打扰），severity 解析与 emission guard 正常。增量监听（`agent/turn-stopping`）+ severity 回注（steer/inject）+ 去重/限频已在 `src/features/advisor/runtime.ts` 落地，`runReviewCall` 有假 LLM 单测。
- **诚实标注（覆盖口径）**：真实会话中 advisor 均判 `ADVISOR: NONE`（审查的增量无技术风险），因此 **`nit`/`concern`/`blocker` 的正向回注（steer/inject 注入主会话并产生可见建议）尚未在真实会话中直接观测到**。机制（`deliver` 调 `main.inject`/`main.steer`，已被 kickReview 的 try/catch 兜底防 unhandled rejection）与解析/守卫已单测+按路径核实，但"回注在主对话可见"这一目标准确说来是"机制已就绪、正向触发待构造一个确会触发 concern 的真实审查来观测"。当前为"机制打通、正向回注效果待实证"状态。

---

## 易混淆来源（已纠正）

- **"按需委派的顾问 agent" ≠ 伴随 advisor**：部分 agent 生态（如 omp 之外的一些 harness 插件）会把"按需委派的外部顾问"（如战略技术顾问、预规划顾问）标为 advisor 类的元数据。那是主 agent 显式调用、响应一次的子 agent，与 omp 的伴随 advisor（常驻旁听、逐条审查、动态回注）是不同架构。本稿采用 omp 的伴随模型。
