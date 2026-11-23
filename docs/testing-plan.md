# dsh-enhance 测试规划（Testing plan）

> 对应 `docs/architecture.md` 第 8 节验证策略的落地清单。
> 原则：先在纯逻辑上单测，再 dsh 实驱；实驱隔离 `$DSH_HOME` 并记录证据到 `.dsh-enhance/evidence/`，证明未污染真实环境。
> 本表按里程碑映射测试，标注当前能力是否已实现——**未实现的能力只有规划，不写伪测试**（避免"测试冒充行为证据"）。

---

## 1. 当前已实现的测试

| 测试文件 | 覆盖能力 | 里程碑 | 状态 |
|---|---|---|---|
| `tests/unit.test.mjs` | skills-provider（parseSkillBody / list / get）+ DEFAULT_WORK_RULES 文案 pin | M1 | ✅ |
| `tests/presets-pin.test.mjs` | prompts 单一源 → `cordis.patch.yml`（插件行 + 四条角色子预设 + `preset-enhance`）的字节 pin 防漂移；含名单钉（Enhance + 四条角色组合，每条都被一个 scoped 工具用 `agentPreset` 引用、`presets/roles.patch.yml` 不得复活）、宿主形状钉（`tool-subagent` 行不得出现 `persona`/`toolFilter`/`backgroundMode`；`agentPreset` 必须指向已声明预设；各角色的写/网/待办工具面）与"防自证式"回归钉（手改必须被发现、`render()` 不得写盘） | M1/M6 | ✅ |
| `tests/shared.test.mjs` | 路径规范化/根包含、原子写+锁、手写校验 | M1/M3 | ✅ |
| `tests/boulder.test.mjs` | boulder CAS 合并、写令牌（goal 落盘测试随实现一起退役） | M4 | ✅ |
| `tests/rules.test.mjs` | rules-injector 只读 `.dsh-enhance/rules/`（AGENTS.md 归原生，含负向断言） | M3 | ✅ |
| `tests/guards.test.mjs` | 守卫逻辑（write-existing/path-traversal/bash-read/truncator） | M3 | ✅ |
| `tests/delivery-gate.test.mjs` | 交付门卫状态机 + 完成声明（含原生 goal 相位消歧）+ verify/反拿/报告 | M3 | ✅ |
| `tests/delivery-gate-hook.test.mjs` | 交付门卫**接线**：无 verify 记 unmeasured、verify 通过与失败、非声明/原生目标未完成不介入、按 turn 幂等、销毁清理 | M3 | ✅ |
| `tests/worktree.test.mjs` | git-runner（run/must/GitError）、naming、validation | M5 | ✅ |
| `tests/worktree-manager.test.mjs` | WorktreeManager（create/find/cleanup/reuse）+ boulder-link 联动 + porcelain 解析 | M5 | ✅ |
| `tests/write-token.test.mjs` | 写令牌抢占/拒绝/释放/死 pid 与超龄接管 + 写令牌门卫判定（§5.5.1） | M4 | ✅ |
| `tests/advisor.test.mjs` | severity 信封、emission guard、`runReviewCall`、注册期捕获 llm + dispose 守卫 | advisor | ✅ |
| `tests/tool-output-schema.test.mjs` | 工具 `output.schema` 完整性（防 "returned invalid output"） | M3/M4 | ✅ |
| `tests/doctor.test.mjs` | doctor 中文渲染与下一步建议 | M1 | ✅ |
| `tests/enhance-mode.test.mjs` | `ENHANCE_MODE_TEXT` 与 `prompts/modes/enhance-mode.md` 逐字一致（改名彻底：正文无 `ulw`/`ultrawork`）+ 段落注册契约（名字/order/effect）+ 模块即可挂载的插件行 | M6 | ✅ |
| `tests/qa-launch.test.mjs` | QA 启动器解析、profile app 自检、实驱目标解析（隔离优先） | QA | ✅ |
| `tests/commands.test.mjs` | 人类指令面：`/doctor`、`/boulder` 注册与只读输出、开关与 disposer；断言诊断里不复活已退役机制 | M6 | ✅ |
| `tests/volatile-remount.test.mjs` | 设置面开关**即时生效**的接线契约：首挂同步、收到 `loader/volatile-update` 先卸后挂、连续改动串行、重挂失败只告警不打死条目 | 设置面 | ✅ |
| `tests/client-contract.test.mjs` | 浏览器半侧跨文件契约：`exports["./client"]`/`dsh.client`、`plugins.row.config` 的 key = `<包名>#<行 id>`（从 `package.json`+`cordis.patch.yml` 推导）、`whileServed` 命名空间、6 开关 + advisorModel 字段集合与布尔往返、样式幂等 | 设置面 | ✅ |
| `tests/host-contract.test.mjs` | **宿主契约**：`src` 里每个 `ctx.on('<ns>/<name>')` 必须在**已安装上游 typings** 里被声明（`agent/session-start` 曾让两个默认开启的钩子静默永不触发；带负控制断言，自证式 pin 无意义）+ 注入署名契约（`createUserMessage(` 调用数 == `kind: CONTEXT_SOURCE_KIND` 数，`src` 里没有 `kind: 'user'`）+ `isDelegatedSession` / `hasInjectedText` 纯函数 | 全部 | ✅ |
| `tests/doc-links.test.mjs` | 文档内部链接可点：所有 markdown 里指向仓库文件的 `](target)` 必须存在（发布前曾有 16 个坏链接无人发现）；带非真空断言 | 发布面 | ✅ |

