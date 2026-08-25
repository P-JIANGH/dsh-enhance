# docs/archive —— 归档文档

> 本目录存放**已废弃/过期的文档**，用于保留过程与历史，不再作为活跃设计依据。
> 归档规则：被替代的文档移入本目录（保留原名或加说明），活跃文档不在此列。
> 若有回归需要，从本目录取回或从 git 历史 `git show <commit>:<path>` 恢复。

## 归档清单

| 归档文件 | 原路径 | 归档日期 | 原因 / 被何替代 |
|---|---|---|---|
| `explorer-persona.md` | `docs/prompts-review/explorer.md` | 2026-08-25 | 按 roles.md 6 角色体系重命名为 **scout**（语义过载）；替代稿见 `docs/prompts-review/scout.md` |
| `executor-persona.md` | `docs/prompts-review/executor.md` | 2026-08-25 | 按 roles.md 重命名为 **task**；替代稿见 `docs/prompts-review/task.md` |
| `debugger-persona.md` | `docs/prompts-review/debugger.md` | 2026-08-25 | 按 roles.md **并入 task**（排障是 task 子流程）；替代稿见 `docs/prompts-review/task.md` |

## 说明

- 这三份原 persona 稿曾由 `docs/prompts-review/` 内的增补稿取代，经角色体系定稿（roles.md）确认后移入归档。
- 归档仅保留文档本身；删除动作已在 git 记录中（`D docs/prompts-review/{explorer,executor,debugger}.md`）。
