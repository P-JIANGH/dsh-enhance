// 「预设挂载验收」—— 真机零 token 断言：Enhance 预设（id `enhance`）可用。
//
// 为什么单独一层：预设是宿主 `ctx.agentPresets` 里的**运行期注册表**，不是本仓库里的
// 一个目录或一段文本。单元测试只能钉住 `cordis.patch.yml` 的字节，钉不住「宿主升级后
// 这行配置还认不认」。0.2.1-rc.2 上 `@deepseek-ai/dsh-tool-subagent` 删掉了 `persona`
// / `toolFilter` 两个 config 字段，四个 `dsh-enhance-subagent-*` 行随即 failed，registry
// 把整个 `enhance` 预设标记为 broken —— 会话绑定它就直接打不开。这条验收复刻 Web/桌面
// 面的装配（dsh-base + dsh-web-app + 本插件），让宿主自己回答「这个预设能不能用」。
//
// 零 token：只调 `compositionInventory()` / `remoteExportList()`（只读注册表），不建
// 会话、不调 LLM。
//
// 运行方式：
//   node qa/preset-mount-drive.mjs
// 目标解析与隔离纪律同其它实驱：默认落仓库内隔离 QA home 的 profile `qa-preset`；
// 要换位置用 DSH_HOME / DSH_ENHANCE_PRESET_PROFILE。**本脚本每轮删除并重建该 profile
// 目录**，因此拒绝在没有隔离 home 也没有显式 DSH_HOME 的环境里运行。
//
// 证据：`.dsh-enhance/evidence/preset-mount-drive.md`。用 DSH_ENHANCE_PRESET_RUN 给运行
// 打标签（默认 `run`），证据文件保留每次运行的原文、不会互相覆盖。修复前的 RED 由
// Lead 记录在同一目录的 `preset-021-fix.md`；本驱动用 `--self-test`（合成注册表、同一
// 判定函数）证明它确实会红，而不是橡皮图章。

import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { preflight, resolveQaTarget } from './dsh-launch.mjs'

const ROOT = process.cwd()
const DEFAULT_HOME = join(homedir(), '.dsh')

// 环境里常常**已经**预设了指向真实 home 的 DSH_HOME（桌面宿主就是这么拉子进程的）。
// 那不是"显式隔离"，绝不能据此在 ~/.dsh 上删 profile —— 与 pack-install-drive 同一纪律。
const ambientEnv = { ...process.env }
if (ambientEnv.DSH_HOME && resolve(ambientEnv.DSH_HOME) === resolve(DEFAULT_HOME)) delete ambientEnv.DSH_HOME

const TARGET = resolveQaTarget({ env: ambientEnv })
const PROFILE = process.env.DSH_ENHANCE_PRESET_PROFILE || 'qa-preset'
const RUN_LABEL = (process.env.DSH_ENHANCE_PRESET_RUN || 'run').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40)
// 端口必须固定：Web 组合会常驻监听，验收要能证明"跑完没有留下孤儿进程"。
// 若端口在运行前已被占用，那是失败而不是"顺手杀掉"——绝不杀无关进程。
const PORT = Number.parseInt(process.env.DSH_ENHANCE_PRESET_PORT || '59737', 10)
const EVIDENCE_DIR = join(ROOT, '.dsh-enhance', 'evidence')
const EVIDENCE_FILE = join(EVIDENCE_DIR, 'preset-mount-drive.md')

const PROFILE_DIR = join(TARGET.home, 'profiles', PROFILE)
const RUN_DIR = join(TARGET.home, 'preset-mount')
const RUNS_DIR = join(RUN_DIR, 'runs')
const PROBE_DIR = join(TARGET.home, 'preset-mount-probe')
const PROBE_NAME = 'dsh-enhance-preset-mount-probe'
const REPORT_PATH = join(RUN_DIR, `report-${RUN_LABEL}.json`)
const HOST_LOG = join(RUN_DIR, `host-${RUN_LABEL}.log`)
const SELF_TEST_LOG = join(RUN_DIR, 'self-test.log')

