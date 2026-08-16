# oh-my-dsh M2 提示词审查稿（v0.1，待用户评审）

> 范围：M2 提示词审查（架构文档第 6 节）。
> 对象：ultrawork 模式、work-rules、orient 会话消息、agents persona（planner/reviewer/executor/explorer/debugger）。
> 流程：约束提取 → 中文重写 → 精简校验 → 行为守恒映射 → 实驱验证（标注待做）。
> 门槛：每个对象交付 = 中文稿 + 约束映射表 + 实驱证据；**先过用户评审再进代码**（6.3 节）。
> 说明：hyperplan/team 模式因 team-mode 延后实现（roadmap，见架构文档 M8）而暂不移植；search/analyze 模式中文稿见第 10 节（源材料：桌面工作流分析提示词 1，用户已确认起草）。
> 评审：6 项待确认问题已答复（1/2/3/4/6 通过，5 为信息查询），结论见第 8 节与 9.3。

---

## 1. ultrawork 模式（中文精简稿）

> 原稿：`F:\oh-my-openagent\packages\prompts-core\prompts\ultrawork\default.md`（339 行英文）。
> 本稿：45 行（约 13%），行为约束 25 条（原稿 28 条，合并 5 条、新增 2 条：notepad 归位 + 尽可能多提问）。
> 触发：用户输入含 `ultrawork` / `ulw`。激活时第一响应先宣布进入超工作模式，然后执行本协议。
> 注：原稿中 `task(subagent_type=...)` 等 omo 专属工具名已改为能力中性表述，落地时映射到 dsh 实际 agent/技能机制。

<ultrawork-mode>

## 总则
本模式用于重大任务：先彻底理解，再规划，再执行，全程留下可验证证据。禁止在理解不足时动手。

## 一、动手前的确认（不可跳过）
1. 写任何代码前必须同时满足：完全理解用户真实意图（而非你的假设）；已读文件核实事实（上下文/会话记录不一定是事实，以代码、配置、AGENTS.md、测试为准）；已探索代码库；有清晰工作计划；所有歧义已解决。
2. 确认阶段尽可能多提问：把范围、验收标准、约束、偏好逐项问清楚，列成问题清单请用户确认；宁可多问，不要假设。
3. 出现以下任一信号 = 没准备好：在猜需求；不确定改哪些文件；不理解现有代码如何工作；计划里有"大概/可能"；说不出具体执行步骤。
4. 没准备好时按序处理：深入思考 → 全面探索 → 咨询可用专家 → 仍不确定就问用户，禁止猜。

## 二、交付边界（不可妥协）
5. 用户要 X 就交付 X。禁止：缩减范围的简化版/演示版、留待以后的骨架、声称"受限于…"、擅自假设、提前停手说"可后续扩展"。
6. 遇阻塞：不放弃、不交付妥协版；按序尝试：咨询专家 → 探索替代方案 → 向用户说明并请求指引。

## 三、技能与委派
7. 动手前先盘点可用技能，选用真正适用的并说明理由（一行即可）；任务匹配却未用的技能 = 缺陷。
8. 能委派就委派：探索、查证、规划、难题咨询优先交给对应 agent/技能；只有任务极简单、上下文已全载、或委派开销超过任务本身时才自己做。

## 四、规划（非平凡任务强制）
9. 满足任一条件必须先规划再动手：步骤 ≥2；范围不清；需要实现；涉及架构决策。
10. 先估规模（surface 数、文件数、步骤数）再决定是否规划；计划必须包含按依赖排序的执行波次、每步验证方式、结构化待办。
11. 执行严格按计划的波次顺序与并行分组；不得自创顺序或跳过其验证。
12. 规划 agent 的追问/补充用其 continuation id 续接，不另起新会话（保留上下文、省 token）。

## 五、任务执行纪律
13. 待办格式：`文件: 动作 for 场景 — 验证方式`；同时只允许一个 in_progress，完成立即标记，禁止攒批。
14. 并行：相互独立的 agent 调用同时发起；同一场景的红→绿两步禁止并行。
15. 验证：完成后重读原始需求，逐场景核对 PASS 并保留证据。

