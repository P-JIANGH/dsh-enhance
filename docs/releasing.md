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

### 公开面审计（首次公开前，以及每次发布后）

"仓库里没有密钥"不等于"公开面没有密钥"。公开面有**四个**，只扫第一个是常见漏洞：

| # | 面 | 为什么容易漏 | 怎么查 |
|---|---|---|---|
| ① | 当前文件 + **全部历史** blob | 删除过的文件仍在历史里 | 枚举 `git rev-list --objects --all` 的每个 blob，用同一套特征扫描（**不要**用 `git grep -E`：POSIX ERE 不认 `\b`/`\s`/`(?:)`，整层会报错；把报错当成"无命中"就是假绿） |
| ② | **提交与标签的消息对象** | 消息不在任何 blob 里 | `git log --all --format=%H` + `git cat-file commit <sha>`；标签用 `git for-each-ref refs/tags` + `git cat-file -p` |
| ③ | GitHub 上的公开文本 | Release 正文 / 仓库描述不在仓库里 | `GET /repos/{slug}/releases/tags/{tag}`（取**完整** body，别用截断输出）+ `GET /repos/{slug}` |
| ④ | **Release 附件的内容** | 它是构建产物，不是 blob，GitHub 的 secret scanning 也不保证覆盖；一个把本机配置/产物打进去的构建正好从这里漏 | 下载附件 → 解包 → 逐文件扫描（顺带确认没有 `*.map`：source map 会带源码路径） |

本机脚本（gitignored，`node .dsh-enhance/<name>`）：`scan-secrets.mjs`（①②，含**非真空守卫**：规模异常即报 ERROR，绝不报 CLEAN）、`scan-public-surface.mjs`（③④）、`control-secret-scan.mjs`（阳性对照：在临时仓库里放一个**只存在于历史**的假密钥，确认扫描器真会报出来）。

2026-10-09 v0.1.0 实测结论：blob 686 个（117 当前 + 569 历史）**0 命中**；63 个提交 + 1 个标签消息 **0 命中**；Release 正文 6.7KB + 仓库描述 **0 命中**；附件 73 个文件 270KB **0 命中、无 source map**。GitHub 侧：Actions secrets 0 · deploy keys 0 · webhooks 0 · 协作者仅 owner · **GitHub 自己的 secret scanning 告警为 0**。唯一的"痕迹"是文档与一条提交消息里作为示例出现的本机代理端口 `127.0.0.1:10809`（非凭据）。

### 本机凭据存放（与公开面无关，但发布前后值得看一眼）

`~/.git-credentials` 里的 GitHub 凭据若是 **classic PAT**（scope 含 `repo`），它等于**你所有仓库的完全写权限**，且明文存盘。建议换成 **fine-grained PAT**（只授权本仓库的 `Contents: RW` + `Workflows: RW`），并把 `credential.helper` 从 `store` 改为 `manager`。这条与"仓库有没有泄密"是两件事：仓库干净，不代表本机那把宽权限 token 值得长期留着。

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

- **标题**：`v<version>`
- **正文**：Added / Changed / Fixed / Removed / Compatibility 五节；把"两个默认开启的钩子
  从未触发"这类修复写清楚（用户需要知道行为变了）。**建议用脚本从 `CHANGELOG.md` 抽对应小节**，
  避免正文与变更记录漂移（v0.1.0 与 v0.1.1 都是这么生成的）。
- **附件**：`npm pack` 产出的 tarball。**文件名由包名决定**——去掉 scope 符号、把 `/` 换成 `-`，
  再接 `-<version>.tgz`：
  `@p-jiangh/dsh-enhance` → **`p-jiangh-dsh-enhance-<version>.tgz`**
  （改名前的 `@dsh-enhance/dsh-enhance` 会得到 `dsh-enhance-dsh-enhance-<version>.tgz`，v0.1.0 的附件就是这个名字）。
  它**是给用户的首选安装来源**（免构建、免 allowBuilds）：
  ```sh
  dsh plugin --profile <p> add \
    https://github.com/P-JIANGH/dsh-enhance/releases/download/v<version>/<asset-name>
  ```
  > 改名后最容易漏的就是这一类 URL：v0.1.1 改名时，README / README.en / installing-plugins
  > 里的 **三条安装命令**仍指向 v0.1.0 的旧文件名（URL 本身没失效，所以不会报错，但装到的是**改名前的那个包**）。
  > 发版时把"全仓库还有哪些 v<上一个版本> 的 URL"当作发布后检查的一项。
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

