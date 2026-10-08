# dsh-enhance 架构设计（v2 重设计）

> 状态：设计稿 v0.1，待评审
> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 参考蓝本：开源增强插件生态（MIT）——`oh-my-pi`（omp，MIT）、`lazycodex`（MIT）；能力边界与事件面以 `F:\deepseek-harness\packages\*`（MIT）实测类型定义为准，探索证据见对应模块。
> 注：本设计不依赖任何 SUL 许可项目内容。

## 1. 定位与目标

dsh-enhance 是 DeepSeek Harness 的"电池全包"增强插件（oh-my-zsh 风格）。它把经开源生态验证的能力按 dsh 的插件 API 重新落地：

- **生命周期 hooks**：pre-step/request 守卫 + turn-stopping 续作
- **工具集**：bash/read 守卫、LSP、comment-checker、goal/boulder 工作追踪
- **技能体系**：打包 SKILL.md + 意图触发路由
- **工作追踪**：goal + boulder 状态机，跨会话续作
- **Worktree 支持**：隔离工作区的一等公民抽象

明确不做（v2 范围外）：

- 跨 harness 的 monorepo 分层（Core 包抽取）——dsh 是单一宿主，v2 不预抽 Core；等第二个 harness 出现再谈
- 遥测、自动更新等运营设施——留到 v3

延后实现（roadmap feature，v2 只预留扩展缝、不实现）：

- **Team mode**（多智能体并行协调）——dsh 侧需在 M1 实测后由插件层自建：`team_mode.enabled` 配置门控 + 独立工具注册表 + 存储布局（`~/.dsh-enhance/teams/{name}/` 的 mailbox / tasklist.jsonl / worktrees，成员 eligibility 注册表）。当前 adapter 层与 hook 分层不堵死该扩展：后续新增 team_* 工具与事件处理器时，挂进 ToolRegistry 与事件面即可，无需重构。

## 2. 设计原则

按本项目的用户要求确立：

1. **人是发起者，智能体是执行者**：提示词面向"一次交代、全程执行"，不面向逐轮澄清。
2. **表达的层级顺序**：Skill（静态知识，零运行时成本）→ Tool（一等运行时能力）→ Hook（注入智能体循环本身）。能用技能表达的不写钩子。
3. **提示词是产品，不是文档**：所有提示词逐条审查、中文化、精简。英文废话与威胁性强调（大写 MANDATORY、叹号堆砌）一律删除，只保留产生行为的约束。
4. **防冲突是存储层职责**：任何共享状态（boulder）写入必须原子、带并发控制，不允许散落的 read-modify-write。
5. **Worktree 是一等概念**：会话可以主动进入隔离工作区；boulder 状态与 worktree 关联并共享同一份事实。
6. **明确不做抽象**：不建"统一 hook 层"去抽象 dsh 的事件面，直接对着 dsh API 写 adapter。

## 3. 总体架构

```
dsh-enhance/
├── docs/                  # 设计 + 用户文档
├── prompts/               # 提示词单源（agents/<role>.persona.md、modes/*.md）
├── skills/                # 打包 SKILL.md（静态知识层）
├── presets/               # dsh-agent-presets 预设目录（生成物；用 scripts/install-presets.mjs 装进 $DSH_HOME/.agent-presets）
├── src/                   # ★ adapter 层（单一宿主平台插件）
│   ├── index.ts           # 插件入口：name / inject / Config（schemastery schema）/ apply
│   ├── hooks/             # 生命周期钩子（work-rules、orient、rules-injector、start-work、delivery-gate）
│   ├── tools/             # 工具注册（doctor、guards、guard-register、boulder-tools、worktree-tools、write-token-guard）
│   ├── features/          # 特性模块（skills-provider、commands、presets/、skill-trigger、boulder/、worktree/、delivery-gate/、advisor/）
│   └── shared/            # 跨模块工具（路径规范化、原子写 + 锁、校验、消息文本）
├── qa/                    # 真实 dsh 实驱脚本（隔离 home、证据落盘）
├── scripts/               # 预设生成（sync-presets / sync-dsh-enhance-preset）与装机（install-presets）
├── tests/                 # node --test 单测
└── cordis.patch.yml       # 插件注入补丁
└── package.json
```

**Adapters 层布局**：`src/` 采用一能力一目录的扁平组织（`hooks/{name}/`、`tools/{name}/`、`agents/` 工厂模式、`features/` 独立特性模块），便于逐能力审查与桶导出。该思路借鉴自 MIT 开源插件生态（`oh-my-pi` coding-agent 的 prompts/tools/agents 域划分、`lazycodex` 的 `plugins/omo/` 组件化目录），并结合 dsh 单包 Cordis 插件的特点：扁平目录 + 工厂 + 桶导出与 dsh 最匹配。

## 4. dsh API 能力映射（dsh 事件面 → dsh-enhance 能力）

