# dsh-enhance 设计：Web 设置卡片 + 一键安装脚本

> 状态：设计定稿（brainstorming 产出，2026）
> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 前置文档：`docs/architecture.md`（v2 重设计）、`AGENTS.md`、`docs/upstream-migration.md`（本设计的 R5 产物，落盘后同步）
> 上游参考：`F:\deepseek-harness\packages\client\*`、`packages/settings/settings`（MIT，实测类型定义）

## 1. 理解总结

1. **要做什么**：为 dsh-enhance 增加两个能力——
   (a) **Web 设置卡片**：用户在 `dsh web`「设置 → 插件配置」标签页直接编辑 dsh-enhance 配置（`workRules`、6 个开关组、`advisorModel`），替代手写 `cordis.patch.yml`；配置持久化到 dsh settings 通道，重启生效。
   (b) **一键安装脚本**：`scripts/install.mjs` 把 dsh-enhance 接入用户 profile（本地 `link:` 目录链接优先），并配套预设复制、验证、重启提示。
2. **定位**：dsh-enhance 之于 DeepSeek Harness ≈ oh-my-pi 之于 Pi agent、LazyCodex 之于 Codex、Reasonix 之于无 dsh 时代的 DeepSeek——dsh 用户生态中的**必备增强层**。面向社区通用插件，受众从个人重度开发者出发、可延伸。
3. **主维度**：UI/产品体验（能力可视化、配置/上手体验、会话内交互）+ 行为层深化。
4. **成功标准（四项全要）**：采用率（装上即长期用）、行为改善（产出质量/效率）、上手体验（低认知负担）、生态影响力（可复制示范）。
5. **产出形态**：先方向筛选 → 聚焦深挖。选定旗舰方向：**Web 设置卡片**（方向 1）。

## 2. 假设

- **性能**：client bundle 控制在 KB 级（跟随 dsh client 体系惯例），不设专项性能优化。
- **规模**：社区插件起步（用户数千级以下），存储沿用文件方案（`~/.dsh-enhance`、boulder CAS），不引入数据库。
- **安全/隐私**：本地文件存储原则延续；设置持久化走 dsh settings 通道；**不引入遥测**（架构文档 v3 前不做）。
- **可靠性**：客户端只是呈现层，**事实源始终在 Host**；boulder 等共享状态的原子性不因 UI 半侧而削弱。
- **维护**：单人维护为主，接受 UI 工程化成本（自建 clientBundle 等效构建）。
- **上游**：dsh 是 developer preview，存在破坏性变更（官方明示）；settings 服务为 dsh 标配（agent-presets 直接依赖）。

## 3. 决策日志

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | namespace = `'dsh-enhance'` | — | 匹配插件名，小写 kebab 合法（`settingsNamespace` 约束） |
| D2 | `applies: 'restart'` | live 热应用 | 配置全部在启动时接线；热应用需可重入接线，YAGNI |
| D3 | 卡片自绘 | 复用官方卡片 chrome | bundle-purity gate 禁止跨插件 value import；卡片须自绘、自管草稿与 revision |
| D4 | 构建复刻最小化（tsdown） | 完整复刻 clientBundle 预设 | 只复刻 lazy-CJS factory loader 契约，跳过 CSS 管线（最大成本头） |
| D5 | 测试分层：Host 单测 / 契约测试 / dsh 实驱 | 仅单测 | 三层分别兜类型、运行时契约、真实链路 |
| D6 | **组件策略：自绘极简原生控件** | Ant Design X / ui-primitives | ADX：体积数百 KB、CSS-in-JS 与 `--dsw-*` 双主题体系、组件面向对话非表单；ui-primitives：无 Switch/Textarea（8 字段仅 Input 可复用）、external 有 purity 风险；规模不匹配 |
| D7 | 构建工具 = tsdown | esbuild/rollup 手写 | 与官方 `clientBundle` 同款，复刻偏差最小 |
| D8 | 零 CSS 管线 | lightningcss CSS Modules 复刻 | 原生控件 + 内联 style 传 `--dsw-alias-*` token（官方规则允许）；砍掉复刻成本最大头 |
| D9 | 接入声明：`./client` export + `dsh.client` 声明 | — | client module system 的扫描契约 |
| D10 | `build = tsc && tsdown` | — | host + client 一次产出 |
| D11 | 上游接触面收敛到桥接薄层（R1） | 直接散用上游 API | 收缩易变 API 物理接触面；与架构原则 6 不冲突（桥接是版本卫生，非抽象事件面） |
| D12 | 契约探测测试（R2） | 仅 tsc 类型层 | 类型层盖不住运行时契约漂移（loader 形状、槽键可注册性） |
| D13 | 版本矩阵 + 升级流程文档（R3/R5） | — | 破坏性变更的快速跟进路径 |
| D14 | 降级路径：client 失败不影响 host（R4） | — | loader 懒加载隔离失败 bundle；卡片不渲染、host 全功能照常 |
| D15 | 风险三维评估：可能性 × 影响面 × 修复难度，分级承接 | 仅"变更可能性" | 影响面与修复难度决定承接力度（见 §5） |
| D16 | 安装脚本 = `scripts/install.mjs`（Node 零依赖） | shell 脚本 | 跨平台（Windows/macOS/Linux）；Node 已是 dsh 前置 |
| D17 | 安装来源三选（`-s`）：`link:`（默认，本地目录链接）/ `github:owner/repo` / npm | 仅 link: | 发布前后一致；link: 开发态实时同步 |
| D18 | 脚本配套：预设复制到 `~/.dsh/.agent-presets` + `--dump-config` 验证 + 重启提示 | 只包装 add | 对齐 README 现有手动步骤，一次到位 |
| D19 | **名字冲突处置**：npm `dsh-enhance` 已被占（0.1.7）；实现期默认 `github:` 直装，scoped npm 名（`@omd/dsh-enhance`）留待发布时定 | — | README/文档明确区分 GitHub 8+ 同名仓库（LaplaceYoung 55★ 等）；scoped 名决定会连带 `dsh plugin add` 命令与 README 示例变化 |
| D20 | 脚本语言 Node（零依赖），禁 shell | bash/sh | Windows 开发环境 + 社区跨平台 |