- 确认 `v<version>` 指向的提交 **CI 是绿的**（`git ls-remote origin` 看 tag 指向；`.github/workflows/ci.yml`；
  推送 `.github/workflows/**` 需要 token 带 `workflow` scope）。`master` 允许在 tag 之后继续前进——
  发布后的文档提交就该这样；但**任何代码或产物变更都必须切新版本**，不能塞回已发布的 tag。
- **搜一遍上一个版本的安装 URL**：`git grep -n "releases/download/v<上一个版本>"` 与旧附件名。
  改成名或切版本时最容易漏的就是这里——**URL 不会失效，所以不会报错**，但照抄 README 的用户
  装到的是**上一个版本的包**。v0.1.1 改名时正是这样发现 README / README.en / installing-plugins
  三条安装命令仍指向 v0.1.0 的（`docs/releasing.md` 自己也有一处）。
- 用**已发布产物**再验一次，不同形态各一条（比 `git ls-remote` 强得多）：
  ```sh
  # ① 产物级：装出来的包必须真的贡献三条技能（无需 LLM）
  curl -L -o dl.tgz https://github.com/P-JIANGH/dsh-enhance/releases/download/v<version>/<asset-name>
  #    并用 sha256 与本地 npm pack 产物比对；再把它装进一次性 profile，对装出来的
  #    lib/features/skills-provider.js 调 list()，断言 code-review / git-workflow / tdd
  # ② 分发级：从 GitHub 源码装一次并 dump-config
  dsh plugin --profile qa-gh add github:P-JIANGH/dsh-enhance
  dsh --profile qa-gh --dump-config | Select-String "dsh-enhance|preset-enhance"
  ```
- 若要提交到社区插件目录（dshbase / deepseekplugin.org）：它们按 **GitHub 仓库**收录，
  因此这一步必须在主仓推送之后。注意 GitHub 上已有一个同名的
  `vcxmug/dsh-enhance`（另一套 vision / native-web 插件），提交时说明区隔。

## 5. npm 渠道（可选，与 GitHub 并行）

v1 只发 GitHub；npm 是可选的第二条渠道，两条可以并存（同一份代码、两个分发面）。要走 npm，先把下面几件事做对——**本机 npm 默认指向 `registry.npmmirror.com` 这类镜像，直接 `npm publish` 会发到错的地方**（镜像通常只读），所以远端必须显式指定；`package.json` 里的 `publishConfig` 已经把这件事钉住：

```json
"publishConfig": { "access": "public", "registry": "https://registry.npmjs.org" }
```

- `access: public` 是 scoped 包的**必需项**：不写，免费账号发布会被拒（scoped 默认 restricted）。
- `registry` 让 `npm publish` 无视本机 npmrc 直指公共 registry（实测 dry-run 输出 `Publishing to https://registry.npmjs.org … public access`）。

### 5.1 前置条件

1. **占住 scope**。2026-10-10 查询：`@p-jiangh/dsh-enhance` 与裸名 `dsh-enhance` **在公共 registry 上均未注册**（都是 404）。但"能不能占"取决于你能否打开 npm 网页：
   - **组织 scope `@dsh-enhance`（当前包名）**：**必须用网页创建组织**——npm 10 的 `npm org` 只有 `set` / `rm` / `ls`，**没有 `create`**（实测 `npm org --help` 的输出里只有这三条）。网页不可达时这条路走不通。
   - **用户 scope `@<你的 npm 用户名>/dsh-enhance`**：账号一旦存在，用户名 scope 是**自动的**，**不需要网页、不需要建组织**；只需要 `npm login`。代价是要改包名（见下），而"改包名"属于改动 manifest，**不能塞回已 tag 的版本**——必须**切新版本**（例如 `0.1.1` + `v0.1.1`），发布时验收标准也随之变成"npm tarball == v0.1.1 的 GitHub 附件"。
   - **裸名 `dsh-enhance`**：安装命令最短（`add dsh-enhance`），同样要改包名；缺点是看起来像官方 `dsh-*` 包，并与 GitHub 上另一个同名项目（`vcxmug/dsh-enhance`）混淆。
   - 改包名牵动：`package.json`、`cordis.patch.yml`（生成器 `scripts/sync-dsh-enhance-preset.mjs` + 生成物）、`client/client.js` 的行 key、`tests/client-contract.test.mjs` 的推导、README/文档约十处。

   > **网络事实（2026-10-10 实测）**：`registry.npmjs.org` **直连可达**（HTTP 200，约 1 秒，不需要代理），所以 `npm login` / `npm publish` 在 CLI 层面没问题；而 `www.npmjs.com` 对程序化请求返回 **403**（WAF，带浏览器 UA 也一样），本机无法据此判断浏览器是否可用。**发布本身不需要网页**——网页只在"建组织 scope"和"建 CI 用的 token"时才是必需的。
