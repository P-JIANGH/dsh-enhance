# dsh-enhance 设计：设置面（内置「插件」面板的配置卡片）

> 状态：已交付（2026-10-08）；本文件保留**机制实证与决策**，规划过程已删除。
> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 前置文档：`docs/architecture.md`、`AGENTS.md`
> 上游参考：上游 dsh 的 `packages/client/*`、`packages/settings/settings`（MIT，实测类型定义）

## 1. 目标

在「插件」面板给本插件一行「配置」入口，直接编辑用户可调字段，替代手写 `cordis.patch.yml`。
初版规划里的另一半（`scripts/install.mjs` 一键安装脚本）已放弃：安装改由 `dsh plugin` 承担。
**最终形态以 §10 为准，机制依据在 §8，验收在 §9。**

## 2. 假设

- 本地文件存储（沿用 `~/.dsh-enhance`、boulder CAS），不引入数据库与遥测。
- 客户端只是呈现层，事实源始终在 Host；共享状态的原子性不因 UI 半侧削弱。
- 上游是 developer preview，存在破坏性变更；settings 服务为桌面/Web 组合标配。

## 3. 决策日志

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | namespace = `'dsh-enhance'` | — | 匹配插件名，小写 kebab 合法 |
| D2 | 卡片自绘 | 复用官方卡片 chrome | bundle-purity gate 禁止跨插件 value import |
| D3 | 组件策略：自绘极简原生控件 | Ant Design X / ui-primitives | 体积与形式都不匹配（ADX 数百 KB、CSS-in-JS；primitives 无 Switch/Textarea） |
| D4 | 接入声明：`./client` export + `dsh.client` | — | client module system 的扫描契约 |
| D5 | 不引入构建链，手写 `client/client.js` | tsdown / rolldown | 无 CSS 模块、无跨包 value import、无多文件拆分需求；代价是该文件不过 tsc，补偿见 §10.4 |
| D6 | 测试分层：Host 单测 / 契约测试 / 真机验收 | 仅单测 | 分别兜类型、运行时契约、真实链路 |
| D7 | 唯一席位 = `plugins.row.config` | 自建 `settings.plugins.tab` | 官方槽目录把 bundle 的配置归属到 `plugins.row.config`；见 §8.2 |
| D8 | 单一写者：只用 `ctx.configForms.get('dsh-enhance')` | 页面递来的 `form` 并存 | 同一命名空间返回同一个共享表单控制器；双写者会互相覆盖 |
| D9 | 改名 `oh-my-dsh` → `dsh-enhance`（2026-09-30 执行） | — | 品牌区隔；npm 上 `oh-my-dsh`/`omd` 均被占，GitHub 上同名项目 35 个 |
| D10 | 包名 `@p-jiangh/dsh-enhance`（2026-10-10 改） | `@dsh-enhance/dsh-enhance`（未注册） | GitHub Packages 要求 scope 与仓库所有者一致 |

## 4. 初版设计（已作废，仅留结论）

初版规划走"`settings.register` 桥接层 + `SettingsScope` + tsdown 构建链 + 一键安装脚本"，并配套桥接薄层、契约探测测试与版本矩阵。**这些在目标宿主上都不成立**：宿主没有 `settings.register`（命名空间来自 Loader 条目 id），只有 `volatile()` 字段可编辑，且 `client/client.js` 不需要构建链（§8.1）。因此实现改为 §10 的形态。

### 4.7 改名记录（D9/D10，已执行）

仓库内旧名已清零（保留迁移用途的 `LEGACY_PACKAGE_NAMES` 与文档历史）；三个 profile 的依赖与 bundles 行改为真名后重跑 pnpm 链接；旧 profile `omd` 迁移为 `dsh-enhance` 后删除（备份在 `~/.dsh/profile-backups/`）。