探索自 `F:\deepseek-harness\packages\core\*` 类型定义（MIT），实现时以实际 d.ts 为准。

| dsh 能力 | dsh-enhance 落点 | 备注 |
|---|---|---|
| 插件入口 `apply(ctx, config)` | 插件入口 | `name` / `inject: ['skills','systemPrompt','tools','agent']` |
| 配置 `schemastery` schema | 配置系统 | 插件行 `config` 块，`cordis.patch.yml` 注入 |
| `ToolRegistry` guard / `ctx.on('agent/pre-step')` | 工具守卫 | dsh ToolRegistry 原生支持 guard waterfall（全局 + 作用域） |
| `ctx.on('agent/request')` | 意图触发 | 用户输入事件，负载字段实现时核实 |
| `ctx.on('agent/session-start')` + `agent.inject(...)` | 会话开始注入 | 已在 v1 验证可用 |
| `ctx.on('agent/turn-stopping')` | 续作强制 | turn 关闭前注入"继续"或审核建议 |
| `SystemPrompt.section()` | 系统提示段落 | work-rules 即此机制（v1 已用） |
| `ctx.skills`（SkillService） | 技能注册 | v1 已验证 `ctx.skills.list({})` |
| `AgentFactory` / `AgentRegistry` | agent 定义 + 需顾问/子会话 | dsh-agent-presets 模式；`ctx.agents.create()` 可拉起独立子会话（advisor 伴随模型可行性见 prompts-review/advisor.md） |
| 事件面 | `agent/created` `agent/session-start` `agent/pre-step` `agent/request` `agent/status` `agent/turn-stopping` `agent/error` `agent/disposed` `session/created` `session/event` | 完整清单见 dsh-agent `runtime-types.d.ts` |

## 5. 子系统设计

### 5.1 配置系统

- 插件行 `config`：`workRules` / `orientOnSessionStart` / `doctorTool`（沿用 v1）+ 新增 `guards` / `workTracking` / `worktree` / `advisor` / `advisorModel` 开关组。
- 打包技能没有开关：`skills-provider` 恒定注册（技能是零运行时成本的静态知识层，见设计原则 2），不做 `skillsEnabled` 配置——早期草案里提过该字段，实现时按"始终开启"定稿。
- 每项功能默认开启、可单独关闭（继承 v1 的"Turn it off"表格式习惯）。
- 不变更 dsh 主配置格式；`cordis.patch.yml` 只负责插入 dsh-enhance 一行。

### 5.2 Hooks 层（守卫 + 注入 + 续作）

按 dsh 事件面能力裁剪为 3 类：

**A. 工具守卫（ToolGuard）** —— 挂在 `ToolRegistry` guard 或 `agent/pre-step`：

| 守卫 | 行为 | 设计来源 |
|---|---|---|
| `write-existing-file-guard` | 未读过的文件禁止写（会话级读权限追踪，cap 1024 路径/会话） | v1 意向 + 安全实践 |
| `bash-file-read-guard` | bash 读文件也计入"读过"权限 | 同上扩展 |
| `path-traversal-guard` | 写入路径必须落在会话根内（canonical path + realpath，防 symlink 逃逸） | 安全实践 |
| `tool-output-truncator` | 超限工具输出截断，保护上下文 | v1 意向 |
| `comment-checker` | 写类工具结果后跑 comment-checker 二进制 | 通用注释校验（二进制可用 dsh 可用实现） |

**B. 上下文注入（Transform）** —— 挂在 `agent/request` / `agent/session-start`：

| 注入 | 行为 |
|---|---|
| `rules-injector` | 会话开始时按工作区发现 AGENTS.md / `.dsh-enhance/rules/`，注入为系统段落（自建 finder/matcher，缓存 + 距离计算） |
| `skill-trigger` | 检测输入意图（ultrawork / search / analyze），注入对应模式提示词 |
| `work-rules` | v1 已有，保留 |

**C. 会话续作（Continuation）** —— 挂在 `agent/turn-stopping` / `agent/session-start`：

| 机制 | 行为 |
|---|---|
| `start-work` | 会话开始发现 boulder 活跃计划 → 注入续作上下文（计划、todo、notepad） |
| ~~`todo-continuation-enforcer`~~ | **已退役**：原实现读本插件自建 goal 的 `remaining_todos`；目标是原生 `ctx.goals` 后该计数没有写入者，续作由原生 `dsh-goal-round-driver`（active goal → 连续轮次）承担 |
| `delivery-gate` | **交付门卫**（在 agent 宣称完成/交付时触发回归审查，未过则压缩上下文后重注入入口契约继续工作，直到通过——见 5.2.1）。**原生 goal 仍 open（`phase !== 'complete'`）时视为进展汇报**，交给原生轮次驱动 |

### 5.2.1 交付门卫（delivery-gate）状态机