2. **登录公共 registry**（注意显式写 registry）：
   ```sh
   npm login --registry=https://registry.npmjs.org
   ```
   开了 2FA 就准备好一次性验证码（发布时 `--otp=<code>`）；CI 场景用 granular access token（`NPM_TOKEN`）。
3. **manifest 发布就绪**：`files`（`lib`/`client`/`skills`/`cordis.patch.yml`）、`prepare`（发布时用 tsc 产出 `lib/`，所以 `lib/` 不入库也能发出）、`repository`/`homepage`/`bugs`、`license`、`keywords`、无 `private`。**注意**：`publishConfig`（固定 registry 与 `access: public`）是 2026-10-10 才加进 master 的，**`v0.1.0` 的树里没有**——发布老 tag 时目标与可见性必须走命令行参数（见 §5.2）。

### 5.2 发布

**版本纪律（本节的核心）**：npm 的 `X.Y.Z` 必须**从 tag `vX.Y.Z` 的树**发布，内容与该提交一致；**不要从 master 发**——master 上 tag 之后的提交（文档、`keywords`、`publishConfig`）不属于该版本。发布所需的目标/权限用**命令行**传入，而不是为了发布去改那个已经 tag 了的 manifest；真要让 manifest 本身带上 `publishConfig`，就**切新版本**（`0.1.1` + `v0.1.1`），而不是把改动塞回 `0.1.0`。

```sh
# 1) 取出 tag 的树，**创建时就把行尾定成 LF**（不要挪到 install 之后，见下方"顺序别改"）。
#    v0.1.0 的树还没有仓库级 `* text=auto eol=lf`（那一条 2026-10-10 才进 master），所以这里要 -c；
#    带该属性的 tag 之后不需要。
git -c core.autocrlf=false worktree add --detach ../dsh-enhance-v0.1.0 v0.1.0
cd ../dsh-enhance-v0.1.0

# 2) 断言工作树全 LF（应无输出；有输出就别继续）
git ls-files --eol | grep -v ' w/lf' || true
#    PowerShell 里等价写法：git ls-files --eol | Where-Object { $_ -notmatch ' w/lf' }

# 3) 装依赖（worktree 是干净树，没有 node_modules，而 prepare 要跑 tsc；实测约 2.5 秒）
pnpm install --offline

# 4) 该 tag 的 manifest 无 publishConfig → 目标与访问级别走命令行
npm publish --dry-run --registry=https://registry.npmjs.org --access public
npm publish           --registry=https://registry.npmjs.org --access public   # 有 2FA 加 --otp

cd -
```
```powershell
# 收尾（PowerShell；本仓库开发环境的主 shell）
Set-Location <仓库根目录>
Remove-Item -Recurse -Force ../dsh-enhance-v0.1.0
git worktree prune
```

> **收尾为什么不能用 `git worktree remove`**：worktree 里有未跟踪的 `node_modules`/`lib`（以及你打出来的
> tarball），`remove` 会以 `Directory not empty` 拒绝——2026-10-10 实测如此。而 `git worktree prune`
> **只清注册项、不删目录**，所以"删目录"这一步是必需的（bash 的 `rm -rf` / PowerShell 的
> `Remove-Item -Recurse -Force`），删完再 `prune`；确认 `git worktree list` 里只剩主工作区即可。
> 注意 bash 的 `cd -` 在 PowerShell 里没有等价语义（`-` 是目录栈），PowerShell 用 `Set-Location <路径>`，
> 且 `rm` 是 `Remove-Item` 别名、不接受 `-rf` 这样的合并短参。