// 探针源码：写成普通字符串再落盘（避免在生成文件里再套一层转义）。
const PROBE_SOURCE = `/**
 * 预设挂载探针（由 qa/preset-mount-drive.mjs 生成在隔离 home 内，不入库）。
 *
 * 只做一件只读的事：等整棵插件树装配完成，取宿主自己的预设注册表
 * （compositionInventory 的逐预设行级诊断 + remoteExportList 的对外清单），
 * 落盘到 DSH_ENHANCE_PRESET_REPORT，然后退出进程。不建会话、不调 LLM。
 */
import { writeFileSync } from 'node:fs'

export const name = '${PROBE_NAME}'

/** 只注入真正用到的服务；web-app 组合同时提供 agentPresets。 */
export const inject = ['agentPresets']

const REPORT = process.env.DSH_ENHANCE_PRESET_REPORT

/**
 * 退出进程：web-app 组合没有 appExit，退化为 process.exit（报告已同步落盘）。
 * @param ctx 宿主上下文。
 * @param code 退出码。
 */
function finish(ctx, code) {
  let appExit
  try { appExit = ctx.get('appExit') } catch { appExit = undefined }
  if (typeof appExit === 'function') {
    try { appExit(code); return } catch { /* 宿主不给 appExit 时照常按进程退出 */ }
  }
  setTimeout(() => process.exit(code), 100)
}

export function apply(ctx) {
  void (async () => {
    const write = (payload) => {
      if (typeof REPORT !== 'string' || REPORT.length === 0) return
      writeFileSync(REPORT, JSON.stringify(payload, null, 2) + '\\n')
    }
    try {
      await ctx.get('loader')?.await()
      const inventory = await ctx.agentPresets.compositionInventory()
      let roster
      let rosterError
      try { roster = await ctx.agentPresets.remoteExportList() } catch (error) { rosterError = String(error && error.stack ? error.stack : error) }
      write({ ok: true, inventory, roster, rosterError })
      finish(ctx, 0)
    } catch (error) {
      write({ ok: false, error: String(error && error.stack ? error.stack : error) })
      finish(ctx, 1)
    }
  })()
}
`

/** 每一步都打一行进度，方便人跟读（同时保证失败时知道停在哪一步）。 */
function step(no, total, text) {
  console.log(`[preset-mount] ${no}/${total} ${text}`)
}

const checks = []
/** 记一条断言（失败不中断，最后统一报告）。 */
function check(label, ok, detail = '') {
  checks.push({ label, ok: Boolean(ok), detail: String(detail).replace(/\s+/g, ' ').slice(0, 400) })
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * 端口是否空闲：尝试独占绑定 127.0.0.1。能绑上 = 没有进程在听。
 * @param port 端口号。
 * @returns 空闲为 true。
 */
function isPortFree(port) {
  return new Promise((done) => {
    const server = createServer()
    server.unref()
    server.once('error', () => done(false))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => done(true))
    })
  })
}

/**
 * 轮询等待端口释放（taskkill 之后内核回收监听需要一点时间）。
 * @param port 端口号。
 * @param timeoutMs 最长等待。
 * @returns 已释放为 true。
 */
async function waitPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true
    await sleep(200)
  }
  return false
}

