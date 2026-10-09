# dsh-enhance M1–M6 用户可见面审查（UX/友好性）

> 日期：2026-07（d414a86 之后的工作树）
> 审查判据：与 M2 中文定稿（`docs/prompts-review/*.md`）一致 + 可执行/建设性措辞 + 无行话；不重新设计产品文案。
> 状态：**已修复**（本文件与 `src/` 修复同步落盘；见各节「状态」与第 7 节验证）。
>
> **2026-10-09 后记（读本文件前必看）**：本文件是**历史审查记录**，其中"orient 开场消息"与"`ulw` / `ultrawork` 触发契约"两条能力面**已退役**——前者绑定的事件在 0.2.0 不存在，后者被 Enhance 预设作用域内的常驻段 `enhance-mode` 取代。下文相关条目按原样保留（不改写历史），现状以 `README.md` 与 `docs/architecture.md` §5.4 为准。

## 1. 结论摘要

M1–M6 的能力面已全部实现，但「直接渲染给最终用户」的文本存在一处系统性漂移：**M2 中文化只覆盖了 persona / 提示词，未覆盖代码内联的用户可见文案**（orient 注入消息、doctor 报告、守卫拒绝原因、DEFAULT_WORK_RULES、boulder/worktree 工具错误信息）。本轮共修复 4 类高严重度缺口 + 2 类中严重度缺口；advisor severity 协议标记、内部存储校验错误按「保持英文」处理（理由见 §7）。

## 2. 逐里程碑清单

### M1 · 骨架（预设生成 / 单源）

| 用户可见面 | 现状 | 问题 | 严重度 | 修复动作 |
|---|---|---|---|---|
| `prompts/agents/*.persona.md` | 中文 ✅ | 无 | — | — |
| `presets/*`（生成产物） | 与 persona 一致 ✅ | 无（字节锁定测试强制） | — | — |
| `docs/prompts-review/*.md` | 中文稿 ✅ | 无 | — | — |

结论：M1 无缺口。注意 `presets/omd` → `presets/dsh-enhance` 重命名尚未提交（工作树遗留，非本次范围）。

### M2 · 提示词中文化（漂移重灾区）

| 用户可见面 | 现状 | 问题 | 严重度 | 修复动作 |
|---|---|---|---|---|
| `DEFAULT_WORK_RULES`（`src/index.ts:35-44`） | **英文**（`# Work rules` + 5 条） | 与 `docs/prompts-review/work-rules.md` 中文稿（7 条）漂移：`docs/prompts-review/README.md` 声称「已中文化」，system prompt 段实际仍是英文 | 高 | 对齐中文稿 7 条；同步 `tests/unit.test.mjs` pin |
| `src/hooks/work-rules.ts` 注入段 | 透传 `config.workRules` ✅ | 无（段名 `dsh-enhance/work-rules` 保持英文标识） | — | — |

### M3 · 守卫 + delivery-gate

| 用户可见面 | 现状 | 问题 | 严重度 | 修复动作 |
|---|---|---|---|---|
| `guardWriteExisting` 拒绝原因（`src/tools/guards.ts:50-51`） | 英文 `path-traversal: outside workspace root` / `write-exists: path not read …` | 拒绝时模型转述给用户的是英文；且只报「不行」不说「该做什么」 | 高 | 中文化 + 附可执行指引（先读再写） |
| `guardPathTraversal` 拒绝原因（`src/tools/guards.ts:65`） | 英文 | 同上 | 高 | 中文化 + 指引 |
| `truncateText` 截断标记（`src/tools/guards.ts:96`） | 英文 `…[truncated: output exceeds cap]` | 截断输出直接进上下文/展示 | 中 | 中文化 |
| delivery-gate 反馈 | 无用户可见文本（hook 静默记录）✅ | 完成报告仅落盘，会话内无提示（见「落地建议」U2） | — | — |

### M4 · 工作追踪（boulder / goal）