把 ultrawork 拆成"工作前 + 交付前"两篇的真正目的是应对**中后段规则混淆**：工作前只注入少而关键的入口契约，完整证据/QA 纪律留到交付前集中回归核验。二者由交付门卫串成闭环：

```
[入口契约] --(执行)--> [agent 宣称完成/交付]
                             │
                  ┌──────────▼──────────┐
         不通过    │ 回归审查 ultrawork-  │  通过
       ┌──────────┤ review（核对证据）   ├─────────► 交付完成
       │          └──────────┬──────────┘
       │                     │
       ▼                     │ 未过
  [压缩上下文] ◄────────────┘
  + 重新注入入口契约
  → 回到执行
```

**规则**：

1. **触发点**：`agent/turn-stopping` 拦截到 agent 的"完成/交付/可以了"声明（而非用户输入）。匹配信号：陈述句带完成语态、调用提交/结束工具、显式说"完成了"。
2. **执行**：交付回归审查 = **双层核对**（见 5.2.2）——先跑该 work 声明的**可执行 verify 脚本**（可观测事实断言），再按 `ultrawork-review.md` 清单核对不可自动化的纪律项。推荐派 `reviewer` agent 独立执行，过滤自我确认偏差与锚定（见 5.2.2-反锚定）。
3. **通过**：全部检查项有真实证据 → 放行交付。
4. **不通过**：任一检查项无证据 → 不失败退出，而是**压缩上下文（压缩已完成步骤的证据，保留需求/计划/未清事项）→ 重新注入入口契约（ultrawork 工作前篇）→ 继续工作**，回到步骤 1。循环直到通过。
   - 压缩是"阶段状态转移"：把已核实的旧证据折叠成摘要，避免上下文膨胀后又进入规则混淆。
   - 每轮入口契约注入的是同一份精简稿，不叠加整段历史。
5. **幂等/不双启**：同一轮内不重复注入回归审查；上轮已通过的检查项记录为 `verified`，下轮只核对未过项与新增变更。

**与原生 goal 续作的关系**：
- 原生 `dsh-goal-round-driver` 处理"目标还没完成"（工作没完）：active goal → 连续轮次，并要求完成前有证据；
- `delivery-gate` 处理"声称做完了但证据不符"（交付质量门）；
- 两者都挂在 turn-stopping：原生 goal 仍 open 时本门卫不启动（视作进展汇报），goal complete（或本会话无目标）后才进入完成声明判定。

**提示词来源**：工作前/交付前两篇见 `docs/prompts-review/ultrawork.md` 与 `ultrawork-review.md`。设计意图说明见 `README.md`。

### 5.2.2 可执行验证绑定与反攻击

交付门卫的回归审查不能只靠 agent 自述"有证据"。借鉴 MIT 评测体系（DeepSeek-Reasonix e2e 基准）的成熟做法，把交付验证**绑定到可执行的 verify 脚本**，并把"agent 制造通过"的路径堵死。

**（1）task→work 级 verify 脚本绑定**

- 每个非平凡 work（boulder work）可声明一组**可执行验证**：`verify` 字段（或在 plan/场景契约里）指向一个 `verify.sh`/DSL 断言脚本，退出码 0 = 该 work 交付物达标。
- 场景契约（ultrawork 稿"五、证据"）中每个**可自动化断言**都应落为 verify 脚本的一条断言，而不是只在 review 时口头核对。
- 交付门卫执行顺序：**先跑 verify.sh**（可观测事实，agent 无法假装），**再核对 `ultrawork-review.md` 中不可自动化的纪律项**（需求范围、禁止性声明、清理、提交完整性）。
- 参考契约纪律：verify 脚本对 pristine 状态应为红（未做时失败）、对参考解应为绿（达标时通过）——保证它确实断言"交付达标"而非恒真。
- **落地状态**：`BoulderWork.verify` + `boulder_start(verify=…)` + `runVerify` 已实现；无绑定记 `unmeasured`（绝不假装通过），失败记 `failed` 且不结算、不释放令牌。

**（2）inverse contract / 反攻击**

防止 agent 通过**改受保护测试、植入缺失依赖、特判断言**来"制造通过"：

- ~~verify 脚本可内嵌 **protected-file manifest**（受保护路径 + 期望哈希）~~ → **已接线（v1 形态）**：`boulder_start(protected_files=[…])` 在挂载时把 sha256 快照进 `protected_hashes`，交付时用 `findTampered` 比对；改动或消失 → 报告 `tampered`（**优先于 `unmeasured`**），且不放行、不清 `active_work`、不释放写令牌，只回注一次"还原这些文件"的提醒。
- **已知限制（下一步）**：清单目前由 work 自行声明（`boulder_start` 参数），覆盖"别改自己的测试/证据文件"这一常见场景，但**不是**下面"最小可知性"的理想形态——agent 可以只声明一个宽松清单。理想形态是清单来自策略侧（仓库内 `.dsh-enhance/protected.json`，或直接内嵌在 verify 脚本里），且只在交付门卫执行时挂载。
- **最小可知性**：verify 脚本与 manifest **运行后才挂载到工作区**，agent 在执行中看不到被监控的文件清单与哈希——它无法针对监控项绕过。
- 只读审查角色（reviewer）与写角色（task）分离：受保护文件的校验由门卫/审查方执行，不由被审查任务的写 agent 自己跑。
- 落地警示：verify 脚本必须在「交付门卫执行」时注入，而非随 work 初始 seed 进入——避免 agent 工作前就获知断言细节。