> **顺序别改：行尾必须在任何构建之前定下来。** 曾经写成"先 `pnpm install`（它会跑 `prepare`/tsc）再
> `checkout` 成 LF"：那样 `lib/` 是在 **CRLF 源码**上构建的，而 `lib/enhance-mode.js`、
> `lib/features/advisor/prompt.js`、`lib/index.js` 里嵌的模板字面量会跟着带 CRLF；最终 tarball 之所以
> 正确，只因为 `npm publish` **又跑了一次** `prepare` 重建——一旦有人加 `--ignore-scripts`、改用
> "只打包不重建"的步骤、或让 `lib/` 被缓存复用，发出去的包就会与附件不同；而版本号不可重发，只能切
> 新版本，正好破坏本节的验收标准。
> 2026-10-10 按修正后的顺序实测：worktree 创建即全 LF（`git ls-files --eol` 无 `w/crlf`）→
> `pnpm install --offline` → 三个嵌入文件 `CR=0` → `npm pack` 与附件**逐字节相同**（`7D20FE1B…`，102,896 B）。

> **别用 junction/symlink 把主检出的 `node_modules` 接进 worktree。** 删 worktree 时
> `Remove-Item -Recurse` 会**穿过 junction** 去删主检出的内容——2026-10-10 实测把
> `node_modules/.bin` 整个删掉，`prepare` 随即报 `Cannot find module …/typescript/bin/tsc`；
> 修复是 `pnpm install --force`（重链 29 个包，2 秒），`node_modules` 是 gitignored，仓库跟踪文件无损失。
> 真要用 junction，删 worktree 前必须先单独删掉那个 junction 本身（`cmd /c rmdir <wt>\node_modules`）。

**可验证的验收**：npm 收下的 tarball 必须与 GitHub Release 附件**逐字节相同**——比对
`npm view @p-jiangh/dsh-enhance dist.integrity`（sha512）与附件的 sha512。2026-10-10 演练实测：
从 tag 树 + `core.autocrlf=false` + `npm pack` 得到的 tarball **等于**附件
（`7D20FE1B…`，102,896 B）。

> **实测过的坑（2026-10-10）**：同一个 tag 在 `core.autocrlf=true` 的 Windows 检出上打出的 tarball
> 比 LF 检出**大 137 字节**——差的不是内容而是行尾，而且连 `lib/` 都受影响：
> `lib/enhance-mode.js`、`lib/features/advisor/prompt.js`、`lib/index.js` 里嵌的多行文本是模板字面量，
> 行尾跟着**源文件**走；另外 `LICENSE`/`README*`/`client/client.js` 也随检出配置变化。
> master 已加仓库级 `* text=auto eol=lf` 根治，但**已发布的 v0.1.0 tag 没有它**，
> 所以发 0.1.0 时必须显式 `-c core.autocrlf=false`。

发布后**不要**改已发布版本的内容：npm 只允许 72 小时内 unpublish，且会打断已有使用者；
出错就 `npm deprecate` 或直接发补丁版。

### 5.3 发布后核验（四件事，缺一不算发完）

```sh
npm view @p-jiangh/dsh-enhance version dist.tarball dist.integrity
npm view @p-jiangh/dsh-enhance dist-tags          # latest 指到刚发的版本

# 1) 四公开面扫描（附件/npm tarball 是**新**的公开面，必须单独扫一遍）
curl -sSL $(npm view @p-jiangh/dsh-enhance dist.tarball) -o /tmp/npm.tgz
#    然后用 .dsh-enhance/scan-public-surface.mjs 扫它（密钥特征 + 本机痕迹 + 无 *.map）

# 2) 装出来的形状：与 qa:pack 的断言同一套（只有 schemastery 闭包被复制进 profile、无宿主包副本）
# 3) 真启动：插件行激活，未激活名单只有预设那一条预期项
# 4) 真会话（L3）：doctor 报插件已加载 + 3 条打包技能
```

### 5.4 更省事的做法（推荐给 v2）

从 GitHub Actions 发布并带 **provenance**（`npm publish --provenance`，需要 `id-token: write` 权限），npm 页面上会显示"由哪个仓库的哪次构建产生"，把"仓库 → 包"的链条变成可验证的。代价是要在仓库 secrets 里放 `NPM_TOKEN`。当前 CI 不发布，只做校验。

### 5.5 备选渠道：GitHub Packages（`npm.pkg.github.com`）

**什么时候考虑它**：`www.npmjs.com` 打不开（例如被 npm 的反机器人门挡住：报错里会写"IP 与网络机器人相同"），或者你没有 npm 账号。它**完全不需要 npmjs.com**，因为认证走 GitHub、组织建在 GitHub。**尚未发布过，以下为已核实的前置条件。**

