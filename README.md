# dsh-enhance

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 oh-my-zsh 风格增强插件。一次安装即可获得：打包的技能、持久的 work-rules 提示词段、会话开场 orient 钩子、doctor 工具，以及不断增长的 v2 能力面：工作追踪（boulder/goal）、守卫 + delivery-gate 纪律、worktree、`ulw` 深度工作模式、advisor 伴随审核运行时，以及一个把 scout / librarian / reviewer / task 作为子代理派发的 dsh-enhance 编排人设。

本项目仅称为 **dsh-enhance**。

## 你能获得什么

| 能力 | 作用 | 关闭方式 |
|---|---|---|
| **打包技能**（`code-review`、`git-workflow`、`tdd`） | 随包内置的技能包，通过标准的 `skill` 工具暴露 | 始终开启 |
| **work-rules 段** | 常驻系统提示词段（`dsh-enhance/work-rules`），内容为通用工作纪律 | `workRules: ''` |
| **orient 开场钩子** | 每次会话开始注入一条中文消息：点名当前激活的插件包与其技能，并附 1–2 条可执行起点（`dsh_enhance_doctor` / `ulw`） | `orientOnSessionStart: false` |
| **doctor 工具** | `dsh_enhance_doctor` 报告实时装配状态（已加载插件、已注册技能、生效配置），并给出可执行的下一步建议 | `doctorTool: false` |
| **守卫 + delivery-gate** | write-existing / path-traversal / bash-read 守卫、rules 注入器、完成声明 delivery-gate | `guards: false` |
| **工作追踪** | boulder（CAS）+ goal 存储、写令牌、start-work / todo-continuation / delivery-gate 钩子 | `workTracking: false` |
| **worktree** | `worktree_create/list/cleanup` 工具 + boulder 联动 | `worktree: false` |
| **`ulw` / ultrawork 模式** | 输入提到 `ulw`/`ultrawork` 时，在首个步骤前注入深度工作入口契约（`<ultrawork-mode>`） | — |
| **Advisor** | 伴随审查子代理跟随每个主会话：接收每轮增量 transcript，把建议 steers/injects 回注（`nit` / `concern` / `blocker`） | `advisor: false` |
| **工作模式** | 在同一能力基底之上的三种可选预设：**dsh-enhance 万能**（默认编排者，意图驱动按需委派）、**Planner 计划实施**（固定骨架：scout/librarian 收集 → 澄清 → 计划 → 计划审查 → 用户确认 → 并行 task 执行 → 执行审查）、**Advisor 目标回归**（目标驱动：advisor 持续向目标纠偏，delivery-gate 回归循环直到达标）。**当前只落地了模式 A**；B/C 的编排 persona 与预设仍是设计稿（见 `docs/modes.md` §7） | 选择对应 persona 预设 / 见 `docs/modes.md` |
| **Agent 预设** | 底层 6 角色：`planner` / `scout` / `librarian` / `task` / `reviewer` 作为 persona 预设，外加 `advisor`（伴随机制，**不是**可选人设预设）；上面三种**工作模式**对它们进行编排 | 见 `docs/modes.md` |

## 安装

需要 `dsh` CLI（npm：`@deepseek-ai/dsh`）。示例使用名为 `dsh-enhance` 的 profile；如有不同可替换为你自己的 profile 名。

```sh
# 发布后
dsh plugin --profile dsh-enhance add dsh-enhance

# 或直接从本 checkout
dsh plugin --profile dsh-enhance add ./path/to/dsh-enhance

# 或从 git（包通过 `prepare` 自构建）
dsh plugin --profile dsh-enhance add git@gitcode.com:jiangh_hnr/dsh-enhance.git

# 或作为实时调试链接（指向本 checkout；改 src/ 后执行 `pnpm build`）
dsh plugin --profile dsh-enhance add link:F:/dsh-enhance
```

本插件是一个补丁层：它向 profile 中插入一行 `dsh-enhance` 插件。验证方式：

```sh
dsh --profile dsh-enhance --dump-config   # 查找 "# == dsh-enhance" 层
```

### 在 web 中作为可见 persona 启用

若要在 `dsh web` 中可选到 **工作模式预设 / 编排者**（以及可选地底层角色预设），把预设目录复制到 `dsh-agent-presets` 扫描的 harness-home 预设根下：

```sh
mkdir -p "$HOME/.dsh/.agent-presets"
cp -r presets/dsh-enhance "$HOME/.dsh/.agent-presets/"   # 工作模式 A：dsh-enhance 万能（默认编排者）
cp -r presets/planner "$HOME/.dsh/.agent-presets/"   # 工作模式 B 的底层角色预设（骨架编排 persona 尚未落地）
# 如需，可重复复制 presets/scout、presets/librarian、presets/reviewer、presets/task
```

