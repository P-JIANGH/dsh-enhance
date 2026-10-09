// Host-contract pins: the two defects this file exists to prevent were both
// "the code compiled and looked right, but the runtime had moved on".
//
//   1. `agent/session-start` does not exist in the 0.2.0 event catalogue, so two
//      default-ON hooks (start-work, rules-injector) were registered against a
//      name nobody emits and never fired. Nothing failed loudly.
//   2. Every injection claimed `source: { kind: 'user' }`. `MessageSourceMap` is
//      documented as a merge-extensible sum type where "user messages carry any
//      producer's kind" — `user` is a *specific* claim ("the human typed this"),
//      not a default. Text a plugin stamped that way is indistinguishable from
//      human input for any consumer that switches on `kind`.
//
// Both pins are deliberately non-vacuous: the event checker is asserted to
// REJECT the name that shipped broken (P0-4 taught that a self-certifying pin is
// worth nothing), and the provenance pin reports how many call sites it checked.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONTEXT_SOURCE_KIND } from '../lib/shared/provenance.js'
import { isDelegatedSession } from '../lib/shared/session-scope.js'
import { hasInjectedText } from '../lib/shared/messages.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Files with one of these suffixes under a directory (recursive, never a symlink walk). */
function filesUnder(dir, suffixes) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(path, suffixes))
    else if (suffixes.some(suffix => entry.name.endsWith(suffix))) out.push(path)
  }
  return out
}

const SRC_FILES = filesUnder(join(ROOT, 'src'), ['.ts'])

/** Event namespaces mapped to the installed package whose typings declare them. */
const EVENT_OWNERS = {
  agent: 'dsh-agent',
  tools: 'dsh-tools',
}

/**
 * Namespaces whose owner ships with the harness rather than this repo's
 * dependency tree: `loader/*` is declared by `@deepseek-ai/cordis-plugin-loader`,
 * which the host provides and this repo does not depend on. Each entry is a
 * deliberate, reviewed exception — the allow-list itself is pinned below, so
 * widening it is a visible edit rather than a silent one.
 */
const HOST_ONLY_EVENTS = new Set(['loader/volatile-update'])

/** Declaration files of an installed upstream package. */
function upstreamTypes(owner) {
  const dir = join(ROOT, 'node_modules', '@deepseek-ai', owner, 'lib', 'types')
  if (!existsSync(dir)) {
    throw new Error(
      `host-contract: @deepseek-ai/${owner} is not installed (${dir} is missing). ` +
      'This pin compares our event bindings against the upstream typings we compile against; ' +
      'run `pnpm install`. A skipped check here would green-light exactly the defect it exists to catch.',
    )
  }
  const files = filesUnder(dir, ['.d.ts'])
  assert.ok(files.length > 0, `host-contract: no declaration files under ${dir}`)
  return files
}

/**
 * Whether the installed upstream typings declare this event name.
 * @param name - a `<namespace>/<event>` name as written in `ctx.on(...)`.
 * @returns true when the owning package's declarations contain the literal name.
 */
function declaredByUpstream(name) {
  const owner = EVENT_OWNERS[String(name).split('/')[0]]
  if (owner === undefined) return false
  return upstreamTypes(owner).some(file => readFileSync(file, 'utf8').includes(`'${name}'`))
}

test('[host] the event-existence pin rejects the name that shipped broken', () => {
  // Negative control. If the first assertion ever flips, the pin lost its teeth.
  assert.equal(declaredByUpstream('agent/session-start'), false,
    'agent/session-start must not be declared — the 0.2.0 catalogue has no such event')
  assert.equal(declaredByUpstream('agent/created'), true,
    'agent/created must be declared by the installed dsh-agent typings')
  assert.equal(declaredByUpstream('tools/result'), true,
    'tools/result must be declared by the installed dsh-tools typings')
})

