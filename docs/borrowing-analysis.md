# dsh-enhance 借鉴分析：lazycodex & oh-my-pi

> 调查时间：2026-07（用户 clone 两项目供调查）。两项目均 MIT 开源；借鉴的是模式与纪律，非代码。
> 本文只记录**落地结论**；逐文件的调查过程已删除。

## 借鉴点与落点

| 借鉴点 | 来源 | 本仓库落点 | 现状 |
|---|---|---|---|
| 提示词单一源 + 生成链 + 字节 pin | lazycodex A1 | `prompts/` 源目录、`scripts/sync-dsh-enhance-preset.mjs`、`tests/presets-pin.test.mjs` | 已落地 |
| evidence 门（收据 / 路径安全 / 重试上限 / 逃生舱） | lazycodex A2 | delivery-gate 的 `verify` + 受保护文件 manifest | 部分落地（verify 模板库待做） |
| 文案审计测试（pin README/文案） | lazycodex A3 | `tests/` 里的文案与 schema 断言 | 部分落地 |
| 提示词静态 `.md` + 参数化纪律 | oh-my-pi B1 | `prompts/agents/*.persona.md`、`prompts/modes/*.md` | 已落地 |
| Central Utilities 单入口 | oh-my-pi B2 | `src/shared/`、worktree 的 git 单入口 | 已落地 |
| advisor 只读监督 + 严重度分级 + 沟通纪律 | oh-my-pi C | `prompts/modes/advisor.md` + `src/features/advisor/` | 已落地（实现形态见下） |
| 记忆 / 压缩 / benchmark 等特色包 | oh-my-pi B4 | — | 不采用（与 dsh 原生能力重叠） |

## advisor 的实现形态（与 omp 不同的一处）

omp 的 advisor 是常驻影子子会话。dsh 上实测：`ctx.agents.create()` 拉起的影子子会话**无法被旁路唤醒驱动**——
主 agent 结束一轮后用 `followup()` / `whenIdle()` 唤醒，其 turn 会空转（无 `step/start`、无模型输出）。
影子子会话只能由主 agent 显式 tool-call 驱动，而伴随审核是常驻旁听，两者驱动机制不同。

因此落地改为**直接 `ctx.llm.stream()` 独立审查调用**，对外契约不变：`agent/turn-stopping` 监听 + 增量提取 +
严重度信封解析 + `nit→inject` / `concern|blocker→steer` 回注 + emission guard 去重限频。
实现与测试见 `src/features/advisor/` 与 `tests/advisor.test.mjs`。