## 4. 最终设计

> ⚠️ **本节（§4–§7）是最初的规划稿，已被 §8 起的实证修订取代**：§4.2 的 `settingsBridge` / `ctx.settings.register` 方案在目标宿主上**不存在**，§4.4 的构建链（tsdown）也未采用。**交付形态以 §10 为准**，机制依据与验收证据在 §8、§9。保留本节只为记录决策演进。

### 4.1 总体架构与数据流

```
┌─ Host 半侧（现有 src/ + 新增 settings-bridge）─────────────┐
│ apply(ctx, config)                                        │
│   scope = settingsBridge.register(ctx, config)            │
│     → ctx.settings.register('dsh-enhance', Config, {base})  │
│   applyFeatures(ctx, scope.get())   // defaults+entry+user│
│   scope.watch(→ 提示重启)                                  │
└───────────────────────────────────────────────────────────┘
         ▲ wire：descriptor(schema/value/revision/base/user)
┌─ Client 半侧（新增 src/client/）──────────────────────────┐
│ apply(clientCtx)                                          │
│   slots.inject('settings.plugin.item',                    │
│     register({name, key:'dsh-enhance', locale}, Card))      │
│   Card 经 settingsScope.bind({namespace:'dsh-enhance'})     │
│   set/unset 单字段，revision 防并发覆盖                   │
└───────────────────────────────────────────────────────────┘
```

数据流：设置页按 served namespace 分发 → 渲染卡片 → 编辑保存（revision-fenced）→ Host 持久化到 `settings.yaml` → 提示重启 → 重启后 `scope.get()` 含用户层。

### 4.2 Host 半侧

```ts
export const inject = ['skills', 'systemPrompt', 'tools', 'agents', 'llm', 'settings']
export const DSH_ENHANCE_SETTINGS_NS = settingsNamespace('dsh-enhance')

export function apply(ctx: Context, config: Config): void {
  const scope = settingsBridge.register(ctx, DSH_ENHANCE_SETTINGS_NS, Config, config) // D11 桥接层
  applyFeatures(ctx, scope.get())   // 现 apply 接线逻辑原样搬入，仅换取值来源
  scope.watch(() => ctx.logger.info('dsh-enhance: 配置已变更，重启后生效'))
}
```

- **必须读 `scope.get()` 而非 `config`**：settings.yaml 用户层不自动并入 entry config（官方范式 web-search-deepseek 用惰性 `current()` 印证）；`inject: ['settings']` 保证 apply 时服务就绪。
- **桥接层 `src/shared/settings-bridge.ts`**（R1）：包装 `register`/`watch`，register 失败（契约破坏）时自动回退——`applyFeatures(ctx, config)` 保持现状不回归（配置 UI 降级为只读展示，数据不丢）。

### 4.3 Client 半侧

