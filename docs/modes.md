# dsh-enhance 三种工作模式/预设（modes）

> 状态：**设计定稿（设计评审稿，2026-08-26）**。本文把 dsh-enhance 的智能体能力整理为三种可选的**工作模式（mode / preset）**——dsh-enhance 万能、Planner 计划实施、Advisor 目标回归。三者共享同一套底层能力基底（一个 tool plane + 4 个专职 subagent + advisor 伴随运行时 + delivery-gate + boulder/goal 工作追踪），差异只在**编排层**：谁主导、按什么流程推进、如何处理"完成"。
> 关联文档：[roles.md](roles.md)（6 角色来源）、[architecture.md](architecture.md)（能力实现）、prompts-review/（各 persona/模式提示词稿）。
> 本文是**设计说明**；预设落点/QA 的验收口径由下文给出，落地以生成的 `cordis.patch.yml`（模式 A）与 `presets/roles.patch.yml`（角色预设）为准。

---

## 1. 核心主张：一个基底 + 三种编排

dsh-enhance 不把"6 角色"扁平铺开，而是用**一份统一预设基底 + 三种编排 persona**来表达。这样三种模式可以：

- **共享同一份已验证的 tool plane**（shell/fs/search/jobs/skills/goals/plan/compaction/delegation/ask-user/todo/web），不需要每个模式重造工具行；
- **共享同一份 subagent 专职清单**（scout / librarian / reviewer / task，各自 toolFilter 已收敛），三个模式都可用；
- **共享同一套运行时纪律**（work-rules 注入、guards + delivery-gate、boulder/goal 追踪、advisor 伴随审查、worktree/写令牌并发纪律）；
- 唯一改变的是**当前会话装配哪份 orchestrator persona**，决定"主模型如何编排它的子 agent 与流程"。

> 结论：三种模式是**同一插件、同一预设基底**上的三种 persona 装配，而非三套独立代码。这也解释了为什么现有 `preset-enhance` 已经承担了"万能模式"角色——它天然就是基底 + 主编排。

| 模式 | 主模型身价 | 编排风格 | 产出 | 何时选 |
|---|---|---|---|---|
| **dsh-enhance 万能**（默认） | 直接实施者 | 意图驱动，按需委派 | 完成的任务 | 一般任务、直接动手 |
| **Planner 计划实施** | 计划者 + 调度者 | 固定骨架工作流，顺序推进 | 计划 + 已确认的交付 | 复杂/多步/需要先规划确认 |
| **Advisor 目标回归** | 目标执行者 | goal 驱动，持续纠偏 + 结束回归闸 | 达成目标的交付 | 目标导向、长任务、要持续对齐 |

---

## 2. 共享的底层能力基底

无论选哪种模式，一个会话都会装载以下能力（细节见 `architecture.md` 5.2–5.7）：

1. **Tool plane**：完整工具面（shell/fs/search/jobs/skills/goals/plan/compaction/delegation/ask-user/todo/web），镜像 `standard` 预设——web 界面会禁用宿主 composition 里的 tool-* 行，会话必须自带工具面。
2. **专职 subagent（4 个）**，通过 `tool-subagent` 以 tool-call 委派驱动：
   - `subagent_scout`（只读：read/glob/grep）—— 映射仓库、盘点文件/模块、给紧凑工作区上下文；
   - `subagent_librarian`（只读：read/glob/grep）—— 定位外部依赖源码/文档、核实事实；
   - `subagent_reviewer`（只读：read/glob/grep）—— 以实际代码为依据做审查，阻塞性/改进分级；
   - `subagent_task`（读写：read/glob/grep/write/edit/todo_write）—— 聚焦执行一个明确小任务。
   - 通用 `subagent` / `subagent_fork`（fork 用于并行背景写者）也在 delegation 组内可用。
3. **运行时刻律**：
   - work-rules 系统段（+ 模式 A 的 enhance-mode 常驻段）；
   - guards（write-existing / path-traversal / bash-read）+ rules-injector（`.dsh-enhance/rules/`）；
   - **delivery-gate**（完成声明拦截 → 双层回归审查 → 未过压缩上下文重注入契约）；
   - boulder/goal 工作追踪 + 写令牌并发纪律 + worktree 隔离；
   - **advisor 伴随审查**（turn-stopping 增量 → `ctx.llm.stream` 独立审查 → nit/concern/blocker 回注）。
4. **编排 persona**：本文件三种模式各有一份编排 persona（单源在 `prompts/agents/`，由 sync 脚本生成成补丁里的一条预设行）。

