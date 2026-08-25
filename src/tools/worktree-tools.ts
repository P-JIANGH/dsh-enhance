/**
 * Model-facing worktree tools (architecture §5.3/§5.6): worktree_create /
 * worktree_list / worktree_cleanup over the WorktreeManager, gated by the
 * workTracking (boulder) switch since linkage lives in boulder work records.
 *
 * @module oh-my-dsh/tools/worktree-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import { createGitRunner } from '../features/worktree/git-runner.js'
import { createWorktreeManager } from '../features/worktree/manager.js'
import { getWorktreePath } from '../features/worktree/boulder-link.js'

/** Resolve the session repo root (cwd) and worktree base. */
function storeOf(exec: ToolExecution): { root: string; base: string } {
  const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
  const base = cwd // worktrees sit beside the session repo by default
  return { root: cwd, base }
}

/**
 * Register worktree tools.
 * @param ctx - context with `tools`.
 * @param enabled - gates on workTracking (boulder dependency).
 * @returns disposer.
 */
export function registerWorktreeTools(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  const git = createGitRunner()
  const d: Array<() => void> = []

  d.push(ctx.tools.register(defineTool({
    name: 'worktree_create',
    description: 'Create a detached git worktree for a boulder work and register its path on the work.',
    parameters: {
      work_id: { type: 'string', required: true },
      slug: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(args, exec) {
      const { root, base } = storeOf(exec)
      const workId = String(args.work_id)
      const mgr = createWorktreeManager(root, git)
      const path = await mgr.create(root, { workId, slug: args.slug, baseDir: base })
      return { ok: true, work_id: workId, path }
    },
  })))

  d.push(ctx.tools.register(defineTool({
    name: 'worktree_list',
    description: 'List git worktrees in the session repository.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(_args, exec) {
      const { root } = storeOf(exec)
      const mgr = createWorktreeManager(root, git)
      const entries = await mgr.list(root)
      return { worktrees: entries }
    },
  })))

  d.push(ctx.tools.register(defineTool({
    name: 'worktree_cleanup',
    description: 'Remove a work\u2019s git worktree and clear its boulder worktree_path.',
    parameters: { work_id: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute(args, exec) {
      const { root } = storeOf(exec)
      const workId = String(args.work_id)
      const registered = getWorktreePath(root, workId)
      if (!registered) return { ok: false, error: 'no registered worktree for this work' }
      const mgr = createWorktreeManager(root, git)
      await mgr.cleanup(root, workId, registered)
      return { ok: true, work_id: workId }
    },
  })))

  return () => { for (const fn of d) fn() }
}
