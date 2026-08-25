import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideContinue, MIN_STEER_GAP_MS } from '../lib/hooks/todo-continuation.js'

// Pure progression-guard unit tests (architecture §8). The `tryContinue` hook
// wrapper is thin; its decision logic is what must hold to avoid a steer loop.

test('[continue] no todos ⇒ no steer', () => {
  assert.equal(decideContinue(0, 'active', undefined, 0, 0), false)
  assert.equal(decideContinue(0, 'active', 5, 100, 0), false)
})

test('[continue] blocked work ⇒ no steer', () => {
  assert.equal(decideContinue(3, 'blocked', undefined, 0, 0), false)
  assert.equal(decideContinue(3, 'blocked', 10, 0, 0), false)
})

test('[continue] first sight with open todos ⇒ steer (no prior, no prior steer)', () => {
  assert.equal(decideContinue(3, 'active', undefined, 1000, 0), true)
})

test('[continue] progress (todos decreased) after cooldown ⇒ steer', () => {
  const t0 = 0
  const t1 = t0 + MIN_STEER_GAP_MS
  // prior=5, now=3 → made progress, past cooldown → steer
  assert.equal(decideContinue(3, 'active', 5, t1, t0), true)
})

test('[continue] no progress (same count) ⇒ no steer (anti-loop)', () => {
  // prior === current, no decrease → never re-steer
  assert.equal(decideContinue(3, 'active', 3, 1_000_000, 0), false)
})

test('[continue] increase (regression) ⇒ no steer', () => {
  // todos went UP (3 → 5): not progress, do not push even off cooldown
  assert.equal(decideContinue(5, 'active', 3, 1_000_000, 0), false)
})

test('[continue] cooldown short-circuit ⇒ no steer despite progress', () => {
  // progress made (prior 5 → 2), but within MIN_STEER_GAP_MS of the last steer
  const tLast = 1_000_000
  const tooSoon = tLast + 500
  assert.equal(decideContinue(2, 'active', 5, tooSoon, tLast), false)
})

test('[continue] first sight but blocked after some delay ⇒ no steer', () => {
  assert.equal(decideContinue(2, 'blocked', undefined, 1_000_000, 0), false)
})