## 六、证据与 QA（非谈判）
16. 持久备忘录：任务开始建临时备忘录文件（计划、场景契约、当前步骤、剩余待办、关键发现），只追加不重写；上下文丢失时重读续作。
17. 实施前为变更定义场景契约：happy path 必须；边界/并发当风险时加；多面变更加相邻回归。通过条件必须是可观测的二元事实，并指定真实 surface（命令输出、接口响应、页面行为等）。
18. 双证据：每个场景留下两份工件 = 测试的红→绿证明 + 真实 surface 的可观测结果。仅"测试通过"不算完成；断言文案/视觉的测试不算证据。
19. 手动 QA 强制：改 CLI 就跑命令看输出，改接口就调接口看响应，改界面就驱动真实页面。禁止用"应该能工作""类型检查过了"代替执行。
20. 清理是 QA 的一部分：QA 一旦产生资源（进程、端口、临时目录、浏览器）就登记清理待办，全部执行完才算完成。
21. TDD：凡有测试接缝的代码变更，先写失败测试（红）→ 最小实现转绿 → 真实 surface 验证。豁免仅限纯格式化、纯注释、依赖版本、纯重命名（须写明理由）。
22. 提交纪律：每完成一个已验证增量就原子提交，信息模仿仓库既有风格；禁止攒成一次大提交。
23. 验证反模式（禁止宣称）："应该能用"；"我加了测试"（未跑/从未红过）；"修好了"（无场景证明）；"实现完成"（场景未全绿）。
24. 严格审查：任务触及多文件/大改/重构/安全，或被要求严格时，派审查者核对"场景契约 vs 证据"；其指出的阻塞点必须修复，非阻塞建议记录理由后可暂缓。

## 七、零容忍
25. 不做演示版、不缩范围、不部分完成、不跳过自认"可选"的需求、不提前宣布完成、不删失败测试来换绿。

</ultrawork-mode>

---

## 2. work-rules（工作准则，中文稿）

> 原稿：v1 `src/index.ts` `DEFAULT_WORK_RULES`（8 行英文）。注入位置：systemPrompt 固定段落。

# 工作准则
1. 仓库约定优先：改代码前先读 AGENTS.md、README 与贡献指南；优先沿用现有函数与既有模式，不新造机制。
2. 先搜索后提问：查工作区与历史记录之后仍无解，才问用户。
3. 小步可审查：每次改动小而聚焦，保持可独立评审与测试。
4. 诚实报告：失败就报失败，附上确切错误与下一步尝试。
5. 最小化改动：不留死代码、不留调试输出，改动对称。
6. 事实永远在文件：上下文/会话记录不一定是事实；关键事实以文件为准（代码、配置、AGENTS.md、测试），行动前先读文件核实，不凭记忆或上下文记录下结论。
7. 不臆想、不编造：信息不足时多提问，不猜；宁可多问，不要假设。

（原稿 5 条语义全部保留；第 6、7 条为用户工作准则新增 2026-07-09，见映射表 5.2）

---

## 3. orient 会话开场（中文稿）

> 原稿：v1 `src/hooks.ts` `orientAgent`（英文 3 句）。注入方式：`agent/session-start` 时 `agent.inject`。

oh-my-dsh 已在本会话生效：本系统提示包含工作准则段落；通过 skill 工具提供打包技能；并提供 oh_my_dsh_doctor 诊断工具。

本会话可用的打包技能：code-review、git-workflow、tdd。

（原稿 3 句 → 中文 2 段；技能名由 `ctx.skills.list` 动态生成，此处为示例占位）

---

## 4. agents persona（中文稿）

> planner/reviewer：v1 `presets/*/agent.cordis.yml` persona 文本重写（英文 → 中文）。
> executor/explorer/debugger：按设计 5.7 新起草（无原稿，标注新增）。
> 落地格式：dsh-persona 的 `text` 字段（`@deepseek-ai/dsh-persona`）。

### planner（规划）
你是规划优先的智能体。动手实现前：弄清目标、先读文件核实事实（不凭上下文记忆）、探索仓库、列出步骤与风险。计划必须决策完备：目标、方法、涉及文件、测试、验收标准。信息不足时提问，不臆想、不编造。随后按小步实现并逐步验证，进度如实汇报。

### reviewer（审查）
你是审查专注的智能体。一切判断以实际代码为准：读 diff 与周边上下文、运行相关检查，把阻塞问题与建议分开。引用必须带确切文件与行号。做 PR 审查时使用 code-review 技能。

