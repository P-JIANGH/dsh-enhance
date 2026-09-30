# dsh-enhance 设计：上手体验（主线 Z）

> 状态：设计定稿（brainstorming 产出，2026）
> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 前置：`README.md`、`src/hooks/orient.ts`、`src/tools/doctor.ts`
> 关联：`docs/design-web-settings-card.md`、`docs/design-delivery-gate-hardening.md`

## 1. 理解总结

1. **要做什么**：把 dsh-enhance 从「装了但不知道怎么开始」提升为「装了就有清晰入口」。两部分：
   - **Z8 入口引导**：orient 开场钩子增强（点名外给 1–2 条可执行起点）+ doctor 报告加建议面（装配状态外提示下一步）。
   - **Z9 编排 playbook**：串联已有能力跑通真实场景的编排层模板（非重复现有 3 个技能）。
2. **定位**：命中「上手体验·低认知负担」成功标准；纯增量、零 UI 零构建。
3. **给谁用**：新装用户（首会话即被引导）+ 想系统性用 boulder/ulw/delivery-gate 跑完整流程的用户。

## 2. 前提与现状

- 已有资产：`skills/` 3 个技能（code-review/git-workflow/tdd）、orient 开场钩子、`doctor` 工具、`rules-injector`。
- orient 现状：注入用户角色消息，点名激活技能。
- doctor 现状：报告装配状态（已加载插件/技能/生效配置）。
- **缺**：安装后引导清单、可复制 playbook、doctor 下一步建议。

## 3. 非目标

- 不做教程文档站（README/docs 已有；playbook 是「给 agent 执行的模板」，非人读教程）。
- 不做交互式安装向导（归 `scripts/install.mjs`）。
- 不新增技能库（现有 3 个技能够；场景示例不动技能体）。

## 4. 设计

### Z8 · 入口引导

**orient 增强**（`src/hooks/orient.ts`，默认开、随 `orientOnSessionStart` 控制、可经 `config.extra` 追加）：
- 点名后追加 1–2 条「从何开始」，例如：
  - "看 `playbooks/` README 挑一册场景模板（如 project-bootstrap）照着跑"
  - "调 `dsh_enhance_doctor` 查看装配与可开启项"
  - "输入 `ulw` 进入深度工作模式"
- **硬约束**：≤2 条、每条 ≤1 行；不膨胀成说明书（DZ-4）。

**doctor 建议面**（`src/tools/doctor.ts`）：
- 报告装配状态后列「可执行下一步」（非空泛排比）：
  - 某关键能力关闭（advisor/worktree/delivery-gate）→ 提示开启 + 指向 `playbooks/onboarding.md`
  - playbooks 存在 → 提示跑 project-bootstrap 走通完整流程
- 由现有 config 开关组驱动，不新增配置（DZ-5）。

### Z9 · 编排 playbook（纯文件）

```
playbooks/
  README.md            # 索引：id / 标题 / 适用场景一行摘要
  project-bootstrap.md # 新项目/工作区初始化
  onboarding.md        # 装好 dsh-enhance 后 5 分钟上手
  gate-your-work.md    # 交付门卫正式流程
```

- **入口=纯文件（DZ-2）**：不打 skill 注册表、不注册工具；模型靠文件工具读 README 挑一册。
- **发现机制**：orient 一句提醒「playbooks/ 存在」（与 Z8 衔接）；可选 rules-injector 兜底带相关提示（progressive enhancement）。
- **与技能互补**：技能是单点动作，playbook 是编排整条场景；零工程、白盒可读、易维护。

**首批 3 册**（每册 = 单一 markdown：目标 → 前置 → 步骤（引用已有工具/技能/settings）→ 完成判定 → 常见卡点）：

| playbook | 串联能力 | 适用 |
|---|---|---|
| `project-bootstrap` | AGENTS.md 生成（**原生**指令链）→ boulder 建目标 → 配 skill → 首批 commit | 新项目/工作区初始化 |
| `onboarding` | doctor 查状态 → 选工作模式 → 跑场景 → 理解 delivery-gate | 新装用户 5 分钟上手 |
| `gate-your-work` | boulder 推进 → 原生 goal 轮次（`dsh-goal-round-driver`）→ delivery-gate 回归 → 落盘审计 | 正式交付流程 |

## 5. 测试策略

- **静态校验** `tests/playbooks.test.mjs`：README 索引与每册一一对应（无孤儿引用）；每册步骤引用的**工具/技能/settings 名存在**（防引用不存在挂载点，DZ-7）。
- **doctor 建议单测**：config 组合下建议面正确（关 X → 提示开 X；playbooks 存在 → 引导跑 bootstrap）。
- **orient 引导单测**：≤2 条、每条 ≤1 行（长度硬约束）。
- **实驱 QA**：起 dsh 会话 orient 含 playbooks 提示 + 引导；doctor 关 advisor 建议正确；按 onboarding.md 手动走通。

## 6. 决策日志

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| DZ-1 | 8+9 合成一条上手体验设计 | 分开 | orient 承载 playbook 发现，天然合成 |
| DZ-2 | Z9 入口=纯文件（`playbooks/` + README + orient 提醒） | skill/tool/提示词常驻 | 零工程、白盒透明、可读性强 |
| DZ-3 | playbook 是「给模型的资产」非注册机制 | — | 不侵入注册表/工具面；模型读照做，不做自动执行 |
| DZ-4 | orient 增强默认开、随 `orientOnSessionStart`、长度≤2 条 | 常驻详细引导 | 控制上下文膨胀，不扩散成说明书 |
| DZ-5 | doctor 建议面由现有 config 开关组驱动 | 新配置开关 | 不新增配置复杂度 |
| DZ-6 | 首批 3 册 playbook | 先做 1 册 | 覆盖初始化/上手/正式门卫三种意图 |
| DZ-7 | `tests/playbooks.test.mjs` 静态校验索引+引用 | 仅实驱 | playbook 引用不存在挂载点会无声失败 |

## 7. 工作量拆分

| 步 | 内容 | 验证 |
|---|---|---|
| DZ-A | `playbooks/` + README 索引 + 首批 2 册（bootstrap/onboarding） | `tests/playbooks.test.mjs` 通过 |
| DZ-B | orient 增强 + doctor 建议面 | orient 单测（≤2 条）+ doctor 建议单测 |
| DZ-C | 第 3 册 `gate-your-work.md` + 实驱 QA 走通 onboarding | 实驱证据（orient 含提示 + onboarding 走通） |