/** 杀掉整棵进程树（桌面宿主是 Electron，自己会再拉子进程）。 */
function killTree(pid) {
  if (!pid) return
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

/** 统一子进程调用（同步、utf8、注入隔离 home）。 */
function runSync(cmd, argv, extraEnv = {}) {
  const res = spawnSync(cmd, argv, {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...(DSH_ENV ?? {}), ...TARGET.env, ...extraEnv },
    windowsHide: true,
  })
  if (res.error) return { status: null, stdout: '', stderr: String(res.error.message) }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** 把多行输出压成可读的一行摘要。 */
function oneLine(text, keep = 240) {
  return String(text).split(/\r?\n/).filter(Boolean).join(' | ').slice(0, keep)
}

/** 运行阶段的中文名（证据文件里用）。 */
function runTitle(label) {
  if (label === 'pre-fix') return '修复前（RED）'
  if (label === 'post-fix') return '修复后（GREEN）'
  return label
}

// ── 自检（--self-test）：证明判定器不是橡皮图章 ────────────────────────────────
// 真实宿主只会在"已经坏了"时给出 broken；要证明驱动真的会红，只能喂合成注册表。
// 这些用例与真机断言走同一个纯函数 evaluateInventory()，不启动宿主、不碰端口。

/** 0.2.1-rc.2 上宿主报出的原文（行 id 与包名由宿主拼在 broken 文本前面）。 */
export const PERSONA_REMOVED_TEXT = 'tool-subagent: persona is no longer supported; configure persona and tool plugins in an Agent Preset and select it with agentPreset (spawn only)'

/** 真机 broken 字段的完整一行（prefix 带行 id + 包名）。 */
export const PERSONA_BROKEN_VERBATIM = `dsh-enhance-subagent-scout (@deepseek-ai/dsh-tool-subagent): ${PERSONA_REMOVED_TEXT}`

/**
 * 纯函数判定：预设注册表清单是否健康。真机运行与 --self-test 共用这同一份逻辑。
 * @param inventory `ctx.agentPresets.compositionInventory()` 的结果。
 * @returns `{ ok, failures }`；failures 项为 `{ kind, id, text }`（kind ∈ missing-enhance / broken-enhance / broken-other）。
 */
export function evaluateInventory(inventory) {
  const entries = Array.isArray(inventory)
    ? inventory.filter((entry) => entry !== null && typeof entry === 'object')
    : []
  const ids = entries.map((entry) => String(entry.id))
  const failures = []
  const enhance = entries.find((entry) => entry.id === 'enhance')
  if (enhance === undefined) {
    failures.push({ kind: 'missing-enhance', id: 'enhance', text: `未找到 id=enhance 的预设（看到的预设：${ids.join(', ') || '(空)'}）` })
  } else if (Object.prototype.hasOwnProperty.call(enhance, 'broken')) {
    failures.push({ kind: 'broken-enhance', id: 'enhance', text: String(enhance.broken ?? '') })
  }
  for (const entry of entries) {
    if (entry.id === 'enhance') continue
    if (Object.prototype.hasOwnProperty.call(entry, 'broken')) {
      failures.push({ kind: 'broken-other', id: String(entry.id), text: String(entry.broken ?? '') })
    }
  }
  return { ok: failures.length === 0, failures }
}

/** 自检用例：健康 / enhance 自身 broken / 其它预设 broken。 */
const SELF_TEST_CASES = [
  {
    name: '健康注册表：只有 {id:"enhance"}，无 broken',
    inventory: [{ id: 'enhance', rows: [{ entryId: 'persona', enabled: true, fiberState: 2 }] }],
    expectOk: true,
  },
  {
    name: 'enhance 自身 broken（0.2.1-rc.2 的 persona 原文）',
    inventory: [{ id: 'enhance', broken: PERSONA_BROKEN_VERBATIM }],
    expectOk: false,
    expectKind: 'broken-enhance',
    expectText: PERSONA_BROKEN_VERBATIM,
  },
  {
    name: '其它预设 broken（宿主未来新增项坏掉也要可见）',
    inventory: [{ id: 'enhance' }, { id: 'some-future-preset', broken: 'import failed: no such package' }],
    expectOk: false,
    expectKind: 'broken-other',
    expectText: 'import failed: no such package',
  },
]

/**
 * 跑自检并返回逐行输出（同时写一份到隔离 home，供正常运行渲染证据时引用）。
 * @returns `{ ok, lines }`。
 */
function runSelfTest() {
  const lines = ['[preset-mount] self-test：用合成注册表证明判定器不是橡皮图章（不启动宿主、不碰端口）']
  let passed = 0
  for (const [index, testCase] of SELF_TEST_CASES.entries()) {
    const verdict = evaluateInventory(testCase.inventory)
    const problems = []
    if (verdict.ok !== testCase.expectOk) problems.push(`ok=${verdict.ok}，期望 ${testCase.expectOk}`)
    if (testCase.expectKind !== undefined && !verdict.failures.some((item) => item.kind === testCase.expectKind)) {
      problems.push(`缺少 ${testCase.expectKind} 类失败`)
    }
    if (testCase.expectText !== undefined && !verdict.failures.some((item) => item.text.includes(testCase.expectText))) {
      problems.push('失败文本里没有期望的宿主原文')
    }
    const ok = problems.length === 0
    if (ok) passed += 1
    lines.push(
      `[preset-mount] self-test ${index + 1}/${SELF_TEST_CASES.length} ${testCase.name}`,
      `  判定：ok=${verdict.ok} failures=${verdict.failures.length}`,
      `  ${ok ? 'PASS' : `FAIL — ${problems.join('；')}`}`,
    )
    for (const failure of verdict.failures) lines.push(`  [failure:${failure.kind}] ${failure.id}: ${failure.text}`)
  }
  lines.push(`[preset-mount] self-test：${passed}/${SELF_TEST_CASES.length} PASS`)
  return { ok: passed === SELF_TEST_CASES.length, lines }
}

if (process.argv.includes('--self-test')) {
  const selfTest = runSelfTest()
  const output = selfTest.lines.join('\n') + '\n'
  process.stdout.write(output)
  // 自检输出要进证据文件；只在隔离 home 落盘，其它环境只打印。
  if (resolve(TARGET.home) !== resolve(DEFAULT_HOME)) {
    mkdirSync(RUN_DIR, { recursive: true })
    writeFileSync(SELF_TEST_LOG, output)
  }
  process.exit(selfTest.ok ? 0 : 1)
}

// ── 0. 目标与守卫 ──────────────────────────────────────────────────────────────
const total = 6
if (resolve(TARGET.home) === resolve(DEFAULT_HOME) || (!TARGET.isolated && !TARGET.explicitHome)) {
  console.error(
    'preset-mount-drive: 拒绝运行。目标 home 不是隔离 home：\n' +
    `  home=${TARGET.home}\n` +
    `本脚本会删除并重建 profiles/${PROFILE}，只允许在隔离 QA home 或显式指向非默认 home 的 DSH_HOME 上运行。`,
  )
  process.exit(2)
}
const profileInsideHome = resolve(PROFILE_DIR).startsWith(resolve(TARGET.home) + sep)
const probeInsideHome = resolve(PROBE_DIR).startsWith(resolve(TARGET.home) + sep)
if (!profileInsideHome || !probeInsideHome) {
  console.error(
    `preset-mount-drive: 拒绝运行：profile/探针目录不在目标 home ${TARGET.home} 内。\n` +
    `  profile=${PROFILE_DIR}\n  probe=${PROBE_DIR}`,
  )
  process.exit(2)
}

const DSH = preflight(PROFILE, { requireApp: false, dshHome: TARGET.home })
const DSH_CMD = DSH.cmd
const DSH_PREFIX = DSH.prefix ?? []
const DSH_ENV = DSH.env ?? {}

console.log(`[preset-mount] home=${TARGET.home}`)
console.log(`[preset-mount] profile=${PROFILE}（每轮删除重建）dir=${PROFILE_DIR}`)
console.log(`[preset-mount] run-label=${RUN_LABEL} port=${PORT}`)

// 本轮的运行快照（最后统一落盘到 RUNS_DIR/<label>.json，并据此重渲染证据文件）。
const snapshot = {
  label: RUN_LABEL,
  title: runTitle(RUN_LABEL),
  startedAt: new Date().toISOString(),
  hostHome: TARGET.home,
  isolated: TARGET.isolated,
  explicitHome: TARGET.explicitHome,
  profile: PROFILE,
  port: PORT,
  hostVersion: '',
  command: '',
  exitCode: null,
  checks: [],
  inventory: [],
  roster: undefined,
  rosterError: undefined,
  brokenText: '',
  reportError: '',
  hostOutput: '',
}

/** 收尾：写本轮快照 → 重渲染证据文件 → 按断言结果退出。 */
function finish(code) {
  snapshot.exitCode = code
  snapshot.checks = checks
  mkdirSync(RUNS_DIR, { recursive: true })
  writeFileSync(join(RUNS_DIR, `${RUN_LABEL}.json`), JSON.stringify(snapshot, null, 2) + '\n')
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  writeFileSync(EVIDENCE_FILE, renderEvidence())
  for (const item of checks) console.log(`${item.ok ? 'ok  ' : 'FAIL'}  ${item.label}${item.detail ? `  — ${item.detail}` : ''}`)
  console.log(`[preset-mount] 证据已记录：${EVIDENCE_FILE}`)
  if (code !== 0) console.error(`[preset-mount] 本轮失败（${checks.filter((item) => !item.ok).length}/${checks.length} 条断言未通过）`)
  process.exit(code)
}

// ── 1. 启动器与宿主版本 ────────────────────────────────────────────────────────
step(1, total, '解析桌面宿主启动器')
const version = oneLine(runSync(DSH_CMD, [...DSH_PREFIX, '--version']).stdout, 40)
snapshot.hostVersion = version
check('宿主版本可读出（桌面宿主是 0.2.x）', /^0\.2\./.test(version), version || '（读不到版本）')
console.log(`[preset-mount] 宿主版本：${version || '（未识别）'}`)

// ── 2. 运行前端口自检：被占用就失败，绝不动无关进程 ────────────────────────────
step(2, total, `检查端口 ${PORT} 是否空闲（占用即失败，不杀无关进程）`)
const portFreeBefore = await isPortFree(PORT)
check('运行前端口空闲（否则报告失败，不杀无关进程）', portFreeBefore,
  portFreeBefore ? `127.0.0.1:${PORT} 可独占绑定` : `127.0.0.1:${PORT} 已被占用`)
if (!portFreeBefore) {
  snapshot.brokenText = ''
  finish(1)
}

// ── 3. 从零重建隔离 profile ────────────────────────────────────────────────────
step(3, total, '删除并重建隔离 profile（bundles + 空 cordis.yml + 探针行）')
rmSync(PROFILE_DIR, { recursive: true, force: true })
mkdirSync(join(PROFILE_DIR, 'node_modules', '@p-jiangh'), { recursive: true })

const pluginLink = join(PROFILE_DIR, 'node_modules', '@p-jiangh', 'dsh-enhance')
symlinkSync(ROOT, pluginLink, 'junction')

const probePackage = JSON.stringify({
  name: PROBE_NAME,
  version: '0.0.0',
  private: true,
  type: 'module',
  main: 'index.mjs',
}, null, 2) + '\n'
mkdirSync(PROBE_DIR, { recursive: true })
writeFileSync(join(PROBE_DIR, 'package.json'), probePackage)
writeFileSync(join(PROBE_DIR, 'index.mjs'), PROBE_SOURCE)

const probeLink = join(PROFILE_DIR, 'node_modules', PROBE_NAME)
symlinkSync(PROBE_DIR, probeLink, 'junction')

writeFileSync(join(PROFILE_DIR, 'package.json'), JSON.stringify({
  name: `dsh-profile-${PROFILE}`,
  private: true,
  dependencies: {
    '@p-jiangh/dsh-enhance': `link:${ROOT.replace(/\\/g, '/')}`,
    [PROBE_NAME]: `link:${PROBE_DIR.replace(/\\/g, '/')}`,
  },
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@p-jiangh/dsh-enhance'],
    },
  },
}, null, 2) + '\n')
writeFileSync(join(PROFILE_DIR, 'cordis.yml'), '# 空根条目列表：整棵树由 bundles + cordis.patch.yml 组合。\n[]\n')
writeFileSync(join(PROFILE_DIR, 'cordis.patch.yml'), [
  '# 一次性探针（隔离 profile，位于 .dsh-enhance/desktop-test-home，不入库）：',
  '# 组合与用户桌面/Web 面一致（dsh-base + dsh-web-app + 本插件），',
  '# agentPresets 由 web-app 提供；这里只插一行只读探针，落盘预设注册表诊断后退出。',
  '- insert:',
  `    - id: ${PROBE_NAME}`,
  `      name: ${PROBE_NAME}`,
  '',
].join('\n'))

