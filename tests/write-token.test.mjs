// 写令牌（§5.5.1）单测：
// - claim/release/陈旧接管与时间戳维护（features/boulder/write-token）；
// - 写令牌门卫的判定（只有「活跃 work 且无独立 worktree 且令牌在他处」才拒绝）。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mutateBoulderState, readBoulder } from '../lib/features/boulder/store.js'
import {
  claimWriteToken,
  claimWriteTokenDetailed,
  releaseWriteToken,
  isPidAlive,
  isHolderStale,
  DEFAULT_TOKEN_STALE_MS,
} from '../lib/features/boulder/write-token.js'
import { decideWriteToken, WRITE_TOOLS } from '../lib/tools/write-token-guard.js'

function tmp () {
  return mkdtempSync(join(tmpdir(), 'dsh-enhance-token-'))
}

/**
 * 预置一份带活跃 work 的 boulder.json。
 * `holderPid` 默认用当前进程（活），这样"活跃持有者"才是真的活。
 */
function seed (dir, { worktree, holder, holderAt, holderPid } = {}) {
  mutateBoulderState(dir, (s) => {
    s.works.w1 = { id: 'w1', status: 'active', updated_at: 1, session_ids: ['s1'] }
    if (worktree) s.works.w1.worktree_path = worktree
    s.active_work_id = 'w1'
    if (holder) {
      s.exec_holder = holder
      // 显式传 null = **真的不写这个字段**（模拟"旧版本留下的、没有时间戳/pid 的状态"）。
      // 之前这里是 `holderAt ?? Date.now()`，于是"无时间戳"那条测试根本构造不出无时间戳的状态：
      // 它只是一直在赌 `seed()` 写文件期间跨过一个毫秒（`now - stampedAt > 0`）。Windows 上
      // 能侥幸通过，Linux 上两次 Date.now() 落在同一毫秒就红了。
      if (holderAt === null) delete s.exec_holder_at
      else s.exec_holder_at = holderAt ?? Date.now()
      if (holderPid === null) delete s.exec_holder_pid
      else s.exec_holder_pid = holderPid ?? process.pid
    }
  })
}