| 用户可见面 | 现状 | 问题 | 严重度 | 修复动作 |
|---|---|---|---|---|
| `goal_update` 错误信息（`src/tools/boulder-tools.ts`） | 英文 `no goal yet; create one first` | 直接进工具输出 | 高 | 中文化 + 指明用 `goal_create` |
| `boulder_start/status/complete`、`goal_create/get` description | 英文 | 工具面（模型选择界面）与整体中文语境不一致 | 中 | description 中文化（name/schema 不变） |
| `start-work` 续作上下文（`src/hooks/start-work.ts`） | 中文 ✅ | 无 | — | — |
| `todo-continuation` steer 消息（`src/hooks/todo-continuation.ts`） | 中文 ✅ | 无 | — | — |
| boulder 存储校验错误（`src/features/boulder/store.ts:59-80`、`goal.ts:36-43`） | 英文 | 内部防御路径，仅在 CAS 写坏时抛出，非常态用户路径 | 低 | **保持英文**（见 §7） |

### M5 · worktree

| 用户可见面 | 现状 | 问题 | 严重度 | 修复动作 |
|---|---|---|---|---|
| `worktree_cleanup` 错误信息 | 英文 `no registered worktree for this work` | 直接进工具输出 | 高 | 中文化 + 指明用 `worktree_create` |
| `worktree_create/list/cleanup` description | 英文 | 同上 | 中 | description 中文化 |
| worktree 名称/路径校验错误（`src/features/worktree/validation.ts`） | 英文 | 内部校验，仅在错误输入时抛 | 低 | **保持英文**（见 §7） |

### M6 · skill-trigger（ulw / ultrawork）—— 2026-10-09 已退役

> 本节记录当时的审查结论。该机制（关键词触发注入 `<ultrawork-mode>` 契约）已被 **Enhance 预设作用域内的常驻段** `enhance-mode` 取代：正文单源 `prompts/modes/enhance-mode.md`，常量 `src/enhance-mode.ts` 的 `ENHANCE_MODE_TEXT`，pin 测试 `tests/enhance-mode.test.mjs`。下表按历史原样保留。

| 用户可见面 | 现状 | 问题 | 严重度 | 修复动作 |
|---|---|---|---|---|
| `ULTRAWORK_ENTRY`（原 `src/features/skill-trigger.ts`） | 中文 ✅（与 `prompts/modes/ultrawork.md` 一致） | 无 | — | — |

### 会话开场（跨里程碑）

| 用户可见面 | 现状 | 问题 | 严重度 | 修复动作 |
|---|---|---|---|---|
| orient 注入消息（`src/hooks/orient.ts:44-50`） | **英文**（`dsh-enhance is active in this session …`） | 每个会话开场第一条用户消息是英文，与 M2 orient 中文稿漂移；只「点名」无「从何开始」 | 高 | 对齐中文稿 + 追加 ≤2 条可执行起点（Z8 硬约束：每条 ≤1 行） |
| doctor 报告（`src/tools/doctor.ts:33-47`） | 英文 key=value 堆砌（`pluginLoaded: true`、`skills:`…） | 模型转述成本高、无下一步指引 | 高 | 中文小节式渲染 + 基于现有 config 开关的「下一步建议」（DZ-5 不新增配置） |
| doctor `presentCall.title`（`src/tools/doctor.ts:122`） | 英文 `Run dsh-enhance doctor` | 工具卡片标题直接展示 | 中 | 中文化 |
| doctor description（`src/tools/doctor.ts:60`） | 英文 | 模型面向但渲染于工具面 | 中 | description 中文化 |

## 3. 修复动作（本次已实施）

| # | 文件 | 动作 | 验证 |
|---|---|---|---|
| R1 | `src/hooks/orient.ts` | 注入文本改中文（对齐 `docs/prompts-review/orient.md`）+ 追加 2 条可执行起点（`dsh_enhance_doctor` / `ulw`） | grep 无 `dsh-enhance is active`；有中文起点行；保留 replay-safe / 失败不阻断 |
| R2 | `src/tools/doctor.ts` | `renderReport` 中文小节式；末尾「下一步建议」由现有 config 开关 + advisor 状态驱动；`presentCall.title`、description 中文化 | `tests/tool-output-schema.test.mjs` 通过（schema 未变） |
| R3 | `src/tools/guards.ts` | 拒绝原因中文化 + 「该做什么」指引；截断标记中文化 | `tests/guards.test.mjs` 同步断言后通过 |
| R4 | `src/index.ts` | `DEFAULT_WORK_RULES` 对齐中文稿 7 条 | `tests/unit.test.mjs` 同步 pin 后通过 |
| R5 | `src/tools/boulder-tools.ts` | `goal_update` 错误中文化 + 指引；6 个工具 description 中文化 | `tests/tool-output-schema.test.mjs` 通过 |
| R6 | `src/tools/worktree-tools.ts` | `worktree_cleanup` 错误中文化 + 指引；3 个工具 description 中文化 | 同上 |

