// 「打包安装验收」—— npm pack → 一次性 profile 真装 tarball → 断言装配与模块加载。
//
// 为什么单独一层：仓库里其余测试都在 `link:` 形态下跑（profile 的
// node_modules/@dsh-enhance/dsh-enhance 是指向本 checkout 的 junction），解析会落到
// checkout 自己的 node_modules —— 恰好掩盖「宿主供给的包被写成 dependency」这类缺陷。
// 这里跑的是用户真装一遍的那条路：真 tarball、真 pnpm、真启动。
//
// 零 token：不调用 LLM，只断言模块解析、行装配与激活状态。要断言"装完真能用"（doctor
// 报告 / 工具 / 设置面往返）请接着跑 qa/dsh-enhance-drive.mjs --llm（消耗 token）。
//
// 运行方式：
//   node qa/pack-install-drive.mjs
// 目标解析与隔离纪律同其它实驱：默认落仓库内隔离 QA home 的 profile `qa-pack`；
// 要换位置用 DSH_HOME / DSH_ENHANCE_PACK_PROFILE。**本脚本会删除并重建该 profile 目录**，
// 因此拒绝在没有隔离 home 也没有显式 DSH_HOME 的环境里运行。

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { preflight, resolveQaTarget } from './dsh-launch.mjs'

const ROOT = process.cwd()
const DEFAULT_HOME = join(homedir(), '.dsh')
// 环境里常常**已经**预设了指向真实 home 的 DSH_HOME（桌面宿主就是这么拉子进程的）。
// 那不是"显式隔离"，绝不能据此在 ~/.dsh 上删 profile —— 第一次跑这个脚本就是这样
// 把 qa-pack 建进了真实 home 的。所以：与默认 home 相同的 DSH_HOME 直接忽略，改走
// 仓库内的隔离 QA home（install 场景的 .dsh-enhance/desktop-test-home）。
const ambientEnv = { ...process.env }
if (ambientEnv.DSH_HOME && resolve(ambientEnv.DSH_HOME) === resolve(DEFAULT_HOME)) delete ambientEnv.DSH_HOME

const TARGET = resolveQaTarget({ env: ambientEnv })
const PROFILE = process.env.DSH_ENHANCE_PACK_PROFILE || 'qa-pack'
const EVIDENCE_DIR = join(ROOT, '.dsh-enhance', 'evidence')

const PACK_DIR = join(TARGET.home, 'pack-install')
const PROFILE_DIR = join(TARGET.home, 'profiles', PROFILE)

const checks = []
/** 记一条断言（失败不中断，最后统一报告）。 */
function check(label, ok, detail = '') {
  checks.push({ label, ok: Boolean(ok), detail: String(detail).replace(/\s+/g, ' ').slice(0, 300) })
}

/** 统一子进程调用（同步、utf8、注入隔离 home）。 */
function run(cmd, argv, options = {}) {
  const res = spawnSync(cmd, argv, {
    encoding: 'utf8',
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(DSH_ENV ?? {}), ...TARGET.env, ...(options.env ?? {}) },
  })
  if (res.error) return { status: null, stdout: '', stderr: String(res.error.message) }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/**
 * npm 的可执行入口。Windows 上 `spawnSync('npm.cmd', …)` 会 EINVAL（实测），
 * 所以走 `node <npm-cli.js>`；`npm_execpath` 在经由 npm/pnpm 运行时已给出正确路径。
 */
function npmArgv() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { cmd: process.execPath, prefix: [candidate] }
  }
  return { cmd: 'npm', prefix: [] }
}

/** 把多行输出压成可读的一行摘要。 */
function oneLine(text, keep = 200) {
  return String(text).split(/\r?\n/).filter(Boolean).join(' | ').slice(0, keep)
}

// ── 0. 目标与启动器 ────────────────────────────────────────────────────────────
if (resolve(TARGET.home) === resolve(DEFAULT_HOME) || (!TARGET.isolated && !TARGET.explicitHome)) {
  console.error(
    'pack-install-drive: 拒绝运行。目标 home 不是隔离 home：\n' +
    `  home=${TARGET.home}\n` +
    `本脚本会删除并重建 profiles/${PROFILE}，只允许在隔离 QA home 或显式指向非默认 home 的 DSH_HOME 上运行。`,
  )
  process.exit(2)
}
const profileInsideHome = resolve(PROFILE_DIR).startsWith(resolve(TARGET.home) + sep)
if (!profileInsideHome) {
  console.error(`pack-install-drive: 拒绝运行：profile 目录 ${PROFILE_DIR} 不在目标 home ${TARGET.home} 内。`)
  process.exit(2)
}

const DSH = preflight(PROFILE, { requireApp: false, dshHome: TARGET.home })
const DSH_CMD = DSH.cmd
const DSH_PREFIX = DSH.prefix ?? []
const DSH_ENV = DSH.env ?? {}