> 工作模式 C（Advisor 目标回归）需要 `presets/advisor/` 与 `prompts/agents/advisor.persona.md`，**两者尚未实现**（见 `docs/modes.md` §5/§7）；当前 advisor 运行时是通过插件 Config 默认开启的伴随机制，不需要预设。

`dsh-enhance` 编排者预设把四个子 persona（`scout` / `librarian` / `reviewer` / `task`）接线为受作用域限制的 `subagent` 工具，各自带 persona 文本与限制其工具面的 `toolFilter`。**注意：只有这个主预设挂了 4 条作用域子代理行**；`presets/<role>/` 角色预设只带通用 `subagent` / `subagent_fork`。三种工作模式的设计意图是共享同一份工具平面与子代理池，但模式 B/C 的预设尚未落地（见 `docs/modes.md`）。

## 配置

插件行接受一个 `config` 块——可在你的 profile 的 `cordis.patch.yml` 或 home `$DSH_HOME/cordis.patch.yml` 中覆盖：

```yaml
- id: dsh-enhance
  name: dsh-enhance
  config:
    workRules: |
      # 团队规则
      Always run the full test suite before pushing.
    orientOnSessionStart: true
    doctorTool: true
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `workRules` | 内置纪律文案 | 提示词段文本；空字符串则移除该段 |
| `orientOnSessionStart` | `true` | 会话开始时注入一次性开场消息 |
| `doctorTool` | `true` | 注册 `dsh_enhance_doctor` 工具 |
| `guards` | `true` | 守卫钩子 + rules 注入器 + delivery-gate 的总开关 |
| `workTracking` | `true` | boulder/goal 存储、写令牌、工作钩子的总开关 |
| `worktree` | `true` | `worktree_create/list/cleanup` 工具（需要 workTracking） |
| `advisor` | `true` | Advisor 伴随审查运行时 |
| `advisorModel` | — | advisor 子代理的独立模型；默认继承主 agent 的路由 |

## 开发

```sh
pnpm install
pnpm build          # tsc → lib/
pnpm typecheck
pnpm test           # node --test
pnpm sync:presets   # 从 prompts/agents/<role>.persona.md 重新生成 presets/<role>/
node scripts/sync-dsh-enhance-preset.mjs   # 重新生成 presets/dsh-enhance/（编排者 + 子代理行）
```

包是 ESM，零运行时依赖：所有 `@deepseek-ai/dsh-*` 导入都是类型导入（构建时擦除），`@deepseek-ai/cordis` 由 harness 作为 peer 提供。

贡献者的工作纪律：先读 `AGENTS.md`；改动 prompts 或 roles 之前先查看 `docs/architecture.md` 与 `docs/roles.md`；persona 文本单源维护在 `prompts/agents/`（绝不手改生成的 `presets/`——字节锁定测试强制这一约定）。

## 设计文档

- `AGENTS.md` — 如何在本仓库工作。
- `docs/architecture.md` — 架构与 M1–M8 里程碑计划。
- `docs/roles.md` — 6 角色智能体集。
- `docs/modes.md` — 三种工作模式（dsh-enhance 万能 / Planner 计划实施 / Advisor 目标回归）及它们如何编排这些角色。
- `docs/prompts-review/` — 逐提示词审查稿：persona/review 源 + 约束映射 + 规模校验 + 实驱状态。
- `docs/borrowing-analysis.md` — 从 MIT 生态（lazycodex、oh-my-pi）借用的模式及其落点。
- `docs/archive/` — 被取代/过时但保留作历史的文档。

## 路线图（v2 里程碑）

- **M1 ✅ 骨架**：`src/` 按能力目录重组；`prompts/agents/` 单源 + 生成 + 字节锁定；persona 预设落地。
- **M2 ✅ 提示词审查**：所有提示词经审查并中文化；采用 6 角色体系。
- **M3 ✅ 守卫 + delivery-gate**：write-existing/path-traversal/bash-read 守卫、rules-injector、delivery-gate 状态机 + verify 绑定 + 防篡改 + 完成报告。
- **M4 ✅ 工作追踪**：boulder（CAS、work 合并）、goal 存储、写令牌、start-work + todo-continuation + delivery-gate 钩子。
- **M5 ✅ worktree**：WorktreeManager（create/list/find/cleanup/reuse）、命名 + 路径校验、boulder 联动、worktree_create/list/cleanup 工具。
- **M6 skill-trigger**：`ulw` / ultrawork 入口契约注入。
- **M7 LSP / comment-check**：计划中。
- **M8 团队模式**：roadmap，稳定后推进。

## 许可证

MIT
