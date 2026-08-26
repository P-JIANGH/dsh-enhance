// Advisor companion-review unit tests: severity envelope parsing and the
// emission guard (de-dupe + rate limit). These pin the pure logic that the
// runtime relies on, independent of the live dsh loop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAdvisorEmission } from '../lib/features/advisor/severity.js'
import { createEmissionGuard } from '../lib/features/advisor/emission-guard.js'
import { runReviewCall } from '../lib/features/advisor/runtime.js'

test('[advisor-severity] NONE marker → null', () => {
  assert.equal(parseAdvisorEmission('ADVISOR: NONE'), null)
  assert.equal(parseAdvisorEmission('Some text\nADVISOR: NONE\nmore'), null)
  assert.equal(parseAdvisorEmission(''), null)
  assert.equal(parseAdvisorEmission('no marker here'), null)
})

test('[advisor-severity] parses severity + body', () => {
  const e = parseAdvisorEmission('ADVISOR: concern\nThe edge case with empty inputs is unhandled.')
  assert.deepEqual(e, { severity: 'concern', body: 'The edge case with empty inputs is unhandled.' })
})

test('[advisor-severity] accepts nit/blocker and lower/upper case', () => {
  assert.equal(parseAdvisorEmission('ADVISOR: nit\nTidy this').severity, 'nit')
  assert.equal(parseAdvisorEmission('ADVISOR: BLOCKER\nStop').severity, 'blocker')
})

test('[advisor-severity] marker without a body is not actionable', () => {
  assert.equal(parseAdvisorEmission('ADVISOR: concern'), null)
})

test('[advisor-guard] allows first emission then de-dupes a repeat within window', () => {
  let t = 0
  const guard = createEmissionGuard(() => t, 1000)
  assert.equal(guard.gate('a1', 'same advice'), true)
  assert.equal(guard.gate('a1', 'same advice'), false) // duplicate in cooldown
  assert.equal(guard.gate('a1', 'different advice'), true) // new body passes
})

test('[advisor-guard] rate-limits a recurring body until the window elapses', () => {
  let t = 0
  const guard = createEmissionGuard(() => t, 1000)
  assert.equal(guard.gate('a2', 'advice'), true)
  t = 500
  assert.equal(guard.gate('a2', 'advice'), false) // same body, within window
  t = 1001
  assert.equal(guard.gate('a2', 'advice'), true) // window elapsed → allowed again
})

test('[advisor-guard] per-agent isolation', () => {
  let t = 0
  const guard = createEmissionGuard(() => t, 1000)
  assert.equal(guard.gate('mainA', 'advice'), true)
  assert.equal(guard.gate('mainB', 'advice'), true) // different agent unaffected
})

test('[advisor-guard] ignore empty bodies', () => {
  const guard = createEmissionGuard(() => 0, 1000)
  assert.equal(guard.gate('a', ''), false)
})

test('[advisor-run] runReviewCall assembles text from a stream', async () => {
  async function* fakeStream() {
    yield { type: 'text-delta', index: 0, text: 'ADVISOR: concern\n' }
    yield { type: 'text-delta', index: 0, text: 'The timeout is too aggressive.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const llm = { stream: () => fakeStream() }
  const raw = await runReviewCall(llm, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    messages: [],
    system: 'sys',
  })
  assert.equal(raw, 'ADVISOR: concern\nThe timeout is too aggressive.')
})

test('[advisor-run] runReviewCall returns null on stream failure', async () => {
  const llm = {
    stream: () => (async function* () { throw new Error('NO_ADAPTER') })(),
  }
  const raw = await runReviewCall(llm, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    messages: [],
  })
  assert.equal(raw, null)
})
