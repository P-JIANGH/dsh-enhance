// 人可见指令面单测：`/doctor` 与 `/boulder` 必须真的注册进上游指令注册表，
// 且输出是只读状态文本。
//
// 触发原因：实机上插件确实加载了（doctor 报「已加载=是」、3 个打包技能、守卫/工作
// 追踪/advisor 全开），但用户在 UI 里除了开场消息里的 `ulw` 之外感知不到任何属于
// 本包的入口——本包从不调用 `ctx.commands.register`。这条测试把「必须在 / 菜单里
// 可见」变成可回归的契约。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHumanCommands, COMMAND_NAMES, renderBoulderStatus } from '../lib/features/commands.js'
import { mutateBoulderState, upsertWork } from '../lib/features/boulder/store.js'
import { claimWriteToken } from '../lib/features/boulder/write-token.js'

/** 假 ctx：捕获注册的指令定义（重名即失败，对齐上游同层去重语义）。 */
function captureCtx (skills = []) {
  const defs = new Map()
  return {
    defs,
    skills: { list: async () => skills },
    commands: {
      register (def) {
        assert.equal(defs.has(def.name), false, `duplicate command name: ${def.name}`)
        defs.set(def.name, def)
        return () => defs.delete(def.name)
      },
    },
  }
}

/** 默认全开的 doctor 回显配置。 */
function fullDoctorConfig (overrides = {}) {
  return {
    workRulesChars: 286,
    orientOnSessionStart: true,
    doctorTool: true,
    guards: true,
    workTracking: true,
    worktree: true,
    commands: true,
    ...overrides,
  }
}

/** 假 agent：`/boulder` 从会话 cwd 解析仓库根。 */
function fakeAgent (cwd) {
  return { session: { header: { id: 's1', cwd } } }
}

/** 调一次指令 handler，返回 CommandResult。 */
async function invoke (def, agent, rawInput = '') {
  return await def.handler({ agent, rawInput, attachments: [], signal: { aborted: false } })
}

/** 注册并返回捕获到的定义表。 */
function registerAll (options = {}) {
  const ctx = captureCtx([{ name: 'tdd', source: 'bundled', provider: 'dsh-enhance' }])
  const dispose = registerHumanCommands(ctx, {
    enabled: true,
    workTracking: true,
    doctorConfig: fullDoctorConfig(),
    advisorEnabled: true,
    ...options,
  })
  return { ctx, dispose }
}

test('[commands] 人类指令面注册 /doctor、/boulder 与 /presets', () => {
  const { ctx, dispose } = registerAll()
  try {
    assert.deepEqual([...ctx.defs.keys()].sort(), [...COMMAND_NAMES].sort())
    for (const name of COMMAND_NAMES) {
      const def = ctx.defs.get(name)
      assert.equal(typeof def.description, 'string')
      assert.ok(def.description.length > 0, `${name} 必须有面向人的描述`)
      // 未声明 input 的指令按 execute 派发（回车即执行）；/presets 要子命令，
      // 因此声明 input（leadingInput），与上游 /goal 同一形态。
      if (name === 'presets') assert.equal(typeof def.input?.hint, 'string', 'presets 应声明 input hint')
      else assert.equal(def.input, undefined, `${name} 不应声明 input`)
    }
  } finally {
    dispose()
  }
})