```ts
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']
export function apply(clientCtx: ClientContext): void {
  clientCtx.slots.inject('settings.plugin.item', () =>
    clientCtx.slots.register({
      name: 'settings.plugin.item', key: 'dsh-enhance',
      locale: 'settings.ohMyDsh', inject: () => card.inject(),
    }, OhMyDshCard))
}
```

字段映射（D6 自绘原生控件，内联 style 引用 `--dsw-alias-*` token）：

| 字段 | 控件 | 说明 |
|---|---|---|
| `workRules` | `<textarea>` | 多行文本 |
| orient/doctor/guards/workTracking/worktree/advisor | `<input type=checkbox>` 样式化 | 布尔 |
| `advisorModel` | `<input>` | 单行文本 |

- 读写走 `settingsScope.bind({ namespace: 'dsh-enhance' })`：`set` 存单字段、`unset` 清除回 base、user 层存在 = 被覆盖（提供 reset）。
- 无 `role('secret')` 字段，不涉及密钥通道。
- 字段列表/值映射抽成纯函数（可单测），组件保持薄层。
- **桥接层 `src/client/bridge.ts`**（R1）：slot 注入与 `window.__ModuleLoader__` 访问收敛于此。

### 4.4 构建方案

- **D7/D8**：新增 `tsdown.config.ts`——单 entry `src/client/index.ts` → CJS bundle；`external` 全部 `@deepseek-ai/*` 与 shell-seeded 依赖（React/Cordis 由 loader module-table 提供）；产物注入 `window.__ModuleLoader__.load({ id: 'dsh-enhance', factory })` 包装（模板单文件化 `scripts/client-bundle.template.cjs`，便于 C5 修复）。
- **D9**：`package.json` 增加 `"./client"` export（`./lib/client.js`）+ `"dsh": { "client": { "platform": "web", "inject": [...] } }`；`files` 增加 `lib/client.js`。
- **D10**：`build = tsc && tsdown`。

### 4.5 一键安装脚本（D16–D18）

`scripts/install.mjs`（Node，零依赖）流程：
1. 检测 dsh CLI：`dsh` 或 `npx @deepseek-ai/dsh`
2. 选择/创建 profile（`-p`，默认 `web`）
3. 安装来源（`-s`）：`link`（默认，当前 checkout 目录链接）/ `github:owner/repo` / `npm:@omd/dsh-enhance`（发布后）
4. 复制 `presets/` 到 `~/.dsh/.agent-presets/`（web persona 启用）
5. 验证：`dsh --profile <name> --dump-config` 找到 `# == dsh-enhance` 层
6. 提示重启 + 可选 `dsh web` 启动

### 4.6 上游破坏性变更承接（R1–R5）

**接触面清单（6 项）**：C1 `settings.register` 签名（可能性中 × 影响面高 × 修复难度中→低）、C2 `SettingsScope` get/watch（低×中×低）、C3 `settings.plugin.item` 槽键（中×低×低）、C4 `dsh.client`/`./client` 约定（中×中高×中高→中）、C5 `__ModuleLoader__.load` 契约（高×中高×中高→中）、C6 client inject 服务列表（中×低×低）。

**承接机制**：
- **R1 桥接层收敛**：host `src/shared/settings-bridge.ts` + client `src/client/bridge.ts`；上游破坏只改这两处。*边界声明：收缩易变 API 物理接触面，非抽象 dsh 事件面（不违原则 6）。*
- **R2 契约探测测试** `tests/upstream-contract.test.mjs`：register 是函数、槽键可注册、`window.__ModuleLoader__.load` 形状；上游破坏 → CI 先红在具体断言 → 快速跟进。
- **R3/R5 版本矩阵 + 升级流程**：`docs/upstream-migration.md` 记录每项"影响面等级 + 修复落点 + 验证方法"。
- **R4 降级路径**：client 契约破坏 → loader 隔离失败 bundle → 卡片不渲染、host 全功能照常；显式写进测试（模拟 loader 失败断言 host 仍工作）。
- **修复难度降级措施**：契约测试保定位速度；桥接层保修复范围（改一处）；降级路径保无时间压力；bundle 模板单文件化保 C4/C5 修复集中。
- **R4-补 卡片"重启生效"提示**：`SettingsDescriptor.applies` 随 wire 下发，但官方卡片是否渲染"重启生效"标记未在源码确认；实现期验证，若未渲染则卡片自绘提示文案。

## 4.7 改名方案：oh-my-dsh → dsh-enhance（✅ 已执行，2026-09-30）

> 定名：`dsh-enhance`。GitHub org/repo 与 npm `@dsh-enhance/dsh-enhance` 全维度可用。

