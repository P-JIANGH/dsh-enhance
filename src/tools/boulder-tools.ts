/**
 * Model-facing boulder tools (architecture §5.3/§5.5). Reads/writes are thin
 * wrappers over the shared store so the CAS/atomic guarantees hold. Only
 * registered when workTracking is enabled.
 *
 * Goals are deliberately **not** here: they belong to the native `ctx.goals`
 * service (`create_goal` / `get_goal` / `update_goal`, driven by
 * `dsh-goal-round-driver`). Duplicating that API on this tool plane produced two
 * near-identical goal vocabularies over two different stores — see
 * `docs/value-assessment.md` §3.
 *
 * These tools are authored as raw {@link ToolDefinition}s (not `defineTool`) so
 * their `output.schema` can carry the enforced JSON-Schema subset with object
 * roots, `required` arrays, and `oneOf` unions — matching the lossless values
 * `execute` actually returns (the harness rejects tools whose declared schema
 * does not cover the canonical output).
 * @module dsh-enhance/tools/boulder-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode, ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { readBoulder, mutateBoulderState, upsertWork, type BoulderState } from '../features/boulder/store.js'
import { releaseWriteToken, readWriteToken } from '../features/boulder/write-token.js'
import { hashFiles } from '../features/delivery-gate/index.js'

/** Output schema for one boulder work record (mirrors {@link BoulderWork}). */
const WORK_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    plan_name: { type: 'string' },
    status: { type: 'string', enum: ['planned', 'active', 'blocked', 'completed'] },
    worktree_path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    goal_id: { type: 'string' },
    verify: { type: 'string' },
    protected_files: { type: 'array', items: { type: 'string' } },
    protected_hashes: { type: 'object' },
    updated_at: { type: 'integer' },
    session_ids: { type: 'array', items: { type: 'string' } },
    task_sessions: { type: 'array', items: { type: 'string' } },
    session_origins: { type: 'object' },
  },
  required: ['id', 'status', 'updated_at', 'session_ids'],
  additionalProperties: false,
}

/** Compact object-root output helper: `{ok:true}`-style simple results. */
function objectOutput(schema: Record<string, JsonSchemaNode>, required: string[]): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: schema as Record<string, JsonSchemaNode>,
      required,
      additionalProperties: false,
    },
    // Render the canonical result as readable text so the model sees it.
    render: (_args, value) => {
      const lines = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        : [JSON.stringify(value)]
      return [{ type: 'text', text: lines.join('\n') }]
    },
  }
}

/**
 * Resolve the session's boulder store root. Prefers `agent.session.header.cwd`
 * (the session's repo root) so boulder.json is written per-project; falls back
 * to process cwd when no session context is present.
 */
export function repoBaseOf(exec: ToolExecution): string {
  return exec.agent?.session?.header?.cwd ?? process.cwd()
}

/** Session id for write-token scoping (the session header id, or a key fallback). */
function sessionKey(exec: ToolExecution): string {
  return String(exec.agent?.session?.header?.id ?? 'session')
}

/**
 * Register the boulder + goal tools.
 * @param ctx - context with the `tools` registry.
 * @param enabled - whether to register (guards the workTracking switch).
 * @returns the exact disposer.
 */
export function registerBoulderTools(ctx: Context, enabled: boolean): () => void {
  if (!enabled) return () => {}
  const d: Array<() => void> = []

  const start: ToolDefinition = {
    name: 'boulder_start',
    description: '开始或更新一项受追踪的工作（boulder）。记录计划名、状态、一个新会话或已有会话、可选的 goal id、可执行 verify 脚本（交付门卫用它判定是否达标），以及受保护文件清单（交付门卫在交付时比对其 sha256，防止改动证据文件）。',
    parameters: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        plan_name: { type: 'string' },
        goal_id: { type: 'string' },
        verify: { type: 'string' },
        protected_files: { type: 'array', items: { type: 'string' } },
      },
      required: ['work_id'],
      additionalProperties: false,
    },
    output: objectOutput({ ok: { type: 'boolean' }, active_work: WORK_SCHEMA }, ['ok', 'active_work']),
    async execute(args, exec) {
      const a = args as {
        work_id: string
        plan_name?: string
        goal_id?: string
        verify?: string
        protected_files?: string[]
      }
      const base = repoBaseOf(exec)
      const session = sessionKey(exec)
      // §5.2.2-2: the manifest is mounted here — snapshot its hashes now, so the
      // gate compares against the state the work started from, not against itself.
      const protectedFiles = Array.isArray(a.protected_files) ? a.protected_files.map(String) : undefined
      const protectedHashes = protectedFiles && protectedFiles.length > 0
        ? await hashFiles(protectedFiles, base)
        : undefined
      mutateBoulderState(base, (s: BoulderState) => {
        upsertWork(s, {
          id: String(a.work_id),
          plan_name: a.plan_name,
          status: 'active',
          goal_id: a.goal_id,
          verify: a.verify,
          protected_files: protectedFiles,
          protected_hashes: protectedHashes,
          updated_at: Date.now(),
          session_ids: [session],
        })
        s.active_work_id = String(a.work_id)
      })
      const { state } = readBoulder(base)
      return { ok: true, active_work: state.works[String(a.work_id)] as unknown as JsonValue }
    },
  }
  d.push(ctx.tools.register(start))

  const status: ToolDefinition = {
    name: 'boulder_status',
    description: '报告当前 boulder 状态：写令牌持有者与进行中的工作项。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: objectOutput({
      exec_holder: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      active_work_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      works: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['planned', 'active', 'blocked', 'completed'] },
            updated_at: { type: 'integer' },
          },
          required: ['id', 'status', 'updated_at'],
          additionalProperties: false,
        },
      },
    }, ['exec_holder', 'active_work_id', 'works']),
    async execute(_args, exec) {
      const base = repoBaseOf(exec)
      const { state } = readBoulder(base)
      const holder = readWriteToken(state)
      return {
        exec_holder: holder ?? null,
        active_work_id: state.active_work_id ?? null,
        works: Object.values(state.works).map(w => ({ id: w.id, status: w.status, updated_at: w.updated_at })),
      }
    },
  }
  d.push(ctx.tools.register(status))

  const complete: ToolDefinition = {
    name: 'boulder_complete',
    description: '将一项工作标记为已完成，并释放本会话的写令牌。',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' } },
      required: ['work_id'],
      additionalProperties: false,
    },
    output: objectOutput({ ok: { type: 'boolean' } }, ['ok']),
    async execute(args, exec) {
      const a = args as { work_id: string }
      const base = repoBaseOf(exec)
      const session = sessionKey(exec)
      mutateBoulderState(base, (s: BoulderState) => {
        upsertWork(s, { id: String(a.work_id), status: 'completed', updated_at: Date.now(), session_ids: [session] })
      })
      releaseWriteToken(base, session)
      return { ok: true }
    },
  }
  d.push(ctx.tools.register(complete))

  return () => { for (const fn of d) fn() }
}
