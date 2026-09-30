# dsh-enhance 测试规划（Testing plan）

> 对应 `docs/architecture.md` 第 8 节验证策略的落地清单。
> 原则：先在纯逻辑上单测，再 dsh 实驱；实驱隔离 `$DSH_HOME` 并记录证据到 `.dsh-enhance/evidence/`，证明未污染真实环境。
> 本表按里程碑映射测试，标注当前能力是否已实现——**未实现的能力只有规划，不写伪测试**（避免"测试冒充行为证据"）。

---

## 1. 当前已实现的测试

| 测试文件 | 覆盖能力 | 里程碑 | 状态 |
|---|---|---|---|
| `tests/unit.test.mjs` | skills-provider（parseSkillBody / list / get）+ DEFAULT_WORK_RULES 文案 pin | M1 | ✅ |
| `tests/presets-pin.test.mjs` | prompts 单一源 → presets 生成的字节 pin 防漂移；含两条"防自证式"回归钉（手改必须被发现、`render()` 不得写盘） | M1 | ✅ |
| `tests/shared.test.mjs` | 路径规范化/根包含、原子写+锁、手写校验 | M1/M3 | ✅ |
| `tests/boulder.test.mjs` | boulder CAS 合并、goal 原子写、写令牌 | M4 | ✅ |
| `tests/continue.test.mjs` | todo-continuation 进度守卫（防 steer 死循环） | M4 | ✅ |
| `tests/guards.test.mjs` | 守卫逻辑（write-existing/path-traversal/bash-read/truncator） | M3 | ✅ |
| `tests/rules.test.mjs` | rules-injector（AGENTS.md / .dsh-enhance/rules/ 发现） | M3 | ✅ |
| `tests/delivery-gate.test.mjs` | 交付门卫状态机 + 完成声明（含 goal 消歧）+ verify/反拿/报告 | M3 | ✅ |
| `tests/delivery-gate-hook.test.mjs` | 交付门卫**接线**：无 verify 记 unmeasured、verify 通过与失败、非声明/未清 todo 不介入、按 turn 幂等、销毁清理 | M3 | ✅ |
| `tests/worktree.test.mjs` | git-runner（run/must/GitError）、naming、validation | M5 | ✅ |
| `tests/worktree-manager.test.mjs` | WorktreeManager（create/find/cleanup/reuse）+ boulder-link 联动 + porcelain 解析 | M5 | ✅ |
| `tests/write-token.test.mjs` | 写令牌抢占/拒绝/释放/死 pid 与超龄接管 + 写令牌门卫判定（§5.5.1） | M4 | ✅ |
| `tests/advisor.test.mjs` | severity 信封、emission guard、`runReviewCall`、注册期捕获 llm + dispose 守卫 | advisor | ✅ |
| `tests/tool-output-schema.test.mjs` | 工具 `output.schema` 完整性（防 "returned invalid output"） | M3/M4 | ✅ |
| `tests/doctor.test.mjs` | doctor 中文渲染与下一步建议 | M1 | ✅ |
| `tests/skill-trigger.test.mjs` | ulw 触发词判定 + `ULTRAWORK_ENTRY` 与 `prompts/modes/ultrawork.md` 逐字一致 | M6 | ✅ |
| `tests/qa-launch.test.mjs` | QA 启动器解析与 profile app 自检（防"无输出不退出"被误诊） | QA | ✅ |

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
| 单测/构建 | 通过 | `node --test` 全绿；tsc `--noEmit` 净；`--dump-config` 确认 `# == @dsh-enhance/dsh-enhance` 层合入 |
| CLI `--dump` | 通过 | `qa/dsh-enhance-drive.mjs --dump` exit=0，bundle 合入 compose |
| CLI `--llm` | **已通过**（2026-09-30） | 三个实驱全 PASS：`qa/dsh-enhance-drive.mjs --llm`、`qa/worktracking-drive.mjs`、`qa/delivery-gate-drive.mjs`；证据在 `.dsh-enhance/evidence/` |
| 浏览器 UI（`dsh web`） | 部分 | 预设菜单可见六预设（`.dsh-enhance/evidence/web-01-home.png`、`web-02-dsh-enhance-preset.png`）；会话内 orient/doctor 卡片仍需改进 webbridge 输入注入后复验 |

**关于此前记录的「`--llm` 阻塞」——归因已更正（2026-09-30 实测）**：

- 旧结论把阻塞归因为「`dsh 0.1.0-rc.6` 的 headless 会话不自行退出」。**该归因是错的**，实际原因是 QA 使用的隔离 profile（`.dsh-enhance/test-home/profiles/dsh-enhance`）**只挂了 `@deepseek-ai/dsh-base` + 本插件，没有挂任何 app bundle**。这样的 profile 装配完插件树后没有 app 执行任务，表现为"无输出且不退出"。对照组：历史上跑成功的 `~/.dsh/profiles/omd` bundles 里含 `@deepseek-ai/dsh-headless`。
- 修复：把 `@deepseek-ai/dsh-headless` 加进隔离 profile 的 dependencies 与 `dsh.profile.bundles`（该目录在 `.gitignore` 内，不影响真实 `$DSH_HOME`）。之后同一条命令立即全绿。
- 防回归：`qa/dsh-launch.mjs` 新增 `checkProfileApp()`，三个实驱脚本在启动前自检 profile 是否挂了 app bundle，缺失时直接给出"请补 `@deepseek-ai/dsh-headless`"的报错，而不是静默超时。
- 另一个此前未记录的前提：实驱脚本依赖 `where.exe dsh.cmd` 定位 dsh，而本机 dsh 装在 `F:\nvm\v24.13.0\`（不在 PATH）。现已加 PATH 扫描 / nvm（`NVM_HOME`、`NVM_SYMLINK`、PATH 中的 nvm 根）/ node 同级全局 三级回退，并在定位失败时提示 `DSH_BIN`。

**遗留**：浏览器侧会话注入验证仍受 webbridge 与本机 UI 输入控件的兼容性限制，保持标 unverified，不当作已通过。
