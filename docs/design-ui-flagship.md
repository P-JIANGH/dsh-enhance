# dsh-enhance 设计：UI 旗舰（方向 2 会话内可操作节点 + 3 会话状态可视化）

> 状态：设计定稿（brainstorming 产出，2026）
> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 前置：`docs/design-web-settings-card.md`（client 半侧基建 + 改名 `dsh-enhance`）、`docs/design-delivery-gate-hardening.md`（支柱 B 证据结构）
> 依赖：阶段 0 改名 + 方向 1 client 链路打通

## 1. 理解总结

1. **要做什么**：把 dsh-enhance 核心能力在会话/界面里呈现并变得可操作。
   - **U2 可操作节点**：boulder/goal 进度、delivery-gate 回归结果、advisor 建议，作为聊天流自定义 Chat Node（`conversation.chat.node` keyed 节点）。
   - **U3 会话状态可视化**：活跃 boulder、工作模式、守卫状态，以 turn-tail 状态条呈现。
2. **定位**：把"模型口头报进度/建议"升级为"界面结构化呈现"，命中能力可视化 + 会话内交互。
3. **给谁用**：用 boulder/enhance-mode/delivery-gate/advisor 的用户。
4. **P-ADV（强制）**：advisor 建议经 `agent.inject`/`agent.steer` 进上下文影响后续生成——**必须被看见**，带独立标识。只呈现、不自动执行（human-in-the-loop）。

## 2. 前提（dsh 侧已查证）

- `conversation.chat.node` 是 keyed Chat Node 槽（`scope:'session'`）；已有 user/steering/context/assistant-step/command/turn-tail/unknown 等节点示范。
- host 需 emit `SessionEvent`（`@deepseek-ai/dsh-session/types` 的 `SessionEventMap` 声明合并 + branded id）；client 声明 `ChatNodeDataMap` 按 key 渲染（cookbook 标准路径）。
- `conversation.chat.turnTail` 为 chain 槽（StatsLine 示范）。
- dsh-enhance 现有 advisor：`nit → agent.inject`、`concern/blocker → agent.steer`——建议确实进上下文影响后续。

## 3. 设计

### U2-A 事件链路（推荐）

**事件契约 + 节点 key**（`start/checkpoint/end` 通用语义）：

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'dsh-enhance/boulder-start':    { boulderId; title }
    'dsh-enhance/boulder-progress': { boulderId; workDone; workTotal }
    'dsh-enhance/boulder-end':      { boulderId; verdict }
    'dsh-enhance/delivery-gate':    { phase; passed; failedChecks; verdict; convergence }
    'dsh-enhance/advisor':          { severity: 'nit'|'concern'|'blocker'; body }
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'boulder':  BoulderChatData
    'delivery': DeliveryGateChatData
    'advisor':  AdvisorChatData
  }
}
```

### U3-A 状态条（推荐）

`conversation.chat.turnTail`（chain 槽）轮尾一行：活跃 boulder + 工作模式 + 守卫/delivery-gate 状态。

### 三组节点

| 节点 | key | 渲染 | 数据 |
|---|---|---|---|
| BoulderNode | `boulder` | 进度条 + 标题 + 态 | workDone/workTotal |
| DeliveryGateNode | `delivery` | 回归结果卡片（passed/failed/unverified + verdict + convergence） | 复用支柱 B 证据结构 |
| AdvisorNode | `advisor` | 建议文本 + **severity 徽标**（nit/concern/blocker）+ ADVISOR 标签 + 边框 | 与注入同一 body（P-ADV） |

## 4. 错误处理与边界

| 场景 | 行为 |
|---|---|
| host emit 失败 | 静默忽略 + 日志；不阻断 agent 主流程 |
| client 未知 key | `UnknownNodeView` 兜底，不白屏 |
| advisor 节点渲染失败 | **注入仍发生**（P-ADV 不反转；UI 失效不切断模型正确性），日志告警 |
| boulder start 在窗口外仅 progress | pending Context 直到 start（cookbook 语义），不扫描回放 |
| delivery 证据清单空 | 节点显示"无证据" + `unmeasured` |

边界：事件按 `log seq` 重放、`(kind,id)` 唯一 start；同业务 id 收敛单一节点（pending→progress→end）；节点 body = 实际注入 body（看见的=注入的）；复用方向 1 契约测试/桥接层防上游漂移；不重写 ui-conversation。

## 5. 测试策略

- **纯函数单测**：boulder 进度计算、delivery 证据渲染数据、advisor severity→徽标映射、事件 payload→ChatData 映射。
- **契约测试**（并入 `upstream-contract.test.mjs`）：SessionEventMap/ChatNodeDataMap 可声明、keyed Chat Node 可注入 `conversation.chat.node`。
- **实驱 QA**：起 dsh web 触发 boulder/delivery-gate/advisor → 断言聊天流出现节点；advisor 建议同时注入上下文 + 节点（P-ADV 可观测）。

## 6. 决策日志

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| DU-1 | U2 完整 SessionEvent + keyed Chat Node | client 轮询 / 提示词注入 | 标准可重放、历史回放 |
| DU-2 | U3 turn-tail 状态条 | 独立 sidebar | 轻量贴对话流、有示范 |
| DU-3 | P-ADV 注入即可见（强制） | 建议仅隐形注入 | advisor 影响后续生成，用户必须看见 |
| DU-4 | advisor 独立标识 = severity 徽标+ADVISOR 标签+边框 | 统一样式 | 一眼区分来源与严重度 |
| DU-5 | P-ADV 不因 UI 失败反转 | UI 失败即停注入 | 不因渲染坏切断模型正确性 |
| DU-6 | 事件 `start/checkpoint/end` 通用语义 | 单事件 | 可重放、防重复 |
| DU-7 | 三节点 + 状态条 | 先做某几个 | 覆盖最高价值，advisor 由 P-ADV 强制 |
| DU-8 | 事件/渲染映射为纯函数 | 内联 | 不依赖 dsh 可单测 |

## 7. 工作量拆分

| 步 | 内容 | 验证 |
|---|---|---|
| DU-A | 底事件契约：host SessionEventMap + client ChatNodeDataMap；advisor 优先（P-ADV） | 契约测试 + 实驱 advisor 注入+节点 |
| DU-B | boulder 进度节点 | 纯函数单测 + 实驱（进度条、跨窗口 pending） |
| DU-C | delivery-gate 结果节点（复用支柱 B） | 数据映射单测 + 实驱（verdict/收敛） |
| DU-D | U3 状态条（turn-tail） | 实驱（轮尾状态行） |
