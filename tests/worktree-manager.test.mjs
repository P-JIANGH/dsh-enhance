import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parsePorcelain, createWorktreeManager } from '../lib/features/worktree/manager.js'
import { setWorktreePath, getWorktreePath, hasWorktree } from '../lib/features/worktree/boulder-link.js'
import { readBoulder } from '../lib/features/boulder/store.js'

/** A stub git runner that records calls and answers known commands. */
function stubGit(routes) {
  const calls = []
  return {
    calls,
    async run(args) { calls.push([...args]); return { stdout: routes.get(args[0] ?? '') ?? '', stderr: '', code: 0, ok: true } },
    async must(args) {
      calls.push([...args])
      const cmd = args[0]
      if (routes.has(cmd)) return routes.get(cmd)
      throw new Error(`unexpected git: ${args.join(' ')}`)
    },
  }
}

test('[worktree parse] porcelain with branch and detached', () => {
  const out = [
    'worktree /repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /repo/.wt/w1',
    'HEAD def456',
    '',
  ].join('\n')
  const entries = parsePorcelain(out)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].path, '/repo')
  assert.equal(entries[0].branch, 'main')
  assert.equal(entries[0].detached, false)
  assert.equal(entries[1].path, '/repo/.wt/w1')
  assert.equal(entries[1].detached, true)
})

test('[worktree manager] create runs git worktree add --detach and registers boulder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-wtm-'))
  const git = stubGit(new Map([['worktree', '']]))
  const mgr = createWorktreeManager(dir, git)

  const rel = await mgr.create(dir, { workId: 'W-9', slug: 'feature-x', baseDir: dir })
  assert.ok(rel.startsWith(dir.replace(/\\/g, '/')) || rel.startsWith(dir))
  // git must have run add --detach
  const addCall = git.calls.find(c => c[1] === 'add')
  assert.ok(addCall, 'git worktree add should have been called')
  assert.equal(addCall[2], '--detach')
  // boulder linkage recorded
  assert.ok(getWorktreePath(dir, 'W-9'))
  assert.equal(hasWorktree(dir, 'W-9'), true)
})

test('[worktree manager] find matches by directory name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-wtm-'))
  const git = stubGit(new Map([['worktree', 'worktree /x\nbranch refs/heads/main\n\nworktree /y/W-9-feature-x\nHEAD zzz\n\n']]))
  const mgr = createWorktreeManager(dir, git)
  const found = await mgr.find('/repo', 'W-9')
  assert.ok(found)
  assert.ok(found.path.includes('W-9-feature-x'))
})

test('[worktree manager] cleanup runs remove + prune and clears boulder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-wtm-'))
  setWorktreePath(dir, 'W-1', join(dir, 'W-1'))
  const git = stubGit(new Map([
    ['worktree', ''], // remove + prune both start with 'worktree'
  ]))
  const mgr = createWorktreeManager(dir, git)
  const ok = await mgr.cleanup(join(dir, 'repo'), 'W-1', join(dir, 'W-1'))
  assert.equal(ok, true)
  assert.ok(git.calls.some(c => c[0] === 'worktree' && c[1] === 'remove'))
  assert.ok(git.calls.some(c => c[0] === 'worktree' && c[1] === 'prune'))
  assert.equal(getWorktreePath(dir, 'W-1'), null)
})

test('[worktree manager] reuse returns path when it exists, else rebuild instruction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-wtm-'))
  const git = stubGit(new Map())
  const mgr = createWorktreeManager(dir, git)
  // not registered → rebuild
  const absent = mgr.reuse('W-x', () => false)
  assert.ok('rebuild' in absent)
  // registered and exists → path
  setWorktreePath(dir, 'W-x', join(dir, 'W-x'))
  const present = mgr.reuse('W-x', () => true)
  assert.ok('path' in present)
  assert.equal(present.path, join(dir, 'W-x'))
})

test('[worktree boulder-link] null clears the path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-enhance-wtm-'))
  setWorktreePath(dir, 'W-2', 'C:\\path')
  setWorktreePath(dir, 'W-2', null)
  assert.equal(getWorktreePath(dir, 'W-2'), null)
  assert.equal(hasWorktree(dir, 'W-2'), false)
  const { state } = readBoulder(dir)
  assert.equal(state.works['W-2'].worktree_path, null)
  rmSync(dir, { recursive: true, force: true })
})
