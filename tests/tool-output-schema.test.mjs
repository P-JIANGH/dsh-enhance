// Verify the model-facing boulder/goal/worktree tools declare a complete,
// lossless output.schema that (a) is a valid object-root JSON Schema in the
// dsh-tools enforced subset and (b) accepts the canonical value the tool's
// execute actually returns. This is the guard against the P1 defect where a
// tool returned a shape its `output.schema` could not hold, which the harness
// rejects as an invalid output.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateJsonSchemaValue, assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerBoulderTools } from '../lib/tools/boulder-tools.js'
import { registerWorktreeTools } from '../lib/tools/worktree-tools.js'

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
  return mkdtempSync(join(tmpdir(), 'omd-schema-'))
}

test('[tool-output-schema] boulder/goal tools declare valid object-root schemas', () => {
  const { defs } = capture(registerBoulderTools)
  assert.deepEqual(defs.map(d => d.name), [
    'boulder_start', 'boulder_status', 'boulder_complete',
    'goal_create', 'goal_get', 'goal_update',
  ])
  for (const def of defs) {
    // Must be a supported object-root JSON Schema (throws otherwise).
    assertObjectJsonSchema(def.output.schema)
    assert.equal(def.output.schema.additionalProperties, false, `${def.name}: closed object root`)
  }
})

test('[tool-output-schema] worktree tools declare valid object-root schemas', () => {
  const { defs } = capture(registerWorktreeTools)
  assert.deepEqual(defs.map(d => d.name), ['worktree_create', 'worktree_list', 'worktree_cleanup'])
  for (const def of defs) {
    assertObjectJsonSchema(def.output.schema)
    assert.equal(def.output.schema.additionalProperties, false, `${def.name}: closed object root`)
  }
})

test('[tool-output-schema] boulder_status output covers a real read shape', async () => {
  const { defs } = capture(registerBoulderTools)
  const def = defs.find(d => d.name === 'boulder_status')
  const value = await def.execute({}, fakeExec(join(tmpdir(), 'omd-status-cwd')))
  const violations = validateJsonSchemaValue(def.output.schema, value)
  assert.deepEqual(violations, [], `boulder_status value validates: ${JSON.stringify(violations)}`)
})

test('[tool-output-schema] boulder_start output covers a live upsert shape', async () => {
  const cwd = tempCwd()
  try {
    const { defs } = capture(registerBoulderTools)
    const def = defs.find(d => d.name === 'boulder_start')
    const value = await def.execute({ work_id: 'wt-schema-check', plan_name: 'x' }, fakeExec(cwd))
    const violations = validateJsonSchemaValue(def.output.schema, value)
    assert.deepEqual(violations, [], `boulder_start value validates: ${JSON.stringify(violations)}`)
    // The live write lands in boulder.json at the session repo root.
    const boulderFile = join(cwd, 'boulder.json')
    assert.equal(existsSync(boulderFile), true, 'boulder.json should be written')
    assert.ok(readFileSync(boulderFile, 'utf8').includes('wt-schema-check'), 'work id persisted')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