const layout = [
  existsSync(join(PROFILE_DIR, 'package.json')),
  existsSync(join(PROFILE_DIR, 'cordis.yml')),
  existsSync(join(PROFILE_DIR, 'cordis.patch.yml')),
  existsSync(pluginLink) && lstatSync(pluginLink).isSymbolicLink(),
  existsSync(probeLink) && lstatSync(probeLink).isSymbolicLink(),
]
check('profile 从零建成（package.json + cordis.yml + cordis.patch.yml）', layout.slice(0, 3).every(Boolean),
  `${PROFILE_DIR}`)
check('插件与探针以 junction 链入 profile 的 node_modules',
  layout.slice(3).every(Boolean) && existsSync(join(pluginLink, 'package.json')),
  `${pluginLink} -> ${ROOT} | ${probeLink} -> ${PROBE_DIR}`)
mkdirSync(RUN_DIR, { recursive: true })
rmSync(REPORT_PATH, { force: true })
rmSync(HOST_LOG, { force: true })

// ── 4. 起真实宿主（后台子进程），轮询报告文件 ──────────────────────────────────
step(4, total, '启动真实桌面宿主（--no-open，后台），等待探针落盘报告')
const argv = [...DSH_PREFIX, '--profile', PROFILE, '--no-open', '--port', String(PORT)]
snapshot.command = `DSH_HOME=${TARGET.home} DSH_ENHANCE_PRESET_REPORT=${REPORT_PATH} ${DSH_CMD} ${argv.join(' ')}`

