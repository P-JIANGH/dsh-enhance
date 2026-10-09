// QA 启动器（qa/dsh-launch.mjs）单测：锁住 profile 自检与启动器解析契约。
//
// 背景：原三个实驱脚本各自实现 resolveDsh，在 dsh shim 不在 PATH 的机器上
// 抛 `spawnSync dsh.cmd EINVAL`；且都不检查 profile 是否挂了 app bundle，
// 导致「无输出且不退出」被误读成 dsh 版本缺陷。本测试锁住修复后的行为。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  checkProfileApp,
  resolveDsh,
  dshMissingHint,
  desktopRootOf,
  desktopRootFromShims,
  desktopLaunchFrom,
  resolveQaTarget,
  QA_HOME,
  QA_PROFILE,
} from '../qa/dsh-launch.mjs'

/** 造一个临时 DSH_HOME，带一个指定 bundles 的 profile。 */
function fakeHome(bundles) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-launch-test-'))
  const dir = join(home, 'profiles', 'p')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-p', dsh: { profile: { bundles } } }))
  return home
}

test('[qa-launch] profile 挂了 headless app → 通过并回报 app 名', () => {
  const home = fakeHome(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-enhance'])
  try {
    const r = checkProfileApp('p', home)
    assert.equal(r.ok, true)
    assert.equal(r.app, '@deepseek-ai/dsh-headless')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('[qa-launch] web-app 同样算 app bundle', () => {
  const home = fakeHome(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  try {
    assert.equal(checkProfileApp('p', home).ok, true)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('[qa-launch] 只有 base + 插件（无 app）→ 失败并给出补 headless 的指引', () => {
  const home = fakeHome(['@deepseek-ai/dsh-base', 'dsh-enhance'])
  try {
    const r = checkProfileApp('p', home)
    assert.equal(r.ok, false)
    assert.match(r.reason, /app bundle/)
    assert.match(r.reason, /dsh-headless/)
    assert.match(r.reason, /无输出且不退出/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('[qa-launch] profile 不存在 → 失败并指出路径', () => {
  const home = fakeHome(['@deepseek-ai/dsh-base'])
  try {
    const r = checkProfileApp('missing', home)
    assert.equal(r.ok, false)
    assert.match(r.reason, /不存在/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('[qa-launch] profile package.json 坏 JSON → 失败但不抛', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-launch-bad-'))
  const dir = join(home, 'profiles', 'p')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{ not json')
  try {
    const r = checkProfileApp('p', home)
    assert.equal(r.ok, false)
    assert.match(r.reason, /无法解析/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('[qa-launch] resolveDsh 返回统一形状（cmd 为字符串，prefix 为数组）', () => {
  const r = resolveDsh()
  assert.equal(typeof r.cmd, 'string')
  assert.ok(Array.isArray(r.prefix))
  // 本机（CI/开发机）应能定位到 dsh；定位不到时应显式标记 missing 并给出指引。
  if (r.missing) {
    assert.equal(r.prefix.length, 0)
    assert.match(dshMissingHint(), /DSH_BIN/)
  } else {
    assert.ok(r.prefix.length > 0)
  }
})

// ── 桌面版（Electron 应用）CLI ──────────────────────────────────────────────
//
// 桌面版不是标准 shim：它的 dsh.cmd 会再拉 `"<App>.exe" --expose-internals
// <app.asar>/…/dsh-desktop-host/lib/cli.js` 并带 ELECTRON_RUN_AS_NODE=1。
// 直接 spawn .cmd 在 Windows 上会 EINVAL，所以必须复刻这三条事实。

/** 造一个桌面版安装布局：<root>/<App>.exe + resources/... + app.asar/…/cli.js。 */
function fakeDesktopLayout({ withShim = true, withCli = true, withExe = true, asarFile = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-'))
  const cliDir = join(root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib')
  mkdirSync(cliDir, { recursive: true })
  if (withCli) writeFileSync(join(cliDir, 'cli.js'), '// cli')
  if (asarFile) {
    // 真实安装形态：app.asar 是**文件**，cli.js 在它里面（Node 看不见，Electron 自己读）。
    rmSync(join(root, 'resources', 'app.asar'), { recursive: true, force: true })
    writeFileSync(join(root, 'resources', 'app.asar'), '')
  }
  const shimDir = join(root, 'resources', 'runtime', 'cli', 'bin')
  mkdirSync(shimDir, { recursive: true })
  if (withShim) writeFileSync(join(shimDir, 'dsh.cmd'), '@echo off\n')
  if (withExe) writeFileSync(join(root, 'MyApp.exe'), '')
  return root
}

/** 临时改 env 跑一段，结束后还原。 */
function withEnv(vars, fn) {
  const saved = new Map()
  for (const [k, v] of Object.entries(vars)) {
    saved.set(k, process.env[k])
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('[qa-launch] desktopRootOf 从桌面 shim 反推应用根，其它路径返回 undefined', () => {
  assert.equal(
    desktopRootOf('F:\\dsh-desktop\\resources\\runtime\\cli\\bin\\dsh.cmd'),
    'F:\\dsh-desktop',
  )
  assert.equal(desktopRootOf('F:\\nvm\\v24.13.0\\dsh.cmd'), undefined)
  assert.equal(desktopRootOf(undefined), undefined)
})

test('[qa-launch] desktopRootFromShims 从 PATH 命中里认出桌面根（非桌面 shim 忽略）', () => {
  // 实测本机 PATH 上命中的就是桌面 shim；认不出它就会退回 nvm 的 0.1.0-rc.6。
  assert.equal(desktopRootFromShims(['F:\\nvm\\v24.13.0\\dsh.cmd']), undefined)
  assert.equal(
    desktopRootFromShims(['F:\\nvm\\v24.13.0\\dsh.cmd', 'F:\\dsh-desktop\\resources\\runtime\\cli\\bin\\dsh.cmd']),
    'F:\\dsh-desktop',
  )
  assert.equal(desktopRootFromShims([]), undefined)
  assert.equal(desktopRootFromShims(undefined), undefined)
})

test('[qa-launch] desktopLaunchFrom 复刻 Electron-as-node 启动三要素', () => {
  const root = fakeDesktopLayout()
  try {
    const d = desktopLaunchFrom(root)
    assert.ok(d, '布局完整时应返回启动信息')
    assert.equal(d.kind, 'desktop')
    assert.equal(d.cmd, join(root, 'MyApp.exe'))
    assert.equal(d.prefix[0], '--expose-internals')
    assert.equal(d.prefix[1], join(root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
    assert.equal(d.env.ELECTRON_RUN_AS_NODE, '1')
    assert.equal(d.shim, join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('[qa-launch] desktopLaunchFrom 布局不全时返回 undefined（不猜）', () => {
  for (const opts of [{ withShim: false }, { withCli: false }, { withExe: false }]) {
    const root = fakeDesktopLayout(opts)
    try {
      assert.equal(desktopLaunchFrom(root), undefined, `缺件时应 undefined: ${JSON.stringify(opts)}`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('[qa-launch] desktopLaunchFrom 接受打包布局（真实安装：cli.js 在 app.asar 文件里）', () => {
  // 真机就是这一种：app.asar 是 121MB 的文件，Node 的 existsSync 看不到里面的 cli.js。
  // 只认解包目录的话，本机 resolveDsh 会一路退回 nvm 的 0.1.0-rc.6（实测过）。
  const root = fakeDesktopLayout({ withCli: false, asarFile: true })
  try {
    const d = desktopLaunchFrom(root)
    assert.ok(d, 'app.asar 文件存在即布局成立')
    assert.equal(d.kind, 'desktop')
    assert.equal(d.cmd, join(root, 'MyApp.exe'))
    assert.match(d.prefix[1].replace(/\\/g, '/'), /resources\/app\.asar\/dsh\/node_modules\/@deepseek-ai\/dsh-desktop-host\/lib\/cli\.js$/)
    assert.equal(d.env.ELECTRON_RUN_AS_NODE, '1')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('[qa-launch] DSH_DESKTOP_ROOT 让 resolveDsh 走桌面版启动路径', () => {
  const root = fakeDesktopLayout()
  try {
    const r = withEnv({ DSH_DESKTOP_ROOT: root, DSH_BIN: undefined }, () => resolveDsh())
    assert.equal(r.kind, 'desktop')
    assert.equal(r.env.ELECTRON_RUN_AS_NODE, '1')
    assert.equal(r.cmd, join(root, 'MyApp.exe'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('[qa-launch] DSH_BIN 指向桌面 shim 时自动转成 exe+cli.js（不 spawn .cmd）', () => {
  const root = fakeDesktopLayout()
  const shim = join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
  try {
    const r = withEnv({ DSH_DESKTOP_ROOT: undefined, DSH_BIN: shim }, () => resolveDsh())
    assert.equal(r.kind, 'desktop')
    assert.equal(r.cmd, join(root, 'MyApp.exe'))
    assert.notEqual(r.cmd, shim, '不得直接把 .cmd 当可执行文件 spawn')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// ── 实驱目标解析：隔离优先 ──────────────────────────────────────────────────
//
// 背景：不带环境变量直接跑实驱时，目标曾落在**真实** `~/.dsh`，于是实现在一个不含
// 本插件的 profile 上找 bundle 层，报出"未发现 dsh-enhance 层"——把"跑错环境"误诊成
// "插件缺陷"。现在默认隔离优先，且解析结果会写进证据。

test('[qa-launch] resolveQaTarget：隔离 home 存在时默认只碰它，profile 用 qa', () => {
  const iso = mkdtempSync(join(tmpdir(), 'dsh-qa-iso-'))
  try {
    const r = resolveQaTarget({ qaHome: iso, env: {} })
    assert.equal(r.home, iso)
    assert.equal(r.profile, 'qa')
    assert.equal(r.isolated, true)
    assert.equal(r.explicitHome, false)
    assert.deepEqual(r.env, { DSH_HOME: iso }, '要注入子进程的环境变量')
  } finally { rmSync(iso, { recursive: true, force: true }) }
})

test('[qa-launch] resolveQaTarget：显式 DSH_HOME / DSH_ENHANCE_PROFILE 优先', () => {
  const r = resolveQaTarget({
    qaHome: join(tmpdir(), 'dsh-qa-not-used'),
    env: { DSH_HOME: 'D:\\some-home', DSH_ENHANCE_PROFILE: 'custom' },
  })
  assert.equal(r.home, 'D:\\some-home')
  assert.equal(r.profile, 'custom')
  assert.equal(r.isolated, false)
  assert.equal(r.explicitHome, true)
})

test('[qa-launch] resolveQaTarget：隔离 home 不存在时退回真实 home 与 dsh-enhance', () => {
  const r = resolveQaTarget({ qaHome: join(tmpdir(), 'dsh-qa-definitely-missing-xyz'), env: {} })
  assert.equal(r.home, join(homedir(), '.dsh'))
  assert.equal(r.profile, 'dsh-enhance')
  assert.equal(r.isolated, false)
})

test('[qa-launch] QA_HOME 指向仓库内的隔离 home，QA_PROFILE 为 qa', () => {
  assert.match(QA_HOME.replace(/\\/g, '/'), /\/\.dsh-enhance\/desktop-test-home\/?$/)
  assert.equal(QA_PROFILE, 'qa')
  // 隔离 home 属运行痕迹（.gitignore），存在与否都不该让单测挂；这里只钉常量契约。
  assert.equal(typeof existsSync(QA_HOME), 'boolean')
})