> **旁注（已实证，非设计假设）**：advisor 用了 `ctx.agents.create()` 的影子子会话**无法被旁路唤醒驱动**（`answerLen=0`、turn 空转无 `step/start`），故落地为 `ctx.llm.stream()` 直接独立审查调用；四个专职 subagent 之所以可用，正是因为它们走显式 tool-call 委派驱动（见 prompts-review/advisor.md 实施修订）。

---

## 3. 模式 A：dsh-enhance 万能（dsh-enhance — orchestrating universal doer）

- **预设 / persona 源**：`preset-enhance`（`cordis.patch.yml` 生成物）← `prompts/agents/dsh-enhance.persona.md`（M1 已实现，即现有默认 orchestrator），另挂 `enhance-mode` 段行。
- **定位**：默认模式。直接实施，通用能力强，**根据用户意图**按需调用子 agent（scout / librarian / reviewer），task 自成执行单元（可委派或主模型直接做）。
- **编排风格**：意图驱动的按需委派。主 persona 先理解意图 → 需要独立核查/侦察/审查时派对应 subagent → 拿结果整合推进。**不强制固定流程**，靠主 persona 自己的判断决定"何时委派谁"（架构 5.4.1 的关键词意图路由**已退役**，不再作为辅助机制）。
- **何时选**：一般开发任务、直接动手、探索型问题、不需要严格出场确认的改动。

### 3.1 编排流程图

```
用户意图 → 主 persona(dsh-enhance) 理解意图
              │
              ├─ 需要独立侦察/映射仓库 → subagent_scout（只读）
              ├─ 需要核实外部依赖/事实 → subagent_librarian（只读）
              ├─ 需要独立审查某块产出  → subagent_reviewer（只读）
              │
              └─ 需要落地改动 → 主 persona 自己小步实施，
                                 或派 subagent_task 执行明确子任务
                                      │
                              （结果整合进主流程，质量由主 persona 负责）
```

### 3.2 验收口径

- 同一意图输入下，主 persona 能基于内容选择合理 subagent（如"盘点模块"触发 scout；"查这个库怎么用"触发 librarian；"审查这段"触发 reviewer）。
- 子 agent 返回自包含结论/证据；主 persona 核实后再采信，最终交付质量由主 persona 负责。
- 完成声明受 delivery-gate 拦截；todo 未清由 continuation-enforcer 续作。

---

## 4. 模式 B：Planner 计划实施（Planner — fixed-skeleton plan-then-execute）

- **预设 / persona 源**：`preset-planner`（`presets/roles.patch.yml` 生成物）← `prompts/agents/planner.persona.md`（**增强**：从单句 persona 扩为可执行固定骨架编排者）。
- **定位**：**骨架固定、过程动态**的计划者。planner 为主导模型，**按固定工作流顺序**调用 subagent，每个阶段是一个 gate，只有通过才进入下一阶段。
- **编排风格**：固定骨架 staged workflow。骨架是**常量**（阶段顺序不变），阶段内部过程是**动态**的（据此收集结果、据此提问、据此定计划）。
- **何时选**：复杂/多步/牵扯面广的任务；需要先对齐目标与方法、用户确认后才动手的改动；风险较高的交付。

### 4.1 固定骨架（stage + gate，顺序执行）

| 阶段 | 动作 | 委派 | Gate（通过才前进） |
|---|---|---|---|
| **S1 进场侦察** | 收集信息 | `subagent_scout`（本地映射）+ `subagent_librarian`（外部查证）+ planner **并行**自收（读文件核实事实） | 关键事实已核实、不确定点已列全 |
| **S2 澄清提问** | 依据 S1 的收集结果与**不确定点**向用户提问 | planner（用 ask-user / 直接提问） | 用户已答复不确定点、缺口补齐 |
| **S3 制定计划** | 产出**决策完备**计划：目标 / 方法 / 涉及文件 / 测试 / 验收标准 | planner | 计划决策完备、可执行、无未决歧义 |
| **S4 计划审查** | **高精度审查计划** | `subagent_reviewer`（阻塞性/改进分级，可带 `mode: security`） | 无未解决的 blocker；建议已纳入或说明放弃理由 |
| **S5 确认闸** | 通知用户计划 + 风险，询问是否执行 | planner → 用户确认（或走 plan-mode approve） | **用户确认执行**（唯一硬性外部闸） |
| **S6 执行** | 按计划交付 | `subagent_task` 逐一执行；**不阻塞前提下可多个 task 并行**（依赖 worktree 物理隔离，见 architecture 5.5.1；无独立 worktree 则写令牌串行） | 每个子任务交付物达到 S3 计划中该步验收标准 |
| **S7 执行审查** | 审查执行结果 + 回归 | `subagent_reviewer`（回归审查 + security） | 全部计划项有证据通过；未过则回到 S6 修整后重审 |

### 4.2 逻辑闭环要点