const logFd = openSync(HOST_LOG, 'a')
let child
let childExit = null
try {
  child = spawn(DSH_CMD, argv, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...DSH_ENV,
      ...TARGET.env,
      DSH_ENHANCE_PRESET_REPORT: REPORT_PATH,
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  })
  child.on('exit', (code, signal) => { childExit = { code, signal } })
} finally {
  closeSync(logFd)
}

const DEADLINE_MS = 90_000
const deadline = Date.now() + DEADLINE_MS
let timedOut = false
while (!existsSync(REPORT_PATH)) {
  if (Date.now() >= deadline) { timedOut = true; break }
  if (childExit !== null) {
    // 宿主先退出了：再等半秒看报告是否落在退出之后，然后放弃。
    await sleep(500)
    if (!existsSync(REPORT_PATH)) break
  }
  await sleep(250)
}

// ── 5. 无论成败都清理进程树 ────────────────────────────────────────────────────
const childPid = child?.pid
try {
  if (child && childExit === null) console.log(`[preset-mount] 报告已就绪，终止宿主进程树 pid=${childPid}`)
} finally {
  killTree(childPid)
}
const portReleased = await waitPortFree(PORT, 15_000)
await sleep(200) // 让被终止进程的日志排空，保证证据里的原文完整

snapshot.hostOutput = existsSync(HOST_LOG) ? readFileSync(HOST_LOG, 'utf8').trimEnd() : ''

