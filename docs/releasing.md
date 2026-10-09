# 发布流程（v1）

本文件是**可执行**的发布 runbook：照做即可产出一个可追溯的版本。它记录的是"发布"这一个
动作的约定，与 `AGENTS.md` 的日常开发纪律互补。

## 0. 前提

- 版本号只在 `package.json` 里改（`version`），并同步 `CHANGELOG.md` 的新小节。
- `CHANGELOG.md` 遵循 Keep a Changelog；每一条都写"为什么"，不写"改了什么文件"。
- **主仓是 GitHub**：`https://github.com/P-JIANGH/dsh-enhance`（2026-10-09 创建，public；同日 `gitcode` 降为镜像）。账号/组织若变更，这四处必须一起改：`package.json` 的 `repository`/`homepage`/`bugs`、`README.md` 与 `README.en.md` 的安装命令与 CI 徽章、`CHANGELOG.md` 底部的版本链接。

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

### 首次公开前的历史扫描（只做一次）

GitHub 一旦公开，**历史**也一起公开——所以密钥检查必须扫全部提交，而不只是工作树：

```sh
# 每个提交扫一遍（本仓库 54 个提交，秒级完成）；命中数必须为 0
for c in $(git rev-list --all); do
  git grep -n -E 'sk-[A-Za-z0-9]{16,}|DEEPSEEK_API_KEY\s*=\s*\S|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}' "$c"
done
git log --all --oneline -- .env   # 必须为空：.env 从未入库
```

2026-10-09 在 v0.1.0 前的实测结论：54 个提交 **0 命中**，`.env` 从未提交，工作树里它由
`.gitignore` 忽略。

## 2. 打标签与发布

**先确认要打的提交 CI 是绿的**——v0.1.0 的第一版 tag 就吃过这个亏：CI 首跑在 Windows 上红了
（P0-14，CRLF 让全部打包技能消失），而 tag 已经指向那个红提交。宁可多等一次 CI，不要把 tag
钉在自己都过不了门的提交上。

```sh
git push origin master                       # 触发 CI
# 等 CI 绿（gh api / 网页），再：
git tag -a v0.1.0 -m "v0.1.0" <green-sha>
git push origin v0.1.0
```

GitHub Release 要点（Release 正文可直接取自 `CHANGELOG.md` 的对应小节）：

- **标题**：`v0.1.0`
- **正文**：Added / Changed / Fixed / Removed / Compatibility 五节；把"两个默认开启的钩子
  从未触发"这类修复写清楚（用户需要知道行为变了）。**建议用脚本从 `CHANGELOG.md` 抽对应小节**，
  避免正文与变更记录漂移（v0.1.0 就是这么生成的）。
- **附件**：`npm pack` 产出的 `dsh-enhance-dsh-enhance-0.1.0.tgz`。**这是给用户的首选安装来源**
  （免构建、免 allowBuilds）：
  ```sh
  dsh plugin --profile <p> add \
    https://github.com/P-JIANGH/dsh-enhance/releases/download/v0.1.0/dsh-enhance-dsh-enhance-0.1.0.tgz
  ```
- **兼容性一句话**：预设行需要 dsh ≥ 0.2.0；纯 headless profile 会打印一行
  `preset-enhance … pending (waiting for service: agentPresets)`，属预期。

**v0.1.0 的两条分发路径都做过真机验收**（隔离 home 的一次性 profile，桌面宿主 0.2.0-rc.2）：

| 路径 | 结果 |
|---|---|
| Release tarball URL | ✅ 9 秒装完；无需 `allowBuilds`；装出来的 profile 里只有 `schemastery`+`cosmokit`+`@standard-schema`；真启动后本插件行**已激活**，未激活名单只有预期的 `preset-enhance`/`agentPresets` |
| `github:P-JIANGH/dsh-enhance` | ✅ 1 分 20 秒（clone + `prepare` 构建）；**必须先按报错放行 `allowBuilds`**，且 key 含 commit 号、YAML 里必须加引号；真启动同样激活 |

结论写进了 README / installing-plugins：**用户首选 tarball**，源码装作为"跟最新 master"的第二选择，
并把两条摩擦点（放行构建、key 加引号）写在旁边。

