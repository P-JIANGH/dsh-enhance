// QA 启动器（qa/dsh-launch.mjs）单测：锁住 profile 自检与启动器解析契约。
//
// 背景：原三个实驱脚本各自实现 resolveDsh，在 dsh shim 不在 PATH 的机器上
// 抛 `spawnSync dsh.cmd EINVAL`；且都不检查 profile 是否挂了 app bundle，
// 导致「无输出且不退出」被误读成 dsh 版本缺陷。本测试锁住修复后的行为。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkProfileApp, resolveDsh, dshMissingHint } from '../qa/dsh-launch.mjs'

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