## 2. dsh 实驱脚本

| 脚本 | 覆盖 | 里程碑 | 状态 |
|---|---|---|---|
| `qa/dsh-enhance-drive.mjs` | 插件激活实驱：`--dump` 零成本 compose 校验 / `--llm` 真实 headless | M1 | ✅ 已实现并跑通 dump 与 llm |
| `qa/worktracking-drive.mjs` | 工作追踪 + 写令牌 + 路径越界守卫（真实 LLM 会话） | M4 | ✅ `--llm` 已跑通 |
| `qa/delivery-gate-drive.mjs` | 交付门卫反向实驱（假完成声明 → 报告落盘、`active_work` 清空） | M3 | ✅ `--llm` 已跑通 |
| `qa/pack-install-drive.mjs`（`pnpm qa:pack`） | **打包安装验收，零 token**：真 `npm pack` → 真装进一次性 profile → 21 条断言。这是唯一覆盖"用户真装一遍"的层：仓库里其余测试都跑在 `link:` 形态下，解析会落到本 checkout 的 `node_modules`，因此**看不见**"宿主供给的包被写成 dependency / 副本遮蔽宿主"这类缺陷。断言含：宿主 0.2.x、插件是真实目录而非链接、复制进 profile 的只有 `schemastery`+`cosmokit`（无任何服务类宿主包副本）、安装无 peer 告警、`--dump-config` 行齐备无失败诊断、真启动解析全部静态 import 且本插件行**已激活**、未激活的正好是本插件五条预设行（都在等 `agentPresets`，名单由生成器给出） | 发布面 | ✅ 21/21 |
| `qa/preset-mount-drive.mjs`（`pnpm qa:preset`） | **预设挂载验收，零 token**：在隔离 home 里组出 Web 面（`dsh-base` + `dsh-web-app` + 本插件）+ 一行只读探针，读 `agentPresets.compositionInventory()`，断言 `enhance` **以及每一条注册预设**都没有 `broken`（宿主原文一并打印）。存在的理由：`qa:pack` 所在的 headless 组合没有 `agentPresets` 服务，`preset-enhance` 永远是 pending，**从不真正挂载**，因此看不见"某一行 failed → 整条预设 broken → 会话打不开"这类缺陷（2026-10-19 的 0.2.1 事故正是这一类）。 | 预设面 | ✅ 已实现 |
| `scripts/check-pack-payload.mjs`（`pnpm check:pack`） | 发布载荷形状：必需文件（`lib/index.js`、`lib/enhance-mode.js`、`client/client.js`、`skills/`、`cordis.patch.yml` …）必须在，**已删源码的编译产物必须不在**（历史上 4 个陈旧模块曾被打进 tarball），`src/`/`tests/`/`docs/`/`.dsh-enhance/` 不得入载荷 | 发布面 | ✅ |

## 3. 后续里程碑测试规划（能力未实现 → 规划先行）

> 已实现的 M3/M4 单测见第 1 节。下表是仍属规划（未实现能力）的测试契约。

| 里程碑 | 能力 | 计划单测（纯逻辑） | 计划 dsh 实驱 |
|---|---|---|---|
| M3 | delivery-gate 在真实会话中的"完成声明→审查→回灌→通过"闭环 | 状态机/声明/verify 单测已实现 | 真实会话触发完成声明 → 拦截并回灌；改受保护文件被 verify 揭穿（`--llm`） |
| M4 | boulder 跨会话交错写 / 双 execute 串行 | 并发合并单测已实现 | 两个真实会话交错写 → 无丢失更新（`--llm`） |
| M5 | worktree 内会话续作（真实 worktree 创建） | 单测已实现（见第 1 节 15 例 worktree 测试） | 真实会话在 worktree 内续作 → 上下文正确（`--llm`） |
| M6 | 预设作用域常驻模式段（enhance-mode） | `enhance-mode.test.mjs` 单源逐字 pin + `presets-pin.test.mjs` 生成物字节 pin | 真机：Enhance 预设会话的 system prompt 含 `<enhance-mode>`，其它预设/无预设会话不含 |
| M7 | 最小 LSP 集 + comment-check | LSP 响应解析 | 写后校验实驱 |
| M8 | team mode（roadmap） | team_* 工具单测 | 多 agent 并行实驱 |

