# 如何将插件安装到 DeepSeek Harness

> 目标宿主：DeepSeek Harness（`dsh`，Cordis 4 插件体系）
> 本文档以 `oh-my-dsh` 为例，说明把插件安装进 `dsh` 并生效、验证、配置、卸载的完整流程，同时覆盖通用机制。
> 原理细节以 `F:\deepseek-harness` 仓库源码（MIT）为准。
>
> **本机约定**：本项目统一用 `omd` 指称 `oh-my-dsh`（含用作 profile 名示例）。文档里的 `omd` 命令可直接复制执行；如果你要装在别的 profile 名下，把 `omd` 换成你的 profile 名即可。

## 1. 理解背景：profile、bundle 与 patch 层

`dsh` 采用"万物皆插件"架构：插件是一个**bundle**（一个声明了 `dsh.bundle` 的 npm 包），它通过一个 `cordis.patch.yml` 向运行树插入配置行。启动时多个 bundle 按顺序叠加成一层层的 `cordis.patch.yml` 补丁（patch），用户自己的覆盖再叠上去。

```
dsh --profile <name>
  运行树 = 空列表
    + dsh.profile.bundles 中每个 bundle 的 cordis.patch.yml（按顺序）
    + profile 目录的 cordis.patch.yml（用户自己的层）
    + $DSH_HOME/cordis.patch.yml（home 级层）
    + 任何 --patch 覆盖
```

- **profile（配置档）**：`$DSH_HOME/profiles/<name>/` 目录，默认 `$DSH_HOME` 为 `~/.dsh`（可用 `DSH_HOME` 环境变量覆盖）。其中含：
  - `package.json`：profile 的依赖 + 清单 `dsh.profile.bundles`（有顺序的 bundle 列表）
  - `cordis.patch.yml`：用户自己的补丁层（可热重载）
  - `pnpm-workspace.yaml`：供装到 profile 节点模块的第三方插件使用
- **bundle（插件包）**：一个 npm 包，其 `package.json` 声明
  ```json
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
  ```
  `dsh.bundle.patch` 指向该 bundle 的补丁文件。
