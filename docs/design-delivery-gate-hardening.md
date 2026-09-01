# dsh-enhance 设计：交付门卫强化（方向 6）

> 状态：设计定稿（brainstorming 产出，2026）
> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 前置文档：`docs/design-web-settings-card.md`（改名 + UI）、`docs/architecture.md` §5.2.1/§5.2.2、`docs/modes.md`
> 关联：`src/features/delivery-gate/index.ts`（现有骨架）

## 1. 理解总结

1. **要做什么**：交付门卫（delivery-gate）的强化——落实架构 §5.2.2 预留的验证强度面，让"交付可信、证据可查、结果可积累"，而非仅依赖 agent 自述。
2. **定位**：dsh-enhance 必备增强层的交付质量门；服务于 Planner/Advisor 模式下执行工作的 agent 与依赖核实交付的用户。
3. **范围**：纯 Host 端；复用现有 `detectCompletionClaim`/`deliveryGateStep`/`runVerify`/`findTampered`/`buildReport`，不推倒重来。
4. **与既有协同**：回归审查复用 advisor 子代理隔离（`origin:'subagent'`），不重复造审查机制。
5. **已被砍/重定义的方向**：方向 5（上下文管理）被 dsh 原生 `spill-policy` 覆盖→砍；方向 7（M7/LSP/comment-check）被 dsh 原生 `ctx.lsp` 覆盖→仅留 comment-check 空位。

## 2. 前提假设（dsh 侧已查证）

- dsh 原生已有 `lsp`（含 `tool-lsp`）、`spill-policy`（`tools/post-execute` 结果变换器）、`compaction`、`feedback`、`test-support`。
- settings 是 dsh 核心 seam；`ctx.agents.create()` 支持子会话（`origin:'subagent'`），advisor 已在用。
- 存储沿用 boulder/evidence 文件方案，不建数据库。

## 3. 价值取向（P1–P4，非责任边界的修正）

- **P1 验证可信**：verify 失败即 `failed`（纪律绝不放行）；模板生成脚本纳入 `findTampered` 防篡改，防"必过假脚本"架空门卫。
- **P2 模板升基线**：模板库给默认 verify 带来健全默认（覆盖真实被测路径、含 build+test、有失败路径），而非从零手写。
- **P3 证据可查**：证据清单是复核的单一事实源——每步有 claim + verify + result + location，审查者能核对"够不够"。
- **P4 结果可积累**：落盘让每轮交付成为可回看资产（收敛轮次、卡点、通过门槛）。

**非目标（修正表述）**：不自动判定 verify 断言的"覆盖正确性/完整性"（语义层人主导）；但通过 P1/P2 尽量帮用户把验证做对。

## 4. 三支柱架构

```
                      现有 base
   detectCompletionClaim · deliveryGateStep · runVerify
                      findTampered · buildReport
                              │
   ┌──────────────┬───────────┴───────────┬──────────────┐
   ▼ 支柱 A        ▼ 支柱 B                 ▼ 支柱 C
 verify 模板库   证据清单规范化            回归结果落盘
```

### 支柱 A · verify 模板库

- 新增 `src/features/delivery-gate/verify-templates.ts` + `templates/`。
- `VerifyTemplate { id, label, description, render(), protectScript }`；`VERIFY_TEMPLATES` 注册表。
- 模板产出默认带 P2 健全测试（构建 + 被测文件对应测试 + 明确失败退出）；`protectScript:true` → 将该脚本路径纳入 `findTampered`（P1）。
- 新增 `verify_template_list` / `verify_template_apply <id>` 工具。
- **不含**"无模板即豁免"路径——自定义 verify 脚本同样进防篡改清单。

### 支柱 B · 证据清单规范化

- `buildReport` 扩展为逐项证据：

