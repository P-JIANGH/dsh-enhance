# 发布流程（v1）

本文件是**可执行**的发布 runbook：照做即可产出一个可追溯的版本。它记录的是"发布"这一个
动作的约定，与 `AGENTS.md` 的日常开发纪律互补。

## 0. 前提

- 版本号只在 `package.json` 里改（`version`），并同步 `CHANGELOG.md` 的新小节。
- `CHANGELOG.md` 遵循 Keep a Changelog；每一条都写"为什么"，不写"改了什么文件"。
- 仓库的 README/CHANGELOG 里的 `<owner>` 占位必须替换成真实 GitHub 账号/组织后才能发布。

## 1. 发布前必须全绿的门（缺一不可）

```sh
pnpm install --frozen-lockfile   # prepare 会跑 tsc，同时验证构建
pnpm typecheck
pnpm test                        # 单测（含文档链接钉、宿主契约钉、字节钉）
pnpm check:pack                  # 发布载荷形状（必需文件在、已删源码的产物不在）
pnpm qa:pack                     # 打包安装验收（零 token，真 tarball → 一次性 profile）
```

`pnpm qa:pack` 需要一个真实的 dsh 宿主（0.2.x）。它默认落仓库内隔离 home 的
`qa-pack` profile，**会删除并重建**该 profile；若解析出的 home 不是隔离 home，脚本直接拒绝
运行（这条守卫是必需的：本机环境预设了 `DSH_HOME=~/.dsh`，第一版脚本曾因此在真实 home 里
建 profile）。

可选（消耗 token，但覆盖"装完真能用"）：

```sh
node qa/dsh-enhance-drive.mjs --llm    # 真实会话断言插件加载 / 技能 / doctor
```

## 2. 打标签与发布

```sh
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

GitHub Release 要点（Release 正文可直接取自 `CHANGELOG.md` 的对应小节）：

- **标题**：`v0.1.0`
- **正文**：Added / Changed / Fixed / Removed / Compatibility 五节；把"两个默认开启的钩子
  从未触发"这类修复写清楚（用户需要知道行为变了）。
- **附件**：`npm pack` 产出的 `dsh-enhance-dsh-enhance-0.1.0.tgz`。用户可以
  `dsh plugin --profile <p> add <tarball-url>` 直接装它，不必 clone。
- **兼容性一句话**：预设行需要 dsh ≥ 0.2.0；纯 headless profile 会打印一行
  `preset-enhance … pending (waiting for service: agentPresets)`，属预期。

## 3. 发布后

- 确认 GitHub 上 `master` 与 `v0.1.0` 指向同一提交。
- 把 GitHub 设为主仓（`gitcode` 保留为镜像）：`git remote rename origin upstream` +
  `git remote add origin git@github.com:<owner>/dsh-enhance.git`，并把 `package.json` 的
  `repository` / `homepage` / `bugs` 指到 GitHub。
- 若要提交到社区插件目录（dshbase / deepseekplugin.org）：它们按 **GitHub 仓库**收录，
  因此这一步必须在主仓推送之后。注意 GitHub 上已有一个同名的
  `vcxmug/dsh-enhance`（另一套 vision / native-web 插件），提交时说明区隔。

## 4. 明确不做的事（v1）

- **不发 npm**（留待 v2）：若将来发，需要 scoped 名 `@dsh-enhance/dsh-enhance` +
  `publishConfig.access: public`（scoped 包默认 restricted，免费账号会推失败）。
- **不自动写用户家目录**：没有 `postinstall`，插件不在启动时写任何东西；预设是补丁行，
  随 bundle 一起生效。
- 不带 `--force` 推送、不重写已发布的 tag：历史只追加。
