# dsh-enhance 测试规划（Testing plan）

> 对应 `docs/architecture.md` 第 8 节验证策略的落地清单。
> 原则：先在纯逻辑上单测，再 dsh 实驱；实驱隔离 `$DSH_HOME` 并记录证据到 `.dsh-enhance/evidence/`，证明未污染真实环境。
> 本表按里程碑映射测试，标注当前能力是否已实现——**未实现的能力只有规划，不写伪测试**（避免"测试冒充行为证据"）。

---

## 1. 当前已实现的测试

| 测试文件 | 覆盖能力 | 里程碑 | 状态 |
|---|---|---|---|
| `tests/unit.test.mjs` | skills-provider（parseSkillBody / list / get）+ DEFAULT_WORK_RULES 文案 pin | M1 | ✅ |
| `tests/presets-pin.test.mjs` | prompts 单一源 → `cordis.patch.yml`（插件行 + `preset-enhance`）的字节 pin 防漂移；含负向钉（只准一条 preset 行、`presets/roles.patch.yml` 不得复活）与"防自证式"回归钉（手改必须被发现、`render()` 不得写盘） | M1/M6 | ✅ |
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
| `qa/pack-install-drive.mjs`（`pnpm qa:pack`） | **打包安装验收，零 token**：真 `npm pack` → 真装进一次性 profile → 21 条断言。这是唯一覆盖"用户真装一遍"的层：仓库里其余测试都跑在 `link:` 形态下，解析会落到本 checkout 的 `node_modules`，因此**看不见**"宿主供给的包被写成 dependency / 副本遮蔽宿主"这类缺陷。断言含：宿主 0.2.x、插件是真实目录而非链接、复制进 profile 的只有 `schemastery`+`cosmokit`（无任何服务类宿主包副本）、安装无 peer 告警、`--dump-config` 行齐备无失败诊断、真启动解析全部静态 import 且本插件行**已激活**、未激活名单只有 `preset-enhance`/`agentPresets` 这条已知项 | 发布面 | ✅ 21/21 |
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

## 6. 实驱现状（2026-09，结合上游对齐 dsh/0.1.x）

> 依前节"未实现只有规划"纪律，以下只记录**已执行的实测结论**与**真实阻塞**；不把未跑通的写成"通过"。

**基线（2026-10-09 发布收尾轮复验）**：本插件对齐**宿主实际携带的** `@deepseek-ai/*@0.2.0-rc.2`（`cordis@4.0.4`；`@deepseek-ai/schemastery` 为 dependency `~3.18.4`，`volatile()` 需要它，且宿主用全局符号 `Symbol.for('schemastery')` 判定原生 schema——跨副本安全）；`pnpm typecheck` 0 · `pnpm build` 0 · `node --test` **187/187**（21 个测试文件）· `pnpm qa:pack` **21/21** · `pnpm check:pack` PASS。**此前的基线是 `@deepseek-ai/*@0.1.2-alpha.4`（另一条大版本）**——那次错配正是 P0-10 的根因：`tsc` 校的不是宿主实际 API，两个钩子因此长期绑在一个不存在的事件上，全绿也没人发现。日常实驱默认跑桌面宿主 `0.2.0-rc.2`（`resolveDsh()` 会从 PATH 命中里认出桌面 shim；旧 nvm `0.1.0-rc.6` 只在显式 `DSH_BIN` 时才用得上）。

**实驱目标解析（隔离优先）**：`qa/dsh-launch.mjs` 的 `resolveQaTarget()` 让三个实驱**默认**落在仓库内隔离 home `.dsh-enhance/desktop-test-home`（profile `qa`）——只要它存在就不碰真实 `~/.dsh`；显式 `DSH_HOME` / `DSH_ENHANCE_PROFILE` 优先。证据与终端都会标注本次实际使用的 profile 与 home。直接原因：不带环境变量跑实驱时，目标曾落在真实 home，实现在一个不含本插件的 profile 上找 bundle 层，于是报出"未发现 dsh-enhance 层"——把"跑错环境"误诊成"插件缺陷"。