// ── 6. 读报告、做断言 ──────────────────────────────────────────────────────────
step(5, total, '读取探针报告并校验预设注册表')
let report
if (existsSync(REPORT_PATH)) {
  try {
    report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
  } catch (error) {
    snapshot.reportError = `报告不是合法 JSON：${error && error.stack ? error.stack : error}`
  }
}
const reportFileOk = existsSync(REPORT_PATH)
const inventory = Array.isArray(report) ? report : (Array.isArray(report?.inventory) ? report.inventory : [])
snapshot.inventory = inventory
snapshot.roster = report?.roster
snapshot.rosterError = report?.rosterError
if (!Array.isArray(report) && typeof report?.error === 'string') snapshot.reportError = report.error

// 判定逻辑与 --self-test 共用同一份纯函数，避免"真机断言"和"自检"两套口径。
const verdict = evaluateInventory(inventory)
const entries = inventory.filter((entry) => entry && typeof entry === 'object')
const enhance = entries.find((entry) => entry.id === 'enhance')
const brokenEnhance = verdict.failures.find((item) => item.kind === 'broken-enhance')
const missingEnhance = verdict.failures.find((item) => item.kind === 'missing-enhance')
const othersBroken = verdict.failures.filter((item) => item.kind === 'broken-other')
const ids = entries.map((entry) => String(entry.id))
// 把宿主原文原样留下：enhance 的 broken 通常本身就是多行（逐行 id + 包名），
// 其它预设则补上 id 前缀，保证失败时证据里能看到宿主自己说的话。
snapshot.brokenText = verdict.failures
  .filter((item) => item.kind === 'broken-enhance' || item.kind === 'broken-other')
  .map((item) => (item.kind === 'broken-enhance' ? item.text : `${item.id}: ${item.text}`))
  .join('\n')

