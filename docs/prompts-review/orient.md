# orient 会话开场（中文稿）

> 原稿：v1 `src/hooks.ts` `orientAgent`（英文 3 句）。注入方式：`agent/session-start` 时 `agent.inject`。

oh-my-dsh 已在本会话生效：本系统提示包含工作准则段落；通过 skill 工具提供打包技能；并提供 oh_my_dsh_doctor 诊断工具。

本会话可用的打包技能：code-review、git-workflow、tdd。

（原稿 3 句 → 中文 2 段；技能名由 `ctx.skills.list` 动态生成，此处为示例占位）

---

## 约束映射表（原 3 句 → 2 段）

| 原稿 | 本稿 |
|---|---|
| oh-my-dsh active: contributes work-rules section, packaged skills, doctor tool | 第 1 段 |
| Packaged skills available through skill tool: <list> | 第 2 段 |
| (extra prose) | 第 2 段（extra 保留为配置项，未写死在模板） |

## 精简校验

| 项 | 值 |
|---|---|
| 原稿规模 | 3 句 |
| 本稿规模 | 2 段 |
| 达标（≤50%） | ✅ |

## 实驱验证状态

- 待做（代码落地后执行）：orient 注入可见（见 README 第 7 节统一状态）。
