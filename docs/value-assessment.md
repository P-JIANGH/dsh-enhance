# dsh-enhance 的存在价值评估

> 日期：2026-09-30 · 依据：live 运行时的服务/工具清单（`cordis_inspect`）、上游包源码与 README（`dsh-commands`、`dsh-agent-presets`、`dsh-agent-instructions`、`cordis-plugin-loader`…）、本仓库代码/测试/台账，以及本次会话在**真实桌面版 0.2.0-rc.2** 上的实测。
> 一句话结论：**作为"能力包"，它的独特面比 README 宣称的小得多；作为"纪律/政策包 + 验收脚手架"，它的价值是真的——但只能靠做减法维持，靠加功能只会越来越薄。**

## 1. 上游 dsh 已经给了什么（本次用运行时核对，不是印象）

| 能力 | 上游承载 | 本次证据 |
|---|---|---|
| 技能：`/` 触发、手打 `/name` 确定性注入正文、按会话候选 | `dsh-client-ui-skill` + `skill` 工具 | README（`skill.list` RPC + pre-step 手势边界） |
| 人类指令注册表 + `/` 菜单（模糊匹配、三种派发） | `ctx.commands` + `dsh-client-ui-commands` | 服务目录 + 上游 README |
| 预设：YAML composition、shipped + 用户根、会话创建时固定 | `dsh-agent-presets` + `dsh-client-ui-agent-preset` | 我读到的 `PresetTree.import()` / `resolvedRoots` |
| 目标：跨轮自动续作 | `goals` 服务 + 工具 `create_goal` / `get_goal` / `update_goal` | **本次工具清单里就有这三个** |
| 团队：成员、共享任务板、邮箱 | `agentTeams` + `spawn_teammate` / `team_task_*` / `wait_agent` | 工具清单 + 服务目录 |
| 子代理：spawn / fork，可续作 | `subagents` + `subagent` / `subagent_fork` | 工具清单 |
| 日程、工作流、插件管理、终端、附件、语音、权限预设、设置卡片 | `schedule_*` / `workflow` / `plugin_manager` / `terminalController` / … | 工具清单 + 服务目录 |
| `AGENTS.md` 指令链（`$DSH_HOME/AGENTS.md` + 目录链 + `CLAUDE.md` 覆盖）与变更重发现 | `@deepseek-ai/dsh-agent-instructions` | 上游 README（逐条明确） |
| 工具结果剪枝 / 先读后写策略 | `toolResultPruner` / `fs-observation-policy` | 服务目录 + 台账 P2-1/P2-2 |
| 桌面 profile 另挂 `@deepseek-ai/dsh-experimental-auto-review`、`dsh-experimental-agent-team-profile` | 打包在 `app.asar` 内 | profile 的 `dsh.profile.bundles`；**源码本次读不到，范围未核实** |

## 2. dsh-enhance 真正新增的（按可替代性分级）

**A. 机制级，且上游确实没有（价值最高）**

1. **写令牌**：一个工作区一个写者，且在**工具管线**里强制（不只是状态文件里的君子协定）；持有进程 pid 已死即可立即接管（真实 headless 退出不触发 `agent/disposed`，这个坑是实驱抓出来的）。
2. **交付门卫**：把"我完成了"当**声明**来判定，绑定可执行 `verify`，产出结构化报告，并推进 work 状态 / 清 `active_work` / 释放令牌。服务目录里**没有任何** gate/verify/deliver 类服务——这是它最硬的差异面。

**B. 内容级（价值=选品，可替代性高）**

3. 3 个打包技能（`code-review` / `git-workflow` / `tdd`）、`work-rules` 常驻段落、`ulw` 深度工作入口契约、6 个角色 persona/预设。这些是**观点与文案**：任何用户都能用原生技能与预设机制自己写一份。

**C. 便利 / 诊断级**

4. `dsh_enhance_doctor` 与 `/doctor`、`/boulder`、orient 开场消息、librarian 的 `web_search` 授权。降低"装了但不知道有没有生效"的成本，天花板低。

**D. 工程资产（对作者本人的价值可能最高）**

5. 隔离实驱 QA（`.dsh-enhance/desktop-test-home` + 三个驱动 + 证据纪律）、预设字节 pin、修复台账。**本次会话真正抓到的问题几乎都来自它**：预设脚本"先装后删"、技能归属按 `source` 误判、实驱跑错环境导致假失败。任何插件都受益于这套脚手架。

## 3. 重叠与冲突（这一节是**负价值**）

> **处置状态（2026-09-30）**：前两行已按建议退役（台账 P1-13）。advisor 一行保持原样——上游包在 `app.asar` 内，本次无法读到源码核实范围，不做基于猜测的行为改动。