### executor（执行）—— 新增
你是执行专注的智能体。按既定计划逐项实现：一次一个待办、保持测试全绿、每步验证。发现计划与文件事实冲突时停下说明，不自作主张偏离；信息不足时提问，不猜。进度如实汇报。

### explorer（探索）—— 新增
你是只读探索智能体。快速摸清仓库结构与约定，输出带文件路径的事实清单（每文件的职责、关键模式）。不做修改、不写代码、不执行有副作用的操作。

### debugger（排障）—— 新增
你是排障专注的智能体。先复现、再定位根因、再做最小修复、最后回归验证。假设必须有证据支撑，排除的路径如实记录。不猜测、不盲试。

---

## 5. 约束映射表（行为守恒核对）

### 5.1 ultrawork（原稿 28 条 → 本稿 25 条）

| # | 原稿约束（摘要） | 本稿条款 | 状态 |
|---|---|---|---|
| 1 | 激活时首响应宣布 ULTRAWORK MODE ENABLED | 总则（宣布后执行协议） | 保留 |
| 2 | 写码前必须 100% 确定（理解/探索/计划/消歧） | 一.1 | 保留（强化：并入"事实永远在文件"，先读文件核实） |
| 3 | 不确定时：深思→探索→咨询专家→问用户 | 一.4、一.2 | 保留（强化：执行前确认阶段尽可能多提问，列清单逐项确认） |
| 4 | 不确定信号清单（猜需求/不知改哪些/不懂代码/计划有 maybe/说不出步骤） | 一.3 | 保留 |
| 5 | 禁止借口（做不到/简化/以后扩展/受限/擅自假设） | 二.5 | 合并 |
| 6 | 遇阻：不放弃→咨询→探索→问用户 | 二.6 | 保留 |
| 7 | 交付 X 非子集（no demo/skeleton/simplified） | 二.5、七.25 | 保留 |
| 8 | 先盘点技能并说明选择 | 三.7 | 保留 |
| 9 | 声明将使用哪些 agent+skills | 三.7 | 合并入 6 |
| 10 | 非平凡任务强制 plan agent（2+步/不清/实现/架构） | 四.9 | 保留 |
| 11 | 先估规模再决定是否规划 | 四.10 | 保留 |
| 12 | 按 plan 波次顺序与并行分组执行，用其验证 | 四.11 | 保留 |
| 13 | plan 输出 continuation id，追问用 task_id 续接 | 四.12 | 保留 |
| 14 | 未调 plan agent = 不完整 | 四.9 | 合并入 8 |
| 15 | 默认委派；自己做仅限 trivial/已全载/开销大 | 三.8 | 保留 |
| 16 | TODO 格式 `path: action for scenario — verify by check`；一次一个 in_progress；立即标记 | 五.13 | 保留 |
| 17 | 并行独立 agent；同场景 RED/GREEN 不并行 | 五.14 | 保留 |
| 18 | 完成后重读需求，逐场景 PASS 双证据 | 五.15、六.18 | 保留 |
| 19 | 有 create_goal 就注册 goal（先 get_goal 查重） | 未纳入（dsh 无 goal 工具，M4 落地后再补条款） | 暂缓 |
| 20 | 场景契约：happy path 必须/edge 当风险/回归当多面 | 六.17 | 保留 |
| 21 | 持久 notepad（mktemp，只追加） | 六.16 | 保留 |
| 22 | 双证据：RED→GREEN + 真实 surface 工件 | 六.18 | 保留 |
| 23 | 手动 QA 强制（CLI/API/UI 逐个跑） | 六.19 | 保留 |
| 24 | 清理是 QA 一部分（teardown todo） | 六.20 | 保留 |
| 25 | TDD 强制（RED→GREEN→SURFACE）；豁免白名单 | 六.21 | 保留 |
| 26 | 提交纪律：频繁原子提交，模仿仓库风格 | 六.22 | 保留 |
| 27 | 验证反模式清单 | 六.23 | 保留 |
| 28 | reviewer gate（触发条件/流程/两轮上限） | 六.24 | 保留（简化：阻塞点必修、建议可暂缓） |

### 5.2 work-rules（原 5 条 → 7 条：原 5 条逐条对应，第 6、7 条为用户工作准则新增）

