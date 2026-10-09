# dsh-enhance

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 oh-my-zsh 风格增强插件。一次安装即可获得：打包的技能、持久的 work-rules 提示词段、doctor 工具，以及不断增长的 v2 能力面：工作追踪（boulder + 写令牌；goal 用**原生**服务）、守卫 + delivery-gate 纪律、worktree、advisor 伴随审核运行时，以及一个把 scout / librarian / reviewer / task 作为子代理派发的编排预设 **Enhance**（id `enhance`）——它还常驻一段深度工作协议（enhance-mode）作为预设作用域内的系统提示词段。

本项目仅称为 **dsh-enhance**。

## 你能获得什么

| 能力 | 作用 | 关闭方式 |
|---|---|---|
| **打包技能**（`code-review`、`git-workflow`、`tdd`） | 随包内置的技能包，通过标准的 `skill` 工具暴露 | 始终开启 |
| **work-rules 段** | 常驻系统提示词段（`dsh-enhance/work-rules`），内容为通用工作纪律 | `workRules: ''` |
| **doctor 工具** | `dsh_enhance_doctor` 报告实时装配状态（已加载插件、已注册技能、生效配置），并给出可执行的下一步建议 | `doctorTool: false` |
| **人类指令**（`/doctor`、`/boulder`） | UI `/` 菜单里属于本包的入口：`/doctor` 复用同一份装配诊断，`/boulder` 显示工作追踪状态。结果只在 UI 渲染——**不进模型历史、不消耗 token** | `commands: false` |
| **守卫 + delivery-gate** | write-existing / path-traversal / bash-read 守卫、rules 注入器（只读 `.dsh-enhance/rules/`）、完成声明 delivery-gate：绑定 `verify` + **受保护文件 manifest（sha256 快照，改动即 `tampered`）**，原生 goal 未完成时判为进展汇报 | `guards: false` |
| **工作追踪** | boulder（CAS）+ 写令牌 + start-work / delivery-gate 钩子。**目标（goal）归原生**：`create_goal`/`get_goal`/`update_goal` + `dsh-goal-round-driver`（目标未完成自动续轮） | `workTracking: false` |
| **worktree** | `worktree_create/list/cleanup` 工具 + boulder 联动 | `worktree: false` |
| **增强模式段（enhance-mode）** | 一段深度工作协议，由本包以 `@dsh-enhance/dsh-enhance/enhance-mode` 行贡献，**只挂在 Enhance 预设作用域内**：选了该预设的会话每个都常驻这段系统提示词；没选的会话完全看不到。没有关键词触发，也没有"退出模式"的动作 | 不在预设里，就不出现（`cordis.patch.yml` 的 `preset-enhance` 行） |
| **Advisor** | 伴随审查子代理跟随每个主会话：接收每轮增量 transcript，把建议 steers/injects 回注（`nit` / `concern` / `blocker`） | `advisor: false` |
| **工作模式** | 面向用户的主预设是 **Enhance**（预设 id `enhance`）：常驻深度工作提示词段 + 纪律 + 打包技能 + 交付门卫，且**保留编排**——它把 scout/librarian/reviewer/task 接线为受作用域限制的子代理，因此"一个会话只有一个预设"也能分派专职子代理 | 新建会话时选 **Enhance** |
| **Agent 预设** | 本插件只出 **1 个**：`Enhance`（id `enhance`，编排者 + 常驻 enhance-mode 段）。预设由 bundle 补丁层声明（`cordis.patch.yml`），**不需要安装动作**；名册里另外那些（standard / ptc / minimal / cordis）是上游自带的 | 见 `docs/modes.md` |
| **界面配置页** | 内置「插件」面板里本插件那一行有「配置」入口：6 个开关 + 顾问模型就地改，**保存即生效**（写入 profile 补丁的 user 层，每项可单独恢复默认） | 无需配置；只有 `workRules` 仍需在 YAML 里改 |

## 如何体验（装完之后你会看到什么）

插件是 **profile 级 bundle**：profile 启动时挂载，**所有会话共享**，因此不需要选预设也已经生效（`dsh_enhance_doctor` 会报「插件已加载：是」）。能力分三层落地，先分清哪一层在哪儿看得见：