**（3）反锚定（anchor resistance）**

独立审查要防"下传结论覆盖真实证据"：reviewer 若预持主 agent 的"已完成/正确"结论，常照单全收（锚定偏差），而非独立核验。

- reviewer 执行回归审查时，**不携带主 agent 的完成结论与已备答案**，只看场景契约与 verify/evidence，独立下判断。
- 若两个假设都合理，用**盲测量化**：对比"带给结论的 review"与"盲 review"的发现差异；若盲 review 经常推翻预持结论，说明委派独立核验是值得的（否则纯提示词足够）。
- 落地：delivery-gate 派 reviewer 时通过显式指令去掉"你认为做完了"的锚定信号，让它对证据本身下结论。

**（4）完成声明轨迹审计**

- 完成声明与回归结果记入**结构化完成报告**（计划/场景契约/verify 结果/未过项/最终通过项），随会话轨迹持久化，而非只口头宣称。
- 无 verify 证据的完成声明记 `unmeasured`（未测量）而非"通过"；诚实未完成 / 明确报告缺失项也是合法出口（对应场景无解、受保护时）。
- 目的是让"交付质量"可回看、可审计：谁能查"这个 work 是怎么宣称并证明完成的"。
- **落地状态**：`completion_log` 已持久化结构化报告（`work_id` / `at` / `state` / `phase` / `claim`），交付门卫每轮留痕，不通过时同样留痕。

**与 5.2.1 关系**：5.2.1 定状态机（触发→审查→未过回灌），5.2.2 定义"审查到底核对什么、如何防止被游戏"。

### 5.3 工具集（ToolRegistry）

| 工具 | 来源 | 说明 |
|---|---|---|
| `bash` / `read` 守卫工具 | dsh 内置 | 通过 guard 增强，不重写 |
| `lsp_*` | ~~自建~~ | **已砍**：dsh 原生提供 `ctx.lsp`（含 `tool-lsp`），本插件不再自建 LSP 最小集；详见 [design-delivery-gate-hardening.md](design-delivery-gate-hardening.md) §1.5 |
| `comment_check` | 自建 | 写后校验 |
| ~~`goal_create` / `goal_get` / `goal_update`~~ | ~~自建~~ | **已退役**：改用原生 `ctx.goals`（`create_goal`/`get_goal`/`update_goal` + `dsh-goal-round-driver`）；自建 goal 存储与三个工具已删除（`docs/value-assessment.md` §3） |
| `boulder_start` / `boulder_status` / `boulder_complete` | 自建 | 见 5.5 防冲突设计 |
| `worktree_create` / `worktree_list` / `worktree_cleanup` | 新增 | 见 5.6 |
| `dsh_enhance_doctor` | v1 已有 | 保留 |

### 5.4 技能体系与触发路由

- **技能池**：v1 的 `code-review` / `git-workflow` / `tdd` + 新增 `debugging` / `refactoring` / `docs-writing`（README roadmap 已预告）。每个 SKILL.md 遵循 dsh 标准 frontmatter。
- **触发路由**（skill-trigger）：声明式意图路由，把用户输入映射到对应的 mode 提示词或技能加载建议（见 5.4.1）。
- **技能自检**：doctor 工具列出当前会话可见技能（v1 已实现 `ctx.skills.list`）。

### 5.4.1 意图路由体系（声明式 + 意图分类）

把"用户输入 → 该做什么"的判定做成显式、可审计、可扩展的路由层，而不是散落的 if/正则。

**两层判定**：

1. **意图分类（第一层）** —— 先把输入归入一个意图维度，据此路由：`ctx.on('agent/request')` 上先做意图分类，把用户消息归入意图之一：

   | 意图 | 语义 | 典型触发词 | 主要落点 |
   |---|---|---|---|
   | `research` | 研究/查证 | search/调研/有哪些/怎么用/文档 | scout / librarian / search 模式 |
   | `investigation` | 调查/定位根因 | 为什么/定位/排查/错误原因是 | task（debugging 纪律） / investigate 流程 |
   | `evaluation` | 评估/审查/比较 | reviewer/审查/评估/对比/审查代码 | reviewer / analyze 模式 |
   | `implementation` | 实现/改动 | 实现/添加/修复/重构/写 | ultrawork 工作前或 task worker |
   | `fix` | 明确排障修复 | 修 bug/修复/解决报错 | task（debugging 纪律） |