test('[write-token] 空闲令牌可抢占，并写入持有时间戳', () => {
  const dir = tmp()
  try {
    seed(dir)
    assert.equal(claimWriteToken(dir, 's1'), true)
    const s = readBoulder(dir).state
    assert.equal(s.exec_holder, 's1')
    assert.equal(typeof s.exec_holder_at, 'number')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[write-token] 令牌被活跃会话持有时不可抢占', () => {
  const dir = tmp()
  try {
    seed(dir, { holder: 's1', holderAt: Date.now(), holderPid: process.pid })
    const r = claimWriteTokenDetailed(dir, 's2')
    assert.equal(r.ok, false)
    assert.equal(r.holder, 's1')
    assert.equal(readBoulder(dir).state.exec_holder, 's1', '失败时不得改写持有者')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[write-token] 持有者进程已死 → 立即接管（不等待 stale 窗口）', () => {
  const dir = tmp()
  try {
    // 一个几乎不可能存活的 pid：headless 退出不触发 agent/disposed，
    // 靠 pid 存活性让死会话的令牌立刻可被接管。
    const deadPid = 4194304
    assert.equal(isPidAlive(deadPid), false, '前置：该 pid 应被视为不存在')
    seed(dir, { holder: 'dead-session', holderAt: Date.now(), holderPid: deadPid })

    const r = claimWriteTokenDetailed(dir, 's2', { staleMs: DEFAULT_TOKEN_STALE_MS })
    assert.equal(r.ok, true)
    assert.equal(r.tookOver, true)
    const s = readBoulder(dir).state
    assert.equal(s.exec_holder, 's2')
    assert.equal(s.exec_holder_pid, process.pid)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[write-token] isHolderStale：死 pid 或超龄任一成立即为陈旧', () => {
  const now = 1_000_000
  assert.equal(isHolderStale({ exec_holder_at: now, exec_holder_pid: process.pid }, now, 1000), false)
  assert.equal(isHolderStale({ exec_holder_at: now, exec_holder_pid: 4194304 }, now, 1000), true)
  assert.equal(isHolderStale({ exec_holder_at: now - 2000, exec_holder_pid: process.pid }, now, 1000), true)
  assert.equal(isHolderStale({}, now, 1000), true, '没有时间戳的旧状态视为陈旧')
})

test('[write-token] 陈旧持有者被接管（默认 30 分钟）', () => {
  const dir = tmp()
  try {
    seed(dir, { holder: 'dead-session', holderAt: 1000 })
    const r = claimWriteTokenDetailed(dir, 's2', { staleMs: 500, now: 2000 })
    assert.equal(r.ok, true)
    assert.equal(r.tookOver, true)
    const s = readBoulder(dir).state
    assert.equal(s.exec_holder, 's2')
    assert.equal(s.exec_holder_at, 2000)
    assert.equal(DEFAULT_TOKEN_STALE_MS, 30 * 60_000)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[write-token] 无时间戳的旧状态视为陈旧，可被接管', () => {
  const dir = tmp()
  try {
    // 真正的"旧状态"：既没有 exec_holder_at，也没有 exec_holder_pid（旧版本写的形态）。
    seed(dir, { holder: 'legacy', holderAt: null, holderPid: null })
    const r = claimWriteTokenDetailed(dir, 's2', { staleMs: 0, now: Date.now() })
    assert.equal(r.ok, true)
    assert.equal(r.tookOver, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[write-token] 刚写下且持有进程仍活着时不陈旧（与"无时间戳"互补的对照）', () => {
  const dir = tmp()
  try {
    // now 显式等于写入时刻：`now - stampedAt === 0`，即使 staleMs 为 0 也不该算陈旧。
    // 这条是为了钉住"判定用的是时间戳而不是'文件写过了'"，避免上一条再次退化成时序赌博。
    const now = 5_000_000
    seed(dir, { holder: 'live', holderAt: now, holderPid: process.pid })
    const r = claimWriteTokenDetailed(dir, 's2', { staleMs: 0, now })
    assert.equal(r.ok, false)
    assert.equal(r.holder, 'live')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('[write-token] release 只释放自己的令牌，并清掉时间戳', () => {
  const dir = tmp()
  try {
    seed(dir, { holder: 's1', holderAt: 123 })
    assert.equal(releaseWriteToken(dir, 's2'), false, '不得释放别人的令牌')
    assert.equal(readBoulder(dir).state.exec_holder, 's1')
    assert.equal(releaseWriteToken(dir, 's1'), true)
    const s = readBoulder(dir).state
    assert.equal(s.exec_holder, undefined)
    assert.equal(s.exec_holder_at, undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// ── 门卫判定 ────────────────────────────────────────────────────────────────

const ACTIVE_WORK = { active_work_id: 'w1', works: { w1: { id: 'w1', status: 'active' } } }

function deps (state, claimResult = true) {
  const claims = []
  return {
    claims,
    read: () => state,
    claim: (cwd, sid) => { claims.push(sid); return claimResult },
  }
}

test('[write-token-guard] 只拦 write/edit，todo_write 不受影响', () => {
  assert.deepEqual([...WRITE_TOOLS].sort(), ['edit', 'write'])
  const d = deps({ ...ACTIVE_WORK, exec_holder: 'other' })
  assert.equal(decideWriteToken({ name: 'todo_write', cwd: '/r', sessionId: 's1' }, d).ok, true)
  assert.equal(decideWriteToken({ name: 'read', cwd: '/r', sessionId: 's1' }, d).ok, true)
  assert.equal(decideWriteToken({ name: 'write', cwd: '/r', sessionId: 's1' }, d).ok, false)
})

test('[write-token-guard] 没有活跃 work → 放行（不用 boulder 的会话不受影响）', () => {
  const d = deps({ works: {} })
  assert.equal(decideWriteToken({ name: 'write', cwd: '/r', sessionId: 's1' }, d).ok, true)
})

test('[write-token-guard] 缺 cwd → 放行', () => {
  const d = deps(ACTIVE_WORK)
  assert.equal(decideWriteToken({ name: 'write', cwd: undefined, sessionId: 's1' }, d).ok, true)
})

test('[write-token-guard] work 有独立 worktree → 并行通道，放行', () => {
  const d = deps({ active_work_id: 'w1', works: { w1: { id: 'w1', status: 'active', worktree_path: '/wt' } } })
  const r = decideWriteToken({ name: 'write', cwd: '/r', sessionId: 's1' }, d)
  assert.equal(r.ok, true)
})

test('[write-token-guard] 自己持有令牌 → 放行', () => {
  const d = deps({ ...ACTIVE_WORK, exec_holder: 's1' })
  assert.equal(decideWriteToken({ name: 'write', cwd: '/r', sessionId: 's1' }, d).ok, true)
})

test('[write-token-guard] 令牌空闲 → 惰性抢占并放行', () => {
  const d = deps(ACTIVE_WORK)
  const r = decideWriteToken({ name: 'write', cwd: '/r', sessionId: 's1' }, d)
  assert.equal(r.ok, true)
  assert.deepEqual(d.claims, ['s1'], '空闲令牌应在本会话被抢占')
})

test('[write-token-guard] 令牌被他人持有且抢占失败 → 拒绝并给出可执行指引', () => {
  const d = deps({ ...ACTIVE_WORK, exec_holder: 'other' }, false)
  const r = decideWriteToken({ name: 'write', cwd: '/r', sessionId: 's1' }, d)
  assert.equal(r.ok, false)
  assert.equal(r.holder, 'other')
  assert.match(r.reason, /写令牌被占用/)
  assert.match(r.reason, /worktree_create/, '拒绝理由必须告诉用户怎么办')
})
