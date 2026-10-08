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

## 8. 实证修订（2026-10-08）：照 dshmarket 的做法重写本设计

> 依据：`dshmarket@1.66.11`（本机 desktop profile 内）的 `package.json` / `client/client.js` / `lib/settings.js`，加上 live 客户端 Slot 树取证。**§4.2 的 `settingsBridge.register` 方案在当前宿主上不成立**，以下为修订后的方案。

### 8.1 上游约束（三条硬事实）

1. **宿主已不再为插件注册的命名空间提供服务**。dshmarket `lib/settings.js` 原话：dsh 0.1.7（#677）起 `SettingsService` **有 `describe` / `update`，没有 `register`**——"namespaces are derived from a plugin's Config schema instead"。本机桌面版是 `0.2.0-rc.2`，属此列。→ **§4.2 的 `ctx.settings.register(...)` 在目标宿主上不存在**，我们的配置面只能靠**插件自己的 `Config` schema 被宿主派生**（我们的 `Config` 已经是完整 schemastery schema ✓）。
2. **不能导入被删掉的命名导出**。dsh 0.1.2-alpha.1 删除了 `settingsNamespace` / `installSettingsSection`；dshmarket 记下真实事故：ESM 里缺失的命名导出是 **SyntaxError → 整机 exit 1**（"Installing the market stopped the host from booting at all"）。→ 我们**绝不** import 这两个符号；若某天要兼容旧宿主，调用 `settings.register` 前必须 `typeof service.register === 'function'` 守卫（dshmarket 的 `canRegister()` 就是这么做的）。
3. **设置页的 tab 是公开 slot，卡片槽不是**。live 客户端 Slot 树（本机 GUI）显示 `settings.plugins.tab` 的 occupants：`all`（order 10，随包）与 **`dsh-market`（id `dsh-market`，order 60，active）**；而 `settings.plugin.item`（内置"插件配置"tab 里的卡片槽）在本部署 `available: false`。→ **主面应是我们自己的 tab**，卡片槽只在被声明时才额外挂。

### 8.2 修订后的接入形态（与 §4.2/§4.3 的差异）

- **Host 半侧**：不再有 `settings-bridge`。① `Config` schema 保持完整（宿主据此派生可编辑面）；② 需要"当前生效值"时读**宿主派生后**的值——实现期先实测 `ctx.settings.describe/update` 的可用形态与命名空间键（预期 = 插件行 `id`，即 `dsh-enhance`，与 dshmarket 用 `dsh-market` 一致）；③ 写路径改成 `update(ns, patch)`（带 `expectedRevision`）。**绝不在 boot 时写盘**。
- **Client 半侧**（按 dshmarket 的注册形状逐条对照）：
  ```js
  ctx.inject(['settingsScope'], (scoped) => {
    scoped.slots.inject('settings.plugins.tab', () => scoped.slots.register({
      name: 'settings.plugins.tab',
      id: 'dsh-enhance',            // 自己的 id：新格子与随包 all 并排
      order: 60,                    // 升序；dshmarket 用 60
      label: () => t('nav'),        // thunk：切换语言不需重新注册
      locale: 'dsh-enhance',
      inject: () => ({ t }),
    }, () => react.createElement(SettingsTab, { t })))
  })
  ```
  数据读写走 **`ctx.settingsScope.bind(spec)`**（`@deepseek-ai/dsh-client-ui-settings` 提供的客户端服务）：绑定在**调用者自己的 ctx** 上（disposer 归调用 fiber）；重载由 `settings/document-updated` 与本命名空间事件驱动；**写入携带单字段路径 + 上次读到的 `expectedRevision`**；没有 `decode` 时非对象/校验失败/无法 rehydrate 的 section **什么都不发布**（自绘控件要自己渲染"不可用"态）。注意：settings RPC 仅 loopback 可用，非 loopback 浏览器里绑定恒为 `unavailable`。
- **控件自绘 + 纯度约束**：上游契约是"带浏览器半侧的插件自己拥有卡片"，`dsh-client-ui-settings-plugins` 只做 flex 布局与派发；**跨插件 value import 会被 client bundle-purity gate 拒绝**，React 从宿主的模块表解析（dshmarket 注释原话）。
- **构建**：复刻 dshmarket 的链——`tsc -p tsconfig.json && tsdown`（另有 banner 归一化脚本）；`package.json` 需要 `exports["./client"]` + `dsh.client = { inject: [客户端包名…], platform: 'web' }`；devDeps 参考 `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-settings-plugins`（仅类型）、`tsdown`、react/react-dom 类型。
- **单一写者纪律（dshmarket 用两次真实 bug 换来的）**：同一字段只能有一个编辑器/写者。它的 `buildEnv` 与"发布通道"都因为"设置层 + 自己的卡片同时写"而互相覆盖（"the exact shape of the channel bug documented below"）。→ 我们的 tab 里出现的字段，就**不要**再让 `/config` 命令或其它面写同一个键。

### 8.3 修订后的实施波次

| 波次 | 内容 | 验证 |
|---|---|---|
| A（零前端） | 实测宿主派生命名空间的键与 `describe/update` 形态（`cordis_inspect_query` + 一个临时探针），确认 tab 能绑到 `dsh-enhance` | 探针输出 + 记录进 `docs/upstream-migration.md` |
| B | client 构建链落地：`tsconfig.client.json` + tsdown + `dsh.client` 声明 + 最小空 tab（只渲染版本/预设状态，不写配置） | `dsh web`/桌面端加载无报错；tab 出现在「设置 → 插件」旁 |
| C | tab 控件：字段映射纯函数 + 草稿/`expectedRevision` 保存/重置；**受保护字段不走两处写** | 单测（映射 + revision）+ 真机保存 → 重启生效 |
| D | 契约测试（slot 可注册性、`settingsScope` 形状）+ `docs/upstream-migration.md` | 契约测试通过；台账记录 |