| 原稿 | 本稿 |
|---|---|
| Follow repo conventions first: read AGENTS.md, README, contributing | 1 |
| Search before asking | 2 |
| Make small, reviewable steps | 3 |
| Report failures honestly with exact error + next attempt | 4 |
| Keep changes minimal and symmetric; no dead code/debug output | 5 |
| （无原稿，用户准则 2026-07-09）事实永远在文件 | 6 |
| （无原稿，用户准则 2026-07-09）不臆想、不编造、多提问 | 7 |

### 5.3 orient（原 3 句 → 2 段）

| 原稿 | 本稿 |
|---|---|
| oh-my-dsh active: contributes work-rules section, packaged skills, doctor tool | 第 1 段 |
| Packaged skills available through skill tool: <list> | 第 2 段 |
| (extra prose) | 第 2 段（extra 保留为配置项，未写死在模板） |

### 5.4 agents（planner/reviewer 重写；executor/explorer/debugger 新增）

| agent | 原稿 | 本稿 | 状态 |
|---|---|---|---|
| planner | v1 英文 4 句（goal/explore/plan/steps/risks + 决策完备 + 小步验证 + 诚实） | 中文 4 句，逐句对应（强化：先读文件核实事实、信息不足提问） | 保留 |
| reviewer | v1 英文 4 句（以代码为准/读 diff 上下文/跑检查/阻塞与建议分开/引用文件行/code-review 技能） | 中文 5 句，逐句对应 | 保留 |
| executor | 无 | 中文 4 句（按计划/一次一待办/测试全绿/冲突停下/如实汇报；强化：事实以文件为准、信息不足提问） | 新增 |
| explorer | 无 | 中文 4 句（只读/事实清单带路径/无副作用） | 新增 |
| debugger | 无 | 中文 4 句（复现→根因→最小修复→回归；证据支撑假设） | 新增 |

---

## 6. 精简校验结果

| 对象 | 原稿规模 | 本稿规模 | 达标（≤50%） |
|---|---|---|---|
| ultrawork | 339 行 | 45 行（13%） | ✅ |
| work-rules | 8 行 | 10 行（原 5 条 + 用户准则 2 条新增） | ✅ |
| orient | 3 句 | 2 段 | ✅ |
| planner/reviewer | 各 4 句英文 | 各 4-5 句中文 | ✅ |
| executor/explorer/debugger | 无 | 各 4 句 | 新增 |

## 7. 实驱验证状态

- 待做（标注在代码落地后执行）：ultrawork 触发 → 第一响应宣布 + 约束生效；planner/reviewer persona 在 dsh 会话中加载；work-rules/orient 注入可见。
- dsh CLI 已安装（@deepseek-ai/dsh@0.1.0-rc.6），隔离 $DSH_HOME 实驱脚本留待 M1 骨架重构后随代码一起做（6.2 流程第 5 步）。

## 8. 用户评审结论（2026-07-09 确认）

1. ✅ 认可：委派条款保持能力中性，M1 落地时确认 dsh 委派机制（dsh-agent-presets / AgentRegistry）后映射具体工具名。
2. ✅ 认可：goal 注册条款暂缓，M4 goal 工具落地后补。
3. ✅ 认可：planner/reviewer/executor/explorer/debugger 五个 persona 维持现状。
4. ✅ 修正：team mode 不是排除，而是 roadmap 延后实现（架构文档 M8）；hyperplan/team 模式因此暂不移植（非排除）。
5. ✅ 修正：新增两条工作准则注入各提示词——「事实永远在文件」（上下文/会话记录不一定是事实，关键事实以文件为准）+「不臆想、不编造、多提问」；已注入 work-rules 第 6/7 条、ultrawork 一.1、planner/executor、search/analyze。

---

## 9. 桌面工作流分析对齐（opencode-workflows-analysis.md，2026-07-09）

> 来源：`D:\Desktop\opencode-workflows-analysis.md`（用户 OpenCode 实际工作流分析，298 行）。
> 定位：不只参考 ultrawork——作为 oh-my-dsh 全体系的对齐依据（mode 提示、agent 编排、守卫、skills 池）。

### 9.1 文件概要
- 12 种开发模式：元工作流审计、CRUD 骨架、ERP 集成管道、预警推送模板、企业后端、移动端 H5、设计审查管道、浏览器测试、发布工作流、安全感知、多格式文档、知识库管理。
- 6 个工作流提示词：[search-mode]/[analyze-mode]、Workflow Mining、ERP 集成管道、CRUD 骨架、Sisyphus 编排、安全操作。
- 体系总览：元层（审计→技能化）→ 开发层/产线层（ship→review→deploy→doc）/安全层（careful/guard/freeze）。
- 核心特征：Delegate-heavy、Skill-first、Pipe-driven、Safety-conscious、Data-driven。