**命名碰撞事实**：GitHub 上含 `oh-my-dsh` 的名字仓库共 **35 个**（`like-study1/Oh-My-DSH` 73★、`LaplaceYoung/oh-my-dsh` 55★"700+ 插件生态"等）；npm `oh-my-dsh`（0.1.7）/`omd`/`oh-my-harness` 均被占。品牌区隔为刚需。

**发布路径**：仓库 `git@gitcode.com:jiangh_hnr/dsh-enhance.git`（GitCode）；npm `@dsh-enhance/dsh-enhance`。

**全套标识映射**：

| 层 | 旧 | 新 |
|---|---|---|
| 包名 | `oh-my-dsh` | `@dsh-enhance/dsh-enhance` |
| 插件行 | `- id/name: oh-my-dsh` | `- id: dsh-enhance` |
| 模型工具 | `oh_my_dsh_doctor` | `dsh_enhance_doctor`（保长度，用户定） |
| 提示词段 | `oh-my-dsh/work-rules` | `dsh-enhance/work-rules` |
| orient 点名 | 包名 | `dsh-enhance` |
| 预设目录 | `presets/omd/` | `presets/dsh-enhance/` |
| 存储目录 | `~/.omd/**` | `~/.dsh-enhance/**`（品牌统一，用户定） |
| QA/脚本 | `qa/omd-drive.mjs` 等 | `qa/dsh-enhance-drive.mjs` 等 |
| 文档/测试 | 107 处 `oh-my-dsh`/`oh_my_dsh` | 全量替换 |

**改名 = 破坏性变更**；v0.1 无外部用户，是零成本唯一窗口。作为阶段 0 前置（先改名再推 UI 半侧，避免两套名并存）。

**执行结果（2026-09-30）**：仓库内旧名已清零（仅保留迁移用途的 `LEGACY_PACKAGE_NAMES` 与文档中的历史记录）；环境侧 `~/.dsh/profiles/web` 的旧 junction 已改为 scoped 名，旧 profile `omd` 迁移为 `dsh-enhance` 后删除（配置备份在 `~/.dsh/profile-backups/`）；`~/.dsh/.agent-presets` 里的旧名残留已备份清理。**注意**：checkout 目录仍叫 `F:\oh-my-dsh`（改名会牵动所有 profile 的 `link:` 指向），包名与项目名才是 `dsh-enhance`。

**迁移顺序**：① 仓库/包名 → ② 运行时标识（工具名/提示词段/预设目录/存储目录）→ ③ QA 脚本/测试（presets-pin 字节锁定自动跟随新名）→ ④ 文档全量替换 → ⑤ 验证（pnpm test/build/typecheck + 实驱）。

## 5. 风险清单

| # | 风险 | 等级 | 承接 |
|---|---|---|---|
| C1 | `settings.register` 签名漂移 | 中×高×中 | 桥接层 + register 失败回退 entry config |
| C2 | `SettingsScope` 形状漂移 | 低×中×低 | 桥接层 + 类型层 |
| C3 | 槽键漂移 | 中×低×低 | 契约测试断言 |
| C4 | `dsh.client`/`./client` 约定漂移 | 中×中高×中高 | 桥接 + 模板单文件 + 降级路径；连带 loader 变更时升级为高，靠自检清单 |
| C5 | `__ModuleLoader__.load` 契约漂移 | 高×中高×中高 | 同上 + migration 文档单独成节记录实现细节 |
| C6 | client inject 服务列表漂移 | 中×低×低 | 类型层 |
| R-N1 | **名字冲突**：npm `dsh-enhance` 被占、GitHub 8+ 同名 | 高（定位面） | 发布走 `github:`/scoped 名；README 差异化声明 |
| R-N2 | bundle 构建格式偏差（自复刻） | 中 | 阶段 0 先验证空 entry 过 loader |
| R-N3 | register 失败兜底依赖"抛错可捕获"假设 | 低 | 契约测试探测 `scope.get()` 行为差异 |
| R-N4 | **settings 服务缺失**（老版本/极简部署）→ `inject` 使插件不激活 | 低 | 接受（dsh 标配场景，agent-presets 亦硬依赖 settings）；文档注明此边界 |
| R-N5 | 无 settings provider 时 `scope.get()` 行为未实测（假设返回 defaults+base） | 中 | 阶段 1 前置验证；若需 provider 才返回可用 scope，则 C1 兜底逻辑提前 |
| R-R1 | **改名破坏性变更**：模型工具名 `dsh_enhance_doctor`、提示词段、`~/.dsh-enhance/` 迁移 | 高（一次性） | v0.1 无外部用户零成本；作为阶段 0 前置，一次到位；`presets-pin`/doctor 单测锁定新名 |

