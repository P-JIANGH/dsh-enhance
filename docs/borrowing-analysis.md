# dsh-enhance 借鉴分析：lazycodex & oh-my-pi

> 调查时间：2026-07（用户 clone 两项目供调查）
> 项目：`F:\lazycodex`（MIT，Codex 增强插件分发仓库，code-yeongyu）、`F:\oh-my-pi`（pi coding agent 本体 fork，badlogic/pi-mono → can1357/oh-my-pi，omp.sh，MIT）
> 用途：为 dsh-enhance（deepseek-harness 增强插件）的 M1 骨架与后续落地提供模式借鉴。借鉴的是模式与纪律，非代码；两项目均 MIT 开源，引用保留来源。

---

## 1. F:\lazycodex：prompt 传播链 + evidence 门

lazycodex 是 Codex 增强插件分发仓库（`plugins/` 组件化：ultrawork、ulw-loop、start-work-continuation、executor-verify、teammode、rules、lsp、codegraph、comment-checker、telemetry、bootstrap…）。三类可直接借鉴：

> **命名说明（2026-10-09）**：本节的 `ultrawork` / `components/ultrawork/` 是 **lazycodex 仓库自己的组件名**（外部事实，不改写）。dsh-enhance 落地的那份协议原名相同，现已改名为 **enhance-mode**（`prompts/modes/enhance-mode.md` + `src/enhance-mode.ts`），文末凡引用本仓库稿件处已按新名更新。

### 1.1 prompt 单一源 + 生成链 + 字节 pin（A1）

- 源唯一：lazycodex 仓库内 `components/ultrawork/` 的 prompts 源目录（`*.md`，外部组件名）。
- 生成：`components/ultrawork/scripts/sync-directive.mjs` 把源写入 `directive.md`（423 行），再包 frontmatter 生成 `skills/ultrawork/SKILL.md`。
- 字节 pin：`test/directive-source.test.ts`（vitest）断言 `directive.md` 与 prompts 源逐字节相等、SKILL.md = frontmatter + 源。
- 纪律：**不手改生成物，改源再 regenerate**，否则 pin 测试红。

对 dsh-enhance：提示词（M2 审查稿中文精简稿）应放独立源目录（如 `prompts/`），落地 dsh 侧产物（systemPrompt 段落、skills）用生成脚本 + 字节 pin 测试防漂移。

### 1.2 evidence 门：出口侧把关（A2）

`lazycodex-executor-verify`（Codex `SubagentStop` hook）把"必须有证据"从 prompt 约束升级为 hook 强制：

- 收据契约：`last_assistant_message` 含 `EVIDENCE_RECORDED: <path>`，path 必须是非空常规文件、位于 `<cwd>/.dsh-enhance/evidence/` 内（symlink 拒、realpath 包含检查、traversal 安全）。
- 重试预算：3 次受阻后放行（`MAX_ATTEMPTS=3`，state 原子写 tmp+rename）；context-pressure 标记（"context compacted" 等）直接放行；无关 agent/畸形输入静默 exit 0（fail-open）。
- 白名单：`RECEIPT_ENFORCED_AGENTS` 只约束 worker 类 agent（low/medium/high），只读审查角色不受限。

对 dsh-enhance：若 dsh 有等价 Stop/SubagentStop 事件，可照此实现 evidence 门（收据 + 路径安全 + 重试上限 + 逃生舱），与 M2 审查稿 enhance-mode 稿"六、证据与 QA"呼应。

### 1.3 文本审计测试（A3）

`test/no-bunx-text.mjs`、`no-korean-text.mjs`、`no-launch-gating-text.mjs`、`readme-feature-workflows-content.mjs` 等用测试 pin README/文案内容防回归。注意与 M2 审查稿"断言文案的测试不算行为证据"不冲突：那是防"测试冒充行为证明"，这是防"文案被意外改动"。

---

## 2. F:\oh-my-pi：工程纪律（B 类）

oh-my-pi 是完整 coding agent（Rust ~80k 行核心 + TS 包：agent、ai、catalog、coding-agent、tui、natives、hashline、metaharness、mnemopi、snapcompact…）。工程纪律层面的借鉴：

### 2.1 提示词纪律（B1）

AGENTS.md 明文：prompts 只在静态 `.md` 文件，用 Handlebars 做动态内容（`{{var}}`、`{{#if}}`），`import content from "./prompt.md" with { type: "text" }`，**禁止代码内拼字符串/模板字面量/readFile**。实测形态（`src/autoresearch/prompt-setup.md`）：静态 .md + `{{base_system_prompt}}`/`{{working_dir}}` 占位 + MUST 清单式指令。与前述 lazycodex 的 prompt 单源纪律一致，应作为 dsh-enhance M1 落地纪律（提示词 .md 源 + `{{param}}` 参数化）。

### 2.2 Central Utilities 纪律（B2）

"grep before implementing；同一功能两个实现 = bug；VCS 包装唯一入口（git.ts/jj.ts）"。印证 dsh-enhance worktree 设计的 `git-runner.ts` 单入口；`shared/` 层应统一（路径、git、日志），不散落实现。

