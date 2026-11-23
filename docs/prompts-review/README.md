# dsh-enhance 提示词稿（索引）

> 状态：2026-08 定稿；2026-10-09 起 enhance-mode 是 Enhance 预设作用域内的常驻系统提示词段，不再有关键词触发。
> 本目录只保留**索引与每份稿子的现状**。提示词正文已单源到 `prompts/`，由 `tests/enhance-mode.test.mjs` 与
> `tests/presets-pin.test.mjs` 钉住；评审轮次、约束映射表、精简校验等过程记录已删除。

| # | 提示词 | 现状 | 现行正文 |
|---|---|---|---|
| 1 | enhance-mode 工作前篇 | 已落地：预设常驻段 | `prompts/modes/enhance-mode.md` |
| 1b | enhance-mode 交付前回归审查 | 稿件保留，供常驻段引用 | `docs/prompts-review/enhance-mode-review.md` |
| 2 | work-rules | 已落地：system-prompt 段 | `src/index.ts` 的 `DEFAULT_WORK_RULES` |
| 3 | orient 会话开场 | 已退役（2026-10-09） | — |
| 4 | planner persona | 设计源（模式 B 未实现） | `prompts/agents/planner.persona.md` |
| 5 | reviewer persona | 已落地：scoped subagent | `prompts/agents/reviewer.persona.md` |
| 6 | scout persona | 已落地：scoped subagent | `prompts/agents/scout.persona.md` |
| 7 | task persona | 已落地：scoped subagent | `prompts/agents/task.persona.md` |
| 8 | librarian persona | 已落地：scoped subagent | `prompts/agents/librarian.persona.md` |
| 9 | search / analyze | 稿件保留、机制搁置 | `docs/prompts-review/search-analyze.md` |
| 10 | advisor 模式 | 已落地：advisor 运行时 | `prompts/modes/advisor.md` |

## 现行正文的去处

- **人格**：`prompts/agents/<role>.persona.md`（只改这里；`cordis.patch.yml` 由 `pnpm sync:enhance-preset` 生成）。
- **模式段**：`prompts/modes/enhance-mode.md`（`src/enhance-mode.ts` 的 `ENHANCE_MODE_TEXT` 与之逐字一致）。
- **advisor**：`prompts/modes/advisor.md`（含"本次审查无工具、只凭增量"的契约）。
- **角色分工与合并来源**（explorer→scout、executor+debugger→task）：`docs/roles.md`。

本目录下的 `*.md` 只记录该稿的来源与现状，正文不在此重复。