2. **意图 → 技能/mode 路由（第二层）** —— 意图判定后再精确匹配到具体 mode / skill：

   - **声明式规则表**：每个触发目标（mode 如 ultrawork/search/analyze，skill 如 code-review/git-workflow/tdd）自带一份**触发规则**（关键词 + 正则 + 1-2 个正例）。规则集中在一个 `pattern-rules` 数据文件，而非散落在各处。
   - **确定性优先**：显式的 `/skill:foo` 或 `/mode:ultrawork` 调用 > 意图分类 > 模糊关键词。任何显式指令最高优先，rule 不得覆盖。

**匹配优先级（仲裁）** —— 一个输入可能命中多种规则，按此顺序裁决：

1. **显式指令**：`/skill:` `/mode:` 前缀 —— 最高，直接命中，不再做意图分类。
2. **精确强规则**：紧耦合关键词（`foo` 技能名、`ultrawork`/`ulw` 等专有触发词）。
3. **意图维度匹配**：落入某个意图后，该意图的默认落点（如 `research`→search）。
4. 同优先级多条命中时：**输入含专有词的那个优先**；仍并列则不注入（交给主 agent 自己判断）。

**注入方式（不劫持）**：

- 命中 mode → `agent.inject` 注入对应**模式提示词**（如 ultrawork 协议、search/analyze 流程）。
- 命中 skill → `agent.inject` 注入**"建议加载技能 X"**提示，让主 agent 决定是否 `skill` 工具加载。
- **只建议、不强制、不重写**：从不替换用户输入、从不静默执行，优先级始终低于显式调用。

**误触回退**：

- 命中但主 agent 判断用户其实真要别的（如 `evaluation` 命中 analyze 但用户其实要 document）：主 agent 直接忽略注入，或用户 `分析` 被误触反义纠正。
- 每个注入都标注来源（`[skill-trigger:research→search]`），便于审计与撤销。
- 规则表冲突/命中过多（>3）时 fallback 到不注入，避免噪声。

**规则表的演进（skill 自描述）**：

- 每个 SKILL.md frontmatter 增加可选 `triggers:`（关键词/正则/正例），构建时汇入 `pattern-rules` 集中表。新增技能 = 更新其 SKILL.md，无需改路由代码。
- 优先命中分析：可记录"命中但被忽略"事件，帮助后续精简规则。

**与 5.4 技能流的关系**：skill-trigger 是"入口"，doctor 的 `ctx.skills.list` 是"出口/自检"，二者配合让技能体系可发现、可触发、可审计。

### 5.5 Work tracking：boulder 防冲突设计（重点）

现状问题：多会话/多 worktree 若对同一份共享状态做无约束写入（直接覆盖 + 无锁 + 散落 read-modify-write），并发会丢更新。dsh-enhance 的 boulder 从第一版就按防冲突设计：

**存储位置**：仓库根（`git rev-parse --show-toplevel`）的 `.dsh-enhance/boulder.json`，全 repo 唯一实例。所有 worktree 的会话共享这一份，work 通过 `worktree_path` 字段关联——杜绝同 repo 多 worktree 各自持有副本导致的分叉。

**写入协议**（核心）：

1. **单一变更入口**：所有修改走 `mutateBoulderState(directory, mutateFn)`。内部 = 读最新 → 深拷贝 → 应用 mutateFn → 校验 → CAS 写回；冲突则重试（上限 3 次）。禁止在任何 hook/tool 里散落 read-modify-write。
2. **原子写**：`writeFileSync(tmp)` + `renameSync`（写入 tmp 再 rename 的原子替换，取自通用文件原子写实践）。
3. **乐观并发（CAS）**：state 携带单调递增 `revision`。写回前重读，`revision` 不匹配 → 冲突。
4. **冲突合并（按 work 粒度，而非整体覆盖）**：
   - 每个 work 条目按 `updated_at` 取新；
   - `session_ids` / `task_sessions` / `session_origins` 取并集（会话是追加型数据，不该互相覆盖）；
   - 根级 `active_work_id` 以最后成功写入者为准；
   - `plan_name` / `status` 等标量：冲突时保留写入方值并记录 `conflict_log`。
5. **进程级锁**：`.dsh-enhance/boulder.lock`（`mkdir` 原子创建 + 内容含 pid + 启动时间）。获取失败时按陈旧锁检测（pid 不存在或超时 30s）接管；写完成后释放。锁只在"需要 CAS 冲突仍失败"或"批量迁移"时使用，常规单写走 CAS 即可。
6. **schema 校验**：写入前 Zod 校验（自建 schema），坏文件读为 null 不崩溃。

**Goal 存储（已退役）**：本插件曾把 goal 落在 session 级 `<baseDir>/<sessionID>.json`。现在 goal 是**原生** `ctx.goals`（会话日志投影 + CAS 修订 + 原生轮次驱动）。与 boulder 的关系不变：goal = 当前会话的验收契约，boulder = 跨会话的工作计划，两者独立、互相引用（boulder work 可带 `goal_id`）。