- **骨架是常量、过程是动态**：S1–S7 顺序固定，但"收集到什么、问什么、计划长什么样、任务怎么切"都随任务而异——避免过度固化到不可用，也避免自由发挥丢骨架。
- **确认闸集中在 S5**：S1–S4 全只读（scout/librarian/reviewer 只读，planner 只规划不写），真正写工作区发生在用户确认（S5）之后的 S6。这与 architecture 5.5.1 的**读写角色分类**一致：plan/explore/审查 = 只读可并行；execute = 写，受令牌/ worktree 纪律。
- **双审查点**：S4 审"计划"，S7 审"执行结果"。前者防走错方向（改动前修正），后者防交付跑偏（完成前回归）。
- **接口契约**：S4/S7 都交给 reviewer 时，用 prompts-review/enhance-mode-review.md 的回归核对清单 + verify 脚本绑定（architecture 5.2.2），并**去掉"已完成"锚定信号**（反锚定）。
- **完成声明**：S7 通过后，主 persona 的交付仍受 delivery-gate 完成声明拦截兜底，双保险。

### 4.3 验收口径

- 固定骨架顺序稳定：同一类任务多次触发，阶段顺序 S1→S7 一致；场景内过程（收什么/问什么/计划/任务切分）随任务变化。
- S5 之前不产生对工作区产物的写（只读收集与规划）；用户确认后才进入执行。
- 多子任务并行成立（有独立 worktree），且不互相踩踏（无 worktree 时写令牌串行）。
- S4/S7 的审查意见真实影响产物（blocker 被处理、建议被纳入或记录放弃理由）。

---

## 5. 模式 C：Advisor 目标回归（Advisor — goal-driven regression loop）

- **预设 / persona 源**：`preset-advisor`（计划中）← `prompts/agents/advisor.persona.md`（编排 persona，单源，尚不存在）或 `prompts/modes/advisor.md`（伴随审查稿件，用于运行时刻决策）——设计上把 **advisor 伴随运行时 + goal 工作追踪 + delivery-gate** 组合成一个**目标回归编排**。
- **定位**：**可设置 goal**；执行过程中 **advisor 持续收集信息/对话/内容，做目的纠正、纠错等回归动作**；结束前 advisor/reviewer 做回归审查；**不通过则压缩上下文后继续，直到达成目标**。
- **编排风格**：goal 驱动的回归循环。与 dsh-enhance/Planner 的最大差别：**存在一个持续对照目标纠偏的影子（advisor）**，且"完成"由"是否达成 goal"判定，而非"自我声明完成"。
- **何时选**：目标导向、长/复杂任务；需要持续对齐用户真实目的而非只求交付；容易跑偏/反复返工的任务。

### 5.1 编排流程（goal 驱动的回归环）

```
[进入] 设置 goal：create_goal(objective)=验收契约（**原生** ctx.goals）
   ▲        │
   │        ▼
   │  [执行] 主 agent（可复用 task 或主 persona）推进，增量提交
   │        │
   │        │ turn 结束 → advisor 伴随审查每次增量
   │        ▼
   │  [纠偏] advisor：收集信息/对话/内容，
   │          发现偏离 goal / nit / concern / blocker → 回注主 agent
   │   ├─ nit→inject（非打断旁注）
   │   ├─ concern→steer（转向提示：可能走错/漏材料）
   │   └─ blocker→steer（停止/重新考虑：明显违背目标或浪费工作）
   │        ▲
   │        │（主 agent 评估采纳或说明放弃）
   │        ▼
   │  [完成声明] 主 agent 声称达成 goal
   │        │
   │        ▼
   │  [回归闸] advisor/reviewer 双层回归审查（delivery-gate）
   │   ├─ 通过 → [交付] 达成目标，结束
   │   └─ 未过 → [压缩上下文]（折叠已完成证据，保留目标/计划/未清项）
   └────────┴→ 重新注入 goal 契约 → 回到 [执行]（循环直到达标）
```

### 5.2 与既有能力的一一对应（均为已实现）

| 目标回归环环节 | 落地机制（已实现） | 说明 |
|---|---|---|
| 设置 goal、验收契约 | 原生 `create_goal`/`get_goal`/`update_goal`（`ctx.goals`；本插件曾自建 `goal_*`，已退役） | goal = 当前会话验收契约（objective/phase） |
| 持续纠偏（收集/对话/内容） | advisor 伴随运行时（`agent/turn-stopping` 增量 → `ctx.llm.stream` 独立审查） | 审查范围既含技术正确性，也对照 goal 的目的对齐（目标回归） |
| 回注（nit/concern/blocker） | advisor `nit→inject` / `concern|blocker→steer` + emission guard | 已单测 + 路径核实；**正向回注已实测**（2026-09-30 实驱：`ADVISOR: nit` 被 emission guard 放行并 `delivered`，见 `.dsh-enhance/evidence/dsh-enhance-drive-llm-*.md`） |
| 结束前回归审查 | **delivery-gate**（5.2.1）派 reviewer 双层核对 + verify 绑定 | 完成声明拦截 → 回归审查 → 未过压缩上下文 |
| 不通过则压缩继续 | delivery-gate 的"压缩上下文 + 重注入入口契约"阶段转移（5.2.1-4） | 目标回归环的"不过则回到执行"，正是 delivery-gate 状态机 |