- 内置 bundle：`@deepseek-ai/dsh-base`（每个 profile 的第一层）、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`。`web` 和 `headless` 两个 profile 有随附模板，会自动初始化；其他 profile 需用 `dsh plugin` 创建。

## 2. 前置条件

- 已安装 `dsh` CLI（npm 包 `@deepseek-ai/dsh`）。
- 已安装并可用 **pnpm**（`dsh plugin` 在 profile 目录里调用 `pnpm`）。
- 想要装载/启用哪个 profile，记下它的 `<name>`（`web`、`headless`，或自建名）。

## 3. 安装插件

`dsh` 没有单独的 "install" 子命令：`dsh plugin` 只是一个**把参数透传给 pnpm** 的薄封装，在 profile 目录中执行 `pnpm <args>`，然后在成功后**按已安装状态自动对账** `dsh.profile.bundles`（装了带 `dsh.bundle` 声明的包就加入层栈；移除或变成非 bundle 则移出）。

语法：

```sh
dsh plugin --profile <name> <pnpm 参数...>
```

常用 pnpm 参数：`add`（安装）、`remove`（移除）、`why`（溯源）、`update`（升级，若某版新增 `dsh.bundle` 声明会自动激活）等。

### 3.1 自建 profile（首次使用）

该 profile 目录不存在时，`dsh plugin` 会自动初始化（无内置模板时以 `@deepseek-ai/dsh-base` 为第一层）、写入 `package.json`、`cordis.patch.yml` 和 `pnpm-workspace.yaml`：

```sh
dsh plugin --profile omd add oh-my-dsh
```

### 3.2 安装来源一：npm registry（已发布）

```sh
dsh plugin --profile omd add oh-my-dsh
```

### 3.3 安装来源二：本地 checkout / 本地路径

`dsh plugin` 会把相对/`file:`/`link:` 形式的路径规格**锚定到你在哪里调用它的目录**（避免在 profile 目录里被误解析），所以从插件仓库直接装：

```sh
# 在 oh-my-dsh 所在目录之外调用，用相对或绝对路径均可
dsh plugin --profile omd add ../../path/to/oh-my-dsh
dsh plugin --profile omd add file:./oh-my-dsh
dsh plugin --profile omd add link:./oh-my-dsh
```

> 提示：`add .` 若在插件仓库目录直接调用会被重写成该目录的绝对路径，`dsh plugin` 的 `anchorPathSpec` 会保证它指向你的调用目录而不是 profile 目录。

### 3.3.1 调试利器：以链接（`link:`）形式安装并实时迭代

开发调试建议用 **`link:` 前缀**安装：它不复制代码，而是让 profile 的 `node_modules/<pkg>` 成为一个指向你源码仓库的目录链接（Windows 上是 junction，`Node`/`pnpm` 会跟随），dsh 每次启动都会从这个链接加载。

```sh
# 相对于你调用 dsh plugin 的目录（或给绝对路径）。
# 本项目作者在本机使用名为 omd 的 profile（约等于 `oh-my-dsh` 的简称）。
dsh plugin --profile omd add link:F:/oh-my-dsh
```

安装成功后 profile 的 `package.json` `dependencies` 里会出现：

```json
"oh-my-dsh": "link:F:/oh-my-dsh"
```

而 `node_modules/oh-my-dsh` 是一个指向源码仓库的目录链接（可验证 `LinkType: Junction, Target: F:\oh-my-dsh`）。

**⚠️ 关键点：链接安装 ≠ 源码即时生效。** dsh 的 loader 解析的是包的 `main` / `exports` 入口，oh-my-dsh 指向 `lib/index.js`（**构建产物**）。因此：

1. pnpm 的 `link:` 依赖**不会自动运行** `prepare` 构建脚本（`prepare` 只在从 registry 或 git 源安装时触发，本地链接不发构建）。
2. 每次修改 `src/` 后，必须在**插件仓库**里手动重新构建：
   ```sh
   cd F:/oh-my-dsh
   pnpm build        # 产出到 lib/（main 指向 lib/index.js）
   ```
3. 然后重启你正在跑的 `dsh --profile omd ...` 进程，改动才会被加载（dsh 的 bundle 树只在启动时装配）。

完整的开发迭代循环是：

```
改 src/ → pnpm build → 重启 dsh --profile omd → 在 dsh 里验证 →（回到第一步）
```

> 为什么已经链接了还要 build？因为 `dsh`（和其它 Node 加载器一样）读取的是包入口指向的**已编译 JS**。你要是愿意，可以把 oh-my-dsh 的 `main`/`exports` 临时指向 `src/index.ts`，并让 profile 用 tsx 之类的运行时打开 —— 但这不是 dsh 默认的加载方式，日常调试按上面的 build 循环最省事。

### 3.4 安装来源三：Git 托管（包通过 `prepare` 自构建）

```sh
dsh plugin --profile omd add git@gitcode.com:jiangh_hnr/oh-my-dsh.git
```

> 注意：pnpm ≥10 默认会拦截 git 依赖的 `prepare`（构建）脚本，直到你在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 里放行它。失败时 `dsh plugin` 会在 stderr 打印 pnpm 报出的确切 key，按其提示加白后重跑即可。

### 3.5 安装第三方插件为普通依赖（非 bundle）

如果装的包**没有** `dsh.bundle` 声明（只是个普通库），它会被当普通依赖装进 profile，**不进** layer 栈，并打印一条提示性 warning（这不影响它被其他 bundle 引用）。

## 4. 验证是否生效

查看该 profile 实际启动时会装配成什么样的树（不会真的启动，只打印组成结果）：

```sh
dsh --profile omd --dump-config
# 或只看默认/内置层（不含用户覆盖与 --patch）：
dsh --profile omd --dump-default-config
```

在输出中查找 oh-my-dsh 的补丁层标记（其 `cordis.patch.yml` 头部注释为 `# oh-my-dsh bundle patch ...`，且插入的插件行 id 为 `oh-my-dsh`）。所见即所加载——任何一行都可以被你自己更高的补丁层覆盖。