test('[host] every event this bundle binds exists in the host it targets', () => {
  const bound = new Map()
  for (const file of SRC_FILES) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/ctx\.on\(\s*'([^']+)'/g)) {
      if (!bound.has(match[1])) bound.set(match[1], [])
      bound.get(match[1]).push(file.slice(ROOT.length).replace(/\\/g, '/'))
    }
  }

  // Non-vacuity: a regex that silently stopped matching would pass everything.
  assert.ok(bound.size >= 5, `expected at least 5 distinct ctx.on bindings, found ${bound.size}`)

  const unknown = []
  for (const [name, where] of bound) {
    if (HOST_ONLY_EVENTS.has(name)) continue
    if (!declaredByUpstream(name)) unknown.push(`${name} (${where.join(', ')})`)
  }
  assert.deepEqual(unknown, [],
    'a listener on a name the host does not emit never fires and never complains — ' +
    'bind a declared event instead:\n' + unknown.join('\n'))
})

test('[host] the host-only event allow-list stays deliberate', () => {
  assert.deepEqual([...HOST_ONLY_EVENTS], ['loader/volatile-update'])
})

test('[provenance] our producer kind is the contract, not "user"', () => {
  assert.equal(CONTEXT_SOURCE_KIND, 'plugin:dsh-enhance')

  // The augmentation is what makes the kind admissible; without it every
  // injection is a compile error rather than a silent fallback to `user`, so pin
  // that it is still declared against dsh-llm.
  const provenance = readFileSync(join(ROOT, 'src', 'shared', 'provenance.ts'), 'utf8')
  assert.match(provenance, /declare module '@deepseek-ai\/dsh-llm'/)
  assert.match(provenance, /interface MessageSourceMap/)
})

test('[provenance] no injection claims to be the human', () => {
  const offenders = []
  let callSites = 0
  let stamped = 0
  for (const file of SRC_FILES) {
    const text = readFileSync(file, 'utf8')
    const rel = file.slice(ROOT.length).replace(/\\/g, '/')
    callSites += text.match(/createUserMessage\(/g)?.length ?? 0
    stamped += text.match(/kind: CONTEXT_SOURCE_KIND/g)?.length ?? 0
    if (/source:\s*\{\s*kind:\s*'user'\s*\}/.test(text)) offenders.push(rel)
  }

  assert.deepEqual(offenders, [], 'these files inject user-role context stamped as human input')
  // Non-vacuity + completeness: every factory call is stamped with our own kind.
  assert.equal(callSites, stamped,
    `every createUserMessage() call must pass source: { kind: CONTEXT_SOURCE_KIND } (${callSites} calls, ${stamped} stamps)`)
  assert.ok(callSites >= 5, `expected at least 5 injection call sites, found ${callSites}`)
})

test('[session-scope] a top-level session is seeded; a delegated child is not', () => {
  // A top-level session carries neither mark.
  assert.equal(isDelegatedSession({}), false)
  assert.equal(isDelegatedSession({ cwd: 'F:/x' }), false)
  assert.equal(isDelegatedSession({ delegationDepth: 0 }), false)
  // `childSessionMeta` writes origin + a persisted depth; either one is enough,
  // because a resumed child keeps the depth even when its options are recreated.
  assert.equal(isDelegatedSession({ origin: 'subagent' }), true)
  assert.equal(isDelegatedSession({ delegationDepth: 1 }), true)
  assert.equal(isDelegatedSession({ origin: 'subagent', delegationDepth: 2 }), true)
})

test('[messages] hasInjectedText matches only this bundle\u2019s own words', () => {
  const text = '## 工作区规则\nAlways run the tests.'
  const ours = { source: { kind: CONTEXT_SOURCE_KIND }, content: [{ type: 'text', text }] }
  const human = { source: { kind: 'user' }, content: [{ type: 'text', text }] }
  const other = { source: { kind: 'agent-instructions' }, content: [{ type: 'text', text }] }
  const stale = { source: { kind: CONTEXT_SOURCE_KIND }, content: [{ type: 'text', text: '## 工作区规则\n旧内容' }] }

  assert.equal(hasInjectedText([ours], text), true)
  assert.equal(hasInjectedText([], text), false)
  // A human typing the same bytes is not our injection.
  assert.equal(hasInjectedText([human], text), false)
  // Another producer's identical text is not ours either.
  assert.equal(hasInjectedText([other], text), false)
  // A state-bearing block must be seeded again once the state changed.
  assert.equal(hasInjectedText([stale], text), false)
  assert.equal(hasInjectedText([stale, ours], text), true)
})