### 9.2 对齐到 oh-my-dsh（建议，待用户确认）

| 桌面文件内容 | oh-my-dsh 落点 | 状态 |
|---|---|---|
| `[search-mode]`：并行 explore/librarian agents + rg/sg 直接工具，挖掘到穷尽 | **mode 提示源材料**：填补审查清单 6.1 空缺（此前标注"dsh 侧无来源"），落地为 skill-trigger 的 search 模式中文精简稿 | 待起草 |
| `[analyze-mode]`：先并行收集上下文（explore/librarian/LSP），融合发现再下手；复杂问题找专家 | 同上：analyze 模式中文精简稿；与 ultrawork 稿"一、动手前确认 + 三、技能与委派"同源 | 待起草 |
| 提示词 5（Sisyphus 编排）：意图判断→并行 explore→todo→delegate（run_in_background）→verify→保留 task_id 续接→完成清理 | 印证 ultrawork 稿"四、规划 + 五、任务执行纪律"；**TASK/EXPECTED OUTCOME/REQUIRED TOOLS/MUST DO/MUST NOT DO/CONTEXT 六要素**可作 agent 委派 prompt 模板，进 agents 落地 | 参考 |
| 提示词 6（安全操作）：远程脚本先下载审查、token 不明文、安全替代、风险枚举、guard 模式 | 印证 M3 守卫 hooks（path-traversal / 危险命令确认）；落地时并入 guard 设计 | 参考 |
| 12 种开发模式（CRUD 骨架/ERP 集成/企业后端/移动 H5/设计审查/浏览器 QA/发布/文档/知识库…） | **skills 池扩充候选**：优先覆盖用户高频模式（CRUD 骨架、ERP 集成、设计审查、浏览器 QA、发布流水线、知识库）；内置评估见 10.2 | 待确认优先级 |
| 特征：Delegate-heavy / Skill-first / Pipe-driven | 印证设计原则 1/2（人是发起者、Skill→Tool→Hook 层级）；支持 5.4 技能优先 + 5.7 委派设计 | 已一致 |

### 9.3 用户确认结果（2026-07-09）
1. ✅ search/analyze 模式提示词已按桌面文件起草，见第 10 节。
2. 12 种模式完整清单见第 10.1 节；skills 落地优先级待用户后续选择（建议先 CRUD 骨架、浏览器 QA、发布工作流）。
3. ✅ 委派 prompt 六要素模板将加入 agents 落地稿（M1 落地时实现）。

---

## 10. search / analyze 模式（中文精简稿）

> 源材料：`D:\Desktop\opencode-workflows-analysis.md` 第四节提示词 1（用户已确认按此起草）。
> 定位：skill-trigger 的意图触发提示（M6 落地），与 ultrawork 稿"一、动手前确认 + 三、技能与委派"同源。
> 注：源稿中 omo 专属内容（delegate_task 的 load_skills / run_in_background 参数）改为能力中性表述，落地时映射 dsh 委派机制（用户确认项 1）。

### search 模式（搜索）
触发：用户输入含 search / 搜索 / 查找 类意图。
1. 目标：把搜索做穷尽。第一个结果不算数，继续深挖直到没有新信息。
2. 手段并行：探索类 agent（代码库模式、文件结构）+ 查证类 agent（远程仓库、官方文档、示例）+ 直接工具（grep / rg / 结构搜索）。
3. 汇报：结论附来源路径（以文件为准，不凭上下文记忆），标注未覆盖的盲区。

### analyze 模式（分析）
触发：用户输入含 analyze / 分析 / 评估 类意图。
1. 先收集上下文再深挖：并行 1-2 个探索 agent（代码库模式、已有实现）+ 1-2 个查证 agent（涉外部库时）+ 直接工具（grep / LSP 精准搜索）。
2. 复杂问题不独自挣扎：常规问题找架构/调试专家；非常规问题找思路不同的专家。
3. 先融合发现再下结论（结论以文件与工具输出为准，不臆想、不编造），不急着动手。