## 6. 实施计划

| 阶段 | 内容 | 验证 |
|---|---|---|
| 0 | **改名 `oh-my-dsh` → `dsh-enhance`（§4.7）**：包名/工具名/提示词段/预设目录/存储目录/QA/文档 | ✅ 已完成：`pnpm test` + `pnpm build` + `pnpm typecheck` 全绿，doctor 实驱报新名 |
| 0b | 构建链验证：tsdown 最小 bundle 模板 + 空 client entry | `dsh web` 加载无报错；若本机 `dsh web` 起不来，退化为 loader 契约静态核对 |
| 1 | Host 半侧：`settings-bridge.ts`、apply 改造（inject 'settings' + `scope.get()`）、settings 单测；**前置验证 R-N5**（无 provider 时 `scope.get()` 行为） | `pnpm test` 新用例 |
| 2 | Client 半侧：`bridge.ts`、字段映射纯函数 + 卡片、package.json 接入声明 | 卡片渲染 |
| 3 | 契约测试 + dsh web 实驱 QA（改配置 → settings.yaml → 重启生效） | 实驱证据（`.dsh-enhance/evidence/`） |
| 4 | `docs/upstream-migration.md` + README 安装段更新 | 文档评审 |
| 5 | `scripts/install.mjs` + 脚本自测（临时 profile 全流程） | 脚本端到端跑通（其中**预设装机**那一半已由 `scripts/install-presets.mjs` 落地，见 README） |

## 7. 验证策略

- **单测**：settings 三层解析（defaults+entry+user）、字段映射纯函数、桥接层回退逻辑。
- **契约测试**：R2 断言清单（每个接触点运行时存在性）。
- **实驱 QA**：隔离 `$DSH_HOME` 起 dsh web——卡片出现 → 编辑保存 → `settings.yaml` 落盘 → 重启 → `doctor` 报新值生效；模拟 loader 失败断言 host 照常。
- **脚本**：临时 profile 全流程（link: 安装 → 预设装机 `scripts/install-presets.mjs` → dump-config 验证）。


## 8. 机制实证（2026-10-08）：设置面到底怎么工作

> 依据：**本机运行中的桌面宿主**（`@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2`，解包自 `resources/app.asar`）的源码 + live Inspect 取证 + 隔离 home 上的真机探针。**§4.2 的 `settingsBridge` / `ctx.settings.register` 与 §4.4 的 tsdown 构建链都已作废**，本节起为最终依据。

### 8.1 三条硬事实（推翻了最初的规划假设）

1. **宿主没有 `register`，命名空间不是插件注册的。** `@deepseek-ai/dsh-settings@0.2.0-rc.2` 的服务类是 **`SettingsForms`**（不是 CLI 依赖树里 rc.6 的 `SettingsProvider`），方法只有 `describe` / `update` / `replace` / `mutate` / `prepareDocument` / `configure`。`describe()` 遍历 `configEditor.configuration()`，把**每个 Loader 条目的 `options.id`**（= 配置补丁行的 `id`，本插件即 `dsh-enhance`）当作命名空间。探针实测：本部署 `settings` 服务 = `SettingsForms`，`register=undefined`、`configure=function`。
   （注意：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings` 里另有一份 rc.6、带 `register` 的旧实现——那是 **CLI** 的依赖树，桌面宿主按自己的解析表用 asar 里的 0.2.0-rc.2。分辨方法就是把服务实现身份打进日志。）
2. **只有 `volatile()` 字段能被设置面编辑。** `SettingsForms.describe()` 对每个条目调 `volatileForm(Config)`：**一个 volatile 字段都没有的条目根本不进 `describe()`**；写路径还会对非 volatile 字段直接抛 `Config field "x" is not volatile`。所以"插件配置出现在设置里"的唯一开关，是把自己的 `Config` 字段标 `.volatile()`（schemastery 的 `Schema.prototype.volatile()` = `extra('volatile', true)`；宿主投影成 JSON Schema 的 `x-cordis.volatile`）。
3. **volatile 改动不重挂插件。** `@deepseek-ai/cordis-plugin-loader` 的 `Entry.update`：当"只有 `config` 变、且 `equalExceptVolatile` 成立"时走 `_commitVolatile()` —— **原地**把新值写进已挂载插件的 accessor（`updateVolatile(ref, source)`），并只在**该插件自己的 fiber** 上 `emit('loader/volatile-update', paths)`，**不重新 apply**。只要还夹带一个普通字段的变化，就走普通更新生命周期（= 重挂）。

### 8.2 席位：`plugins.row.config`（用户 2026-10-08 选定 A）

- 内置「插件」面板（`@deepseek-ai/dsh-client-ui-plugin-manager` 注册在 `main` 槽）声明并派发 `plugins.row.config`（keyed）。槽目录原话：*"The configuration of one row a bundle declares, keyed by `<package name>#<row id>` … the row on the bundle's page gains a configure control"*；同目录明确 bundle 的配置属于 `plugins.bundle.config` / `plugins.row.config`，而 `plugins.item` 是**官方随包页专用**。→ 我们的 key = `@dsh-enhance/dsh-enhance#dsh-enhance`（包名 + `cordis.patch.yml` 那行的 `id`）。
- 派发侧代码就是判据：`configure.has = (row) => ledger.rows.has(rowConfigKey(pkg.name, row.rowId))` —— 台账里没有这个 key 就**没有**「配置」入口；组件收到 `{ view: 'summary' | 'page', form? }`。
- 被否掉的备选：`settings.plugins.tab`（设置弹窗 →「内置插件」里的自建 tab，dshmarket 走的路，id `dsh-market`/order 60 已在 live 树中可见）。功能上可行，但官方槽目录把该区描述为随包页与官方视图的座位，且它绕开了"bundle 的配置"这条正式归属。
- 对照（live）：`plugins.item` 的 occupants = `shell`/`agent-loop`/`subagent`/`web-search`（全为 `mf` 内置包，各自一个 companion 包）；`settings.section` occupants = `account`/`general`/`models`/`plugins`/`agent-presets`/`market`。

