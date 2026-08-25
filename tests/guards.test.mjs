import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filePathOf, guardWriteExisting, guardPathTraversal, bashReadPaths, truncateText, READ_TRACK_CAP,
} from '../lib/tools/guards.js'

const root = process.platform === 'win32' ? 'C:\\repo' : '/repo'

test('[guards] filePathOf extracts file_path', () => {
  assert.equal(filePathOf({ file_path: '/a/b.ts', content: 'x' }), '/a/b.ts')
  assert.equal(filePathOf({ file_path: '' }), undefined)
  assert.equal(filePathOf(null), undefined)
  assert.equal(filePathOf({ content: 'x' }), undefined)
})

test('[guards] guardWriteExisting rejects unread write, allows read-first', () => {
  const read = new Set([`${root}/a.ts`])
  assert.equal(guardWriteExisting({ file_path: `${root}/a.ts` }, read, root), undefined)
  assert.ok(guardWriteExisting({ file_path: `${root}/b.ts` }, read, root)?.includes('read'))
  assert.equal(guardWriteExisting({ content: 'no-path' }, read, root), undefined)
})

test('[guards] guardWriteExisting force bypasses read requirement', () => {
  const read = new Set()
  assert.equal(guardWriteExisting({ file_path: `${root}/x.ts` }, read, root, true), undefined)
})

test('[guards] guardWriteExisting rejects out-of-root as traversal', () => {
  const read = new Set()
  assert.ok(guardWriteExisting({ file_path: `${root}/../secret` }, read, root)?.includes('outside'))
})

test('[guards] guardPathTraversal blocks escapes, allows inside', () => {
  assert.equal(guardPathTraversal({ file_path: `${root}/src/a.ts` }, root), undefined)
  assert.ok(guardPathTraversal({ file_path: `${root}/../etc/passwd` }, root))
  assert.equal(guardPathTraversal({ content: 'x' }, root), undefined)
})

test('[guards] bashReadPaths extracts cat/gcc refs', () => {
  const ps = bashReadPaths('cat src/a.ts && gcc main.c -o out')
  assert.ok(ps.includes('src/a.ts'))
  assert.ok(ps.includes('main.c'))
})

test('[guards] bashReadPaths ignores flags', () => {
  const ps = bashReadPaths('cat -n foo.txt')
  assert.equal(ps.some(p => p === '-n'), false)
})

test('[guards] truncateText caps output', () => {
  assert.equal(truncateText('hello', 10), 'hello')
  assert.ok(truncateText('a'.repeat(100), 10).includes('truncated'))
  assert.ok(truncateText('a'.repeat(100), 10).length < 100)
})

test('[guards] READ_TRACK_CAP is the documented cap', () => {
  assert.equal(READ_TRACK_CAP, 1024)
})