| 你看到的 | 怎么触发 | 需要什么 |
|---|---|---|
| **`/` 菜单里的打包技能** `code-review` / `git-workflow` / `tdd` | 在输入框打 `/`；或直接手打 `/tdd`——手打的同名 token 会把技能正文确定性注入该轮 | 插件已挂载 |
| **`/` 菜单里的本包指令** `/doctor`、`/boulder` | 在输入框打 `/` 选择后回车（两条都无入参→回车即执行） | `commands: true`（默认） |
| **预设**：**Enhance**（id `enhance`，编排者 + 常驻 enhance-mode 段） | 新建会话时用会话标题旁的预设菜单选择；或在设置的预设名册区块里设为默认。预设由 bundle 补丁声明，装好插件就在 | 插件已挂载（预设行随 bundle 一起生效） |
| **模型侧工具** `dsh_enhance_doctor`、`boulder_*`、`worktree_*`（目标用原生的 `create_goal`/`get_goal`/`update_goal`） | 让模型使用即可（也可以直接说「跑一下 dsh_enhance_doctor」） | 对应开关（默认全开） |
| **本插件的配置页** | 侧边栏「插件」面板 → `@dsh-enhance/dsh-enhance` 包 → 它那一行的「配置」 | 桌面端 / loopback Web（浏览器半侧随包发布） |

两个容易误解的点：

- **预设是「会话创建时固定」的**：上游明确拒绝给已存在的会话换预设（会话历史是在前一个预设的工具面下产生的）。要试 **Enhance**，请**新建会话**再选；改「默认预设」也只对之后新建的会话生效。
- **enhance-mode 不是指令、也不是触发词**，而是 Enhance 预设作用域内的常驻系统提示词段：只有选了该预设的会话有它。**需要 dsh ≥ 0.2.0 的行式预设注册表**（见 `docs/installing-plugins.md`）。

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

### 预设（无需安装动作）

预设由 bundle 的补丁层声明，**不是目录**：`cordis.patch.yml` 插入本插件行与 `preset-enhance` 行（`@deepseek-ai/dsh-agent-preset`）。profile 挂上本 bundle，**Enhance** 就出现在预设名册里（本插件只出这一个），没有 `/presets install`、没有 `postinstall`、插件绝不在启动时写你的家目录。

`config.plugins` 就是该会话 agent 的**全部**构成（**没有继承**）：Enhance 预设里逐条写明了 persona（`@deepseek-ai/dsh-persona` 的 `prefix`，即 persona 正文）、`agent-instructions`（AGENTS.md 指令链）、工具行、四条受限子代理与 `@dsh-enhance/dsh-enhance/enhance-mode` 段行。这四条子代理（scout / librarian / reviewer / task）是**预设定的一部分**，不再单独出现在预设名册里。

> **兼容性（必须知道）**：`@deepseek-ai/dsh-agent-preset` 只存在于 **dsh ≥ 0.2.0** 的行式预设注册表里。老 CLI（如 nvm 里的 `0.1.0-rc.6`，其机制是已退役的目录式 `dsh-agent-presets`）解析不到这一行，它会成为 inactive entry（启动时给一条告警），**不是**静默生效；本插件不为此发明条件插入机制。

> 工作模式 C（Advisor 目标回归）需要 `preset-advisor` 与 `prompts/agents/advisor.persona.md`，**尚未实现**（见 `docs/modes.md` §5/§7）；当前 advisor 运行时是通过插件 Config 默认开启的伴随机制，不需要预设。

## 配置

插件行接受一个 `config` 块——可在你的 profile 的 `cordis.patch.yml` 或 home `$DSH_HOME/cordis.patch.yml` 中覆盖：