### 8.3 官方 companion 包的形状（逐项对照 `dsh-client-ui-settings-agent-loop@0.2.0-rc.2`）

```js
const inject = ['slots', 'locale', 'configForms']              // 客户端服务
ctx.effect(() => ctx.locale.register(NS, { zh, en }), '…')
const card = new CardController(ctx.configForms.get('agent-loop'))
ctx.effect(() => () => card.dispose(), '…')
ctx.effect(() => ctx.configForms.whileServed(['agent-loop'], () =>
  ctx.slots.inject('plugins.item', () => ctx.slots.register({ name, id, order, label, locale, inject }, Card))), '…')
```
- 带浏览器半侧的第三方插件用 `dsh.client = { inject: [客户端包名…], platform: 'web' }` + `exports["./client"]`；官方 companion 包同样如此（`dsh-client-ui-settings-agent-loop` 的 `dsh.client.inject` = locale + ui-settings + **ui-plugin-manager**，最后一个是它所注册槽位的所有者）。
- 模块加载器给 `factory(require)` 的模块表里有 `react` / `react-dom` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`（dshmarket 与随包页都这么用）。
- **单一写者**：`ctx.configForms.get(id)` 对同一命名空间返回**同一个**共享表单控制器（上游明文："repeated `get(entryId)` calls return the same form"），所以"用页面递来的 `form` 还是自己 `get`"不会变成双写者。dshmarket 记过两次真实 bug，纪律照旧：同一字段只有一个写者。

### 8.4 为什么不引入构建链（与 §4.4 的差异）

dshmarket 用 tsdown/rolldown 产出 `client/client.js`；本插件没有 CSS 模块、没有跨包 value import、也没有多文件拆分需求，因此**手写**该文件（模块加载器按 `exports["./client"]` 原样取用），保持本仓库 tsc-only 构建与"除 schemastery 外零运行时依赖"。代价：该文件不过 tsc；补偿见 §10.4 的契约测试。

## 9. 波次 A 验收：写→读往返（2026-10-08，四条全部通过）

> 探针：`.dsh-enhance/settings-probe/`（gitignored）+ 隔离 home `.dsh-enhance/desktop-test-home`（profile `qa`，含探针行）。启动方式 = **桌面宿主 CLI** `resources/runtime/cli/bin/dsh.cmd`（→ `app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`），因此跑的就是桌面那套 0.2.0-rc.2 语义。**全程不碰用户的 desktop profile。**

第一次启动（`PROBE_WRITE=1`，原始日志节选）：

```
apply: settings=SettingsForms register=undefined configure=function describe=function update=function mutate=function
describe: 11 namespace(s); ours=YES
doctorToolRegistered(before)=yes
tools(before)=boulder_complete,boulder_start,boulder_status,dsh_enhance_doctor,worktree_cleanup,worktree_create,worktree_list
descriptor(before)={"ns":"dsh-enhance","revision":0,"applies":"live","autoGenerate":true,
                    "value":{…7 个开关全 true…},"user":{},"base":{…同 value…},"secretPaths":[]}
