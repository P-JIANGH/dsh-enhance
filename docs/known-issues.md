# dsh-enhance 已知问题清单（known issues）

> 建立日期：2026-09-30。来源：一次全仓库静态审查 + `pnpm test`/`pnpm build`/`pnpm typecheck` 实测 + 隔离 `$DSH_HOME` 的真实 LLM 实驱。
> 用法：本文件是**修复台账**。每项标注等级、证据、修复动作与状态。
> 等级定义：
> - **P0** — 阻断验证、或"文档承诺的机制在运行时不成立"（会造成虚假安全感）。
> - **P1** — 文档/契约与实现不一致，会误导使用者或后续开发。
> - **P2** — 未接线的能力、死代码、脆弱测试（不降低正确性，但降低可维护性）。
> - **P3** — 已定稿但未开工的功能（路线图，不在"修 bug"范围）。

## 当前基线（2026-09-30 复验）

- `pnpm typecheck` 0 · `pnpm build` 0 · `pnpm test` **171/171** · `git status` 干净。
- 实驱：`--dump` PASS；`--llm` PASS；`worktracking-drive` PASS；`delivery-gate-drive` PASS。
- **运行时矩阵（2026-09-30）**：以上实驱同时在 **nvm dsh 0.1.0-rc.6** 与 **桌面版 dsh 0.2.0-rc.2**（隔离 `$DSH_HOME` + `qa` profile）上通过。
- **人可见面（2026-09-30，P1-11）**：新增 `/doctor`、`/boulder` 人类指令；`~/.dsh/.agent-presets/` 已装 6 个预设（`--check` 通过），`omd` 旧名残留已备份清理。

---

## P0 — 阻断验证 / 机制不成立 —— 全部已修复

### ✅ P0-1 QA 驱动的同步标记已失效（doctor 中文化后）
- 证据：`SYNC_MARKERS` 含 `pluginLoaded: true`，但 doctor 已中文化为"插件已加载：是"，该标记永不命中。
- 修复：拆成「实质标记」（`插件已加载：是` / `pluginLoaded: true` / `dsh-enhance/work-rules`）+ 软标记；判定要求至少命中一条实质标记。