```yaml
- id: dsh-enhance
  name: '@dsh-enhance/dsh-enhance'
  config:
    workRules: |
      # 团队规则
      Always run the full test suite before pushing.
    doctorTool: true
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `workRules` | 内置纪律文案 | 提示词段文本；空字符串则移除该段 |
| `doctorTool` | `true` | 注册 `dsh_enhance_doctor` 工具 |
| `commands` | `true` | 注册人类指令 `/doctor`、`/boulder` 到 UI 指令表 |
| `guards` | `true` | 守卫钩子 + rules 注入器 + delivery-gate 的总开关 |
| `workTracking` | `true` | boulder 状态、写令牌、start-work / delivery-gate 钩子的总开关（目标是原生服务，不受此开关影响） |
| `worktree` | `true` | `worktree_create/list/cleanup` 工具（需要 workTracking） |
| `advisor` | `true` | Advisor 伴随审查运行时 |
| `advisorModel` | — | advisor 子代理的独立模型；默认继承主 agent 的路由 |

### 在界面里改（不用手写 YAML）

除 `workRules` 之外的 7 个字段都标了 `volatile()`，因此**内置「插件」面板**里本插件那一行会有一个「配置」入口：勾选/取消即时生效（写完立刻重建接线，不需要重启），改动落到你 profile 的 `cordis.patch.yml`（`user` 层），每行旁的「恢复默认」会把覆盖删掉、退回组合默认。

- 面板位置：侧边栏「插件」→ 找到 `@dsh-enhance/dsh-enhance` 包 → 它那一行（设置弹窗里也有只读清单可查）。
- 一条纪律：**同一个字段只有一个写者**。用界面改了之后，就别再同时手工在补丁里写同一个键——界面会把你的覆盖读成 user 层，两边同时写会互相覆盖。
- 已知限制（上游）：非 loopback 的浏览器拿不到持久设置，页面会显示为只读/不可用；桌面端与 loopback Web 正常。
- 机制与真机证据（`describe`/`update` 往返、命名空间键、为什么必须重挂）：[docs/design-web-settings-card.md](docs/design-web-settings-card.md) §8–§10。

## 开发

```sh
pnpm install
pnpm build          # tsc → lib/
pnpm typecheck
pnpm test           # node --test
pnpm sync:enhance-preset   # 从 dsh-enhance persona + 子代理行重新生成 cordis.patch.yml
```

包是 ESM，零运行时依赖：所有 `@deepseek-ai/dsh-*` 导入都是类型导入（构建时擦除），`@deepseek-ai/cordis` 由 harness 作为 peer 提供。

贡献者的工作纪律：先读 `AGENTS.md`；改动 prompts 或 roles 之前先查看 `docs/architecture.md` 与 `docs/roles.md`；persona 文本单源维护在 `prompts/agents/`（绝不手改生成的 `cordis.patch.yml`——字节锁定测试强制这一约定）。

## 设计文档

- `AGENTS.md` — 如何在本仓库工作。
- `docs/architecture.md` — 架构与 M1–M8 里程碑计划。
- `docs/value-assessment.md` — **存在价值评估**：逐面与上游原生能力对照，结论是把它定位为「政策包 + 验收脚手架」，长期应做减法而不是扩张。
- `docs/roles.md` — 6 角色智能体集。
- `docs/modes.md` — 三种工作模式（dsh-enhance 万能 / Planner 计划实施 / Advisor 目标回归）及它们如何编排这些角色。
- `docs/prompts-review/` — 逐提示词审查稿：persona/review 源 + 约束映射 + 规模校验 + 实驱状态。
- `docs/borrowing-analysis.md` — 从 MIT 生态（lazycodex、oh-my-pi）借用的模式及其落点。
- `docs/archive/` — 被取代/过时但保留作历史的文档。

## 路线图（v2 里程碑）

- **M1 ✅ 骨架**：`src/` 按能力目录重组；`prompts/agents/` 单源 + 生成 + 字节锁定；persona 预设落地。
- **M2 ✅ 提示词审查**：所有提示词经审查并中文化；采用 6 角色体系。
- **M3 ✅ 守卫 + delivery-gate**：write-existing/path-traversal/bash-read 守卫、rules-injector、delivery-gate 状态机 + verify 绑定 + 防篡改 + 完成报告。
- **M4 ✅ 工作追踪**：boulder（CAS、work 合并）、写令牌、start-work + delivery-gate 钩子。**goal 存储与 `goal_*` 工具已退役**（原生 `ctx.goals` 覆盖，见 `docs/value-assessment.md` §3）。
- **M5 ✅ worktree**：WorktreeManager（create/list/find/cleanup/reuse）、命名 + 路径校验、boulder 联动、worktree_create/list/cleanup 工具。
- **M6 ✅ enhance-mode**：深度工作协议改为 **Enhance 预设作用域内的常驻系统提示词段**（`@dsh-enhance/dsh-enhance/enhance-mode`）；关键词触发（`ulw`/`ultrawork`）与目录式预设投递一并退役。
- **M7 LSP / comment-check**：计划中。
- **M8 团队模式**：**不建议自研**——上游已有 Agent Teams（成员 / 共享任务板 / 邮箱，见 `docs/value-assessment.md` §3）。

## 许可证

MIT