update(doctorTool=false) OK at revision 0
descriptor(after)={… "revision":1, "value":{"doctorTool":false,…},
                   "user":{"doctorTool":false}, "base":{"doctorTool":true,…}}
doctorToolRegistered(after)=no
tools(after)=boulder_complete,boulder_start,boulder_status,worktree_cleanup,worktree_create,worktree_list
stale write rejected: SettingsConflictError code=SETTINGS_CONFLICT expected=0 actual=1
patch file: … - id: dsh-enhance / name: "@dsh-enhance/dsh-enhance" / config: { doctorTool: false }
```

第二次启动（只读，新进程）：

```
describe: 11 namespace(s); ours=YES
doctorToolRegistered(before)=no
descriptor(before)={… "revision":0, "value":{"doctorTool":false,…},
                    "user":{"doctorTool":false}, "base":{"doctorTool":true,…}}
read-only boot: nothing written
```

逐条对照旧 §9.3 的出口条件：

| # | 条件 | 结果 |
|---|---|---|
| 1 | `describe()` 里有本插件条目、键 = ? | ✅ `ns = "dsh-enhance"`（= 补丁行 id），`applies: "live"` |
| 2 | `update(ns, patch, expectedRevision)` 被接受 | ✅ `update(doctorTool=false) OK at revision 0` |
| 3 | 再读：新值进 **user 层**、`revision` 前进 | ✅ `user={doctorTool:false}`、`revision` 0 → 1，且 `base` 保持组合默认（可"恢复默认"） |
| 4 | 第二次启动仍生效（证明落盘而非内存） | ✅ 写进了该 profile 的 `cordis.patch.yml`，新进程读到 `user={doctorTool:false}` |
| 5 | 过期 revision 被拒 | ✅ `SettingsConflictError code=SETTINGS_CONFLICT expected=0 actual=1` |

**额外拿到的一条关键事实**（第一轮探针暴露、直接改变了实现）：写成功后 `dsh_enhance_doctor` **从工具表消失**，而 `boulder_*`/`worktree_*` 一个不多一个不少 —— 说明改动真的重建了整代接线（§8.1 事实 3 + §10.2 的重挂）。第一轮**没有**这条效果（工具还在），正是它逼出了重挂设计。

旧 §9.2 列的"尚未证明"五项逐条落定：descriptor ✅、命名空间键 ✅、写入/落盘/live ✅、桌面部署 compose 了 settings（`describe()` 返回 11 个命名空间）✅、客户端 `configForms` ✅（`@deepseek-ai/dsh-client-ui-settings` 的 `ConfigForms` 服务；本机客户端服务目录确未投影它，但官方 companion 包与 dshmarket 都按此写）。

## 10. 最终实现（已交付）

### 10.1 文件与职责

| 位置 | 内容 |
|---|---|
| `src/index.ts` | 8 个用户可见字段 `.volatile()`（`workRules` 保持普通值：长文本，非开关）；功能接线装进子插件 `dsh-enhance/features`；`ctx.on('loader/volatile-update')` 上串行「先卸载再重挂」 |
| `client/client.js` | 浏览器半侧：注册 `plugins.row.config`（key `@dsh-enhance/dsh-enhance#dsh-enhance`），`whileServed(['dsh-enhance'])` 门控；`SettingsFormModel` + 自写布尔规格 + `Checkbox` 行 + `SettingsValueField`（顾问模型）；字典与样式内联 |
| `package.json` | `exports["./client"]`、`dsh.client = { inject: [locale, ui-settings, ui-plugin-manager], platform: 'web' }`、`files += client`；`@deepseek-ai/schemastery` 进 `dependencies`（`~3.18.4`，`volatile()` 需要它，与宿主同版本） |
| `tests/volatile-remount.test.mjs` | 重挂编排契约：同步首挂、先卸后挂、串行、失败只告警 |
| `tests/client-contract.test.mjs` | 浏览器半侧跨文件契约（§10.4） |

### 10.2 开关为什么必须重挂

`describe()` 只暴露 volatile 字段 → 只能靠 volatile 编辑；而 volatile 改动**不重挂**（§8.1 事实 3）。本插件每个开关管的都是**注册**（工具、命令、钩子、advisor 运行时），原地改 accessor 不会改变已注册面，所以功能接线必须由我们自己重建：
`apply` 同步挂一个子插件 → 收到 `loader/volatile-update` 时**串行**地 `dispose()` 旧代再挂新代（先卸后挂，避免与"同一层内重名即失败"撞车）→ 子插件在挂载时读 accessor 的**当前**值。若某个部署的 loader 不发这个事件，退化为"值已存下、下次启动生效"。