check('宿主按报告写出探针结果（报告文件存在）', reportFileOk,
  reportFileOk ? REPORT_PATH : `${REPORT_PATH} 不存在${timedOut ? `（${DEADLINE_MS / 1000}s 超时）` : ''}${childExit ? `；宿主退出码 ${childExit.code}` : ''}`)
check('探针没有抛错（报告标记 ok=true）', !snapshot.reportError && (Array.isArray(report) || report?.ok === true),
  snapshot.reportError || (Array.isArray(report) ? '报告是 inventory 数组' : `ok=${String(report?.ok)}`))
check('报告含 Enhance 预设（id=enhance）', enhance !== undefined,
  enhance ? `rows=${(enhance.rows ?? []).length}` : missingEnhance?.text ?? `看到的预设：${ids.join(', ') || '(空)'}`)
check('enhance 预设没有 broken 字段（预设可用）', enhance !== undefined && brokenEnhance === undefined,
  brokenEnhance ? 'broken=YES（宿主原文见证据/下方）' : 'broken 字段不存在')
check('没有其它预设被标记 broken', othersBroken.length === 0,
  othersBroken.length > 0
    ? othersBroken.map((item) => `${item.id}: ${item.text}`).join(' | ')
    : `看到的预设：${ids.join(', ') || '(空)'}`)
check('宿主进程树已清理（端口已释放）', portReleased,
  portReleased ? `127.0.0.1:${PORT} 已可独占绑定` : `127.0.0.1:${PORT} 仍被占用`)

if (snapshot.brokenText) {
  console.error('[preset-mount] 宿主报告的 broken 原文：')
  console.error(snapshot.brokenText)
}

// ── 7. 证据已由 finish() 统一渲染 ──────────────────────────────────────────────
step(6, total, '渲染证据文件并给出结论')
const failed = checks.filter((item) => !item.ok).length
finish(failed === 0 ? 0 : 1)

/**
 * 从本轮快照 + 历史各轮快照渲染证据 markdown。
 * 关键点：RED 的原文必须原样保留，后一次 GREEN 运行只追加、不覆盖它。
 * @returns 证据文件全文。
 */
