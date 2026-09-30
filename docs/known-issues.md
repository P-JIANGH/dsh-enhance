# dsh-enhance 已知问题清单（known issues）

> 建立日期：2026-09-30。来源：一次全仓库静态审查 + `pnpm test`/`pnpm build`/`pnpm typecheck` 实测 + 隔离 `$DSH_HOME` 的真实 LLM 实驱（3 个驱动全 PASS）。
> 用法：本文件是**修复台账**。每项标注等级、证据、修复动作与状态；修完即勾掉并注明验证方式。
> 等级定义：
> - **P0** — 阻断验证、或"文档承诺的机制在运行时不成立"（会造成虚假安全感）。
> - **P1** — 文档/契约与实现不一致，会误导使用者或后续开发。
> - **P2** — 未接线的能力、死代码、脆弱测试（不阻断，但降低可维护性）。
> - **P3** — 已定稿但未开工的功能（路线图，不在"修 bug"范围）。

## 基线（修复前，2026-09-30 实测）

- `pnpm typecheck` exit 0；`pnpm build` exit 0；`pnpm test` **97/97**；`git status` 干净；HEAD `c78f953`。
- 实驱：`qa/dsh-enhance-drive.mjs --dump` PASS；`--llm` PASS；`qa/worktracking-drive.mjs` PASS；`qa/delivery-gate-drive.mjs` PASS。

---

## P0 — 阻断验证 / 机制不成立

### P0-1 QA 驱动的同步标记已失效（doctor 中文化后）
- 证据：[qa/dsh-enhance-drive.mjs](../../qa/dsh-enhance-drive.mjs) 的 `SYNC_MARKERS` 含 `pluginLoaded: true`，但 doctor 报告已按 M2 中文化为"插件已加载：是"，该标记永不命中。实测命中集只有 `work-rules, bundled, dsh-enhance`。
- 影响：判定是"命中 ≥1 即通过"，暂无假通过；但标记集腐化，后续若再中文化会误报。
- 修复：标记集改为中英文双匹配（`插件已加载：是` / `dsh-enhance/work-rules` 等）。