| 层 | 结果 | 证据 |
|---|---|---|
| 单测/构建 | 通过 | `node --test` 全绿；tsc `--noEmit` 净；`--dump-config` 确认 `# == @p-jiangh/dsh-enhance` 层合入 |
| CLI `--dump` | 通过 | `qa/dsh-enhance-drive.mjs --dump` exit=0，bundle 合入 compose |
| CLI `--llm` | **已通过**（2026-09-30） | 三个实驱全 PASS：`qa/dsh-enhance-drive.mjs --llm`、`qa/worktracking-drive.mjs`、`qa/delivery-gate-drive.mjs`；证据在 `.dsh-enhance/evidence/` |
| 浏览器 UI（`dsh web`） | 部分 | 预设菜单可见六个预设（`.dsh-enhance/evidence/web-01-home.png`、`web-02-dsh-enhance-preset.png`）；**说明（2026-10-09）**：以上截图是历史证据，自 2026-10-09 起本插件只出 Enhance 一个预设，其余条目来自上游 dsh；会话内 doctor 卡片仍需改进 webbridge 输入注入后复验 |
| 设置面写→读往返（2026-10-08） | **已通过** | 桌面宿主 CLI（`resources/runtime/cli/bin/dsh.cmd`）+ 隔离 home `qa` profile 上的探针：`describe()` 有 `ns: dsh-enhance` → `update(doctorTool=false)` → `user` 层 + `revision` 0→1 → 过期 revision 被拒（`SETTINGS_CONFLICT`）→ 二次启动仍生效；同时观测到 `dsh_enhance_doctor` 从工具表消失（重挂生效）。原始日志见 [design-web-settings-card.md](design-web-settings-card.md) §9 |
| 设置面**真机 GUI** 往返（2026-10-08） | **已通过（双向）** | 桌面端「插件」面板：重启后 `plugins.row.config` occupant = `@p-jiangh/dsh-enhance#dsh-enhance`；用户对 worktree 开关 set→unset，三条独立信号一致（profile 补丁行新增/整行删除、`doctor` 生效配置 关→开、`worktree_*` 工具消失→回来），**全程不重启**。记录见 [design-web-settings-card.md](design-web-settings-card.md) §10.5 |
| **打包安装验收（2026-10-09）** | **已通过（21/21，零 token）** | `pnpm qa:pack`：真 `npm pack` → 真装进一次性 profile `qa-pack`（隔离 home）→ 宿主 0.2.x、插件以真实目录装成、profile 里只有 `schemastery`+`cosmokit`（**无任何服务类宿主包副本**）、安装无 peer 告警、`--dump-config` 行齐备、**真启动解析全部静态 import 且本插件行已激活**、未激活名单只有 `preset-enhance`/`agentPresets`。证据 `.dsh-enhance/evidence/pack-install-drive.md` |
| **L3 真机验收 · headless 组合（2026-10-09，发布后）** | **已通过（exit 0）** | 对象是**已发布字节**（Release 附件，sha256 `7D20FE1B…`），profile `qa-gh4`：真实会话里模型调用 `dsh_enhance_doctor`，报告插件已加载、**打包技能（3）** `code-review/git-workflow/tdd`、`work-rules` 段 286 字、守卫/工作追踪/worktree/人类指令/advisor 全开；advisor 运行时真实跑了一次审查（`ADVISOR: nit`）。enhance-mode 缺失属预期（headless 一次性 runner 不消费预设，模型自己推理出这一点） |
| **L3 真机验收 · 预设作用域（2026-10-09，发布后）** | **已通过（exit 0）** | 同一**已发布字节** + 探针复刻 Web/桌面绑定（profile `qa-l3p`：registry 默认 `enhance` + probe 行）：名册只有 `preset=enhance default=true broken=-`，全部行 `=true`（含 `enhance-mode`、persona、agent-instructions 与四条子代理）；`resolve(default) -> {id: enhance}`；真实会话 `session-443bec83` 的 header 即该预设，其 system prompt **含完整 26 行 `<enhance-mode>`**、含 persona 前缀、`{{cwd}}` 已替换，且全日志**无** ultrawork/ulw。证据 `.dsh-enhance/evidence/l3-acceptance-published-artifact.md` |

**这道验收证明什么、不证明什么（写清楚，别过度归因）**：

- **证明**：用户真装一遍的那条路上，模块解析、行装配、启动、激活状态都成立；宿主供给的包没有被复制进 profile。
- **不证明**：预设行在有 `agentPresets` 服务的 **Web 组合**里会激活（本验收用的是 headless 组合，那里它必然 pending）。这一条已由 2026-10-09 发布后的**预设作用域 L3** 补上：探针在**已发布字节**上复刻 `agentPresets.resolve` + `mount`，真实会话 `session-443bec83` 的 system prompt 含完整 `<enhance-mode>`（见表）。仍未做的只有"人在真实 GUI 里点一次预设菜单"——历史证据见 `design-web-settings-card.md` §10.5。

**关于此前记录的「`--llm` 阻塞」——归因已更正（2026-09-30 实测）**：

- 旧结论把阻塞归因为「`dsh 0.1.0-rc.6` 的 headless 会话不自行退出」。**该归因是错的**，实际原因是 QA 使用的隔离 profile（`.dsh-enhance/test-home/profiles/dsh-enhance`）**只挂了 `@deepseek-ai/dsh-base` + 本插件，没有挂任何 app bundle**。这样的 profile 装配完插件树后没有 app 执行任务，表现为"无输出且不退出"。对照组：历史上跑成功的 `~/.dsh/profiles/omd` bundles 里含 `@deepseek-ai/dsh-headless`（该 profile 属旧包名时期的产物，已于 2026-09-30 迁移为 `~/.dsh/profiles/dsh-enhance` 并删除）。
- 修复：把 `@deepseek-ai/dsh-headless` 加进隔离 profile 的 dependencies 与 `dsh.profile.bundles`（该目录在 `.gitignore` 内，不影响真实 `$DSH_HOME`）。之后同一条命令立即全绿。
- 防回归：`qa/dsh-launch.mjs` 新增 `checkProfileApp()`，三个实驱脚本在启动前自检 profile 是否挂了 app bundle，缺失时直接给出"请补 `@deepseek-ai/dsh-headless`"的报错，而不是静默超时。
- 另一个此前未记录的前提：实驱脚本依赖 `where.exe dsh.cmd` 定位 dsh，而本机 dsh 装在 `F:\nvm\v24.13.0\`（不在 PATH）。现已加 PATH 扫描 / nvm（`NVM_HOME`、`NVM_SYMLINK`、PATH 中的 nvm 根）/ node 同级全局 三级回退，并在定位失败时提示 `DSH_BIN`。

**遗留**：浏览器侧会话注入验证仍受 webbridge 与本机 UI 输入控件的兼容性限制，保持标 unverified，不当作已通过。
