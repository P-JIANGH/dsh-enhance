/**
 * 「volatile 开关即时生效」的接线回归测试。
 *
 * 契约（见 docs/design-web-settings-card.md）：
 * - 设置面改一个 volatile 字段时，Loader **不会**重挂本插件，只在原地提交新值并
 *   在**本插件自己的 fiber** 上发 `loader/volatile-update`；
 * - 本插件的功能接线因此被装在一个子插件里，收到该事件时**先卸载再重挂**，
 *   否则开关要等下次重启才生效（曾经就是如此）；
 * - 重挂必须串行：连续两次改动不能出现"两次挂载都没卸载"的窗口（那会与
 *   `commands`/`tools` 的"同一层内重名即失败"撞车）。
 *
 * 这里用最小假 ctx 只验证**编排**（挂载/卸载顺序与串行性），不跑功能接线本身
 * ——功能接线由各自的单测覆盖。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/** 假 ctx：记录 `plugin()` 的挂载，捕获 `on()` 的监听器。 */
function harness() {
  const mounts = []
  const listeners = new Map()
  const ctx = {
    plugin(plugin, config) {
      const record = { plugin, config, disposed: false }
      mounts.push(record)
      return {
        dispose: async () => {
          record.disposed = true
          record.disposedAt = mounts.filter(m => m.disposed).length
        },
      }
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => true
    },
    logger: { warn() {}, debug() {}, info() {}, error() {} },
  }
  return { ctx, mounts, listeners }
}

/** 让已排入微任务队列的重挂跑完。 */
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/** 一个 volatile 字段的最小替身：值是活的，读时才取。 */
function field(value) {
  return { get: () => value }
}

test('[volatile] 首个挂载在 apply 内同步完成，且挂的是功能子插件', () => {
  const { ctx, mounts } = harness()
  apply(ctx, { doctorTool: field(true) })
  assert.equal(mounts.length, 1)
  assert.equal(mounts[0].plugin.name, 'dsh-enhance/features')
  assert.equal(mounts[0].disposed, false)
})

test('[volatile] 收到 loader/volatile-update 后先卸载再重挂，且复用同一 config 对象', async () => {
  const { ctx, mounts, listeners } = harness()
  const config = { doctorTool: field(true) }
  apply(ctx, config)

  const fire = listeners.get('loader/volatile-update')
  assert.equal(typeof fire, 'function', '必须监听 loader/volatile-update')

  config.doctorTool = field(false)
  fire([['doctorTool']])
  await settle()

  assert.equal(mounts.length, 2)
  assert.equal(mounts[0].disposed, true, '旧的一代必须先卸载')
  assert.equal(mounts[1].disposed, false)
  assert.equal(mounts[1].config, config, '重挂复用同一 config，volatile 取值在挂载时读取')
  assert.equal(mounts[1].config.doctorTool.get(), false)
})

test('[volatile] 连续两次改动串行重挂：任何时刻最多一代存活', async () => {
  const { ctx, mounts, listeners } = harness()
  apply(ctx, { doctorTool: field(true) })
  const fire = listeners.get('loader/volatile-update')

  fire([['doctorTool']])
  fire([['guards']])
  await settle()

  assert.equal(mounts.length, 3)
  assert.deepEqual(mounts.map(m => m.disposed), [true, true, false])
})

test('[volatile] 重挂失败只记录告警，不把条目打成失败', async () => {
  const { ctx, mounts, listeners } = harness()
  const warnings = []
  ctx.logger.warn = (...args) => warnings.push(args)
  apply(ctx, { doctorTool: field(true) })

  ctx.plugin = (plugin, config) => {
    mounts.push({ plugin, config, disposed: false })
    throw new Error('boom')
  }
  listeners.get('loader/volatile-update')([['doctorTool']])
  await settle()

  assert.equal(warnings.length, 2)
  assert.match(String(warnings[0][0]), /rebuilding the feature wiring/)
})