### 5.5.1 并发执行策略（写令牌 + worktree 可选并行）

> 说明：上面 CAS/锁只保护 `boulder.json` 这个**状态文件**；它不保护**实际工作产物（代码文件、git 历史）**。多个 agent 同时在同一个工作目录上 plan + execute，boulder 不丢更新，但会写同一文件、交错 commit、互相破坏半成品——这是先行版设计的漏洞，本小节补齐。

**读写角色分类**：

| 动作 | 角色 | 是否写工作区 |
|---|---|---|
| plan / explore / 查证 / 审查 | planner / scout / librarian / reviewer | 否（只读） |
| execute | task（worker） | 是（写文件、commit） |
| assemble | 主 agent | 可能写 |

**核心规则**（混合模型：默认串行 + worktree 可选并行）：

1. **只读可并行**：`planner` / `scout` / `librarian` / `reviewer` 对这些只读角色可任意并行，不占写令牌，也不受写串行影响。它们读 boulder、读工作区，但绝不写文件系统产物。
2. **默认串行（写令牌）**：**同一 repo 上同一时刻只允许一个写会话（execute）**。用"执行令牌"实现——boulder 中一个原子字段 `exec_holder: <sessionId>`（写令牌，通过 `mutateBoulderState` 的 CAS 原子抢占/释放）：
   - 每个 task/execute 会话启动 execute 前必须**抢占令牌**（读-改-write CAS，失败重试，与 5.5 的 CAS 合并规则一致）；
   - 抢占成功才可写文件、commit；结束（或 turn 暂停）必须**释放令牌**；
   - 令牌被占时，其它 execute 会话**等待或提示"等当前执行者释放"**，不得硬写。
   - 这保证无 worktree 时多个 agent plan+execute 也不会在文件系统上互相踩踏——写永远串行。
3. **worktree 可选并行**：若某 execute 会话**在独立 worktree 中**运行（`worktree_path` 已登记、指向独立隔离目录），则**不受写令牌约束**——不同 worktree 的工作区物理隔离，天然可并行。判别：`start-work` 发现 `work.worktree_path` 存在且为该 work 专属 → 走并行通道（不抢令牌）；否则走默认串行（抢令牌）。
4. **plan 与 execute 的关系**：planner 产出计划写入 boulder（只读角色、可并行），task 消费计划后抢令牌执行。多 planner 各写各的 work 条目（并集合并），不做全局互斥——因为它们只写 boulder 元数据、不碰工作区文件。

**判定优先级**：worktree 隔离 > 写令牌串行。一个 work 只要有独立 worktree，就取消令牌约束；没有 worktree 就强制令牌串行。绝不允许"无 worktree 且无令牌"的 execute。

**落地路径**：`boulder-link.ts` 负责登记/释放令牌与 worktree；`start-work` 钩子在会话开始检查"令牌 or worktree"是否就绪，未就绪则注入"等待/创建 worktree"提示；写令牌本身由 `write-token-guard` 在工具管线强制。

### 5.6 Worktree 管理器（重点）

在 dsh 的 `git worktree` 原生能力之上做成一等抽象：

```
features/worktree/
├── manager.ts       # WorktreeManager：create / list / find / cleanup / reuse
├── naming.ts        # 命名约定：<work-id>-<slug>，分支 dsh/<work-id>
├── validation.ts    # 路径校验：拒绝 symlink 逃逸、.. 溢出、大小写规范化
├── git-runner.ts    # git 子进程运行器（可注入，便于单测）
└── boulder-link.ts  # 与 boulder 联动：work.worktree_path 登记 / 注销
```

能力：

- **create(repoRoot, {workId, slug, baseDir})**：`git worktree add --detach`，返回绝对路径；记录到 boulder work。
- **list / find**：`git worktree list --porcelain` 解析；`rev-parse --show-toplevel` 检测当前是否已在 worktree 内。
- **cleanup(workId)**：`git worktree remove` + `git worktree prune`；boulder 中该 work 的 `worktree_path` 置空。
- **reuse(workId)**：续作时若 worktree 仍存在则直接返回路径；被删除则给出重建指令（提示 `git worktree add` 命令本身，不偷偷重建）。
- **安全性**：worktree 路径只允许 `./` `../` 相对或绝对路径（validateWorktreeSpec），且必须位于约定的 baseDir 下。

与续作链的集成：`start-work` 发现 boulder work 带 `worktree_path` 时，注入"你正在 worktree X 中工作"的上下文块。

### 5.7 Agents 体系

dsh 的 agent 通过 `AgentFactory` 注册（dsh-agent-presets 模式，v1 的 `presets/` 已验证）。v2 设计：

