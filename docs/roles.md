# oh-my-dsh 角色体系设计（roles）

> 状态：设计稿（角色合并/重命名/重写的依据）
> 目标：为 oh-my-dsh 定义一套精干、职责清晰、可组合的 agent 角色，替代当前"5 个 persona + 断言的 advisor 去向"。
> 性质：自主设计；借鉴来源均为 MIT（oh-my-pi 角色、lazycodex 组件）；不依赖任何 SUL 项目内容。

---

## 1. 为什么需要梳理角色

oh-my-dsh 的 agents 目前是 5 个 persona（planner / reviewer / executor / explorer / debugger）+ 一个待定的 advisor。但这 5 个角色之间职责有重叠（executor 与 explorer、reviewer 与 debugger），也没有覆盖"查证外部库""安全审查"等常见需求。要重命名 + 重写，必须先知道：

- 每个候选角色**到底做什么**（职责边界）；
- 哪些角色天然**能合并**（避免职责重复）；
- 哪些角色**该拆分/新增**（补齐需求空白）。

下面的对照以 oh-my-pi（MIT）的角色体系为参照，因为它是一套成熟、职责清晰、经生产验证的 agent 角色集。

---

## 2. 参照角色的职责（oh-my-pi，MIT）

| 角色 | 职责 | 关键工具 | 与其他角色关系 |
|---|---|---|---|
| `task` | 通用执行 worker；被委派后超聚焦完成任务，不偏离 | full（edit/write/bash/grep/read…） | 主执行者；hyperfocus 单一任务 |
| `scout` | 只读探索：代码库研究、快速分析、宽泛模式搜索；返回**压缩上下文**用于交接 | read/grep/glob/web_search | 快速侦察，产出交给他人的上下文 |
| `librarian` | 定位外部库/包源码与文档（概念/实现/行为三类问题） | read/grep/glob/ast_grep/web_search | 查证外部依赖，本地优先 |
| `reviewer` | 代码审查：质量/安全分析 | read/grep/glob/bash/lsp/web_search/ast_grep | 审查他人产出，spawns scout |
| `security-reviewer` | 只读安全审查：证据支撑的漏洞发现 | read/grep/glob/lsp/ast_grep | 专精安全，与 reviewer 区别在"只读 + 安全视角" |
| `designer` | 前端/UX 设计 + 实现（读组件→定方向→实现→验证可访问） | （调用方提供） | 业务特定，非通用核心 |
| `advisor` | 伴随审核（peer-shadow）：常驻旁听增量 transcript、只读核查、graded 回注 | read/grep/glob（可扩展） | 与主 agent 并行，非委派子 agent |

---

## 3. oh-my-dsh 当前 5 角色 vs 这是怎么来的

| oh-my-dsh 现角色 | 来源 | 问题 |
|---|---|---|
| planner | v1 preset（规划） | 职责清晰，保留 |
| reviewer | v1 preset（审查） | 与 security-reviewer / advisor 有重叠，需界定 |
| executor | v2 新增（执行） | 与 oh-my-pi `task` 等价；目前只有 persona，无独立工具策略 |
| explorer | v2 新增（只读探索） | 与 oh-my-pi `scout`/`librarian` 部分重叠，需拆分"探索本地"与"查证外部" |
| debugger | v2 新增（排障） | 职责可并回 executor 或独立（见下建议） |

---

## 4. 合并建议（基于职责重叠分析）

| 候选合并 | 理由 | 结论 |
|---|---|---|
| **debugger → executor** | 排障本质是"复现→根因→最小修复→回归"，是 task 类执行的一个子流程，不宜单独成角色 | 建议**合并到 executor**（作为 executor 的一个技能/纪律），不单列 |
| **security-reviewer → reviewer** | reviewer 已承担"质量/安全分析"；安全可作为 reviewer 的一个模式（`mode: security`）而非独立 agent | 建议**并入 reviewer**（安全作为其一档口径，减少角色数量） |
| **explorer(scout) + librarian** | 探索分两种：探索本地代码库（scout）与查证外部库/文档（librarian），职责不同、工具集不同 | 建议**保持两者分离**（见新增表），不合并 |
| **planner + explorer** | 规划需要先探索，但探索常常独立使用（用户直接要"看看这个库"） | 建议**保持分离**；planner 可 spawns explorer 满足探索需求 |

---

## 5. 重命名建议

| 现名 | 建议名 | 理由 |
|---|---|---|
| explorer | **scout** | 与主流（oh-my-pi scout）对齐；"explorer" 在多个生态语义过载；scout 语义更聚焦"只读快速侦察" |
| executor | **task（worker）** | 与 oh-my-pi task 对齐；executor 语义含混（常与"执行某阶段"混淆），task/worker 语义更精确"被委派的执行单元" |
| planner | 保留 **planner** | 语义清晰，无冲突 |
| reviewer | 保留 **reviewer**（吸收 security 为模式） | 语义清晰；安全并入其名下 |
| debugger | （合并消失） | 并入 task/worker |

---

## 6. 新增建议

| 新增角色 | 职责 | 来源 | 依赖 |
|---|---|---|---|
| **librarian（查证）** | 定位外部库源码/文档：概念/实现/行为三类问题，本地优先、必要时 web_search/clone | oh-my-pi（MIT） | 需 web_search 或等价工具 |
| **adviser**（扮演伴随审核，或归入 reviewer-spawn） | 会话级持续监督 / 一次性审查二选一 | oh-my-pi（MIT）advisor | 需 dsh 支持伴随/增量输入（见 advisor.md 可行性） |

---

## 7. 最终角色体系（建议）

| 角色 | 职责 | 工具策略 | 合并自 |
|---|---|---|---|
| **planner** | 规划优先；先读文件核实、探索、列计划与风险 | 只读 + 规划 | planner |
| **scout**（原 explorer） | 只读快速探索本地代码库，返回压缩上下文 | read/grep/glob | explorer + scout |
| **librarian**（新增） | 查证外部库源码/文档 | read/grep/glob/web_search/lsp | librarian（新增） |
| **task / worker**（原 executor） | 通用执行：被委派后超聚焦完成任务 | full | executor + debugger |
| **reviewer** | 审查（质量 + 安全）：阻塞/建议分级 | read/grep/glob/lsp | reviewer + security-reviewer |
| **advisor** | 伴随审核（peer-shadow）或 reviewer 的持续形态 | read/grep/glob | advisor（独立层） |

> 说明：这 6 个角色取代原 5 persona。planner、reviewer、advisor、scout、librarian 为只读/审查/规划/探索，task/worker 为唯一写角色。**并发纪律**（见 architecture.md 5.5.1）：只读角色可任意并行；`task` 在无独立 worktree 时默认串行（抢写令牌），有独立 worktree 时可并行。

---

## 8. 下一步（重命名 + 重写清单）

1. **重命名**：`docs/prompts-review/explorer.md` → scout，`executor.md` → task；`debugger.md` 并入 task；合并 review 稿中 security 职责进 reviewer。
2. **重写**：每个角色一份中文精简稿（走 prompts-review 统一流程：职责 → 约束 → 映射表 → 实驱）。
3. **新增**：librarian.md、以及 advisor 的落地形态（伴随 vs 一次性审查——待 M1 实测 dsh 能力后定稿）。
4. **同步**：architecture.md 5.7、README、presets/ 目录随之更新。

> 待你确认：这套 6 角色体系是否采用？尤其 debugger 并入 task、security 并入 reviewer 这两个合并点，以及 explorer→scout、executor→task 的重命名。