### 两条踩过的坑（v0.1.0 实测，别再踩）

1. **不要在同一个 URL 下替换已发布的附件。** v0.1.0 发布 20 分钟后因 P0-14 重打了 tag 并重传了
   同名附件，结果 pnpm 的按 URL 缓存/lockfile 对不上：再次安装同一 URL 会失败
   `ERR_PNPM_MISSING_TARBALL_INTEGRITY`（`resolution: {tarball: …}` 没有 integrity 字段）。
   正确做法是**切版本**（v0.1.1）让 URL 变。这次之所以敢替换：发布仅数分钟、0 下载、0 外部引用。
   替换后必须核验**字节一致**：`curl -L <asset-url>` 下载回来与本地 `npm pack` 产物的 sha256 相同
   （v0.1.0 实测两者均为 `7D20FE1B…C6AC`，102,896 B）。
2. **tag 只钉 CI 绿的提交**（见 §2）。移动 tag 时 GitHub 会把旧 Release 自动转成 **draft**，
   记得删掉残留 draft，别让同一个 tag 存在两份 Release。

## 3. 远端布局与本机网络

主仓 = GitHub（`origin`），镜像 = GitCode（`upstream`）：

```sh
git remote rename origin upstream                                   # 现在叫 upstream 的是 GitCode
git remote add origin https://github.com/P-JIANGH/dsh-enhance.git   # GitHub 成为 origin
git push -u origin master && git push origin v0.1.0
git push upstream master                                            # 镜像同步
```

**本机网络事实（2026-10-09 实测）**：直连 `github.com` / `api.github.com` / `ssh git@github.com:22`
**三条通道全部超时**（无代理环境变量）；本机有一个在听的本地代理 `127.0.0.1:10809`，经它
`api.github.com` 返回 200、`git ls-remote` 正常。因此 GitHub 相关的操作都要走代理，建议按 URL
定向设置（只影响 GitHub，不影响 GitCode）：

```sh
git config --local http.https://github.com.proxy http://127.0.0.1:10809
```

撤销：`git config --local --unset http.https://github.com.proxy`。

## 4. 发布后

- 确认 `v0.1.0` 指向的提交 **CI 是绿的**（`git ls-remote origin` 看 tag 指向；`.github/workflows/ci.yml`；
  推送 `.github/workflows/**` 需要 token 带 `workflow` scope）。`master` 允许在 tag 之后继续前进——
  发布后的文档提交就该这样；但**任何代码或产物变更都必须切新版本**，不能塞回已发布的 tag。
- 用**已发布产物**再验一次，不同形态各一条（比 `git ls-remote` 强得多）：
  ```sh
  # ① 产物级：装出来的包必须真的贡献三条技能（无需 LLM）
  curl -L -o dl.tgz https://github.com/P-JIANGH/dsh-enhance/releases/download/v0.1.0/dsh-enhance-dsh-enhance-0.1.0.tgz
  #    并用 sha256 与本地 npm pack 产物比对；再把它装进一次性 profile，对装出来的
  #    lib/features/skills-provider.js 调 list()，断言 code-review / git-workflow / tdd
  # ② 分发级：从 GitHub 源码装一次并 dump-config
  dsh plugin --profile qa-gh add github:P-JIANGH/dsh-enhance
  dsh --profile qa-gh --dump-config | Select-String "dsh-enhance|preset-enhance"
  ```
- 若要提交到社区插件目录（dshbase / deepseekplugin.org）：它们按 **GitHub 仓库**收录，
  因此这一步必须在主仓推送之后。注意 GitHub 上已有一个同名的
  `vcxmug/dsh-enhance`（另一套 vision / native-web 插件），提交时说明区隔。

## 4. 明确不做的事（v1）

- **不发 npm**（留待 v2）：若将来发，需要 scoped 名 `@dsh-enhance/dsh-enhance` +
  `publishConfig.access: public`（scoped 包默认 restricted，免费账号会推失败）。
- **不自动写用户家目录**：没有 `postinstall`，插件不在启动时写任何东西；预设是补丁行，
  随 bundle 一起生效。
- 不带 `--force` 推送、不重写已发布的 tag：历史只追加。
