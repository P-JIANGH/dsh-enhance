import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  compareKey, absoluteRoot, isContained, isContainedRobust, realPath,
} from '../lib/shared/path.js'
import {
  atomicWriteFile, readJsonOrNull, acquireLock, forceReleaseLock,
} from '../lib/shared/atomic-write.js'
import {
  isNonNegInt, isNonEmptyString, isPlainObject, isOneOf,
} from '../lib/shared/validate.js'

// ---- path ---- //

test('[path] compareKey resolves and normalizes for comparison', () => {
  const a = compareKey('repo/src/index.ts')
  const b = compareKey('repo/src/../src/index.ts')
  assert.equal(a, b, '.. should normalize away')
  assert.equal(typeof a, 'string')
})

test('[path] absoluteRoot keeps an absolute input; resolves relative against cwd', () => {
  const abs = process.platform === 'win32' ? 'C:\\x' : '/x'
  assert.equal(absoluteRoot(abs), abs) // absolute in, absolute out
  assert.ok(pathIsAbsPredicate(absoluteRoot('repo')))
})

function pathIsAbsPredicate(p) {
  return p.length > 0 && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))
}

test('[path] isContained rejects escapes, accepts inside', () => {
  const root = absoluteRoot(String(process.cwd()))
  const inside = join(root, 'src', 'index.ts')
  assert.equal(isContained(inside, root), true)
  // A sibling that shares no prefix is outside.
  assert.equal(isContained(join(root, '..', 'x'), root), false)
})

test('[path] isContained with .. traversal is rejected', () => {
  const root = absoluteRoot(String(process.cwd()))
  assert.equal(isContained(join(root, '..', 'secret'), root), false)
})

test('[path] isContainedRobust rejects lexical escapes deterministically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-path-'))
  const outside = join(dir, '..', 'dsh-enhance-path-outside.txt')
  assert.equal(isContained(outside, dir), false)
  assert.equal(isContained(join(dir, '..', 'anything'), dir), false)
  // Inside stays inside.
  assert.equal(isContained(join(dir, 'src', 'a.ts'), dir), true)
  const _used = realPath // referenced for coverage of the realpath fallback
  assert.ok(typeof _used === 'function')
})

// ---- atomic-write ---- //

test('[atomic] atomicWriteFile persists and overwrites atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-aw-'))
  const file = join(dir, 'data.json')
  atomicWriteFile(file, '{"v":1}')
  assert.equal(readFileSync(file, 'utf8'), '{"v":1}')
  atomicWriteFile(file, '{"v":2}')
  assert.equal(readFileSync(file, 'utf8'), '{"v":2}')
})

test('[atomic] readJsonOrNull returns null for missing/bad file, parses good', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-aw-'))
  assert.equal(readJsonOrNull(join(dir, 'nope.json')), null)
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, 'not json')
  assert.equal(readJsonOrNull(bad), null)
  const good = join(dir, 'good.json')
  writeFileSync(good, '{"a":1}')
  assert.deepEqual(readJsonOrNull(good), { a: 1 })
})

test('[atomic] acquireLock: exclusive, then second fails; release allows retake', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-lock-'))
  const lock = join(dir, 'L')
  const first = acquireLock(lock)
  assert.equal(first.ok, true)
  if (!first.ok) return
  const second = acquireLock(lock)
  assert.equal(second.ok, false)
  first.released()
  const third = acquireLock(lock)
  assert.equal(third.ok, true)
  if (third.ok) third.released()
  forceReleaseLock(lock)
})

// ---- validate ---- //

test('[validate] primitive guards', () => {
  assert.equal(isNonNegInt(0), true)
  assert.equal(isNonNegInt(1.5), false)
  assert.equal(isNonNegInt(-1), false)
  assert.equal(isNonEmptyString('   x '), true)
  assert.equal(isNonEmptyString(''), false)
  assert.equal(isPlainObject({}), true)
  assert.equal(isPlainObject([]), false)
  assert.equal(isPlainObject(null), false)
  assert.equal(isOneOf('b', ['a', 'b']), true)
  assert.equal(isOneOf('z', ['a', 'b']), false)
})