## 4. 提示词验证（架构 8.4，M2 已审查）

- 每个 agent/模式一次实驱触发，核对行为约束生效。依赖 agents 落地（scout/librarian/reviewer/task 四份 persona 已作为 `cordis.patch.yml` 的 Enhance 预设内的四条 scoped subagent 行就绪；原 `presets/roles.patch.yml` 的 5 个角色预设行已于 2026-10-09 退役；advisor 需伴随机制）。
- 状态：审查稿已定稿（M2）；实驱随各能力落地时由 `qa/dsh-enhance-drive.mjs --llm` 逐步执行。
- **模式段（M6，2026-10-09）**：enhance-mode 不再是"触发后注入"的文本，而是 Enhance 预设会话的常驻系统提示词段；验证方式是真机会话日志里 system prompt 含 `<enhance-mode>`（见第 6 节）。

## 5. 证据纪律

- 每次实驱记录到隔离沙箱的 `.dsh-enhance/evidence/`（不起真实 `$DSH_HOME`）。
- 单测对纯逻辑断言；实驱对行为断言；**不写"断言未运行实现的伪测试"**（M3/M4 的纯逻辑均已单测覆盖；真实会话闭环留 `--llm` 实驱）。

## 6. 实驱现状

> 依前节"未实现只有规划"纪律，以下只记录**已执行的实测结论**与**真实阻塞**；不把未跑通的写成"通过"。更早的逐版本基线与事故记录见 `docs/known-issues.md`。

**基线（2026-11-13，宿主 0.2.2-rc.1）**：devDeps 对齐桌面宿主实际携带的 `@deepseek-ai/*@0.2.2-rc.1`（`cordis@4.1.0`、`schemastery ~3.19.0`）。`pnpm typecheck` 0 · `pnpm build` 0 · `node --test` **214/214** · `pnpm qa:pack` **21/21** · `pnpm qa:preset` **PASS** · `pnpm check:pack` PASS。两个零 token 门都跑在真宿主上；`qa:preset` 是唯一能看见"行 import 不到 → 无 fiber → 预设 broken"这一类的检查，`--dump-config` 与单测都会显示健康。

**实驱目标解析（隔离优先）**：`qa/dsh-launch.mjs` 的 `resolveQaTarget()` 让实驱**默认**落在仓库内隔离 home `.dsh-enhance/desktop-test-home`（profile `qa`）——只要它存在就不碰真实 `~/.dsh`；显式 `DSH_HOME` / `DSH_ENHANCE_PROFILE` 优先。证据与终端都会标注本次实际使用的 profile 与 home。

| 层 | 结果 | 证据 |
|---|---|---|
| 单测/构建 | 通过 | `node --test` 全绿；tsc `--noEmit` 净；`--dump-config` 确认 `# == @p-jiangh/dsh-enhance` 层合入 |
| CLI `--dump` | 通过 | `qa/dsh-enhance-drive.mjs --dump` exit=0，bundle 合入 compose |
| CLI `--llm` | **已通过** | 三个实驱全 PASS：`qa/dsh-enhance-drive.mjs --llm`、`qa/worktracking-drive.mjs`、`qa/delivery-gate-drive.mjs`；证据在 `.dsh-enhance/evidence/` |
| 打包安装（`pnpm qa:pack`） | **21/21** | 真 tarball 装进一次性 profile；断言"用户真装一遍"的形状（真实目录、无宿主包副本、无 peer 告警、行齐备、启动后插件行激活） |
| 预设挂载（`pnpm qa:preset`） | **PASS** | 隔离 home 组 Web 面 + 只读探针，断言每一条注册预设都没有 `broken` |
| 设置面写→读往返 | **已通过** | 探针：`describe` → `update` → user 层 + revision 前进 → 过期 revision 被拒 → 二次启动仍生效；原始记录见 [design-web-settings-card.md](design-web-settings-card.md) §9 |
| 设置面真机 GUI 往返 | **已通过（双向）** | 桌面端「插件」面板：worktree 开关 set→unset，三条独立信号一致，全程不重启；记录见 [design-web-settings-card.md](design-web-settings-card.md) §10.5 |

**历史归因（已更正）**：曾把 `--llm` 卡死归因为"dsh headless 会话不自行退出"，实际是 QA profile 没挂 app bundle（装完插件树后没有 app 执行任务）。现在 `checkProfileApp()` 在启动前直接报"请补 `@deepseek-ai/dsh-headless`"；`qa/dsh-launch.mjs` 另有 PATH / nvm / node 同级全局三级回退，定位失败时提示 `DSH_BIN`。

**遗留**：浏览器侧会话注入验证仍受 webbridge 与 UI 输入控件的兼容性限制，保持标 unverified，不当作已通过。