test('[commands] /doctor 输出装配诊断并点名人类指令本身', async () => {
  const { ctx, dispose } = registerAll()
  try {
    const result = await invoke(ctx.defs.get('doctor'), fakeAgent('/repo'))
    assert.equal(result.kind, 'success')
    assert.match(result.text, /# dsh-enhance 诊断/)
    assert.match(result.text, /插件已加载：是/)
    assert.match(result.text, /本插件打包技能（1）：tdd/)
    assert.match(result.text, /人类指令=开/)
    // 用户直接看到自己能用什么：三条指令都被点名。
    assert.match(result.text, /人类指令（3）：\/doctor、\/boulder、\/presets/)
  } finally {
    dispose()
  }
})

test('[commands] /doctor 不受 doctorTool 开关影响（人可见诊断独立于模型工具）', async () => {
  const { ctx, dispose } = registerAll({ doctorConfig: fullDoctorConfig({ doctorTool: false }) })
  try {
    const result = await invoke(ctx.defs.get('doctor'), fakeAgent('/repo'))
    assert.equal(result.kind, 'success')
    assert.match(result.text, /doctor 工具=关/)
    assert.match(result.text, /# dsh-enhance 诊断/)
  } finally {
    dispose()
  }
})

test('[commands] /boulder 无状态时明确报无，并给出状态文件路径', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-enhance-cmd-'))
  try {
    const { ctx, dispose } = registerAll()
    try {
      const result = await invoke(ctx.defs.get('boulder'), fakeAgent(cwd))
      assert.equal(result.kind, 'success')
      assert.match(result.text, /# dsh-enhance 工作追踪/)
      assert.match(result.text, /写令牌持有者：无/)
      assert.match(result.text, /进行中的工作：无/)
      assert.match(result.text, /工作项：无/)
      assert.match(result.text, /\.dsh-enhance[\\/]boulder\.json/)
    } finally {
      dispose()
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('[commands] /boulder 报告令牌持有者与工作项（复用同一份存储）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-enhance-cmd-'))
  try {
    mutateBoulderState(cwd, (state) => {
      upsertWork(state, { id: 'w1', status: 'active', updated_at: 1700000000000, session_ids: ['s1'], verify: 'pnpm test' })
      state.active_work_id = 'w1'
    })
    assert.equal(claimWriteToken(cwd, 'holder-session'), true)

    const { ctx, dispose } = registerAll()
    try {
      const result = await invoke(ctx.defs.get('boulder'), fakeAgent(cwd))
      assert.match(result.text, /写令牌持有者：holder-session/)
      assert.match(result.text, /进行中的工作：w1/)
      assert.match(result.text, /工作项（1）：/)
      assert.match(result.text, /- w1 \[active\] verify=pnpm test 更新于 2023-11-14T22:13:20\.000Z/)
    } finally {
      dispose()
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('[commands] renderBoulderStatus 是纯渲染：不写状态文件', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-enhance-cmd-'))
  try {
    const text = renderBoulderStatus(cwd)
    assert.match(text, /工作项：无/)
    // 纯读：连 .dsh-enhance/ 都不应被创建。
    assert.equal(renderBoulderStatus(cwd), text, '同样输入应得到同样输出')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('[commands] workTracking 关闭时只注册 /doctor 与 /presets', () => {
  const { ctx, dispose } = registerAll({ workTracking: false })
  try {
    assert.deepEqual([...ctx.defs.keys()], ['doctor', 'presets'])
  } finally {
    dispose()
  }
})

test('[commands] enabled:false 一条都不注册，且 disposer 可安全调用', () => {
  const ctx = captureCtx()
  const dispose = registerHumanCommands(ctx, {
    enabled: false,
    workTracking: true,
    doctorConfig: fullDoctorConfig(),
    advisorEnabled: true,
  })
  assert.equal(ctx.defs.size, 0)
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('[commands] disposer 注销本次注册的每条指令', () => {
  const { ctx, dispose } = registerAll()
  assert.equal(ctx.defs.size, 3)
  dispose()
  assert.equal(ctx.defs.size, 0)
})

// ---- /presets：显式动作的预设装机（插件不在启动时写用户家目录） ----

/** 造一个临时预设源 + 目标根，供 /presets 单测注入。 */
function presetDirs () {
  const base = mkdtempSync(join(tmpdir(), 'dsh-enhance-presets-cmd-'))
  const source = join(base, 'src')
  mkdirSync(join(source, 'enhance'), { recursive: true })
  writeFileSync(join(source, 'enhance', 'agent.cordis.yml'), "- id: dsh-enhance\n  name: '@dsh-enhance/dsh-enhance'\n")
  writeFileSync(join(source, 'enhance', 'preset.yml'), 'name: Enhance 模式\n')
  return { base, source, target: join(base, 'target') }
}

test('[commands] /presets 默认报状态，指出来源、目标与未安装项', async () => {
  const { base, source, target } = presetDirs()
  try {
    const { ctx, dispose } = registerAll({ presetsSource: source, presetRoot: target })
    try {
      const result = await invoke(ctx.defs.get('presets'), fakeAgent('/repo'))
      assert.equal(result.kind, 'success')
      assert.match(result.text, /预设源：/)
      assert.match(result.text, /增强|预设目标：/)
      assert.match(result.text, /- enhance：未安装/)
      assert.match(result.text, /\/presets install/)
      assert.equal(existsSync(target), false, '只看状态不写盘')
    } finally {
      dispose()
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('[commands] /presets install 装机后可复判为最新（幂等，先备份）', async () => {
  const { base, source, target } = presetDirs()
  try {
    const { ctx, dispose } = registerAll({ presetsSource: source, presetRoot: target })
    try {
      const first = await invoke(ctx.defs.get('presets'), fakeAgent('/repo'), 'install')
      assert.equal(first.kind, 'success')
      assert.match(first.text, /完成：新增 1/)
      assert.equal(existsSync(join(target, 'enhance', 'preset.yml')), true)

      const second = await invoke(ctx.defs.get('presets'), fakeAgent('/repo'), 'install')
      assert.match(second.text, /已是最新 1/)
      assert.match(second.text, /完成：新增 0/)

      const status = await invoke(ctx.defs.get('presets'), fakeAgent('/repo'), 'status')
      assert.match(status.text, /- enhance：已是最新/)
    } finally {
      dispose()
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('[commands] /presets 未知子命令 → error 结果并给出用法', async () => {
  const { base, source, target } = presetDirs()
  try {
    const { ctx, dispose } = registerAll({ presetsSource: source, presetRoot: target })
    try {
      const result = await invoke(ctx.defs.get('presets'), fakeAgent('/repo'), 'nope')
      assert.equal(result.kind, 'error')
      assert.match(result.text, /用法：\/presets/)
    } finally {
      dispose()
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('[commands] /doctor 追加一行预设状态（用户不必猜装没装）', async () => {
  const { base, source, target } = presetDirs()
  try {
    const { ctx, dispose } = registerAll({ presetsSource: source, presetRoot: target })
    try {
      const before = await invoke(ctx.defs.get('doctor'), fakeAgent('/repo'))
      assert.match(before.text, /预设：1\/1 个未安装或已过期/)
      await invoke(ctx.defs.get('presets'), fakeAgent('/repo'), 'install')
      const after = await invoke(ctx.defs.get('doctor'), fakeAgent('/repo'))
      assert.match(after.text, /预设：1 个已就绪/)
    } finally {
      dispose()
    }
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
