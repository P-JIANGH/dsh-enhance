# orient 会话开场（中文稿）—— 已退役（2026-10-09）

> 状态：**本稿对应的机制已退役**。`src/hooks/orient.ts` 与其绑定事件 `agent/session-start` 一并删除（该事件在 0.2.0 事件目录里不存在，桌面端从未注入过开场引导）；`orientOnSessionStart` 配置字段与 doctor 里的相关行/schema 同步退役。入口发现改由**预设菜单**（Enhance）与 `/doctor` 承担。下文按原样保留作历史记录。
>
> 原稿：v1 `src/hooks.ts` `orientAgent`（英文 3 句）。注入方式：`agent/session-start` 时 `agent.inject`。

dsh-enhance 已在本会话生效：本系统提示包含工作准则段落；通过 skill 工具提供打包技能；并提供 dsh_enhance_doctor 诊断工具。

本会话可用的打包技能：code-review、git-workflow、tdd。

（原稿 3 句 → 中文 2 段；技能名由 `ctx.skills.list` 动态生成，此处为示例占位）

---

## 约束映射表（原 3 句 → 2 段）

| 原稿 | 本稿 |
|---|---|
| dsh-enhance active: contributes work-rules section, packaged skills, doctor tool | 第 1 段 |
| Packaged skills available through skill tool: <list> | 第 2 段 |
| (extra prose) | 第 2 段（extra 保留为配置项，未写死在模板） |

## 精简校验

| 项 | 值 |
|---|---|
| 原稿规模 | 3 句 |
| 本稿规模 | 2 段 |
| 达标（≤50%） | ✅ |

## 实驱验证状态

- **已关闭**：机制退役，注入可见性不再是验收项（曾标"待做"，但事件本身不存在，永远不可能通过）。
