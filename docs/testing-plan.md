# dsh-enhance 测试规划（Testing plan）

> 对应 `docs/architecture.md` 第 8 节验证策略的落地清单。
> 原则：先在纯逻辑上单测，再 dsh 实驱；实驱隔离 `$DSH_HOME` 并记录证据到 `.dsh-enhance/evidence/`，证明未污染真实环境。
> 本表按里程碑映射测试，标注当前能力是否已实现——**未实现的能力只有规划，不写伪测试**（避免"测试冒充行为证据"）。

---

## 1. 当前已实现的测试

| 测试文件 | 覆盖能力 | 里程碑 | 状态 |
|---|---|---|---|
| `tests/unit.test.mjs` | skills-provider（parseSkillBody / list / get）+ DEFAULT_WORK_RULES 文案 pin | M1 | ✅ 5 例 |
| `tests/presets-pin.test.mjs` | prompts 单一源 → presets 生成的字节 pin 防漂移 | M1 | ✅ 2 例 |
| `tests/shared.test.mjs` | 路径规范化/根包含、原子写+锁、手写校验 | M1/M3 | ✅ 9 例 |
| `tests/boulder.test.mjs` | boulder CAS 合并、goal 原子写、写令牌 | M4 | ✅ 12 例 |
| `tests/continue.test.mjs` | todo-continuation 进度守卫（防 steer 死循环） | M4 | ✅ 8 例 |
| `tests/guards.test.mjs` | 守卫逻辑（write-existing/path-traversal/bash-read/truncator） | M3 | ✅ 9 例 |
| `tests/rules.test.mjs` | rules-injector（AGENTS.md / .dsh-enhance/rules/ 发现） | M3 | ✅ 4 例 |
| `tests/delivery-gate.test.mjs` | 交付门卫状态机 + 完成声明（含 goal 消歧）+ verify/反拿/报告 | M3 | ✅ 12 例 |
| `tests/worktree.test.mjs` | git-runner（run/must/GitError）、naming、validation | M5 | ✅ 9 例 |
| `tests/worktree-manager.test.mjs` | WorktreeManager（create/find/cleanup/reuse）+ boulder-link 联动 + porcelain 解析 | M5 | ✅ 6 例 |

## 2. dsh 实驱脚本

| 脚本 | 覆盖 | 里程碑 | 状态 |
|---|---|---|---|
| `qa/dsh-enhance-drive.mjs` | 插件激活实驱：`--dump` 零成本 compose 校验 / `--llm` 真实 headless | M1 | ✅ 已实现并跑通 dump |
| `qa/delivery-gate-drive.mjs` | 交付门卫反向实驱（假完成声明） | M3 | 占位（需真实 dsh 会话，`--llm` 验证） |

## 3. 后续里程碑测试规划（能力未实现 → 规划先行）

> 已实现的 M3/M4 单测见第 1 节。下表是仍属规划（未实现能力）的测试契约。

| 里程碑 | 能力 | 计划单测（纯逻辑） | 计划 dsh 实驱 |
|---|---|---|---|
| M3 | delivery-gate 在真实会话中的"完成声明→审查→回灌→通过"闭环 | 状态机/声明/verify 单测已实现 | 真实会话触发完成声明 → 拦截并回灌；改受保护文件被 verify 揭穿（`--llm`） |
| M4 | boulder 跨会话交错写 / 双 execute 串行 | 并发合并单测已实现 | 两个真实会话交错写 → 无丢失更新（`--llm`） |
| M5 | worktree 内会话续作（真实 worktree 创建） | 单测已实现（见第 1 节 15 例 worktree 测试） | 真实会话在 worktree 内续作 → 上下文正确（`--llm`） |
| M6 | skill-trigger 意图路由 | 意图分类 / 优先级仲裁 / 误触回退单测 | 多模式命中/误触回退注入实驱 |
| M7 | 最小 LSP 集 + comment-check | LSP 响应解析 | 写后校验实驱 |
| M8 | team mode（roadmap） | team_* 工具单测 | 多 agent 并行实驱 |

## 4. 提示词验证（架构 8.4，M2 已审查）

- 每个 agent/模式一次实驱触发，核对行为约束生效。依赖 agents 落地（presets 已就绪 5 角色；advisor 需伴随机制）。
- 状态：审查稿已定稿（M2）；实驱随各能力落地时由 `qa/dsh-enhance-drive.mjs --llm` 逐步执行。

## 5. 证据纪律

- 每次实驱记录到隔离沙箱的 `.dsh-enhance/evidence/`（不起真实 `$DSH_HOME`）。
- 单测对纯逻辑断言；实驱对行为断言；**不写"断言未运行实现的伪测试"**（M3/M4 的纯逻辑均已单测覆盖；真实会话闭环留 `--llm` 实驱）。

## 6. 实驱现状（2026-09，结合上游对齐 dsh/0.1.x）

> 依前节"未实现只有规划"纪律，以下只记录**已执行的实测结论**与**真实阻塞**；不把未跑通的写成"通过"。

**基线**：本插件 master 已对齐 `@deepseek-ai/*@0.1.2-alpha.4`（commit `36f7e72`：JsonValue 由 `dsh-util-values` 提供，唯一适配点；tsc 全净、13 单测 97 项全绿）。运行用 dsh CLI 为 `0.1.0-rc.6`。

| 层 | 结果 | 证据 |
|---|---|---|
| 单测/构建 | 通过 | `node --test` 13 文件 97 全绿；tsc `--noEmit` 净；`--dump-config` 确认 `# == @dsh-enhance/dsh-enhance` 层合入 |
| CLI `--dump` | 通过 | `qa/dsh-enhance-drive.mjs --dump` exit=0，bundle 合入 compose；工具 description（doctor/boulder/worktree）源码全中文（单测断言 + grep） |
| CLI `--llm` | **阻塞/未确认** | `dsh 0.1.0-rc.6` 的 headless 会话（`--profile … '<task>'`）在无关 LLM 的探针下也不自行退出（>25s 无输出），qa 用同步 `spawnSync` 等其退故卡死——非插件缺陷；**留待 dsh 升级到 0.1.1-rc.2+ 后用其 headless stderr/退出修复重验** |
| 浏览器 UI（`dsh web`） | 部分 | web 在隔离 `$DSH_HOME/.agent-presets` 下正常加载，persona menu **可见 dsh-enhance/Planner/Reviewer/Scout/Librarian/Task 六预设**（`.dsh-enhance/evidence/web-01-home.png`、`web-02-dsh-enhance-preset.png`）；会话内 orient/doctor 卡片**无法自动触发**——webbridge 的 fill/insertText 与本 UI 的受控 `textarea` 不兼容（非插件缺陷），故会话注入呈现**标 unverified** |

**遗留/建议**：上 `--llm` 与 web 会话注入验证须（a）把 host dsh 升级到含 headless 退出/进度修复的版本（0.1.1-rc.2 或更高），（b）改进或规避 webbridge 输入注入，再补实驱；二者在本机当前基线都无法自动完成故如实标注，不当作已通过。
