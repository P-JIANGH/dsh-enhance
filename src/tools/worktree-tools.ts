/**
 * Model-facing worktree tools (architecture §5.3/§5.6): worktree_create /
 * worktree_list / worktree_cleanup over the WorktreeManager, gated by the
 * workTracking (boulder) switch since linkage lives in boulder work records.
 *
 * Authored as raw {@link ToolDefinition}s so `output.schema` covers the lossless
 * values actually returned (the harness rejects tools whose declared schema
 * does not cover the canonical output).
 * @module dsh-enhance/tools/worktree-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { createGitRunner } from '../features/worktree/git-runner.js'
import { createWorktreeManager } from '../features/worktree/manager.js'
import { getWorktreePath } from '../features/worktree/boulder-link.js'

/** Resolve the session repo root (cwd) and worktree base. */
function storeOf(exec: ToolExecution): { root: string; base: string } {
  const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
  const base = cwd // worktrees sit beside the session repo by default
  return { root: cwd, base }
}

/** Output schema for one parsed git worktree entry (mirrors {@link GitWorktree}). */
const WORKTREE_ENTRY_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    head: { type: 'string' },
    branch: { type: 'string' },
    detached: { type: 'boolean' },
  },
  required: ['path', 'detached'],
  additionalProperties: false,
}

/** Compact object-root output helper for this module. */
function objectOutput(schema: Record<string, JsonSchemaNode>, required: string[]): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: schema as Record<string, JsonSchemaNode>,
      required,
      additionalProperties: false,
    },
    render: (_args, value) => {
      const lines = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        : [JSON.stringify(value)]
      return [{ type: 'text', text: lines.join('\n') }]
    },
  }
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

  const create: ToolDefinition = {
    name: 'worktree_create',
    description: '为一项 boulder 工作创建独立的 git worktree，并注册其路径到该项工作。',
    parameters: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        slug: { type: 'string' },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
    output: objectOutput({ ok: { type: 'boolean' }, work_id: { type: 'string' }, path: { type: 'string' } }, ['ok', 'work_id', 'path']),
    async execute(args, exec) {
      const a = args as { work_id: string; slug?: string }
      const { root, base } = storeOf(exec)
      const workId = String(a.work_id)
      const mgr = createWorktreeManager(root, git)
      const path = await mgr.create(root, { workId, slug: a.slug, baseDir: base })
      return { ok: true, work_id: workId, path }
    },
  }
  d.push(ctx.tools.register(create))

  const list: ToolDefinition = {
    name: 'worktree_list',
    description: '列出当前仓库中的 git worktree。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: objectOutput({ worktrees: { type: 'array', items: WORKTREE_ENTRY_SCHEMA } }, ['worktrees']),
    async execute(_args, exec) {
      const { root } = storeOf(exec)
      const mgr = createWorktreeManager(root, git)
      const entries = await mgr.list(root)
      return { worktrees: entries }
    },
  }
  d.push(ctx.tools.register(list))

  const cleanup: ToolDefinition = {
    name: 'worktree_cleanup',
    description: '移除一项工作的 git worktree，并清除 boulder 中记录的 worktree_path。',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' } },
      required: ['work_id'],
      additionalProperties: false,
    },
    output: objectOutput({ ok: { type: 'boolean' }, work_id: { type: 'string' }, error: { type: 'string' } }, ['ok']),
    async execute(args, exec) {
      const a = args as { work_id: string }
      const { root } = storeOf(exec)
      const workId = String(a.work_id)
      const registered = getWorktreePath(root, workId)
      if (!registered) return { ok: false, error: '没有为该工作注册 worktree，请先用 worktree_create 创建' }
      const mgr = createWorktreeManager(root, git)
      await mgr.cleanup(root, workId, registered)
      return { ok: true, work_id: workId }
    },
  }
  d.push(ctx.tools.register(cleanup))

  return () => { for (const fn of d) fn() }
}