> 关键设计点：Advisor 模式**不是**再发明一套循环，而是**把 advisor（持续纠偏）+ goal（验收契约）+ delivery-gate（结束回归闸 + 压缩续作）串成一条回归环**。三者在 dsh-enhance 中均已实现，Advisor 模式是它们的编排组合——这也是"基于已完成工作"的一种落地方式。

### 5.3 逻辑闭环要点

- **目标 = 验收标准**："完成"由 goal 状态 + 回归审查证据共同判定，而非主 agent 自述。goal-guard 完成前禁止宣称 done。
- **持续纠偏优先于事后补救**：advisor 每个 turn 后介入，目的跑偏在早期被 concern/blocker 拦下，避免长任务浪费式多轮返工。
- **终止条件**：目标达成（回归闸通过）→ 正常交付；或目标不可达/受保护 → 合法出口（对应场景无解、受保护时，等价 delivery-gate 的 `unmeasured` 诚实出口）。
- **成本控制**：advisor 独立模型用量；emission guard 去重/限频避免噪声；无风险时 `ADVISOR: NONE` 静默。

### 5.4 验收口径

- 设置 goal 后，执行过程中 advisor 能对照目标持续介入（有可观测的纠偏增量或"在正轨宁可不发声"的静默）。
- 主 agent 声称"达成目标"时，delivery-gate 拦截并做回归审查；未过则压缩上下文 + 重注入 goal 契约继续。
- 达成目标 = goal 状态 done + 回归审查通过（证据一致）；未达成不宣称 done。
- 触发的 concern/blocker 会被主 agent 回应当（采纳或记录放弃理由）。

---

## 6. 三模式的统一纪律（不分模式都成立）

1. **人是发起者**：模式是执行编排，不是取代用户决策。Planner 的 S5 确认闸、Advisor 的 goal 由用户设定/确认。
2. **提示词单源**：三种编排 persona 各自单源在 `prompts/agents/`，由 sync 脚本生成成补丁里的预设行；不手改生成产物（presets-pin 测试锁定）。
3. **委派六要素**：委派 subagent 时用自包含任务说明（任务的 TASK / EXPECTED OUTCOME / REQUIRED TOOLS / MUST DO / MUST NOT DO / CONTEXT，见 prompts-review/README 桌面对齐）。
4. **读写纪律**：只读角色（scout/librarian/reviewer/planner/advisor）可并行；写角色（task/execute）受写令牌或 worktree 隔离（5.5.1）。
5. **完成 = 证据**：无论哪个模式，完成声明都过 delivery-gate；verify 绑定 + 反锚定 + 完成报告审计（5.2.2）。

---

## 7. 落地与 QA

- **预设落点**：`preset-enhance`（`cordis.patch.yml`，已实现，= 模式 A，并额外挂 `@dsh-enhance/dsh-enhance/enhance-mode`）；`preset-planner` 增强为模式 B 编排 persona（**未实现**——当前 planner.persona.md 仍是单句）；`preset-advisor` 为模式 C 编排 + 装配（**未实现**——`prompts/agents/advisor.persona.md` 不存在；advisor 运行时本身已由 Config 默认开启）。预设行由 bundle 补丁层声明，随插件即可选。
- **触发方式**：会话创建时选择对应 preset（web Agent 面板 / headless `--profile` + preset）。**没有**意图路由或关键词触发：模式是会话构成的一部分（0.2.x 的预设行），不写进 `plugins` 就没有。
- **QA 口径**：
  - A：意图→subagent 映射（单测 + 实驱）；
  - B：固定骨架顺序（实驱断言 S1→S7 阶段次序）+ 确认闸前无写（文件系统断言）+ 并行 task 不踩踏（worktree/令牌）。
  - C：goal→纠偏→回归→压缩续作闭环（实驱构造一个"声明达成但未达标"的目标，断言被拦回灌；advisor 纠偏正向回注若可观测则记录证据）。
- **状态**：模式 A 已实驱（dsh-enhance 预设 + subagent_scout 调用证据）；模式 B/C 编排 persona 与 presets 为**后续实现项**，本文为设计蓝本。

---