实际启动 profile：

```sh
dsh --profile omd ...
```

## 5. 配置插件的 config

插件行接受 `config` 块。由于补丁覆盖是**整行替换 config** 的语义，需在有更高优先级的层里覆盖，即 profile 的 `cordis.patch.yml` 或 home 级 `$DSH_HOME/cordis.patch.yml`。针对 oh-my-dsh：

```yaml
# $DSH_HOME/profiles/omd/cordis.patch.yml
- id: oh-my-dsh
  name: oh-my-dsh
  config:
    workRules: |
      # My team's rules
      Always run the full test suite before pushing.
    orientOnSessionStart: true
    doctorTool: true
```

> 覆盖 key 时**必须带 `name` 并在 `config` 里写全你要保留的每个字段**——补丁会替换目标行的整个 `config`，不写即清掉。

配置项速查（oh-my-dsh）：

| 字段 | 默认 | 含义 |
|---|---|---|
| `workRules` | 内置纪律文案 | 系统提示词 sections 正文；设空字符串即移除该 section |
| `orientOnSessionStart` | `true` | 会话开始时注入一条一次性 orientation 消息 |
| `doctorTool` | `true` | 注册 `oh_my_dsh_doctor` 工具 |

用 `--patch` 临时覆盖（不落盘，调试用，在 profile 层之后应用）：

```sh
dsh --profile omd --patch ./extra.yml ...
```

## 6. 启停 / 卸载

- **从 profile 卸载插件**（移除依赖并自动从 `bundles` 列表剔除）：
  ```sh
  dsh plugin --profile omd remove oh-my-dsh
  ```
- **临时停用某一行**：在更高的补丁层里对目标行设 `disabled: true`（oh-my-dsh 自带的 `presets` 行默认就是 disabled 的示例）。例如在业务上禁用 oh-my-dsh 主行：
  ```yaml
  - id: oh-my-dsh
    disabled: true
  ```

## 7. 排查要点

| 现象 | 原因 / 对策 |
|---|---|
| `dsh plugin` 报 `pnpm: failed ... allowBuilds` | pnpm ≥10 拦截 git 依赖构建，把报错里给的 key 加进 profile 的 `pnpm-workspace.yaml` `allowBuilds` 后重跑 |
| 装了但 `--dump-config` 里没出现 | 该包没有 `dsh.bundle` 声明，只会作为普通依赖；看 `dsh plugin` 的 warning |
| 想覆盖插件配置却没生效 | 层优先级没对：`dsh.profile.bundles` 内的 bundle 层 < profile 的 `cordis.patch.yml` < home 级 < `--patch`；请在更高层覆盖，并写全 `config` |
| `--dump-config` 有帮助 | 用它能看见最终装配树，确认某行能否被自己的补丁瞄准（按其 id） |

## 8. 附录：如何把你们自己的插件变成可装 bundle

只要你的包满足两点即可被 `dsh plugin add` 直接装上并自动进入层栈：

1. `package.json` 声明：
   ```json
   "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
   ```
2. `cordis.patch.yml` 为顶层 YAML 数组，用 `- insert:` 或直接 `- id: ...` 行向空条目列表插入配置行（如 oh-my-dsh 插入 `id: oh-my-dsh` / `name: oh-my-dsh` 一行）。

这样"万物皆插件"的插件就齐了：加一个依赖声明、一个补丁文件，就能用 `dsh plugin --profile <name> add <pkg>` 完成安装。
