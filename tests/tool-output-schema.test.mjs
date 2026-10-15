// Verify the model-facing boulder/worktree tools declare a complete,
// lossless output.schema that (a) is a valid object-root JSON Schema in the
// dsh-tools enforced subset and (b) accepts the canonical value the tool's
// execute actually returns. This is the guard against the P1 defect where a
// tool returned a shape its `output.schema` could not hold, which the harness
// rejects as an invalid output.
//
// Goal tools are deliberately absent from this bundle: goals belong to the native
// `ctx.goals` service (docs/value-assessment.md §3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue, assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerBoulderTools } from '../lib/tools/boulder-tools.js'
import { registerWorktreeTools } from '../lib/tools/worktree-tools.js'
import { registerDoctorTool } from '../lib/tools/doctor.js'
import { boulderFileFor } from '../lib/features/boulder/store.js'

/** Capture every registered ToolDefinition in registration order. */
function capture(toolsFn) {
  const defs = []
  const ctx = {
    tools: {
      register(def) {
        defs.push(def)
        return () => { /* no-op disposer */ }
      },
    },
  }
  const dispose = toolsFn(ctx, true)
  return { defs, dispose }
}

/** A minimal exec-shaped object so pure execute paths that read cwd work. */
function fakeExec(cwd, extra = {}) {
  return {
    agent: { session: { header: { id: 'test-session', cwd } } },
    signal: { aborted: false },
    ...extra,
  }
}

/** Scratch repo root so boulder writes never land in the checkout. */
function tempCwd() {
  return mkdtempSync(join(tmpdir(), 'dsh-enhance-schema-'))
}

test('[tool-output-schema] boulder tools declare valid object-root schemas', () => {
  const { defs } = capture(registerBoulderTools)
  // Set equality, not registration order: adding/reordering rows must not fail the
  // test, but silently dropping or renaming a tool still must. A goal tool
  // reappearing here would re-introduce the duplicate goal API.
  assert.deepEqual(
    [...defs.map(d => d.name)].sort(),
    [...['boulder_start', 'boulder_status', 'boulder_complete']].sort(),
  )
  for (const def of defs) {
    // Must be a supported object-root JSON Schema (throws otherwise).
    assertObjectJsonSchema(def.output.schema)
    assert.equal(def.output.schema.additionalProperties, false, `${def.name}: closed object root`)
  }
})

test('[tool-output-schema] worktree tools declare valid object-root schemas', () => {
  const { defs } = capture(registerWorktreeTools)
  assert.deepEqual(
    [...defs.map(d => d.name)].sort(),
    [...['worktree_create', 'worktree_list', 'worktree_cleanup']].sort(),
  )
  for (const def of defs) {
    assertObjectJsonSchema(def.output.schema)
    assert.equal(def.output.schema.additionalProperties, false, `${def.name}: closed object root`)
  }
})

test('[tool-output-schema] doctor 工具输出覆盖真实报告形状（含 advisor 运行时状态）', async () => {
  // 触发原因（2026-10-15 实机）：advisor 静默失效无法自查。报告现在携带运行时状态，
  // 所以 schema 必须能装下它——否则工具会被宿主判为 invalid output。
  const defs = []
  const ctx = {
    tools: { register(def) { defs.push(def); return () => { /* no-op */ } } },
    skills: { list: async () => [{ name: 'tdd', source: 'bundled', provider: 'dsh-enhance' }] },
  }
  const dispose = registerDoctorTool(ctx, {
    config: { workRulesChars: 286, doctorTool: true, guards: true, workTracking: true, worktree: true, commands: true },
    enabled: true,
    humanCommands: ['doctor', 'boulder'],
    advisorStatus: () => ({
      enabled: true,
      reviews: 2,
      outcome: 'failed',
      detail: 'Request is missing x-opencode-session',
      route: 'opencode-go/deepseek-v4.1-flash',
      lastReviewAt: '2026-10-15T02:00:00.000Z',
    }),
  })
  try {
    assert.equal(defs.length, 1)
    const def = defs[0]
    assert.equal(def.name, 'dsh_enhance_doctor')
    assertObjectJsonSchema(def.output.schema)
    assert.equal(def.output.schema.additionalProperties, false, 'closed object root')

    const value = await def.execute({})
    const violations = validateJsonSchemaValue(def.output.schema, value)
    assert.deepEqual(violations, [], `doctor value validates: ${JSON.stringify(violations)}`)
    assert.equal(value.advisor.outcome, 'failed')
    assert.equal(value.advisor.reviews, 2)

    // 渲染面同样要把失败讲清楚（模型读到的就是这段文本）。
    const text = def.output.render({}, value).map(part => part.text).join('\n')
    assert.ok(text.includes('最近：调用失败'), `渲染应回显失败结局：\n${text}`)
    assert.ok(text.includes('x-opencode-session'), `渲染应回显失败原因：\n${text}`)

    // 负控制：schema 必须真的**拒绝**坏值，否则"schema 覆盖"只是自证
    // （宿主 dsh-tools 的值校验器确实递归进入嵌套对象，见其 json-schema.js 的 frame 栈）。
    const missingOutcome = { ...value, advisor: { ...value.advisor } }
    delete missingOutcome.advisor.outcome
    assert.notDeepEqual(
      validateJsonSchemaValue(def.output.schema, missingOutcome),
      [],
      '缺 advisor.outcome 必须被判违规',
    )
    assert.notDeepEqual(
      validateJsonSchemaValue(def.output.schema, { ...value, unexpected: 1 }),
      [],
      '多出未声明字段必须被判违规（additionalProperties: false）',
    )
  } finally {
    dispose()
  }
})

test('[tool-output-schema] boulder_status output covers a real read shape', async () => {
  const { defs } = capture(registerBoulderTools)
  const def = defs.find(d => d.name === 'boulder_status')
  const value = await def.execute({}, fakeExec(join(tmpdir(), 'dsh-enhance-status-cwd')))
  const violations = validateJsonSchemaValue(def.output.schema, value)
  assert.deepEqual(violations, [], `boulder_status value validates: ${JSON.stringify(violations)}`)
})

test('[tool-output-schema] boulder_start output covers a live upsert shape', async () => {
  const cwd = tempCwd()
  try {
    // A real manifest file so the §5.2.2-2 hash snapshot is non-empty.
    writeFileSync(join(cwd, 'protected.txt'), 'evidence')
    const { defs } = capture(registerBoulderTools)
    const def = defs.find(d => d.name === 'boulder_start')
    const value = await def.execute(
      { work_id: 'wt-schema-check', plan_name: 'x', protected_files: ['protected.txt'] },
      fakeExec(cwd),
    )
    const violations = validateJsonSchemaValue(def.output.schema, value)
    assert.deepEqual(violations, [], `boulder_start value validates: ${JSON.stringify(violations)}`)
    assert.match(
      String(value.active_work.protected_hashes['protected.txt']),
      /^[0-9a-f]{64}$/,
      '挂载时快照受保护文件的 sha256',
    )
    // The live write lands in the repo's .dsh-enhance/ state dir (architecture §5.5),
    // NOT at the repository root — the root must stay free of untracked store files.
    const boulderFile = boulderFileFor(cwd)
    assert.equal(existsSync(join(cwd, 'boulder.json')), false, '仓库根不得再出现 boulder.json')
    assert.equal(existsSync(boulderFile), true, 'boulder.json should be written under .dsh-enhance/')
    assert.ok(readFileSync(boulderFile, 'utf8').includes('wt-schema-check'), 'work id persisted')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
