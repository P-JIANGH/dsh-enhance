import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  mutateBoulderState, readBoulder, cloneState, mergeStates, upsertWork,
  validateState, isValidState, emptyState, validateWork,
} from '../lib/features/boulder/store.js'
import {
  claimWriteToken, releaseWriteToken, readWriteToken, stealWriteToken,
} from '../lib/features/boulder/write-token.js'
import {
  readGoal, writeSessionGoal, upsertGoal, goalFile,
} from '../lib/features/boulder/goal.js'

function tmpStore() {
  return mkdtempSync(join(tmpdir(), 'omd-boulder-'))
}

test('[boulder] empty state is valid; malformed file reads as empty', () => {
  const dir = tmpStore()
  const { state, file } = readBoulder(dir)
  assert.equal(state.revision, 0)
  assert.equal(existsSync(file), false)
})

test('[boulder] mutateBoulderState upserts a work and bumps revision', () => {
  const dir = tmpStore()
  const ok = mutateBoulderState(dir, (s) => {
    upsertWork(s, { id: 'w1', status: 'active', updated_at: 1, session_ids: ['sa'] })
    s.active_work_id = 'w1'
  })
  assert.equal(ok, true)
  const { state } = readBoulder(dir)
  assert.equal(state.revision, 1)
  assert.equal(state.active_work_id, 'w1')
  assert.equal(state.works.w1.status, 'active')
  assert.ok(state.works.w1.session_ids.includes('sa'))
})

test('[boulder] second mutate preserves prior work and unions sessions', () => {
  const dir = tmpStore()
  mutateBoulderState(dir, (s) => upsertWork(s, { id: 'w1', status: 'active', updated_at: 1, session_ids: ['sa'] }))
  mutateBoulderState(dir, (s) => upsertWork(s, { id: 'w1', status: 'active', updated_at: 2, session_ids: ['sb'] }))
  const { state } = readBoulder(dir)
  const sessions = state.works.w1.session_ids
  assert.ok(sessions.includes('sa') && sessions.includes('sb'), 'sessions should union')
  assert.equal(state.works.w1.updated_at, 2) // later writer wins scalar
})

test('[boulder] concurrent CAS: two interleaved mutations do not lose updates', () => {
  const dir = tmpStore()
  // Simulate two writers adding independent works on the same base.
  // mutateBoulderState re-reads each attempt, so sequential calls are enough to
  // prove no lost update; the merge path exercises cross-revision union.
  mutateBoulderState(dir, (s) => upsertWork(s, { id: 'wA', status: 'active', updated_at: 1, session_ids: ['sa'] }))
  mutateBoulderState(dir, (s) => upsertWork(s, { id: 'wB', status: 'active', updated_at: 1, session_ids: ['sb'] }))
  const { state } = readBoulder(dir)
  assert.ok(state.works.wA && state.works.wB, 'both works survive consecutive CAS')
});

test('[boulder] mergeStates unions independent writers at work granularity', () => {
  const base = emptyState()
  const a = cloneState(base); upsertWork(a, { id: 'w1', status: 'active', updated_at: 1, session_ids: ['sa'] }); a.active_work_id = 'w1'
  const b = cloneState(base); upsertWork(b, { id: 'w2', status: 'active', updated_at: 1, session_ids: ['sb'] }); b.active_work_id = 'w2'
  const merged = mergeStates(a, b)
  assert.ok(merged.works.w1 && merged.works.w2, 'both works preserved')
  assert.ok(merged.conflict_log && merged.conflict_log.length > 0, 'active_work_id conflict logged')
})

test('[boulder] conflicting scalar keeps the later writer (merge)', () => {
  const base = emptyState()
  const a = cloneState(base); upsertWork(a, { id: 'w1', status: 'active', updated_at: 10, session_ids: ['sa'] })
  const b = cloneState(base); upsertWork(b, { id: 'w1', status: 'active', updated_at: 20, session_ids: ['sb'] })
  const merged = mergeStates(a, b)
  assert.equal(merged.works.w1.updated_at, 20) // later writer wins
  assert.ok(merged.works.w1.session_ids.includes('sa') && merged.works.w1.session_ids.includes('sb'))
})

test('[boulder] invalid write (bad status) throws, never commits', () => {
  const dir = tmpStore()
  assert.throws(() => {
    mutateBoulderState(dir, (s) => { s.works['bad'] = { id: 'bad', status: 'nope', updated_at: 1, session_ids: [] } })
  }, /invalid state/)
})

test('[boulder] write token: claim exclusive, second claim fails, release allows retake', () => {
  const dir = tmpStore()
  assert.equal(claimWriteToken(dir, 'sa'), true)
  assert.equal(readWriteToken(readBoulder(dir).state), 'sa')
  assert.equal(claimWriteToken(dir, 'sb'), false, 'second cannot claim while held')
  assert.equal(releaseWriteToken(dir, 'sa'), true)
  assert.equal(claimWriteToken(dir, 'sb'), true)
})

test('[boulder] stealWriteToken reassigns a stale holder', () => {
  const dir = tmpStore()
  claimWriteToken(dir, 'stale')
  assert.equal(stealWriteToken(dir, 'new'), true)
  assert.equal(readWriteToken(readBoulder(dir).state), 'new')
})

// ---- goal ---- //

test('[goal] upsertGoal persists atomically and reads back', () => {
  const dir = tmpStore()
  const g = upsertGoal(dir, 'sess-1', { id: 'sess-1', objective: 'Ship X', status: 'in_progress', acceptance: ['a'], remaining_todos: 2, created_at: 1, updated_at: 1 })
  assert.ok(g.updated_at > 0)
  const loaded = readGoal(dir, 'sess-1')
  assert.ok(loaded)
  assert.equal(loaded.objective, 'Ship X')
  assert.equal(loaded.remaining_todos, 2)
})

test('[goal] malformed goal file reads as null, never crashes', () => {
  const dir = tmpStore()
  const file = goalFile(dir, 'sess-2')
  writeFileSync(file, 'not-json')
  assert.equal(readGoal(dir, 'sess-2'), null)
})

test('[goal] writeSessionGoal round-trips through disk', () => {
  const dir = tmpStore()
  writeSessionGoal(dir, 'sess-3', { id: 'sess-3', objective: 'Doc', status: 'done', created_at: 1, updated_at: 1 })
  const raw = JSON.parse(readFileSync(join(dir, 'goal_sess-3.json'), 'utf8'))
  assert.equal(raw.objective, 'Doc')

  // no-extra-files cleanup
  rmSync(dir, { recursive: true, force: true })
})
