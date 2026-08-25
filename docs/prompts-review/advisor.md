# advisor 模式（伴随审核模型）—— 审查稿（草案，待用户确认源材料）

> 状态：草案。advisor 的真正出处是 **oh-my-pi（omp）**——它是主模型的**伴随审核模型**（peer-shadow main agent），与主模型并行、独立于主会话，逐条审查主对话增量并通过 `advise` 工具回注建议。
> 这与按需委派的 oracle/metis（见文末"易混淆来源"）从架构上不同，审查源材料应取 omp 的 advisor 实现。

## 源材料（已核实，oh-my-pi 仓库）

| 文件 | 作用 |
|---|---|
| `F:\oh-my-pi\docs\advisor-watchdog.md` | advisor 子系统总设计文档（启用、工具隔离、advise 严重度、emission guard、WATCHDOG.md/yml） |
| `F:\oh-my-pi\packages\coding-agent\src\prompts\advisor\system.md` | advisor 系统提示词（审查准则、通信纪律、nit/concern/blocker 语义） |
| `F:\oh-my-pi\packages\coding-agent\src\advise-tool.md` | `advise` 工具说明 |
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

## 审查框架（沿用各提示词统一流程）

1. 源材料 = 上表 omp advisor 文件（system.md 为主体）。
2. 提取：列出 system.md 的每条可执行约束（审查准则、communication、critical 禁条、nit/concern/blocker 判定）。
3. 中文重写（精简）：行为语义保留，不保留惯用法。
4. 精简校验、行为守恒映射、实驱验证同统一流程。

## 对 oh-my-dsh 的移植可行性（已核实 dsh 能力）

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

**需 M1 实驱确认的点**（非可行性风险，是接线细节）：
1. `agent/request` 内返回替换 `LlmCallConfig.model` 是否仅影响该次调用（隔离 advisor 模型）还是全局——实测确认。
2. `ctx.agents.create()` 创建的 advisor 子会话是否回归影响 `roots()`/工具面（advisor 不应作为可见子 agent）。
3. `agent.steer` 在 `pre-step`/`turn-stopping` 内调用的时序与重入约束。


## 易混淆来源（已纠正）

- **oracle / metis 不是"advisor 模式"**：它们是 oh-my-openagent（omo）按需委派的独立顾问 agent（oracle=战略技术顾问、metis=预规划顾问），带 `category: "advisor"` 元数据标签，但与 omp 的伴随 advisor 是不同架构。上一版占位稿将二者列为源材料，系误判，已更正。
