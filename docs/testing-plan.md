# oh-my-dsh 测试规划（Testing plan）

> 对应 `docs/architecture.md` 第 8 节验证策略的落地清单。
> 原则：先在纯逻辑上单测，再 dsh 实驱；实驱隔离 `$DSH_HOME` 并记录证据到 `.omd/evidence/`，证明未污染真实环境。
> 本表按里程碑映射测试，标注当前能力是否已实现——**未实现的能力只有规划，不写伪测试**（避免"测试冒充行为证据"）。

---

## 1. 当前已实现的测试

| 测试文件 | 覆盖能力 | 里程碑 | 状态 |
|---|---|---|---|
| `tests/unit.test.mjs` | skills-provider（parseSkillBody / list / get / SKILLS_ROOT） | M1 | ✅ 4 例 |
| `tests/presets-pin.test.mjs` | prompts 单一源 → presets 生成的字节 pin 防漂移 | M1 | ✅ 2 例 |
| `tests/delivery-gate.test.mjs` | 交付门卫状态机 + 完成声明检出 | M3（逻辑已先行） | ✅ 9 例 |

### 当前应补（纯逻辑，能力已实现）
- **DEFAULT_WORK_RULES 文案 pin**：防提示词文案被意外改动（borrowing-analysis A3 文本审计理念，但**不冒充行为证据**——只防回归、不证明行为）。放入 `tests/unit.test.mjs`。
- **doctor 输出渲染**：`renderReport` 是纯函数（report → 文本）。当前未导出，建议后续导出后补 1 例。不是本阶段阻断项。

## 2. dsh 实驱脚本

| 脚本 | 覆盖 | 里程碑 | 状态 |
|---|---|---|---|
| `qa/ohmy-drive.mjs`（新增） | 插件激活实驱：隔离 DSH_HOME + link 到本地 oh-my-dsh 的 profile，断言 `oh_my_dsh_doctor` 报告 pluginLoaded、work-rules 段、bundled 技能；可选 `--llm` 触发真实 headless | M1（已完成 LLM 手测，固化为脚本） | 待写 |
| `qa/delivery-gate-drive.mjs` | 交付门卫反向实驱（假完成声明） | M3 | 占位（M3 落地后接真实 hook） |

## 3. 后续里程碑测试规划（能力未实现 → 规划先行）

> 这些能力（M3+）尚未开发，因此暂无实现/单测。下表是**写入规划的测试契约**，能力落地时逐项补，避免返工。

| 里程碑 | 能力 | 计划单测（纯逻辑） | 计划 dsh 实驱 |
|---|---|---|---|
| M3 | 守卫 hooks：write-existing / path-traversal / output-truncator / rules-injector / delivery-gate | 守卫判定函数单测（拒写未读、symlink 逃逸拒、截断边界）；delivery-gate 状态机（已先行） | 写未读文件被拒；假完成声明被拦并回灌；改受保护文件伪造通过被 verify 揭穿 |
| M3 | verify 脚本绑定 + protected-file manifest + 反锚定 | verify.sh 契约（pristine 红/参考绿）+ manifest 哈希校验 | 运行 `verify.sh` 判定；篡改 manifest 文件被揭穿 |
| M4 | boulder 防冲突 + 写令牌 + goal + start-work + todo-enforcer | **并发写冲突单测**（两 mutate 交错 → 合并正确）；CAS/锁/令牌抢占释放 | 两个会话交错写 → 无丢失更新；双 execute 会话串行 |
| M5 | worktree manager + boulder 联动 | worktree 路径校验（symlink 逃逸 / `..` 溢出 / 大小写规范化）；git-runner 注入单测 | worktree 内会话续作 → 上下文正确 |
| M6 | skill-trigger 意图路由 | 意图分类单测；优先级仲裁单测；误触回退单测 | 多模式命中/误触回退注入实驱 |
| M7 | 最小 LSP 集 + comment-check | LSP 响应解析 | 写后校验实驱 |
| M8 | team mode（roadmap） | team_* 工具单测 | 多 agent 并行实驱 |

## 4. 提示词验证（架构 8.4，M2 已审查）

- 每个 agent/模式一次实驱触发，核对行为约束生效。依赖 agents 落地（presets 已就绪 5 角色；advisor 需伴随机制）。
- 状态：审查稿已定稿（M2），实驱随各里程碑对应能力落地时逐步执行。

## 5. 证据纪律

- 每次实驱记录到隔离沙箱的 `.omd/evidence/`（不起真实 `$DSH_HOME`）。
- 单测对纯逻辑断言；实驱对行为断言；**不写"断言未运行实现的伪测试"**。