/** 跑一次 dsh（复用启动器解析出的 cmd/prefix/env，避开 Windows 上 .cmd 的 EINVAL）。 */
function runDsh(args) {
  return run(DSH_CMD, [...DSH_PREFIX, ...args])
}

const version = oneLine(runDsh(['--version']).stdout, 40)
check('宿主是 0.2.x（行式预设注册表只存在于 ≥0.2.0）', /^0\.2\./.test(version), version)

console.log(`pack-install-drive: home=${TARGET.home}`)
console.log(`pack-install-drive: profile=${PROFILE}（将被删除重建）dir=${PROFILE_DIR}`)

// ── 1. 打包 ────────────────────────────────────────────────────────────────────
rmSync(PACK_DIR, { recursive: true, force: true })
mkdirSync(PACK_DIR, { recursive: true })
const npm = npmArgv()
const packed = run(npm.cmd, [...npm.prefix, 'pack', '--pack-destination', PACK_DIR], { cwd: ROOT })
const tarball = readdirSync(PACK_DIR).find(name => name.endsWith('.tgz'))
check('npm pack 产出 tarball', Boolean(tarball) && packed.status === 0, tarball ?? oneLine(packed.stderr))
if (tarball === undefined) {
  console.error('pack-install-drive: 打包失败，无法继续。\n' + oneLine(packed.stderr, 600))
  process.exit(1)
}
const tarballPath = join(PACK_DIR, tarball)

// ── 2. 真装进一次性 profile ────────────────────────────────────────────────────
rmSync(PROFILE_DIR, { recursive: true, force: true })
const installed = runDsh(['plugin', '--profile', PROFILE, 'add', tarballPath])
check('dsh plugin add <tarball> 成功', installed.status === 0, oneLine(installed.stdout + installed.stderr))