| 本插件能力 | 上游对应 | 现状 | 建议 |
|---|---|---|---|
| ~~`goal_create` / `goal_get` / `goal_update` + `.dsh-enhance/goals/`~~ | `goals` 服务 + `create_goal` / `get_goal` / `update_goal`（会话日志 + 原生轮次驱动） | **已处置**：自建 goal 存储与三个工具已删除；`delivery-gate` 改读原生 `ctx.goals`，c13 消歧从 `remainingTodos` 换成 `goalOpen` | — |
| ~~`rules-injector`（AGENTS.md 发现）~~ | `dsh-agent-instructions`（完整指令链 + 嵌套重发现） | **已处置**：只保留 `.dsh-enhance/rules/`，AGENTS.md 交还原生（含负向测试钉） | — |
| ~~`todo-continuation`（自建计数驱动续作）~~ | `dsh-goal-round-driver`（active goal → 连续轮次） | **已处置**：计数随自建 goal 一起消失，续作归原生 | — |
| `advisor` 伴随审查 | 桌面 profile 的 `dsh-experimental-auto-review` | 可能重复（上游范围未核实） | 先核实再决定"差异化"或"退役" |
| M8 团队模式（路线图） | 原生 Agent Teams | 直接重复 | 不要再做（README 已标注） |
| output-truncator / write-existing 守卫 | `tool-result-pruner` / `fs-observation-policy` | 已确认被取代（台账 ⛔ 保留为已测纯函数） | 保持不接线，或连实现一起删 |
| 角色预设、技能、人类指令 | 原生同名机制 | 同一机制上的**内容**，非重复 | 保留（这是"选品"该有的样子） |

## 4. 成本与风险

- **上游漂移税**：dsh 是 developer preview 且明示破坏性变更；上游每补一块，重复面就从"加分"变成"负债"——**已经发生过两次**（剪枝、先读后写）。
- **体量比**：`src` 3420 行 / 测试 2253 行 / 文档 1981 行 / 脚本 782 行；其中第 2 节 A 类（不可替代）目测不足 10%。
- **模型歧义（已消除）**：`goal_*` 与原生 `*_goal` 曾同时出现在工具面，是真实的误用来源；自建 goal API 退役后只剩一套。
- **最后一公里被低估**：本次实测证明"装完即用"曾是**假的**（没有人类指令、预设从没装过、旧名残留让预设选中即挂载失败）。可见性与接线成本被设计文档系统性低估。
- **单作者、无外部用户**：没有生态回报，只有个人收益；投入产出比完全取决于作者自己的使用频率。

## 5. 如果继续投入，建议这么投

1. **做减法**（优先级最高）—— ✅ 2026-09-30 完成第一轮：goal API/存储、重复的 AGENTS.md 注入、todo 续作驱动已退役（台账 P1-13），"刻意不做什么"已写进 `AGENTS.md` 的 Non-goals 一节。下一轮候选：`advisor`（先核实上游 auto-review 的范围）、output-truncator / write-existing 的实现本身。
2. **加厚唯一的护城河**：交付门卫的 verify 模板库 / 受保护文件 manifest / 报告落盘；写令牌的进程锁与孤儿回收。这是上游没覆盖、且**用户能感知收益**的地方。
3. **收紧对外承诺**：只承诺"纪律默认值 + 诊断 + 可验证验收"，不再承诺"更多能力"。
4. **把 QA 骨架与台账当一等资产**：它证明过自己能抓真 bug，比多写两个 persona 值钱。
5. **若要产品化**：护城河只能是"**强制 + 可验证**"——提示词与技能谁都能抄，机制上游随时会补。

## 6. 直接回答"dsh 本身就很强了，还需要这个项目吗"

- **需要**，如果你要的是**纪律的默认值**：每个会话默认先读文件核事实、小步可审查、留下可验证证据、不许假称完成、一个工作区一个写者。上游提供的是**机制**，政策得自己定——这份政策目前只有 dsh-enhance 在用可执行的 verify 把它钉住。
- **不需要**，如果你要的是**能力**：技能、预设、指令、目标、团队、日程、工作流、审查，上游都有或在补；在这条路上 dsh-enhance 只会越来越像一层薄壳，且每加一层都要跟着上游漂移维护。
- **最诚实的定位**：它不是"dsh 的能力扩展包"，而是**一份个人化的政策包 + 一套真跑的验收脚手架**（外加 oh-my-zsh 式的选品）。它的价值随"你多在意不许假称完成"上升，随"上游又补了哪一块"下降——所以正确的动作长期是**删减**，不是扩张。