## 4. 保持英文的项（有依据）

- **advisor severity 标记**（`nit/concern/blocker/NONE`，`src/features/advisor/severity.ts`）：是 `prompts/modes/advisor.md` 定义的机器协议信封，改中文会破坏子模型解析契约；`[advisor·nit]` 注入前缀中的标记同样保留。
- **存储/校验错误**（`boulder/store.ts`、`goal.ts`、`worktree/validation.ts`）：内部防御路径（CAS 写坏 / 非法输入），非常态用户路径；中文化收益低、破坏 `boulder.test.mjs` 语义 pin 的风险高。
- **skills/*/SKILL.md 的 description 与 body**：技能是「给模型执行的 playbook」，description 是 routing 元数据，模型负责用中文与用户交互；M2 中文稿未覆盖技能内容，中文化属独立改动（列入落地建议，见 §5）。

## 5. 落地建议（本次不实现）

来自已定稿设计文档，全部属「界面/上手」层，非文本修复，本次仅记录：

1. **Z8 入口引导增强**（`docs/design-onboarding.md` §4）：orient 的 ≤2 条可执行起点已在此次落地；doctor 的完整建议面（playbooks 存在 → 引导跑 project-bootstrap）待 `playbooks/` 落地后接入。
2. **Z9 编排 playbook**（`docs/design-onboarding.md` §4）：`playbooks/{README,project-bootstrap,onboarding,gate-your-work}.md` 纯文件 + `tests/playbooks.test.mjs` 静态校验。依赖 Z8 的 orient 提示衔接。
3. **U2 可操作节点 + U3 会话状态条**（`docs/design-ui-flagship.md`）：boulder 进度 / delivery-gate 回归结果 / advisor 建议作为 `conversation.chat.node` 自定义节点 + `turnTail` 状态条。依赖 dsh client 侧 `SessionEvent` + `ChatNodeDataMap` 声明合并（host+client 双半侧工程，规模最大）。
4. **Web 设置卡片**（`docs/design-web-settings-card.md`）：`dsh web` 设置页直接编辑 8 个配置字段，替代手写 `cordis.patch.yml`；含 `scripts/install.mjs` 一键安装。依赖自绘极简原生控件（D6）+ tsdown client 构建（D7/D8）。
5. **技能内容中文化**：三个 `skills/*/SKILL.md` 的 body/description 目前为英文；如需与 M2 全中文一致，应作为独立改动（改 body 需同步 `tests/unit.test.mjs` 的 `# Code review` 断言，并重走实驱 QA）。

## 6. 逐条验证

| 验收 | 验证 |
|---|---|
| R1 orient 中文 + ≤2 条起点 | `rg "dsh-enhance is active" src/hooks/orient.ts` 无命中；`rg "doctor|ulw" src/hooks/orient.ts` 有中文行 |
| R2 doctor 中文 + schema 不变 | `pnpm test -- tests/tool-output-schema.test.mjs` 通过 |
| R3 guards 中文 + 判定不变 | `pnpm test -- tests/guards.test.mjs` 通过（断言已同步） |
| R4 work-rules 中文 + pin 同步 | `pnpm test -- tests/unit.test.mjs` 通过 |
| R5/R6 工具错误/description 中文 | `pnpm test -- tests/tool-output-schema.test.mjs` 通过；`rg "no goal yet|no registered worktree" src/tools` 无命中 |
| 全量 | `pnpm typecheck && pnpm test && pnpm build` 全绿（见 §7） |

## 7. 验证记录

- `pnpm typecheck` — 退出码 0。
- `pnpm test` — 全部通过（含更新后的 guards / unit pin 断言）。
- `pnpm build` — tsc 成功产出 `lib/`。
- `git diff --stat` — 改动集中在 `src/` 文案、受影响测试、README/docs 与本报告。