- **agent 清单（6 角色，roles.md 定稿）**：`planner`（规划）、`scout`（只读探索，原 explorer）、`librarian`（查证外部库）、`task`（执行/worker，原 executor + debugger 并入）、`reviewer`（审查：质量 + 安全，security 并入其口径）、`advisor`（伴随审核，peer-shadow）。每个 agent 定义 = 中文精简提示词 + 工具白名单 + 模型建议。
- **提示词审查**：见第 6 节，这是 v2 的重头；角色稿见 prompts-review（scout/task/librarian 已按 roles.md 落地）。
- **并发纪律**（见 5.5.1）：只读角色（planner/scout/librarian/reviewer/advisor）可任意并行；`task` 无独立 worktree 时默认串行（抢写令牌），有独立 worktree 时可并行。

### 5.8 三种工作模式/预设（modes）

> 详细设计见 **[modes.md](modes.md)**（设计定稿）。本节为架构层的挂载点说明。

dsh-enhance 把 6 角色按**三种工作模式/预设**组织和呈现，三者共享同一份 v2 能力基底（tool plane + 4 专职 subagent + advisor 伴随运行时 + delivery-gate + boulder/goal + worktree/写令牌纪律），差异只在**编排 persona**（谁主导、按什么流程、如何处理"完成"）：

| 模式 | 预设 | 编排风格 | 一句话 |
|---|---|---|---|
| **A dsh-enhance 万能**（默认） | `presets/dsh-enhance/` | 意图驱动按需委派 | 主 persona 直接实施，按意图调 scout/librarian/reviewer |
| **B Planner 计划实施** | `presets/planner/` | 固定骨架工作流 | planner 按 S1 侦察→S2 澄清→S3 计划→S4 计划审查→S5 用户确认→S6 执行→S7 执行审查的顺序推进，确认闸后才落地 |
| **C Advisor 目标回归** | `presets/advisor/` | goal 驱动的回归环 | 设 goal；advisor 持续纠偏；结束前回归审查，不过则压缩上下文继续直到达标 |

**落地挂载点**：三种模式复用同一份 `agent.cordis.yml` 工具平面（sync-dsh-enhance-preset 产出的 5.4 骨架），仅替换 orchestrator persona 与（可选）subagent 装配偏置。模式 C 直接复用已有 advisor 运行时与 delivery-gate 状态机，不新增代码路径（modes.md 5.2 给出逐环节映射）。预设投递见 `README.md` "Enabling as a web-visible persona"。

> **当前落地状态（2026-09-30）**：只有**模式 A** 已实现并实驱。模式 B 的固定骨架 persona（`prompts/agents/planner.persona.md` 目前仍是单句）与模式 C 的 `prompts/agents/advisor.persona.md` + `presets/advisor/` **均未实现**，是 [modes.md](modes.md) §7 的后续实现项。文档中 `presets/advisor/` 一律按"计划中"理解。

**统一纪律**：无论哪种模式，完成声明都过 delivery-gate；只读角色可并行、写角色受令牌/worktree 约束（5.5.1）；委派用六要素模板；persona 单源 + presets-pin 锁定（modes.md 第 6 节）。

## 6. 提示词审查计划（用户指定：中文 + 精简 + 逐个审查）

### 6.1 审查对象清单