### 10.3 单一写者与字段范围

- 7 个开关（`orientOnSessionStart` / `doctorTool` / `commands` / `guards` / `workTracking` / `worktree` / `advisor`）+ `advisorModel`；`workRules` **不可**在页面编辑（仍在 profile 补丁里改）。
- 页面用 `ctx.configForms.get('dsh-enhance')`，与「插件」面板拿到的控制器是同一个 → 不存在两个写者。
- 写入走 `mutate(ops, revision)`：`set` 单字段、`unset` 恢复组合默认；revision 来自上次 `describe`。

### 10.4 验收清单（本仓库可复跑）

```sh
pnpm typecheck && pnpm build && node --test      # 188/188
pnpm check:presets                              # 预设装机仍是最新
npm pack --dry-run                              # 含 client/client.js
```
浏览器半侧的**真机验收**：重启桌面端 → 打开「插件」面板 → 本插件那一行应出现「配置」入口；随后可用客户端 Inspect 复核（不必靠肉眼）：

```
cordis_inspect_query(platform="client", provider="Slots", method="listSubTree", input={root: "plugins.row.config"})
# 期望 occupants 里出现 key = "@dsh-enhance/dsh-enhance#dsh-enhance"
```

### 10.5 真机验收记录（2026-10-08，桌面端 GUI，**双向**都跑）

前置：重启桌面端后，客户端 Inspect 已确认 `plugins.row.config` 的唯一 occupant = `key "@dsh-enhance/dsh-enhance#dsh-enhance"`、`active: true`（`plugins.item` 的官方四条未受影响）。

用户在「插件」面板对 **worktree 工具** 做了一次往返，三条互相独立的信号一致：

| 信号 | 独立性 | set（取消勾选→保存） | unset（恢复默认→保存） |
|---|---|---|---|
| ① `~/.dsh/profiles/desktop/cordis.patch.yml` | 不依赖任何注册表/会话状态 | 新增整行 `- id: dsh-enhance / name: … / config: { worktree: false }` | **整行被删除**（文件回到 285 行，末行仍是 `agent-default-model`） |
| ② `dsh_enhance_doctor` 回显的生效配置 | 读的是插件自己 resolve 出来的值 | `worktree=关`，其余全 `开`，`工作准则长度=286 字` | `worktree=开`，其余全 `开`，`工作准则长度=286 字` |
| ③ `Tool.listTools`（宿主工具注册表） | 反映 volatile 原地提交 + 重挂是否真的跑了 | `worktree_create/list/cleanup` **消失**，`boulder_*`/`dsh_enhance_doctor` 原样 | 三个 `worktree_*` **回来** |

三条合起来证明（**全程不需要重启**）：浏览器表单 → 客户端 `configForms`（带 revision 的 `mutate`）→ 宿主 `SettingsForms` → `configEditor.edit` 写桌面 profile 的补丁 → Loader 原地提交 volatile → 我们那一代接线先卸后挂 → 工具注册表变更。顺带纠正一个自疑：工具表**不是**会话开始时的快照，它在会话中途跟着变。

两个只有真机能暴露的细节，记下来：

- **界面写的是"最小增量"**，不是整份 config：`SettingsForms.write` 先 `strip(raw)` 保留目标行原有的非 volatile 字段，再叠加 volatile 增量，所以补丁里只有一个键。被省略的字段回落到 **schema 默认值**（`workRules` 的 286 字默认值仍在 ⇒ 提示词段没被清掉）。注意：这意味着**手写在 bundle 补丁里的同名值会被界面覆盖成 schema 默认**——所以单一写者纪律不是建议而是必须。
- **恢复默认会整行删除**：`configEditor.edit` 在 `next` 与继承层深等时先删 `config` 键，若该行只剩 `id`/`name` 就整行删掉；实测正是如此，且删掉的只是**用户补丁里的 id 定向覆盖行**，bundle 自己的 `insert` 行不受影响。

### 10.6 未做与取舍

- **不做**自建设置 tab（`settings.plugins.tab`）：用户选定的席位是官方归属的 `plugins.row.config`；两者可复用同一组件，但目前不需要。
- **不做**网页端构建链（tsdown/JSX）：见 §8.4。
- **未覆盖**：非 loopback 浏览器拿不到持久设置（上游限制：`persistence` 恒为 memory，表单呈 unavailable）；本插件页面因此也只承诺桌面端与 loopback Web。