标识映射：包名 `oh-my-dsh` → `@p-jiangh/dsh-enhance`；插件行 `dsh-enhance`；工具 `dsh_enhance_doctor`；提示词段 `dsh-enhance/work-rules`；存储目录 `~/.omd/**` → `~/.dsh-enhance/**`；QA 脚本 `qa/omd-drive.mjs` → `qa/dsh-enhance-drive.mjs`。

> 原 §5–§7（风险清单 / 实施计划 / 验证策略）属于已被实证推翻的规划过程，已删除；编号保留跳跃是为兼容外部对 §4.7、§8–§10 的引用。

## 8. 机制实证（2026-10-08）：设置面到底怎么工作

> 依据：桌面宿主（`@deepseek-ai/dsh-desktop-runtime`，解包自 `resources/app.asar`）的源码 + live Inspect 取证 + 隔离 home 上的真机探针。

### 8.1 三条硬事实（推翻了初版的规划假设）

1. **宿主没有 `register`，命名空间不是插件注册的。** `@deepseek-ai/dsh-settings` 的服务类是 **`SettingsForms`**（不是旧 CLI 依赖树里的 `SettingsProvider`），方法只有 `describe` / `update` / `replace` / `mutate` / `prepareDocument` / `configure`。`describe()` 遍历 `configEditor.configuration()`，把**每个 Loader 条目的 `options.id`**（= 配置补丁行的 `id`，本插件即 `dsh-enhance`）当作命名空间。探针实测：`register=undefined`、`configure=function`。
2. **只有 `volatile()` 字段能被设置面编辑。** `describe()` 对每个条目调 `volatileForm(Config)`：**一个 volatile 字段都没有的条目根本不进 `describe()`**；写路径对非 volatile 字段直接抛 `Config field "x" is not volatile`。所以"配置出现在设置里"的唯一开关是给字段标 `.volatile()`（宿主投影成 JSON Schema 的 `x-cordis.volatile`）。
3. **volatile 改动不重挂插件。** `cordis-plugin-loader` 的 `Entry.update`：只有 `config` 变且 `equalExceptVolatile` 成立时走 `_commitVolatile()` —— **原地**把新值写进已挂载插件的 accessor，并只在该插件自己的 fiber 上 `emit('loader/volatile-update')`，**不重新 apply**。夹带任何普通字段变化才走普通更新生命周期（= 重挂）。

### 8.2 席位：`plugins.row.config`

- 内置「插件」面板（`@deepseek-ai/dsh-client-ui-plugin-manager` 注册在 `main` 槽）声明并派发 `plugins.row.config`（keyed）。槽目录原话：*"The configuration of one row a bundle declares, keyed by `<package name>#<row id>` … the row on the bundle's page gains a configure control"*。→ 我们的 key = `<包名>#<行 id>`。
- 派发侧代码就是判据：`configure.has = (row) => ledger.rows.has(rowConfigKey(pkg.name, row.rowId))` —— 台账里没有这个 key 就**没有**「配置」入口；组件收到 `{ view: 'summary' | 'page', form? }`。
- 被否掉的备选：`settings.plugins.tab`（自建 tab）。功能可行，但它绕开"bundle 的配置"这条正式归属。
- 对照（live）：`plugins.item` 的 occupants 是官方随包页；`settings.section` 的 occupants 是 account/general/models/plugins/agent-presets/market。

### 8.3 官方 companion 包的形状

```js
const inject = ['slots', 'locale', 'configForms']
ctx.effect(() => ctx.locale.register(NS, { zh, en }), '…')
const card = new CardController(ctx.configForms.get('agent-loop'))
ctx.effect(() => () => card.dispose(), '…')
ctx.effect(() => ctx.configForms.whileServed(['agent-loop'], () =>
  ctx.slots.inject('plugins.item', () => ctx.slots.register({ name, id, order, label, locale, inject }, Card))), '…')
```