// 3. 补一个 app bundle：没有 app 的 profile 能装配插件树但不会执行任何东西
//    （这正是 P0-3 的教训），启动断言就没意义了。
const manifestPath = join(PROFILE_DIR, 'package.json')
if (!existsSync(manifestPath)) {
  console.error(`pack-install-drive: profile 未生成：${manifestPath}`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest?.dsh?.profile?.bundles ?? []
if (!bundles.some(b => /dsh-(headless|web-app)$|-app$/.test(String(b)))) {
  manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', ...bundles.filter(b => b !== '@deepseek-ai/dsh-base')]
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

// ── 4. 装出来的形状：这些断言就是这条验收存在的理由 ────────────────────────────
const installedPkg = join(PROFILE_DIR, 'node_modules', '@dsh-enhance', 'dsh-enhance')
const isLink = existsSync(installedPkg) && lstatSync(installedPkg).isSymbolicLink()
check('插件以真实目录装进 profile（不是 link: 形态）', existsSync(installedPkg) && !isLink,
  isLink ? 'junction/symlink — 这条验收就失去意义了' : installedPkg)

// schemastery 是普通 dependency（上游一等公民插件也这么声明），而它是**纯数据**库：
// 宿主用全局符号 `Symbol.for('schemastery')` 判定原生 schema（dsh-app-boot 的
// isNativeConfigSchema），所以同版本的跨副本是安全的；它自己的依赖闭包（cosmokit /
// @standard-schema）同样是纯工具库。**服务类**宿主包（dsh-llm / dsh-agent / dsh-tools /
// cordis …）带模块级身份（消息工厂、工具运行时 Symbol），在一个 profile 里只能有宿主那一份
// —— 它们必须由宿主运行时解析器供给，绝不能被我们声明成依赖。这份白名单就是那条边界。
const ALLOWED_DEEPSEEK_COPIES = new Set(['schemastery', 'cosmokit'])
const ALLOWED_TOP_SCOPES = new Set(['@dsh-enhance', '@deepseek-ai', '@standard-schema'])
const deepseekDir = join(PROFILE_DIR, 'node_modules', '@deepseek-ai')
const deepseekCopies = existsSync(deepseekDir) ? readdirSync(deepseekDir).sort() : []
check('复制进 profile 的只有 schemastery 及其纯工具依赖，没有任何服务类宿主包',
  deepseekCopies.every(name => ALLOWED_DEEPSEEK_COPIES.has(name)),
  deepseekCopies.join(', ') || 'none')

const MODULE_META = new Set(['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json', '.package-map.json'])
const extraEntries = readdirSync(join(PROFILE_DIR, 'node_modules'))
  .filter(name => !ALLOWED_TOP_SCOPES.has(name) && !MODULE_META.has(name))
check('profile 里没有多装任何计划外的包', extraEntries.length === 0,
  extraEntries.join(', ') || 'only our scope + schemastery closure')
check('安装过程没有 peer 依赖告警（peer 全部 optional，由宿主供给）',
  !/Issues with peer dependencies/i.test(installed.stdout + installed.stderr),
  oneLine((installed.stdout + installed.stderr).split(/\r?\n/).filter(l => /peer/i.test(l)).join(' ')))

// ── 5. 装配层 ──────────────────────────────────────────────────────────────────
const dump = runDsh(['--profile', PROFILE, '--dump-config'])
const dumpText = dump.stdout + dump.stderr
for (const needle of [
  "- id: dsh-enhance",
  "name: '@dsh-enhance/dsh-enhance'",
  'id: preset-enhance',
  'id: enhance-mode',
  "name: '@dsh-enhance/dsh-enhance/enhance-mode'",
  'id: dsh-enhance-subagent-scout',
  'id: dsh-enhance-subagent-librarian',
  'id: dsh-enhance-subagent-reviewer',
  'id: dsh-enhance-subagent-task',
]) {
  check(`--dump-config 含 ${needle}`, dumpText.includes(needle))
}
check('--dump-config 无兼容性/失败诊断', !/compatib|did not activate|failed/i.test(dumpText),
  oneLine(dumpText.split(/\r?\n/).filter(l => /compatib|failed/i.test(l)).join(' ')))

// ── 6. 启动层：模块解析与激活 ──────────────────────────────────────────────────
// 不带任务启动：会以 "a task is required" 退出，但**启动过程已经把整棵树 import 过**，
// 所以这一跑就是「宿主能不能解析我们那两个静态 import」的答案。
const boot = runDsh(['--profile', PROFILE])
const bootText = boot.stdout + boot.stderr

check('启动过程没有模块解析失败', !/ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/i.test(bootText),
  oneLine(bootText.split(/\r?\n/).filter(l => /ERR_MODULE_NOT_FOUND|Cannot find/i.test(l)).join(' ')))
check('app 真的起来了（"a task is required" 说明装配完成并进入 app）',
  /a task is required/i.test(bootText), oneLine(bootText))

// 未激活的行：只允许 preset-enhance 因缺少 agentPresets 服务而 pending。
// 该服务由 Web 组合提供（预设本来就只在 Web/桌面面可选），headless 组合里必然 pending。
const notActivated = [...bootText.matchAll(/^([A-Za-z0-9_-]+) \((@[^)]+)\): (.*)$/gm)]
  .map(m => ({ id: m[1], pkg: m[2], reason: m[3] }))
check('本插件的行处于激活状态（不在未激活名单里）',
  !notActivated.some(entry => entry.id === 'dsh-enhance'),
  notActivated.map(e => `${e.id}: ${e.reason}`).join(' | '))
const unexpected = notActivated.filter(entry => entry.id !== 'preset-enhance' || !/agentPresets/.test(entry.reason))
check('未激活的只有 preset-enhance / agentPresets 这一条已知项', unexpected.length === 0,
  unexpected.map(e => `${e.id} (${e.pkg}): ${e.reason}`).join(' | '))

// ── 7. 证据与报告 ──────────────────────────────────────────────────────────────
const failed = checks.filter(c => !c.ok)
const lines = [
  '# 打包安装验收（pack-install-drive）',
  '',
  `- 时间：${new Date().toISOString()}`,
  `- home：\`${TARGET.home}\`（isolated=${TARGET.isolated}, explicit=${TARGET.explicitHome}）`,
  `- profile：\`${PROFILE}\`（每轮删除重建）`,
  `- tarball：\`${tarball}\``,
  `- 宿主版本：\`${version}\``,
  '',
  '| 断言 | 结果 | 证据 |',
  '|---|---|---|',
  ...checks.map(c => `| ${c.label} | ${c.ok ? '✅' : '❌'} | ${c.detail || ''} |`),
  '',
  `结论：**${failed.length === 0 ? 'PASS' : `FAIL（${failed.length} 条）`}**`,
  '',
  '## 启动输出（原文）',
  '',
  '```',
  bootText.trim(),
  '```',
  '',
].join('\n')
mkdirSync(EVIDENCE_DIR, { recursive: true })
const evidenceFile = join(EVIDENCE_DIR, 'pack-install-drive.md')
writeFileSync(evidenceFile, lines)

for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.label}${c.detail ? `  — ${c.detail}` : ''}`)
console.log(`证据已记录：${evidenceFile}`)
if (failed.length > 0) {
  console.error(`pack-install-drive: ${failed.length}/${checks.length} 条断言失败`)
  process.exit(1)
}
console.log(`pack-install-drive: ${checks.length}/${checks.length} 条断言通过（零 token）`)
console.log('提示：要断言"装完真能用"，接着跑 node qa/dsh-enhance-drive.mjs --llm（消耗 token）。')