### ✅ P0-2 QA 驱动无法定位 dsh（`spawnSync dsh.cmd EINVAL`）
- 证据：只走 `where.exe dsh.cmd`；本机 dsh 在 `F:\nvm\v24.13.0\`（不在 PATH）→ 回退裸 `dsh.cmd` → `EINVAL`。
- 修复：抽出 `qa/dsh-launch.mjs`，加 PATH 目录扫描 / nvm（`NVM_HOME`、`NVM_SYMLINK`、PATH 中的 nvm 根）/ node 同级全局 三级回退；定位失败提示 `DSH_BIN`。

### ✅ P0-3 隔离 QA profile 缺 headless app（"`--llm` 卡死"的真实原因）
- 证据：`.dsh-enhance/test-home/profiles/dsh-enhance` 的 bundles 只有 `dsh-base` + 本插件；对照组 `~/.dsh/profiles/omd` 含 `@deepseek-ai/dsh-headless`。补上后三个实驱立刻全 PASS。
- 修复：profile 补 `@deepseek-ai/dsh-headless`（隔离目录、已备份）；新增 `checkProfileApp()` 自检，缺 app 时直接报错而不是静默超时；[docs/testing-plan.md](../testing-plan.md) §6 的错误归因已更正。

### ✅ P0-4 presets-pin 自证式断言，字节锁定名不副实
- 证据（实测）：篡改 `presets/planner/preset.yml` 后 `node --test tests/presets-pin.test.mjs` 仍 2/2 通过，标记被 `generate()` 静默覆写，工作树被写。
- 修复：生成器拆成纯 `render({presetsRoot})` 与 `generate()`；测试改用 `render()` 与磁盘比对，并加两条回归钉（手改必须被发现；`render()` 按 mtime 断言不写盘）。新增 `.gitattributes` 固定 `presets/**`、`prompts/**` 为 LF。
- 复验：篡改后 pin 测试由"2/2 通过"变为"2 例变红、exit 1"，且篡改保留。

### ✅ P0-5 advisor 在上下文失活后仍触发审查
- 证据（实驱）：`[advisor] review FAILED ... cannot get required service "agents" in inactive context`。
- 修复：注册期捕获 `llm`；新增 `disposed` 标志，dispose 后短路并在 await 后二次检查；`agent/disposed` 清理游标。

### ✅ P0-6 §5.5.1 写令牌纪律在运行时完全不存在
- 证据（实驱）：`boulder_status` 的 `exec_holder` 恒为 `null`；`claimWriteToken`/`stealWriteToken`/`acquireLock` 无调用点。
- 修复：新增 `src/tools/write-token-guard.ts`（只拦 `write`/`edit`，只在"活跃 work 且无独立 worktree"时生效，空闲则惰性抢占，被他人持有则拒绝并给指引）；令牌记录 `exec_holder_at` + `exec_holder_pid`，**进程已死即刻可接管**（实驱证明 headless 退出不触发 `agent/disposed`，只靠 30 分钟时间戳会让令牌泄漏）；`start-work` 抢占并注入令牌状态；会话销毁释放。
- 复验（实驱）：会话内 `boulder_status` 显示本会话持有令牌；合法工作区内写成功（不误伤）；越界写被拦；退出后无活进程占用令牌。

### ✅ P0-7 delivery-gate 只记报告、不改 work 状态，且状态机未接线
- 证据（实驱）：`completion_log` 写 `state:"passed"` 但 `works[id].status` 仍 `"active"`；静态：`detectCompletionClaim`/`deliveryGateStep`/`runVerify`/`buildReport` 在 `src/` 内无 import。
- 修复：钩子读最新 assistant 文本做完成声明判定（goal 未清 todo 作 c13 消歧，未清则交给 todo-continuation）；`deliveryGateStep` 维护 per-session 相位并按 `(session, turn)` 幂等；引入 `BoulderWork.verify` 可执行验证绑定（`boulder_start` 可传），命中时跑 `runVerify`，用 `buildReport` 写结构化报告（state/phase/claim）；无绑定记 `unmeasured`，verify 失败记 `failed` 且不结算、回注一次回归提醒（60s 冷却）；通过/unmeasured 时把 work 置 `completed`、清 `active_work`、释放令牌；`agent/disposed` 清 per-session 记忆。
- 复验（实驱）：证据显示 `status:"completed"`、`state:"unmeasured"`、`phase:"review"`、`claim` 留痕。

### ✅ P0-8 `--llm` 驱动的判定过脆（字面标记 vs 模型改写标点）
- 证据（实驱）：某轮模型把 doctor 的「插件已加载：是」复述成「插件已加载=是」，字面标记全部落空 → 驱动 exit 1，**假失败**（产品本身完全正常）。
- 修复：标记改为**正则**（`/插件已加载\s*[：:=＝]\s*是/` 等），并加入本插件运行时自己写进 stderr 的确定性痕迹 `/\[advisor\]/`——命中它即证明插件运行时真的在本会话跑起来了，不依赖模型措辞。

### ✅ P0-9 advisor 提示词要求用工具核查，但审查调用不提供任何工具
- 证据（实驱）：advisor 输出了原始工具调用标记（`<||DSML|| calls>…`），`parseAdvisorEmission` 解析为空 → 这条审查被整段丢弃。
- 根因：`ADVISOR_SYSTEM_PROMPT` 写着"verify doubts with read/grep/glob"，而 `registerAdvisorRuntime` 走的是 `ctx.llm.stream()` **独立单次调用，没有工具面**。
- 修复：提示词与实际能力对齐——明确"本次调用无工具，只依据增量证据推理；绝不输出工具调用语法；证据不足就 `ADVISOR: NONE`"。同步 `prompts/modes/advisor.md`（中文单源）。

---

## P1 — 文档与契约不一致 —— 全部已修复

### ✅ P1-8 orient/doctor 把不属于本插件的技能算作"打包技能"
- 证据（实驱，由主模型自己指出）：启动钩子把会话里 31 个技能（含 `user-agents` 用户池）全列成"打包技能"，而 doctor 只认 3 个 `bundled`。
- 第一次修复（不完整）：改为按 `summary.source === 'bundled'` 过滤。**真实环境应用后立刻发现这仍然错**——`source` 只是"注册表来源标签"，任何从磁盘根加载技能的 provider 都用它；desktop profile 里 `office-docx/pptx/xlsx`、`diagnose-windows-sandbox-acl` 的 source 同样是 `bundled`，但 provider 不是 dsh-enhance。doctor 实测显示 7 个 `bundled` 技能里只有 3 个是本插件的。
- 最终修复：改用 **`summary.provider === 'dsh-enhance'`**（`SkillSummary` 同时有 `source` 与 `provider`，provider 才是归属）；`skills-provider.ts` 导出 `PROVIDER` 常量；doctor 报告拆成「本插件打包技能（N）」与「会话内其它来源技能：N 个（非本插件提供）」两行，schema 增加 `provider` 字段。
- 测试：`tests/orient.test.mjs` 与 `tests/doctor.test.mjs` 都补了"别的 provider 也标 bundled"这一真实回归场景。

### ✅ P1-9 patch 行用了裸包名 → 按文档装完加载器直接失败（"用不起来"的根因）
- 证据：真实实驱报 `Cannot find package 'dsh-enhance' imported from …` / `ERR_MODULE_NOT_FOUND`。上游惯例（`dsh-base` / `dsh-web-app` 的 patch）一律写完整包名（`'@deepseek-ai/dsh-*'`），而本仓库的 `cordis.patch.yml` 与预设生成器都写裸名 `dsh-enhance`——Cordis loader 把 `name` 当模块说明符从 profile 目录解析，因此 `dsh plugin add` 装完仍然解析不到，除非 profile 额外挂一个同名别名依赖。
- 修复：`cordis.patch.yml` 与两个预设生成器改用 `'@dsh-enhance/dsh-enhance'`（`id` 保持短名，因为 id 是给用户 patch 定位用的，name 才是 loader 导入的）；预设已重新生成。
- 复验：把隔离 profile 里的裸名别名依赖与 junction 都删掉、只留 scoped 名，`worktracking-drive` 与 `delivery-gate-drive` 实驱仍全 PASS。

### ✅ P1-10 boulder 状态落在仓库根，污染用户仓库且与文档不符
- 证据：[docs/architecture.md](../architecture.md) §5.5 规定 `.dsh-enhance/boulder.json`，但 `readBoulder(storeDir)` 实际是 `join(storeDir,'boulder.json')`，所有调用方传的都是 `session.header.cwd`（仓库根）→ 落在 `<repo>/boulder.json`；而 `.gitignore` 只忽略 `.dsh-enhance/`（goal 走的是对的 `.dsh-enhance/goals/`）。任何用户用一次 boulder 工具，自己仓库根就多一个未跟踪文件。
- 修复：store 新增 `STATE_DIR='.dsh-enhance'` 与 `boulderFileFor(repoRoot)`，`readBoulder` 走它（全部生产调用点一次覆盖）；测试与两个驱动改用同一导出而不是写死路径；worktracking 实驱新增断言"仓库根无 boulder.json"。
- 影响：破坏性（旧位置的状态不会被读取）。v0.1 无外部用户，按 architecture 一次到位。

### ✅ P1-11 装完插件后 UI 里没有任何属于本包的入口（人可见面缺失）
- 证据（真实桌面版 0.2.0-rc.2 会话）：`dsh_enhance_doctor` 报「插件已加载：是」、3 个打包技能、守卫/工作追踪/advisor 全开，而用户「除了开场消息里的 `ulw` 之外什么都感知不到」。静态核实：`src/` 内 `commands.register` 出现 **0 次**——DSH 的人类指令面（`@deepseek-ai/dsh-commands` 的 `ctx.commands.register`，由 `dsh-client-ui-commands` 在 `/` 菜单渲染）本包从未使用；技能虽已注册（`dsh-client-ui-skill` 挂 `/` 触发器 + 手打 `/name` 会确定性注入正文），但除开场消息外没有任何提示。
- 预设证据（同一台机器）：`$DSH_HOME/.agent-presets/` 里只有 6 个**改名前的残留**（`planner/scout/librarian/task/reviewer/omd`，composition 首行 `name: oh-my-dsh`），而 `package.json.bak-preinstall` 证明 desktop profile **从未**依赖过 `oh-my-dsh` → 这 6 项不可解析，选中即挂载失败；仓库自带的 6 个预设（含主编排 `presets/dsh-enhance/`）**一个都没装**。README 只教手工 `cp`，从未被执行。
- 修复 1（人可见面）：新增 `src/features/commands.ts`，用上游注册表注册两条只读指令 `/doctor`（复用同一份装配报告与渲染器）与 `/boulder`（读 `.dsh-enhance/boulder.json`）；新增 `Config.commands` 开关（默认开），doctor 回显 `人类指令=开/关` 并点名两条指令，orient 开场消息也点名它们。指令结果由 UI adapter 直接渲染 → **零 token、不进模型历史**。名字先核对过上游占用（`compact`/`feedback`/`goal`/`plan`/`export`/`permission`）无冲突（同层重名会在注册时失败）。
- 修复 2（装机）：新增 `scripts/install-presets.mjs`（幂等、逐字节比对、覆盖/清理前整份备份到目标根**同级**的 `agent-presets-backup-<时间戳>/`，支持 `--dry-run`/`--check`/`--target`/`--prune-renamed`），并接入 `pnpm install:presets` / `pnpm check:presets`。**预演模式在第一次真写之前抓到真 bug**：同名预设同时进了「更新」与「残留清理」两个清单 → 会先装后删；已修（只有不在本包名册里的 id 才算残留）并加回归钉。
- 解析依据（读上游代码，不是猜测）：`dsh-agent-presets` 的 `PresetTree.import()` 对**裸包名**强制用 harness 自身 base 解析，注释原话是"本地预设位于用户家目录，Node 的上行 `node_modules` 查找永远到不了 harness 的依赖，于是每个 `@deepseek-ai/dsh-*` 行都会 import 失败"——所以预设目录下**不需要** `node_modules`，相对路径才随预设目录走。
- 复验：`pnpm test` 171/171；对真实家目录执行安装 → 6 个预设就位且 `--check` 通过，`omd` 残留已备份清理（`~/.dsh/agent-presets-backup-2026-09-30-044128` 含 6 份旧副本）。

### ✅ P1-1 README 自相矛盾 + 幽灵 `presets/advisor`
移除 `cp -r presets/advisor` 指引并标注模式 C 未实现；修正"三模式共享同一子代理池"（实际只有主预设挂 4 条作用域子代理行）；明确 advisor 是伴随机制而非可选人设预设。

### ✅ P1-2 librarian persona 与 toolFilter 矛盾
librarian 授权补 `web_search`（`web_fetch` 因 tool plane `fetch: false` 未挂载，不授权）；persona 改为只承诺 `web_search` 并附来源链接。预设已重新生成。

### ✅ P1-3 `ULTRAWORK_ENTRY` 与单源漂移且无 pin
按 `prompts/modes/ultrawork.md` 逐字对齐（补回丢失的"列成问题清单请用户确认""上下文/会话记录不一定是事实"与结尾指向 ultrawork-review.md 的一句）；新增 `tests/skill-trigger.test.mjs` 逐字 pin + 关键句回归钉。

### ✅ P1-4 architecture 与设计文档冲突
`skillsEnabled` 改为"技能恒定开启，不做开关"；§5.3/§7 的 M7 标注为"最小 LSP 集已被 dsh 原生 `ctx.lsp` 覆盖，仅留 comment-check"；三模式表加落地状态说明。

### ✅ P1-5 testing-plan §6 的 `--llm` 阻塞归因错误
改写为"隔离 profile 缺 app bundle"，并补齐测试清单（新增 6 个测试文件的覆盖说明）。

### ✅ P1-6 design-web-settings-card.md 编辑残留
去掉重复的 `## 4.7` / `## 5. 风险清单` 标题与重复表头；阶段 0 的自反句改回 `oh-my-dsh → dsh-enhance`。

### ✅ P1-7 modes.md / architecture 的预设落点标注
在 `presets/planner`（模式 B）与 `presets/advisor`（模式 C）处显式标注"未实现"。

---

## P2 — 未接线能力 / 死代码 / 脆弱测试（含处置决定）

### ✅ P2-6 生成器与测试共享缩进魔法数
`SCALAR_INDENT` / `NESTED_SCALAR_INDENT` 改为从生成器导出，`presets-pin.test.mjs` 使用同一常量去缩进，消除两处 6/10 空格约定各自维护。

### ✅ P2-4a `tool-output-schema` 断言注册顺序
改为集合相等（排序后比较）：增删或重排工具行不再误报，静默丢工具仍会红。

### ⛔ 不修（有意不接线，dsh 原生已覆盖）— 已在代码注释与本文件记录理由
- **P2-1 output-truncator**：dsh 原生 `tool-result-pruner` / spill policy 已封顶工具输出，且预设已挂 `tool-result-pruner`（thresholdChars 8192）；再截断会重复扣预算。`truncateText` 保留为已测纯函数与可选项。
- **P2-2 bash-file-read 判定 / write-existing 强制**：dsh 的 `fs-observation-policy` 已拥有"先读再写"，再叠一层策略会与之冲突。`guardWriteExisting` 保留为已测决策函数，运行时不强制。
- 理由已写进 [src/tools/guards.ts](../../src/tools/guards.ts) 模块注释。

### ⛔ 不修（有意的 API 面 / 已接受）
- **P2-3 未调用导出**（`stealWriteToken`、`hasWorktree`、`slugFrom`、`worktreeBranch`、`worktreePathFor`、`keyOf`、`acquireLock`/`forceReleaseLock`）：均为小而纯、有单测覆盖的工具函数，构成模块的显式 API 与扩展点（`acquireLock` 对应架构 §5.5.5 的进程锁路径）。删掉它们会连带删掉有效覆盖，收益为负。
- **P2-4b boulder "concurrent CAS" 实为顺序调用**：真正的进程间写竞争无法在单进程 `node --test` 里可靠构造；跨会话无丢失更新已由真实实驱覆盖。保留为已知限制。
- **P2-4c 文案内容钉**（doctor / DEFAULT_WORK_RULES 中文子串）：设计如此（防文案意外改动），代价是润色即红。
- **P2-5 QA 退出码**：`worktracking`/`delivery-gate`/`dsh-enhance-drive` 已补非 0；`webbridge-drive.mjs` 是浏览器桥工具而非断言型测试，不适用退出码语义。
- **P2-7 `.dsh-enhance/test-home/.agent-presets/` 第二份预设副本**：位于 gitignore 的隔离 QA home，属运行痕迹，不入库、不被测试依赖。

---

## P3 — 已定稿未开工（路线图）

| 项 | 来源 |
|---|---|
| 模式 B（Planner S1–S7 骨架 persona + `presets/planner/` 增强） | [docs/modes.md](../modes.md) §7 |
| 模式 C（`prompts/agents/advisor.persona.md` + `presets/advisor/`） | [docs/modes.md](../modes.md) §5 |
| delivery-gate 三支柱的剩余部分（verify **模板库**、受保护文件 manifest、报告落盘） | [docs/design-delivery-gate-hardening.md](../design-delivery-gate-hardening.md) §8 |
| Web 设置卡片 + `scripts/install.mjs`（预设装机那一半已由 `scripts/install-presets.mjs` 落地） | [docs/design-web-settings-card.md](../design-web-settings-card.md) §6 |
| UI 旗舰（Chat Node / turn-tail 状态条） | [docs/design-ui-flagship.md](../design-ui-flagship.md) §7 |
| `playbooks/` 上手层 + `tests/playbooks.test.mjs` | [docs/design-onboarding.md](../design-onboarding.md) §7 |
| M7 comment-check 空位 / M8 team mode | [docs/architecture.md](../architecture.md) §7 |
| 10 篇提示词的逐条实驱验证 | [docs/prompts-review/README.md](../prompts-review/README.md) |
| skills 池扩充（浏览器 QA / 发布流水线等） | [docs/prompts-review/README.md](../prompts-review/README.md) |
| MCP 内置机制确认 | 同上 |

> **已部分提前落地**：delivery-gate 的 verify **绑定**（§5.2.2-1 的核心机制）已在 P0-7 接入 —— `BoulderWork.verify` 指向脚本、`runVerify` 判定、无绑定记 `unmeasured`。剩余的是模板库、受保护文件 manifest 与报告落盘。

---

## 修复记录

| 日期 | 范围 | 提交 | 验证 |
|---|---|---|---|
| 2026-09-30 | 台账建立 | `9d1c93f` | — |
| 2026-09-30 | P0-1/P0-2/P0-3 工具与 QA 环境 | `a53f4ee` | 新增 `tests/qa-launch.test.mjs` 6 例；`--dump` 免 PATH 修正即通过 |
| 2026-09-30 | P0-4 字节锁定 | `4e3a558` | 篡改 → pin 测试变红（修复前为绿）；`pnpm test` 不再写工作树 |
| 2026-09-30 | P0-5 advisor | `3532581` | advisor 测试 +3 例 |
| 2026-09-30 | P0-7 交付门卫 | `90935f8` | `tests/delivery-gate-hook.test.mjs` 9 例 + delivery-gate 实驱 PASS |
| 2026-09-30 | P0-6 写令牌 | `2442120` | `tests/write-token.test.mjs` 14 例 + worktracking 实驱扩展断言 PASS |
| 2026-09-30 | P1 文档与单源 | `337ae9a` | `tests/skill-trigger.test.mjs` 3 例；预设重新生成后 pin 通过 |
| 2026-09-30 | P2 脆弱耦合 + 记录 | `337ae9a` 之后 | 135/135 |
| 2026-09-30 | P0-8/P0-9 + P1-8（实驱复验时新暴露） | 见下一次提交 | 139/139；三实驱复验 PASS |
| 2026-09-30 | P1-11 人可见指令面（`/doctor`、`/boulder`） | `29d3299` | `tests/commands.test.mjs` 9 例 + doctor/orient 回归钉；171/171 |
| 2026-09-30 | P1-11 预设装机脚本 + 真实家目录安装 | `9637da5` | `tests/install-presets.test.mjs` 10 例；预演抓出「先装后删」bug；`--check` 通过 |
| 2026-09-30 | P1-11 文档（如何体验 / 安装脚本 / 配置表 / AGENTS） | `9637da5` 之后 | README/AGENTS 与实现逐条对齐 |