### 2.3 prompt 按功能域组织（B3）

`src/autoresearch/`、`src/commit/prompts/`（system/user 分离）、`src/cleanse/prompts/` 等按域组织。dsh-enhance 提示词目录可按域/角色组织（M1 参考）。

### 2.4 特色包（远期参考，非当前范围）

- `metaharness`：benchmark 管理器（实验/run/trace 模型 + SQLite + REST/SSE + dashboard）。
- `mnemopi`：本地 SQLite 记忆引擎（remember/recall/stats/sleep + BeamMemory），若 dsh 需要记忆功能再参考（对应前述记忆相关能力，非当前范围）。
- `snapcompact`：bitmap-frame 上下文压缩（历史渲染成 PNG 给视觉模型读），与 dsh 无直接关系。

---

## 3. oh-my-pi advisor 模式（用户点名，重点借鉴 C 类）

`packages/coding-agent/src/advisor/` + `src/prompts/advisor/*.md` + `src/modes/components/advisor-config.ts`。概念：**advisor = 只读同伴监督者（peer-shadow）**，独立于主 agent 常驻，接收主 transcript 增量并选择性反馈。

### 3.1 机制

- 独立 agent：每个 advisor 有自己的 model / tools / instructions（`WATCHDOG.yml` 名册，项目/用户级；`/advisor configure` TUI 编辑）。
- 增量输入：`runtime.ts` 接收主 agent 增量 transcript（含 thoughts），`delta-split.ts` 增量分发，`transcript-recorder.ts` 记录。
- 默认只读：`read` / `grep` / `glob`；名册可扩展授权。
- 反馈通道：`advise` 工具入主会话 YieldQueue；每次更新最多 1 条；分级 `nit`（非紧急）/ `concern` / `blocker`。
- 控制：`emission-guard.ts`（发言频率/静默优先）、`watchdog.ts`（活动仓库看门）、context 维护（promote 大模型/清上下文，绝不重放全量 transcript）。

### 3.2 沟通纪律（`prompts/advisor/system.md`，可移植为 dsh-enhance reviewer 的提示词约束）

- 只对具体技术风险发言；泛泛不确定、意图歧义 → 静默。
- 不重复 agent 已见信息（类型错误、LSP 诊断、失败构建/测试/lint）。
- 不重复已给建议；同一主题等 agent 行动后再谈。
- 不质疑用户已接受的、不质疑意图/范围（除非 transcript 明确指令如"minimal change"）、不主动提兼容性/迁移/API 稳定性（除非有要求）。
- 引用只能来自 transcript 或亲自检查的工具输出；隐藏参数不可断言具体值。
- `[in progress — more steps follow]` 时只对正在执行的不可恢复副作用提 blocker。

### 3.3 对 dsh-enhance 的映射（建议）

| advisor 特性 | dsh-enhance 落点 |
|---|---|
| peer-shadow 只读监督 + 增量 transcript | reviewer agent（5.7 节）从"一次性审查"升级为**会话级持续监督**（若 dsh 事件面支持增量输入）；只读工具白名单 |
| nit / concern / blocker 分级 | reviewer 输出分级；blocker 对应 enhance-mode 稿"严格审查"条款 |
| 沟通纪律（不重复已知/引用证据/静默优先） | reviewer persona 提示词直接移植（中文精简） |
| WATCHDOG.yml 名册（model/tools/instructions 按项目配置） | dsh-enhance config 的 agents 参数化（`{{project}}`/`{{stack}}` 等由配置注入，同 10.1 参数化约定） |
| emission-guard 频率控制 | advisor/审查消息节流（防干扰主循环） |

> 边界注意：advisor prompt 明确"不指示主 agent 去澄清/确认范围"（意图归主 agent）——这与 enhance-mode 稿"尽可能多提问"不冲突：前者是监督者纪律，后者是主 agent 执行模式；落地时保持两层职责分离。

---

## 4. 落地映射汇总

| 借鉴点 | 来源 | 落地里程碑 |
|---|---|---|
| 提示词单一源 + 生成链 + 字节 pin | lazycodex A1 | M1（prompts/ 源目录 + 生成脚本 + pin 测试） |
| evidence 门（收据/路径安全/重试上限/逃生舱） | lazycodex A2 | 后续 M（dsh Stop 事件确认后） |
| 文本审计测试 pin 文案 | lazycodex A3 | M1（提示词落地后） |
| 提示词静态 .md + 参数化纪律 | oh-my-pi B1 | M1（与 A1 合并实现） |
| Central Utilities 单入口 | oh-my-pi B2 | M1（shared/ 层） |
| advisor 只读监督 + 分级 + 沟通纪律 | oh-my-pi C | agents 落地（reviewer 升级）；WATCHDOG.yml → config 参数化 |
| 特色包（记忆/压缩/benchmark） | oh-my-pi B4 | 远期（不进入当前范围） |

> 待确认：advisor 模式是否纳入 dsh-enhance 首批 agents 落地（作为 reviewer 的持续监督形态），还是仅借鉴其沟通纪律进 reviewer persona？