### P0-2 QA 驱动无法定位 dsh（`spawnSync dsh.cmd EINVAL`）
- 证据：`resolveDsh()` 用 `where.exe dsh.cmd`；本机 dsh 装在 `F:\nvm\v24.13.0\`，该目录不在 PATH（PATH 只有 `F:\nvm`），回退到裸 `dsh.cmd` → `EINVAL`。
- 影响：任何未把 dsh shim 加进 PATH 的机器上，实驱静默不可用。
- 修复：定位失败时给出可执行报错（提示 `DSH_BIN`），并回退探测常见位置。

### P0-3 隔离 QA profile 缺 headless app（"`--llm` 卡死"的真实原因）
- 证据：`.dsh-enhance/test-home/profiles/dsh-enhance/package.json` 的 bundles 只有 `dsh-base` + 本插件；对照组 `~/.dsh/profiles/omd` 含 `@deepseek-ai/dsh-headless`。补上 headless 后三个实驱立刻全 PASS。
- 影响：[docs/testing-plan.md](../testing-plan.md) §6 把 `--llm` 阻塞归因为"dsh 0.1.0-rc.6 headless 不退出"，**归因错误**，会让人白等一次 dsh 升级。
- 修复：QA 文档改写归因；实驱脚本在启动前自检 profile 是否含 app bundle，缺失时给出明确提示。

### P0-4 presets-pin 是自证式断言，字节锁定名不副实
- 证据（实测）：向 `presets/planner/preset.yml` 追加 `TAMPER_MARKER_XYZ` → `node --test tests/presets-pin.test.mjs` **仍 2/2 通过**，标记被 `generate()` 静默覆写回 HEAD 内容，`git status` 干净。
- 根因：[tests/presets-pin.test.mjs](../../tests/presets-pin.test.mjs) 先调 `generate()`（内部 `writeFile`），再 `readFile` 比对自己刚写的内容。
- 影响：(a) AGENTS.md/README 宣称的"手改 presets 会打破字节锁定"不成立；(b) `pnpm test` 会写工作树。
- 修复：把脚本拆成纯 `render()`（返回 `Map<路径, 内容>`）与 `generate()`（写盘）；测试用 `render()` 与磁盘副本比对，不改盘。

### P0-5 advisor 在上下文失活后仍触发审查
- 证据（实驱）：交付一条 `ADVISOR: concern` 后，出现 `[advisor] review FAILED ... cannot get required service "agents" in inactive context`。
- 根因：[src/features/advisor/runtime.ts](../../src/features/advisor/runtime.ts) 在异步回调里惰性访问 `ctx.llm`，且 `agent/turn-stopping` 监听器无 disposed 守卫。
- 影响：噪声错误；极端情况下可能在已销毁的 scope 上做副作用。
- 修复：注册期捕获 `llm` 引用 + disposed 标志短路。

### P0-6 §5.5.1 写令牌纪律在运行时完全不存在
- 证据（实驱）：worktracking 会话 `boulder_status` 返回 `exec_holder: null`；全仓库 `claimWriteToken`/`stealWriteToken`/`acquireLock` 只有定义与单测，**无任何调用点**。
- 影响："无 worktree 且无令牌的 execute 绝不允许"这条核心并发纪律只是文档。
- 修复：`start-work` 抢占令牌（有独立 worktree 时跳过）+ write/edit 守卫强制 + 释放与陈旧接管。

### P0-7 delivery-gate 只记报告、不改 work 状态，且状态机未接线
- 证据（实驱）：`completion_log` 写入 `state:"passed"`、`active_work_id` 清除，但 `works["dg-work-1"].status` 仍是 `"active"`；全程没有声明拦截/回归审查/verify。
- 证据（静态）：`detectCompletionClaim` / `deliveryGateStep` / `runVerify` / `findTampered` / `buildReport` 在 `src/` 内**无任何 import**，只被测试使用。
- 影响：[docs/architecture.md](../architecture.md) §5.2.1/§5.2.2 描述的闭环与运行时不符。
- 修复：完成时同步 `work.status='completed'`；把声明检测 + 状态机 + 报告接进 turn-stopping 钩子（含防死循环），verify 模板库与落盘按 P3 推进。

---

## P1 — 文档与契约不一致

### P1-1 README 自相矛盾 + 幽灵 `presets/advisor`
- [README.md](../../README.md) L20/L55 把 advisor 当"工作模式 C / `presets/advisor/`"，L21 又说"advisor 是伴随机制，非可选 persona"；`presets/advisor/`、`prompts/agents/advisor.persona.md` 均不存在。[docs/architecture.md](../architecture.md) L342、[docs/modes.md](../modes.md) L191 同样按已实现叙述。
- 修复：README/docs 明确标注模式 B/C 为未实现，移除幽灵路径或改为"计划中"。

### P1-2 librarian persona 与 toolFilter 矛盾
- [prompts/agents/librarian.persona.md](../../prompts/agents/librarian.persona.md) 要求"本地不足才走 web_search / 拉取"，但预设里 librarian 的 `toolFilter.allow` 只有 `read/glob/grep`；且 scout/librarian/reviewer 过滤面完全相同。
- 修复：给 librarian 补 `web_search`/`web_fetch`（若 harness 工具名允许），或改 persona 文本与过滤面一致。

### P1-3 `ULTRAWORK_ENTRY` 与单源 `prompts/modes/ultrawork.md` 漂移且无 pin
- [src/features/skill-trigger.ts](../../src/features/skill-trigger.ts) 硬编码的入口契约丢失了源稿的"列成问题清单请用户确认""上下文/会话记录不一定是事实"以及结尾指向 ultrawork-review.md 的一句。
- 修复：同步文本，并加 pin 测试锁住"常量 == 源稿"。

### P1-4 [docs/architecture.md](../architecture.md) 与设计文档冲突
- 架构 M7 仍写"最小 LSP 集 + comment-checker"，而 [docs/design-delivery-gate-hardening.md](../design-delivery-gate-hardening.md) §1.5 判定 M7/LSP 已被 dsh 原生 `ctx.lsp` 覆盖、仅留 comment-check 空位。
- 架构 §5.1 提到 `skillsEnabled` 开关，代码无此字段（技能提供器恒开）。
- 修复：更新架构文档，或在代码补开关。

### P1-5 [docs/testing-plan.md](../testing-plan.md) §6 的 `--llm` 阻塞归因错误
- 见 P0-3，需改写为"隔离 profile 缺 app bundle"。
- 另：§6 表格里的"13 单测 97 项"与现状一致，但缺 advisor（10 例）与 tool-output-schema（4 例）行。

### P1-6 [docs/design-web-settings-card.md](../design-web-settings-card.md) 编辑残留
- L146/L147 重复 `## 4.7` 标题（且其一自反写"改名 dsh-enhance → dsh-enhance"）、L173/L174 重复 `## 5. 风险清单`、L193/L195 重复表头。
- 修复：去重并修正自反句。

