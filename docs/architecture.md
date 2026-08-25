# oh-my-dsh 架构设计（v2 重设计）

> 状态：设计稿 v0.1，待评审
> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 参考蓝本：开源增强插件生态（MIT）——`oh-my-pi`（omp，MIT）、`lazycodex`（MIT）；能力边界与事件面以 `F:\deepseek-harness\packages\*`（MIT）实测类型定义为准，探索证据见对应模块。
> 注：本设计不依赖任何 SUL 许可项目内容。

## 1. 定位与目标

oh-my-dsh 是 DeepSeek Harness 的"电池全包"增强插件（oh-my-zsh 风格）。它把经开源生态验证的能力按 dsh 的插件 API 重新落地：

- **生命周期 hooks**：pre-step/request 守卫 + turn-stopping 续作
- **工具集**：bash/read 守卫、LSP、comment-checker、goal/boulder 工作追踪
- **技能体系**：打包 SKILL.md + 意图触发路由
- **工作追踪**：goal + boulder 状态机，跨会话续作
- **Worktree 支持**：隔离工作区的一等公民抽象

明确不做（v2 范围外）：

- 跨 harness 的 monorepo 分层（Core 包抽取）——dsh 是单一宿主，v2 不预抽 Core；等第二个 harness 出现再谈
- 遥测、自动更新等运营设施——留到 v3

延后实现（roadmap feature，v2 只预留扩展缝、不实现）：