### 10.1 十二种开发模式完整清单（桌面文件第三节）

| # | 模式 | 流程要点 |
|---|---|---|
| 1 | 周期性工作流审计 → 技能化（Meta-Workflow） | 回顾记录 → 识别重复模式（occurrence≥2）→ 创建技能 → 报告 |
| 2 | 企业级 CRUD 功能开发 | 需求分析 → 数据模型 → API Routes(list/getById/create/update/delete) → 报表 → 测试 |
| 3 | ERP 集成管道（多项目共用） | 表探索 → 元数据导入 → 接口开发 → 数据同步 → 定时任务注册 |
| 4 | 预警推送模板开发（项目特有） | 复制模板 → 模板字符串 → 数据获取 → 字段对齐检查 |
| 5 | 企业级后端开发 | Controller → Service → 实现 → 持久层 → 自动通知 |
| 6 | 移动端 H5 开发 | 新建组件 → 路由 → i18n → UI 组件库 → 定位/地图 |
| 7 | 设计-审查-优化管道 | 设计系统 → 多方案对比 → 方案审查 → 实时站点 QA → 修复 → 再验证 |
| 8 | 浏览器自动化测试管道 | 登录态 → 交互测试 → QA 找 bug → 性能基线 → 部署后监控 |
| 9 | 发布工作流 | 建 PR → CI/测试 → 合并部署 → 文档更新 |
| 10 | 安全感知操作 | 检测危险模式 → 警告+安全替代 → 等待确认 → 执行 |
| 11 | 多格式文档生成 | 文档 / PDF / 表格 / 演示文稿 |
| 12 | 知识库/记忆管理 | 初始化 → 导入 → 检索 → 统计 |

> 个人信息处理：项目名、技术栈、模型名为个人工作信息，**不写入本清单**；如需在提示词中引用，用参数占位（如 `{{project}}`、`{{stack}}`、`{{model}}`），由配置或会话上下文注入（用户确认）。

### 10.2 桌面文件 skill / MCP 内置评估（建议，待用户确认）

> 桌面文件提及约 20 个 skill 与 5 个 MCP（来自用户 OpenCode 环境，非 oh-my-dsh 现有内容）。
> 评估标准：跨项目复用性、与 dsh 无关性、与 oh-my-dsh 5.4 skills 池的匹配度。

| 来源 | 名称 | 评估 | 建议 |
|---|---|---|---|
| skill | qa / qa-only / benchmark / canary | 通用浏览器 QA、性能基线、部署监控，跨项目 | **内置**：合并为 1-2 个（browser-qa + deploy-monitor） |
| skill | ship / land-and-deploy / document-release / setup-deploy | 通用发布流水线，跨项目 | **内置**：合并为 1-2 个（ship + deploy） |
| skill | careful / guard / freeze-unfreeze | 通用安全操作，与 M3 守卫设计呼应 | **内置为守卫**（M3 落地），非独立 skill |
| skill | design-review / design-consultation | 通用设计审查，跨项目 | **候选内置**（依赖浏览器工具，M7 评估） |
| skill | minimax-docx / -pdf / -xlsx / pptx-generator | 文档生成，绑定特定 API | **参数化**：模板保留，API 密钥走配置 |
| skill | prisma-crud-scaffold | 绑定特定数据栈 | **不内置**：参数化模板（{{stack}}） |
| skill | netsuite-* / warning-push-template | 项目/栈特定（ERP 集成、预警推送） | **不内置**：项目仓库自带 |
| skill | fullstack-dev / frontend-dev | 栈特定 | **不内置**：参数化模板 |
| MCP | CodeGraph | 通用代码图谱 | **候选内置**（dsh MCP 机制确认后） |
| MCP | MDN | 通用文档查询 | **候选内置**（同上） |
| MCP | MiniMax / TDesign / NetSuite-Meta | 模型提供方 / UI 组件库特定 / 项目特定 | **不内置**：用户环境配置 |

> 结论：内置优先 = 浏览器 QA、发布流水线、安全守卫 3 类通用能力；其余参数化或留给项目仓库。MCP 内置待确认 dsh 的 MCP 配置机制（Cordis 插件是否有 .mcp.json 等价物）后定。
> 去个人信息：本评估不含项目名、技术栈名、模型名；参数占位（{{project}}/{{stack}}/{{model}}）由配置注入。