### P1-7 品牌/路径未收尾
- 证据/笔记仍在 `.omd/`（`evidence/omd-drive-*`），而脚本已叫 `qa/dsh-enhance-drive.mjs`；真实 `~/.dsh/profiles/web` 的 bundles 仍写旧名 `oh-my-dsh`。
- 修复：文档说明；生产环境 profile 由用户自行迁移（不在本仓库范围）。

---

## P2 — 未接线能力、死代码、脆弱测试

### P2-1 output-truncator 未接线
- `truncateText` 有实现与单测，但无任何调用点；架构 §5.2-A 的 `tool-output-truncator` 缺失。

### P2-2 bash-file-read 守卫只记录不判定
- [src/tools/guard-register.ts](../../src/tools/guard-register.ts) 在 `tools/result` 里收集 bash 读取路径，但从不用于拒绝；`guardWriteExisting` 有意不接（交给 dsh 的 fs-observation-policy）。

### P2-3 死代码
- 无调用点：`stealWriteToken`、`hasWorktree`、`slugFrom`、`worktreeBranch`、`worktreePathFor`、`keyOf`、`acquireLock`/`forceReleaseLock`（仅测试）。

### P2-4 测试脆弱点
- [tests/tool-output-schema.test.mjs](../../tests/tool-output-schema.test.mjs) 断言工具**注册顺序**，调整顺序即失败。
- `boulder.test.mjs` 的"concurrent CAS"实为顺序调用，无真正双写竞争覆盖。
- `doctor.test.mjs` / `unit.test.mjs` 以中文子串钉文案，润色即红（设计如此，需知晓）。

### P2-5 QA 脚本退出码不严谨
- `qa/worktracking-drive.mjs` 从不设非 0 退出码（CI 无法判定）；`qa/delivery-gate-drive.mjs` 用 `active_work_id === undefined` 判定清除（实现若写 `null` 会误判）。
- `qa/webbridge-drive.mjs` 只打印 JSON，不写证据、无断言。

### P2-6 预设缩进魔法数跨文件共享
- 生成器与 `presets-pin.test.mjs` 共享 `6 空格 / 10 空格` 缩进约定，改一处需同步另一处。

### P2-7 `.dsh-enhance/test-home/.agent-presets/` 是第二份预设副本
- gitignore 内，无测试覆盖，易与 `presets/` 漂移。

---

## P3 — 已定稿未开工（路线图，非本次修复范围）

| 项 | 来源 |
|---|---|
| 模式 B（Planner S1–S7 骨架 persona + `presets/planner/` 增强） | [docs/modes.md](../modes.md) §7 |
| 模式 C（`prompts/agents/advisor.persona.md` + `presets/advisor/`） | [docs/modes.md](../modes.md) §5 |
| delivery-gate 三支柱（verify 模板库 / 证据清单 / 落盘） | [docs/design-delivery-gate-hardening.md](../design-delivery-gate-hardening.md) §8 |
| Web 设置卡片 + `scripts/install.mjs` | [docs/design-web-settings-card.md](../design-web-settings-card.md) §6 |
| UI 旗舰（Chat Node / turn-tail 状态条） | [docs/design-ui-flagship.md](../design-ui-flagship.md) §7 |
| `playbooks/` 上手层 + `tests/playbooks.test.mjs` | [docs/design-onboarding.md](../design-onboarding.md) §7 |
| M7 comment-check 空位 / M8 team mode | [docs/architecture.md](../architecture.md) §7 |
| 10 篇提示词的实驱验证 | [docs/prompts-review/README.md](../prompts-review/README.md) §实驱验证状态 |
| skills 池扩充（浏览器 QA / 发布流水线等） | [docs/prompts-review/README.md](../prompts-review/README.md) |
| MCP 内置机制确认 | 同上 |

---

## 修复记录

| 日期 | 项 | 动作 | 验证 |
|---|---|---|---|
| 2026-09-30 | P0-3（环境侧） | 隔离 profile 补 `@deepseek-ai/dsh-headless`（已备份 `package.json.bak-headless-fix`） | 三个实驱由阻塞转为 PASS |