- **Team mode**（多智能体并行协调）——dsh 侧需在 M1 实测后由插件层自建：`team_mode.enabled` 配置门控 + 独立工具注册表 + 存储布局（`~/.omd/teams/{name}/` 的 mailbox / tasklist.jsonl / worktrees，成员 eligibility 注册表）。当前 adapter 层与 hook 分层不堵死该扩展：后续新增 team_* 工具与事件处理器时，挂进 ToolRegistry 与事件面即可，无需重构。

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
oh-my-dsh/
├── docs/                  # 设计 + 用户文档
├── skills/                # 打包 SKILL.md（静态知识层）
├── presets/               # dsh-agent-presets 预设目录（可选安装）
├── src/                   # ★ adapter 层（单一宿主平台插件）
│   ├── index.ts           # 插件入口：name / inject / Config / apply
│   ├── config/            # schemastery schema（插件行 config）
│   ├── hooks/             # 生命周期钩子（每个能力一个目录）
│   ├── tools/             # 工具注册（ToolRegistry）
│   ├── agents/            # 智能体定义（AgentFactory 工厂）
│   ├── features/          # 特性模块（skill 触发路由、worktree manager…）
│   ├── shared/            # 跨模块工具（路径规范化、git 运行器、日志）
│   └── cli/               # 未来的 CLI 子命令（doctor、boulder…）
├── tests/                 # node --test 单测 + dsh 实驱 QA 脚本
├── cordis.patch.yml       # 插件注入补丁
└── package.json
```

**Adapters 层布局**：`src/` 采用一能力一目录的扁平组织（`hooks/{name}/`、`tools/{name}/`、`agents/` 工厂模式、`features/` 独立特性模块），便于逐能力审查与桶导出。该思路借鉴自 MIT 开源插件生态（`oh-my-pi` coding-agent 的 prompts/tools/agents 域划分、`lazycodex` 的 `plugins/omo/` 组件化目录），并结合 dsh 单包 Cordis 插件的特点：扁平目录 + 工厂 + 桶导出与 dsh 最匹配。

## 4. dsh API 能力映射（dsh 事件面 → oh-my-dsh 能力）

探索自 `F:\deepseek-harness\packages\core\*` 类型定义（MIT），实现时以实际 d.ts 为准。

| dsh 能力 | oh-my-dsh 落点 | 备注 |
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

- 插件行 `config`：`workRules` / `orientOnSessionStart` / `doctorTool`（沿用 v1）+ 新增 `skillsEnabled` / `guards` / `workTracking` / `worktree` 开关组。
- 每项功能默认开启、可单独关闭（继承 v1 的"Turn it off"表格式习惯）。
- 不变更 dsh 主配置格式；`cordis.patch.yml` 只负责插入 oh-my-dsh 一行。

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
| `rules-injector` | 会话开始时按工作区发现 AGENTS.md / `.omd/rules/`，注入为系统段落（自建 finder/matcher，缓存 + 距离计算） |
| `skill-trigger` | 检测输入意图（ultrawork / search / analyze），注入对应模式提示词 |
| `work-rules` | v1 已有，保留 |

**C. 会话续作（Continuation）** —— 挂在 `agent/turn-stopping` / `agent/session-start`：

| 机制 | 行为 |
|---|---|
| `start-work` | 会话开始发现 boulder 活跃计划 → 注入续作上下文（计划、todo、notepad） |
| `todo-continuation-enforcer` | turn-stopping 时若 todo 未清、无阻塞，注入"继续"提醒 |
| `goal-guard` | goal 活跃时，完成前禁止宣称 done（注入校验提示） |

### 5.3 工具集（ToolRegistry）

| 工具 | 来源 | 说明 |
|---|---|---|
| `bash` / `read` 守卫工具 | dsh 内置 | 通过 guard 增强，不重写 |
| `lsp_*` | 自建 | dsh 侧先做最小集：diagnostics / goto_definition / references；进程管理用每用户共享守护进程 |
| `comment_check` | 自建 | 写后校验 |
| `goal_create` / `goal_get` / `goal_update` | 自建 | session 级 JSON 存储 |
| `boulder_start` / `boulder_status` / `boulder_complete` | 自建 | 见 5.5 防冲突设计 |
| `worktree_create` / `worktree_list` / `worktree_cleanup` | 新增 | 见 5.6 |
| `oh_my_dsh_doctor` | v1 已有 | 保留 |

### 5.4 技能体系与触发路由

- **技能池**：v1 的 `code-review` / `git-workflow` / `tdd` + 新增 `debugging` / `refactoring` / `docs-writing`（README roadmap 已预告）。每个 SKILL.md 遵循 dsh 标准 frontmatter。
- **触发路由**（skill-trigger）：`agent/request` 上做轻量意图分类（关键词 + 正则），命中则通过 `agent.inject` 注入"建议加载技能 X"提示，不强制、不重写用户输入。优先级低于显式 `/skill:` 调用。
- **技能自检**：doctor 工具列出当前会话可见技能（v1 已实现 `ctx.skills.list`）。

### 5.5 Work tracking：boulder 防冲突设计（重点）

现状问题：多会话/多 worktree 若对同一份共享状态做无约束写入（直接覆盖 + 无锁 + 散落 read-modify-write），并发会丢更新。oh-my-dsh 的 boulder 从第一版就按防冲突设计：

**存储位置**：仓库根（`git rev-parse --show-toplevel`）的 `.omd/boulder.json`，全 repo 唯一实例。所有 worktree 的会话共享这一份，work 通过 `worktree_path` 字段关联——杜绝同 repo 多 worktree 各自持有副本导致的分叉。

**写入协议**（核心）：

1. **单一变更入口**：所有修改走 `mutateBoulderState(directory, mutateFn)`。内部 = 读最新 → 深拷贝 → 应用 mutateFn → 校验 → CAS 写回；冲突则重试（上限 3 次）。禁止在任何 hook/tool 里散落 read-modify-write。
2. **原子写**：`writeFileSync(tmp)` + `renameSync`（写入 tmp 再 rename 的原子替换，取自通用文件原子写实践）。
3. **乐观并发（CAS）**：state 携带单调递增 `revision`。写回前重读，`revision` 不匹配 → 冲突。
4. **冲突合并（按 work 粒度，而非整体覆盖）**：
   - 每个 work 条目按 `updated_at` 取新；
   - `session_ids` / `task_sessions` / `session_origins` 取并集（会话是追加型数据，不该互相覆盖）；
   - 根级 `active_work_id` 以最后成功写入者为准；
   - `plan_name` / `status` 等标量：冲突时保留写入方值并记录 `conflict_log`。
5. **进程级锁**：`.omd/boulder.lock`（`mkdir` 原子创建 + 内容含 pid + 启动时间）。获取失败时按陈旧锁检测（pid 不存在或超时 30s）接管；写完成后释放。锁只在"需要 CAS 冲突仍失败"或"批量迁移"时使用，常规单写走 CAS 即可。
6. **schema 校验**：写入前 Zod 校验（自建 schema），坏文件读为 null 不崩溃。

**Goal 存储**：session 级 `<baseDir>/<sessionID>.json` + 原子写。goal 与 boulder 的关系：goal = 当前会话的验收契约（objective/status/tokens），boulder = 跨会话的工作计划（plan/todo/worktree），两者独立存储、互相引用（boulder work 可带 `goal_id`）。

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

**落地路径**：`boulder-link.ts` 负责登记/释放令牌与 worktree；`start-work` / `todo-continuation-enforcer` 在 execute 开始处检查"令牌 or worktree"是否就绪，未就绪则注入"等待/创建 worktree"提示而非直接执行。

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

- **agent 清单**：`planner`（规划）、`reviewer`（审查，v1 已有）+ `executor`（执行）、`explorer`（只读探索）、`debugger`（排障）。每个 agent 定义 = 中文精简提示词 + 工具白名单 + 模型建议。
- **提示词审查**：见第 6 节，这是 v2 的重头。
- dsh v2 先做 4-5 个精干 agent，不过度设计多 agent + 变体路由；模型路由留待需要时。

## 6. 提示词审查计划（用户指定：中文 + 精简 + 逐个审查）

### 6.1 审查对象清单

| 提示词 | 现状 | 审查动作 |
|---|---|---|
| ultrawork 模式 | 见 prompts-review/ultrawork.md（自主设计） | 中文精简稿已产出，目标 ≤ 100 行 |
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
| **M3 守卫 hooks** | write-existing-file-guard / path-traversal / output-truncator / rules-injector | 单测 + dsh 实驱（写未读文件被拒） |
| **M4 工作追踪** | boulder（防冲突协议）+ 写令牌 + goal + start-work 续作 + todo-continuation-enforcer | 并发写冲突单测 + 写令牌抢占/释放单测 + 跨会话续作实驱 + 双 execute 会话串行实驱 |
| **M5 worktree** | WorktreeManager + 工具 + boulder 联动 | 单测 + 实驱（worktree 内会话续作） |
| **M6 技能与触发** | 新增 skills + skill-trigger 路由 | 单测 + 实驱 |
| **M7 LSP + comment-checker** | 最小 LSP 集 + 写后校验 | 实驱 |
| **M8 Team mode（roadmap）** | 多智能体并行协调：team_* 工具 + 事件处理器，存储布局与成员 eligibility 自建 | 单测 + 多 agent 并行实驱 |

依赖顺序：M2 的提示词审查贯穿始终（agents/模式提示词先定稿，M3-M6 的注入文本才不返工）；M1 → M3/M4 可并行；M5 依赖 M4（boulder worktree_path 字段）；M6 依赖 M2（触发提示词）。M8 属 roadmap，在 M1-M7 全部稳定后启动，其扩展缝（配置门控 + 工具注册表挂载点）已在总体架构预留。

## 8. 验证策略（QA）

按 dsh 实驱落地：

1. **单测**：`node --test`（现有 `tests/unit.test.mjs` 扩展）。纯逻辑（boulder 冲突合并、worktree 解析、路径校验）必须有单测，尤其**并发写冲突单测**（两个 mutate 交错 → 合并结果正确）。
2. **dsh 实驱**：隔离 `$DSH_HOME`，`dsh --profile <sandbox>` 真实加载插件，逐项断言：
   - 守卫：写未读文件 → 拒绝；
   - 续作：turn-stopping 后 todo 未清 → 注入继续；
   - boulder：两个会话交错写 → 无丢失更新；
   - worktree：会话在 worktree 内续作 → 上下文正确。
3. **证据**：每次实驱记录到 `.omd/evidence/`，证明隔离（真实 `$DSH_HOME` 未动）。
4. **提示词验证**：每个 agent/模式一次实驱触发，输出行为核对。

## 9. 风险与开放问题

- **dsh API 稳定性**：Cordis 4 是 deepseek-harness vendored 的，事件负载字段（尤其 `agent/request`、`agent/pre-step`）需在 M1 用真实 dsh 核实后再定守卫实现。
- **LSP 集成成本**：dsh 无 MCP 层则需直接内嵌 LSP 或走工具直调；M7 先做最小集控制风险。
- **comment-checker 二进制**：需确认 dsh 侧可用实现或换方案。
- **worktree 与 Windows**：dsh 跨平台，`git worktree` 路径处理（长短路径、大小写）需在 Windows 上实测（本项目仓库本身就在 Windows 上开发）。
- **不预抽 Core 包**：单一宿主的现实选择；若未来出现第二个 dsh 系 harness，再按 MIT 生态的 Core 分层思路抽取。