- 带浏览器半侧的第三方插件用 `dsh.client = { inject: [客户端包名…], platform: 'web' }` + `exports["./client"]`；`inject` 必须包含所注册槽位的所有者（`ui-plugin-manager`）。
- 模块加载器给 `factory(require)` 的模块表里有 `react` / `react-dom` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`。
- **单一写者**：`ctx.configForms.get(id)` 对同一命名空间返回**同一个**共享表单控制器（上游明文："repeated `get(entryId)` calls return the same form"）。

### 8.4 为什么不引入构建链

本插件没有 CSS 模块、没有跨包 value import、也没有多文件拆分需求，因此**手写** `client/client.js`（模块加载器按 `exports["./client"]` 原样取用），保持 tsc-only 构建与"除 schemastery 外零运行时依赖"。代价：该文件不过 tsc；补偿见 §10.4 的契约测试。

## 9. 验收：写→读往返

> 探针：`.dsh-enhance/settings-probe/`（gitignored）+ 隔离 home `.dsh-enhance/desktop-test-home`（profile `qa`）。启动方式 = 桌面宿主 CLI，因此跑的就是桌面那套语义。**全程不碰用户的 desktop profile。**

真机结果（原始日志见 gitignored 的探针目录）：

| # | 条件 | 结果 |
|---|---|---|
| 1 | `describe()` 里有本插件条目 | ✅ `ns = "dsh-enhance"`（= 补丁行 id），`applies: "live"` |
| 2 | `update(ns, patch, expectedRevision)` 被接受 | ✅ `update(doctorTool=false) OK at revision 0` |
| 3 | 新值进 **user 层**、`revision` 前进 | ✅ `user={doctorTool:false}`、`revision` 0 → 1，`base` 保持组合默认（可"恢复默认"） |
| 4 | 第二次启动仍生效（证明落盘） | ✅ 写进 profile 的 `cordis.patch.yml`，新进程读到 `user` 层 |
| 5 | 过期 revision 被拒 | ✅ `SettingsConflictError code=SETTINGS_CONFLICT expected=0 actual=1` |

**关键事实**：写成功后 `dsh_enhance_doctor` **从工具表消失**，而 `boulder_*`/`worktree_*` 一个不多一个不少 —— 改动真的重建了整代接线（§8.1 事实 3 + §10.2）。第一轮探针没有这条效果（工具还在），正是它逼出了重挂设计。

## 10. 最终实现

### 10.1 文件与职责

| 位置 | 内容 |
|---|---|
| `src/index.ts` | 用户可见字段 `.volatile()`（`workRules` 保持普通值：长文本，非开关）；功能接线装进子插件 `dsh-enhance/features`；`ctx.on('loader/volatile-update')` 上串行「先卸载再重挂」 |
| `client/client.js` | 浏览器半侧：注册 `plugins.row.config`，`whileServed(['dsh-enhance'])` 门控；`SettingsFormModel` + 自写布尔规格 + `Checkbox` 行 + `SettingsValueField`（顾问模型） |
| `package.json` | `exports["./client"]`、`dsh.client = { inject: [locale, ui-settings, ui-plugin-manager], platform: 'web' }`、`files += client`；`@deepseek-ai/schemastery` 进 `dependencies` |
| `tests/volatile-remount.test.mjs` | 重挂编排契约：同步首挂、先卸后挂、串行、失败只告警 |
| `tests/client-contract.test.mjs` | 浏览器半侧跨文件契约（§10.4） |

### 10.2 开关为什么必须重挂

`describe()` 只暴露 volatile 字段 → 只能靠 volatile 编辑；而 volatile 改动**不重挂**（§8.1 事实 3）。本插件每个开关管的都是**注册**（工具、命令、钩子、advisor 运行时），原地改 accessor 不会改变已注册面，所以功能接线必须由我们自己重建：
`apply` 同步挂一个子插件 → 收到 `loader/volatile-update` 时**串行**地 `dispose()` 旧代再挂新代（先卸后挂，避免与"同一层内重名即失败"撞车）→ 子插件在挂载时读 accessor 的**当前**值。若某个部署的 loader 不发这个事件，退化为"值已存下、下次启动生效"。

### 10.3 单一写者与字段范围

- 开关（`doctorTool` / `commands` / `guards` / `workTracking` / `worktree` / `advisor`）+ `advisorModel`；`workRules` **不可**在页面编辑（仍在 profile 补丁里改）。
- 页面用 `ctx.configForms.get('dsh-enhance')`，与「插件」面板拿到的控制器是同一个 → 不存在两个写者。
- 写入走 `mutate(ops, revision)`：`set` 单字段、`unset` 恢复组合默认；revision 来自上次 `describe`。

### 10.4 验收清单（本仓库可复跑）

```sh
pnpm typecheck && pnpm build && node --test
pnpm sync:enhance-preset && git diff --exit-code -- cordis.patch.yml  # 生成物与单源同步
npm pack --dry-run                                                   # 含 client/client.js
```

浏览器半侧的**真机验收**：重启桌面端 → 打开「插件」面板 → 本插件那一行应出现「配置」入口；也可用客户端 Inspect 复核：

```
cordis_inspect_query(platform="client", provider="Slots", method="listSubTree", input={root: "plugins.row.config"})
# 期望 occupants 里出现 key = "<包名>#dsh-enhance"
```

### 10.5 真机验收记录（桌面端 GUI，**双向**都跑）

前置：重启桌面端后，客户端 Inspect 确认 `plugins.row.config` 的唯一 occupant 是本插件的 key、`active: true`。

用户在「插件」面板对 **worktree 工具** 做了一次往返，三条互相独立的信号一致：

| 信号 | 独立性 | set（取消勾选→保存） | unset（恢复默认→保存） |
|---|---|---|---|
| ① profile 的 `cordis.patch.yml` | 不依赖任何注册表/会话状态 | 新增整行 `- id: dsh-enhance / config: { worktree: false }` | **整行被删除** |
| ② `dsh_enhance_doctor` 回显的生效配置 | 读的是插件自己 resolve 出来的值 | `worktree=关`，其余全 `开` | `worktree=开`，其余全 `开` |
| ③ `Tool.listTools`（宿主工具注册表） | 反映 volatile 原地提交 + 重挂是否真的跑了 | `worktree_create/list/cleanup` **消失**，`boulder_*` 原样 | 三个 `worktree_*` **回来** |

三条合起来证明（**全程不需要重启**）：浏览器表单 → 客户端 `configForms`（带 revision 的 `mutate`）→ 宿主 `SettingsForms` → `configEditor.edit` 写 profile 的补丁 → Loader 原地提交 volatile → 我们那一代接线先卸后挂 → 工具注册表变更。顺带纠正一个自疑：工具表**不是**会话开始时的快照。

两个只有真机能暴露的细节：

- **界面写的是"最小增量"**：`SettingsForms.write` 先 `strip(raw)` 保留目标行原有的非 volatile 字段，再叠加 volatile 增量。被省略的字段回落到 **schema 默认值** —— 所以**手写在 bundle 补丁里的同名值会被界面覆盖成默认**，单一写者纪律不是建议而是必须。
- **恢复默认会整行删除**：`configEditor.edit` 在 `next` 与继承层深等时先删 `config` 键，若该行只剩 `id`/`name` 就整行删掉；删的只是用户补丁里的 id 定向覆盖行，bundle 自己的 `insert` 行不受影响。

### 10.6 未做与取舍

- **不做**自建设置 tab（`settings.plugins.tab`）：官方席位是 `plugins.row.config`。
- **不做**网页端构建链：见 §8.4。
- **未覆盖**：非 loopback 浏览器拿不到持久设置（上游限制：`persistence` 恒为 memory）；本插件页面因此只承诺桌面端与 loopback Web。
