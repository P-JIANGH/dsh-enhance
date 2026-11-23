# M1–M6 用户可见面审查（UX/友好性）—— 历史记录

> 日期：2026-07。结论：能力面已全部实现，但「直接渲染给用户的文本」存在系统性漂移——M2 中文化只覆盖
> persona / 提示词，没覆盖代码内联文案。以下 6 项已修复并随 `src/` 落盘；orient 与 `ulw`/`ultrawork`
> 触发面已于 2026-10-09 退役，现状以 `README.md` 与 `docs/architecture.md` §5.4 为准。

## 已修复

| # | 位置 | 动作 |
|---|---|---|
| R1 | `src/hooks/orient.ts` | 注入文本中文化 + 2 条可执行起点（orient 已于 2026-10-09 退役） |
| R2 | `src/tools/doctor.ts` | 报告改中文小节式；末行「下一步建议」由现有 config 开关 + advisor 状态驱动；description 中文化 |
| R3 | `src/tools/guards.ts` | 拒绝原因中文化 + 「该做什么」指引；截断标记中文化 |
| R4 | `src/index.ts` | `DEFAULT_WORK_RULES` 对齐 `docs/prompts-review/work-rules.md` 的 7 条 |
| R5 | `src/tools/boulder-tools.ts` | 错误信息中文化 + 指引；工具 description 中文化 |
| R6 | `src/tools/worktree-tools.ts` | 同上（worktree_create/list/cleanup） |

## 保持英文（有依据，不要再改）

- **advisor severity 标记**（`nit`/`concern`/`blocker`/`NONE`）：`prompts/modes/advisor.md` 定义的机器协议信封，中文化会破坏子模型解析契约。
- **存储/校验错误**（`boulder/store.ts`、`goal.ts`、`worktree/validation.ts`）：内部防御路径（CAS 写坏 / 非法输入），非常态用户路径。
- **`skills/*/SKILL.md` 的 description 与 body**：技能是给模型执行的 playbook，description 是 routing 元数据；中文化属独立改动。

## 未实现（已转设计文档）

- Z9 编排 playbook、Z8 剩余引导面 → `docs/design-onboarding.md`。
- U2 可操作节点 / U3 会话状态条 → `docs/design-ui-flagship.md`。
- 技能内容中文化：需要时按独立改动走（改 body 要同步单测断言并重跑实驱 QA）。