| 项 | 事实（2026-10-10 实测/官方文档） |
|---|---|
| 包名必须 scoped 且**全小写** | 文档：*"GitHub Packages only supports scoped npm packages"*、*"Package names and scopes must only use lowercase letters"* → 用户 scope 只能写作 `@p-jiangh/…`（不是 `@P-JIANGH/…`） |
| **scope 与仓库所有者的关系（关键）** | 文档的经典规则原文：*"By default, your package is published in the GitHub repository that you specify in the `name` field of the `package.json` file. For example, you would publish a package named `@my-org/test` to the `my-org/test` GitHub repository."* → **scope 应对应仓库所有者**。即：发 `@p-jiangh/dsh-enhance` 需要仓库位于组织 `dsh-enhance` 之下（**只建组织不够，还要把仓库转移进去**）；发 `@p-jiangh/dsh-enhance` 与当前仓库 `P-JIANGH/dsh-enhance` 天然匹配。文档另有一支较新的行为（包归属某账号/组织、与仓库的关联可选），但**哪一支对某个账号生效无法从外部判定——以第一次发布的实际返回为准** |
| 认证 | 文档：npm registry **只支持 classic PAT**（fine-grained 不行）；且 *"You need an access token to publish, **install**, and delete private, internal, and **public** packages."* → 发布与安装都要 token |
| 需要勾的 scope | **`repo` + `read:packages` + `write:packages`**（`delete:packages` 可选）。最小发布集是 `write:packages` **加** `read:packages`，只勾前者仍可能 403 |
| 改动 scope 的代价 | classic token 的 scope **无法就地修改**，必须 regenerate 或新建；改后用 `x-oauth-scopes` 响应头验证（本仓库：`node .dsh-enhance/gh-api.mjs whoami`） |
| `.npmrc`（发布与安装都需要） | `@<NAMESPACE>:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=<classic PAT>` |
| 发布目标 | 也可用 `publishConfig.registry`，但那会改 manifest；**已经 tag 的版本**就用命令行/`.npmrc` 路由，别改树 |

**两条轴决定了四种组合**（"scope 选谁" 与 "谁来发布"）：

| scope | 发布者/凭据 | 你需要做的前置 | 改名？ |
|---|---|---|---|
| `@p-jiangh/dsh-enhance` | **Actions 的 `GITHUB_TOKEN`**（`permissions: packages: write`） | **什么都不用**（只需点一次 "Run workflow"） | 要 → 切 `0.1.1` |
| `@p-jiangh/dsh-enhance` | 本机 classic PAT | 新建一把带上述 scope 的 classic PAT | 要 → 切 `0.1.1` |
| `@p-jiangh/dsh-enhance` | 本机 classic PAT | 建组织 `dsh-enhance` + 新 PAT；**且（按经典规则）把仓库转移进该组织** | 不改名 → 可发 `0.1.0` |
| `@p-jiangh/dsh-enhance` | Actions 的 `GITHUB_TOKEN` | 建组织 **+ 转移仓库**进组织 | 不改名 → 可发 `0.1.0` |

**注意**：`GITHUB_TOKEN` 这条并不要求建组织——它只要求 **scope 与仓库所有者一致**。所以"保名"才需要组织（+转移仓库），"用用户名 scope"则连 PAT 都不用。

发布步骤与 §5.2 相同（worktree + `core.autocrlf=false` + `pnpm install --offline`），只把最后两步换成：

```sh
npm publish --dry-run --registry=https://npm.pkg.github.com
npm publish           --registry=https://npm.pkg.github.com
```

**消费侧的硬约束（决定它是不是"公开渠道"）**：安装方**必须**有 GitHub token（公开包也一样），并在自己的 `.npmrc` 里写 scope 行。因此：

- **公开分发**仍然用**匿名 tarball URL**（`dsh plugin add https://github.com/…/releases/download/v…/….tgz`）——它不需要任何凭据，且已端到端验收；
- **GitHub Packages** 适合"我要一个 registry 上的包、且我自己/团队可控"的场景。

## 6. 明确不做的事（v1）

- **v1 不发 npm**：机制与前置条件见 §5；要发就按 §5 走，别在镜像上发。
- **不自动写用户家目录**：没有 `postinstall`，插件不在启动时写任何东西；预设是补丁行，
  随 bundle 一起生效。
- 不带 `--force` 推送、不重写已发布的 tag：历史只追加。