| 提示词 | 现状 | 审查动作 |
|---|---|---|
| ultrawork 模式 | 已拆工作前篇 + 交付前回归审查（见 prompts-review/ultrawork.md、ultrawork-review.md；交付门卫见 5.2.1） | 工作前入口契约 ≤ 100 行；交付前为回归核对清单 |
| agents（planner/scout/librarian/task/reviewer/advisor） | 角色体系见 [roles.md](roles.md)，中文稿见 prompts-review/*.md | 按 roles.md 的合并/重命名/新增逐个重写 |
| work-rules | v1 英文默认文案 | 中文重写 |
| orient 会话消息 | v1 英文 | 中文重写 |
| mode 提示（search/analyze） | 桌面工作流文件 | 中文重写 |

### 6.2 审查流程（每个提示词走同一套）

1. **起草/提取**：明确该提示词的职责边界与来源素材；列出要表达的可执行约束（行为 → 触发条件 → 后果），丢弃情绪化措辞与重复强调（大写 MUST 连用、叹号堆砌）。
2. **中文精简**：每条约束用一句话中文陈述；保留必须的行为语义（如"写代码前先写失败测试"），不保留文体。
3. **精简校验**：目标中文稿 ≤ 100 行（或足够精简）；无 em 破折号、无 AI 填充词（simply/obviously/moreover）。
4. **行为守恒核对**：每一条都能对应回来源素材的某条约束（建映射表），确保精简不丢行为。
5. **实驱验证**：在真实 dsh 会话中分别触发每个 agent / 模式，确认行为约束生效（见第 8 节 QA）。

### 6.3 评审门槛

- 每个提示词交付物 = 中文稿 + 约束来源映射表 + 实驱证据。缺一不算完成。
- 用户对提示词有一票否决权：审查产出先过用户，再进代码。

## 7. 移植清单与里程碑

| 里程碑 | 内容 | 验证 |
|---|---|---|
| **M1 骨架重构** | src/ 按 5.3 布局重组；config 开关组；cordis.patch.yml 更新 | `pnpm typecheck` + 单测 + dsh 实驱加载 |
| **M2 提示词审查** | 第 6 节全部对象完成中文精简 + 映射表 | 用户评审 + 实驱 |
| **M3 守卫 hooks** | write-existing-file-guard / path-traversal / output-truncator / rules-injector + **delivery-gate**（交付门卫：完成声明拦截 → 双层回归审查 → 未过压缩上下文重注入入口契约；含 verify 脚本绑定 / 反攻击 / 反锚定 / 轨迹审计，见 5.2.1-5.2.2） | 单测 + dsh 实驱（写未读文件被拒；假完成声明被拦并回灌契约通过；改受保护文件伪造通过被 verify 揭穿）。反向契约见 `tests/delivery-gate.test.mjs`，实驱占位见 `qa/delivery-gate-drive.mjs` |
| **M4 工作追踪** | boulder（防冲突协议）+ 写令牌 + start-work 续作 + delivery-gate（goal 是原生服务，不再自建） | 并发写冲突单测 + 写令牌抢占/释放单测 + 跨会话续作实驱 + 双 execute 会话串行实驱 |
| **M5 worktree** | WorktreeManager + 工具 + boulder 联动 | 单测 + 实驱（worktree 内会话续作） |
| **M6 技能与触发** | 新增 skills + skill-trigger 声明式路由（意图分类 + 规则表 + 仲裁 + 误触回退，见 5.4.1） | 意图分类单测 + 优先级仲裁单测 + 注入实驱（多模式命中/误触回退） |
| **M7 comment-check** | ~~最小 LSP 集~~（dsh 原生 `ctx.lsp` 已覆盖）+ 写后注释校验 | 实驱 |
| **M8 Team mode（roadmap）** | 多智能体并行协调：team_* 工具 + 事件处理器，存储布局与成员 eligibility 自建 | 单测 + 多 agent 并行实驱 |

依赖顺序：M2 的提示词审查贯穿始终（agents/模式提示词先定稿，M3-M6 的注入文本才不返工）；M1 → M3/M4 可并行；M5 依赖 M4（boulder worktree_path 字段）；M6 依赖 M2（触发提示词）。M8 属 roadmap，在 M1-M7 全部稳定后启动，其扩展缝（配置门控 + 工具注册表挂载点）已在总体架构预留。

## 8. 验证策略（QA）

按 dsh 实驱落地：

1. **单测**：`node --test`（20 个测试文件 / 175 例）。纯逻辑（boulder 冲突合并、写令牌接管、worktree 解析、路径校验、守卫判定、交付门卫状态机、人类指令注册、预设装机）均有单测；并发写冲突为构造式交错（真进程间竞争见 §9 已知限制）。
2. **dsh 实驱**：`qa/` 下三个驱动（`dsh-enhance-drive` / `worktracking-drive` / `delivery-gate-drive`）**默认落在仓库内隔离 home** `.dsh-enhance/desktop-test-home`（profile `qa`；显式 `DSH_HOME` / `DSH_ENHANCE_PROFILE` 优先），真实加载插件后逐项断言：
   - 激活：`--dump` 确认 `# == @dsh-enhance/dsh-enhance` 层合入（零 token）；`--llm` 真实会话命中实质标记（含插件自己写进 stderr 的确定性痕迹）；
   - 守卫 + 工作追踪：越界写被拒、合法写放行、令牌持有者可读、退出后无活进程占用令牌；
   - 交付门卫：假完成声明 → `completion_log` 落盘且 `active_work` 清空。
3. **证据**：每次实驱记录到 `.dsh-enhance/evidence/`（含本次实际使用的 profile 与 `$DSH_HOME`），证明隔离（真实 `$DSH_HOME` 未动）。
4. **提示词验证**：每个 agent/模式一次实驱触发，输出行为核对。

## 9. 风险与开放问题

- **dsh API 稳定性**：Cordis 4 是 deepseek-harness vendored 的，事件负载字段（尤其 `agent/request`、`agent/pre-step`）需在 M1 用真实 dsh 核实后再定守卫实现。
- **LSP 集成成本**：dsh 无 MCP 层则需直接内嵌 LSP 或走工具直调；M7 先做最小集控制风险。
- **comment-checker 二进制**：需确认 dsh 侧可用实现或换方案。
- **worktree 与 Windows**：dsh 跨平台，`git worktree` 路径处理（长短路径、大小写）需在 Windows 上实测（本项目仓库本身就在 Windows 上开发）。
- **不预抽 Core 包**：单一宿主的现实选择；若未来出现第二个 dsh 系 harness，再按 MIT 生态的 Core 分层思路抽取。