function renderEvidence() {
  const runs = []
  for (const name of readdirSync(RUNS_DIR)) {
    if (!name.endsWith('.json')) continue
    try {
      runs.push(JSON.parse(readFileSync(join(RUNS_DIR, name), 'utf8')))
    } catch {
      // 坏掉的历史快照不影响本轮渲染。
    }
  }
  runs.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
  const selfTestOutput = existsSync(SELF_TEST_LOG) ? readFileSync(SELF_TEST_LOG, 'utf8').trimEnd() : ''
  const lines = [
    '# 预设挂载验收（preset-mount-drive）',
    '',
    '零 token 真机验收：真实桌面宿主 + 隔离 profile（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `@p-jiangh/dsh-enhance`），',
    '由宿主自己的 `ctx.agentPresets.compositionInventory()` 回答「Enhance 预设能不能用」。',
    '只要 `enhance` 预设被标记 `broken`（或报告里出现任何其它 broken 预设），本验收即失败并以非 0 退出。',
    '',
    `- home：\`${TARGET.home}\`（isolated=${TARGET.isolated}, explicit=${TARGET.explicitHome}）`,
    `- profile：\`${PROFILE}\`（每轮删除重建）`,
    `- 探针：\`${PROBE_DIR}\` → \`${PROBE_NAME}\``,
    `- 端口：\`${PORT}\`（运行前占用即判失败，不杀无关进程；跑完必须释放）`,
    `- 本轮命令：\`DSH_ENHANCE_PRESET_RUN=${RUN_LABEL} node qa/preset-mount-drive.mjs\``,
    '',
    '## 自检（--self-test，证明判定器不是橡皮图章）',
    '',
    '命令：`node qa/preset-mount-drive.mjs --self-test`',
    '真机只会在「已经坏了」时给出 `broken`，所以另用合成注册表跑同一份判定函数 `evaluateInventory()`：',
    '健康表必须通过，`enhance` 自身 broken 与其它预设 broken 都必须判失败并带出宿主原文。',
    '',
    '```',
    selfTestOutput || '（未运行自检；先执行 node qa/preset-mount-drive.mjs --self-test）',
    '```',
    '',
    '## 修复前 RED 证据（引用 Lead 记录）',
    '',
    '修复前的真机 RED 由 Lead 用同一探针机制记录在 [`preset-021-fix.md`](./preset-021-fix.md)（宿主 0.2.1-rc.2，`preset-check` 探针）。',
    '宿主的 `broken` 原文（×4 行，逐行 id 不同、文本相同）：',
    '',
    '```',
    `dsh-enhance-subagent-scout (@deepseek-ai/dsh-tool-subagent): ${PERSONA_REMOVED_TEXT}`,
    `dsh-enhance-subagent-librarian (@deepseek-ai/dsh-tool-subagent): ${PERSONA_REMOVED_TEXT}`,
    `dsh-enhance-subagent-reviewer (@deepseek-ai/dsh-tool-subagent): ${PERSONA_REMOVED_TEXT}`,
    `dsh-enhance-subagent-task (@deepseek-ai/dsh-tool-subagent): ${PERSONA_REMOVED_TEXT}`,
    '```',
    '',
  ]
  for (const [index, run] of runs.entries()) {
    lines.push(
      `## 运行 ${index + 1}：${run.title}`,
      '',
      `- 时间：${run.startedAt}`,
      `- 宿主版本：\`${run.hostVersion || '（未识别）'}\``,
      `- 退出码：\`${run.exitCode}\``,
      `- 命令：\`${run.command}\``,
      '',
      '| 断言 | 结果 | 证据 |',
      '|---|---|---|',
      ...(run.checks ?? []).map((item) => `| ${item.label} | ${item.ok ? '✅' : '❌'} | ${item.detail || ''} |`),
      '',
    )
    if (run.brokenText) {
      lines.push('### 宿主报告的 broken 原文', '', '```', run.brokenText.trimEnd(), '```', '')
    }
    lines.push(
      '### 探针报告原文（compositionInventory + remoteExportList）',
      '',
      '```json',
      JSON.stringify({
        ok: run.reportError ? false : true,
        inventory: run.inventory ?? [],
        roster: run.roster,
        rosterError: run.rosterError,
        reportError: run.reportError || undefined,
      }, null, 2),
      '```',
      '',
      `### 宿主进程输出（原文，端口 ${run.port}）`,
      '',
      '```',
      (run.hostOutput || '（无输出）').trimEnd(),
      '```',
      '',
    )
  }
  const latest = runs[runs.length - 1]
  const failedNow = (latest?.checks ?? []).filter((item) => !item.ok).length
  lines.push('## 结论', '')
  for (const run of runs) {
    const bad = (run.checks ?? []).filter((item) => !item.ok).length
    lines.push(`- ${run.title}：**${bad === 0 ? 'PASS' : `FAIL（${bad} 条）`}**`)
  }
  lines.push(
    '- 修复前 RED：引用 `preset-021-fix.md`（见上）；本驱动负责修复后 GREEN 与 `--self-test` 的失败能力证明。',
    '',
    `当前结论：**${latest && failedNow === 0 ? 'PASS' : `FAIL（${failedNow ?? '?'} 条）`}**`,
    '',
  )
  return lines.join('\n')
}
