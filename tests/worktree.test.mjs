import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGitRunner, GitError } from '../lib/features/worktree/git-runner.js'
import { worktreeDirName, worktreeBranch, slugFrom } from '../lib/features/worktree/naming.js'
import {
  validateWorktreeSpec, assertSafeWorkName, worktreePathFor,
} from '../lib/features/worktree/validation.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---- git-runner ---- //

test('[worktree git] run captures git exit code and stdout', async () => {
  const runner = createGitRunner()
  const res = await runner.run(['--version'], process.cwd())
  assert.equal(res.ok, true)
  assert.ok(res.stdout.includes('git version'))
  assert.equal(res.code, 0)
})

test('[worktree git] must throws GitError on failure', async () => {
  const runner = createGitRunner()
  await assert.rejects(() => runner.must(['rev-parse', '--verify', 'refs/heads/definitely-not-a-branch-xyz'], process.cwd()), GitError)
})

// ---- naming ---- //

test('[worktree naming] dir name uses work id + normalized slug', () => {
  assert.equal(worktreeDirName('W-12', 'my feature'), 'W-12-my-feature')
  assert.equal(worktreeDirName('W-12'), 'W-12')
  assert.equal(worktreeDirName('W/../x', 'A B'), 'W----x-a-b') // sanitized id
})

test('[worktree naming] branch is dsh/<work-id>', () => {
  assert.equal(worktreeBranch('W-12'), 'dsh/W-12')
})

test('[worktree naming] slugFrom normalizes and truncates', () => {
  assert.equal(slugFrom('  Add User API  '), 'add-user-api')
  assert.equal(slugFrom('x'.repeat(100)).length, 40)
})

// ---- validation ---- //

test('[worktree validation] rejects escapes and symlink escapes', () => {
  const base = mkdtempSync(join(tmpdir(), 'omd-wt-'))
  assert.throws(() => validateWorktreeSpec('../evil', base), /escapes/)
  assert.throws(() => validateWorktreeSpec('a/../../evil', base), /escapes/)
})

test('[worktree validation] accepts inside paths (relative & absolute)', () => {
  const base = mkdtempSync(join(tmpdir(), 'omd-wt-'))
  const ok = validateWorktreeSpec('./w1', base)
  assert.equal(ok, join(base, 'w1'))
  const abs = validateWorktreeSpec(join(base, 'w1'), base)
  assert.equal(abs, join(base, 'w1'))
  rmSync(base, { recursive: true, force: true })
})

test('[worktree validation] rejects unsafe names', () => {
  assert.throws(() => assertSafeWorkName('a/b'), /unsafe/)
  assert.throws(() => assertSafeWorkName('..'), /unsafe/)
  assert.doesNotThrow(() => assertSafeWorkName('w-12'))
})

test('[worktree validation] worktreePathFor joins under base', () => {
  const p = worktreePathFor('B', 'w1')
  assert.ok(p.includes('w1'))
})