```ts
interface EvidenceItem {
  claim       // 断言描述（如「pnpm build 通过」）
  verify      // 可执行验证方式（verify 脚本 / 命令 / reviewer 检查）
  result      // 'ok' | 'failed' | 'unmeasured' | 'tampered'
  location?   // 证据落点（文件/输出/hash）
  protected?  // 是否落在防篡改脚本上（P1 可核对）
}
// 报告增加：
evidence: EvidenceItem[],
passedChecks, failedChecks, unverified: number,
verdict: 'passed' | 'failed' | 'unmeasured' | 'tampered'
```

- **状态机扩展（只动 review 分支）**：review 阶段读 `evidence` → `unverified>0 || failed>0 || tampered` ⇒ 回 `working` 重注入；全过 ⇒ `delivered`。`detectCompletionClaim`/idle/working 不动（D6-5）。

### 支柱 C · 回归结果落盘

- 新增 `src/features/delivery-gate/persist.ts`：`persistReport(report, evidenceDir) → path`。
- 命名 `delivery-report-<sessionId>-<timestamp>.json`；追加 `convergence`（收敛轮次）与 `sortByP1` 失败归因。
- 写入复用 existing evidence/boulder，不建新库（D6-6）。

## 5. 错误处理与边界

| 场景 | 行为 |
|---|---|
| `runVerify` 退出码非 0 | `failed` → 回 `working`，记录失败归因 |
| 脚本跑不起来（EACCES/ENOENT/超时） | `unmeasured`（非 failed）——"没能验证"，门卫不放行，回 `working` |
| 防篡改发现脚本被改 | `tampered` → 拒放行，回 `working`（P1） |
| 落盘失败 | `persistError`，不阻断门卫流转，纪律不失效 |
| 无模板适用 | 允许自定义脚本但同样进防篡改；无豁免 |

边界：幂等（上轮已过项记 `passed`）；防双验（`delivered` 锁同声明）；退出循环（`maxConvergence` 上限 → 超限落盘 `timeout` 告警，不无限拖垮）。

## 6. 测试策略

- **单测**（扩展 `tests/delivery-gate.test.mjs`）：状态机 review 分支对 evidence 分类；`findTampered` 拦截生成脚本改动；`maxConvergence` 终止；落盘命名/收敛轮次。
- **纯函数可测**：`render()` 输出、证据清单构建、报告 JSON 均为纯函数。
- **实驱 QA**：沿用 `qa/delivery-gate-drive.mjs`——触发交付声明 → 验证失败打回 → 修正通过 → 落盘含 convergence；改脚本 → 拒放行。

## 7. 决策日志

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D6-1 | 三支柱为主体 | comment-check 新造 | 5 被 spill 覆盖砍 / 7 被 lsp 覆盖仅留 comment 空位 / 6 最连贯 |
| D6-2 | 价值取向 P1–P4 | 划分责任边界 | 项目目标创造交付价值，非划边界 |
| D6-3 | 模板脚本纳入 `findTampered`（P1） | 模板豁免 | 防"必过假脚本"架空门卫 |
| D6-4 | 执行失败=`failed`；跑不起来=`unmeasured` | 一律 failed | 诚实区分"验证失败"与"未能验证"，都不放行 |
| D6-5 | 只改状态机 review 分支 | 重写状态机 | 最小侵入 |
| D6-6 | 落盘到 existing evidence/boulder | 新建仓库 | 复用存储，非目标守住 |
| D6-7 | 反锚定 reviewer 复用 advisor 子代理隔离 | 新造审查机制 | advisor 已有 `ctx.agents.create()` |

## 8. 工作量拆分

| 阶段 | 内容 | 验证 |
|---|---|---|
| D6-A | 支柱 A：模板注册表 + 首批模板 + 工具；模板纳入防篡改 | 单测 render + 实驱（选模板→runVerify→false 打回→真实通过） |
| D6-B | 支柱 B：证据清单数据结构 + 状态机 review 扩展 + unmeasured/tampered 归属 | 单测 evidence 分类 + findTampered 拦截 |
| D6-C | 支柱 C：persistReport 落盘 + convergence + maxConvergence + persistError 降级 | 落盘命名/收敛轮次 + 实驱完整闭环 |
