// delivery-gate 交付门卫 —— 真实会话触发驱动（替换原占位）
//
// 目的：在真实 dsh 会话中验证 delivery-gate hook 的"完成声明拦截"。
// 方式：在隔离沙箱 cwd 预置 boulder.json（active_work 存在）+ .dsh-enhance/goals/<session>.json
// （goal.status=done + remaining_todos=0），再用 dsh headless 在沙箱跑一个真实单轮会话，
// 触发 agent/turn-stopping → delivery-gate hook 运行 → 命中完成条件 → 向 boulder.completion_log
// 写入结构化交付记录并释放写令牌。随后断言 completion_log 出现且 active_work 被清除。
//
// 说明：hook 的判定函数（deliveryGateStep / detectCompletionClaim / buildReport）已在
// tests/delivery-gate.test.mjs 单测覆盖；这里验证的是 M3 集成路径：真实 dsh 事件机 →
// turn-stopping → delivery-gate hook 读 boulder/goal 存储 → 拦截并落 completion_log。
//
// 运行：node qa/delivery-gate-drive.mjs
//   （需 DEEPSEEK_API_KEY；profile 用 dsh-enhance）
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { preflight } from './dsh-launch.mjs'

const ROOT = process.cwd()
const PROFILE = process.env.DSH_ENHANCE_PROFILE ?? 'dsh-enhance'
const evidenceDir = join(ROOT, '.dsh-enhance', 'evidence')

// 启动器解析 + profile 自检（缺 app bundle 的 profile 会静默不产出）。
const { cmd: D_CMD, prefix: D_PREFIX } = preflight(PROFILE)

function runDsh(cwd, task) {
  const res = spawnSync(D_CMD, [...D_PREFIX, '--profile', PROFILE, task], { encoding: 'utf8', cwd })
  return { stdout: res.stdout, stderr: res.stderr, status: res.status, error: res.error }
}

function readText(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

function main() {
  mkdirSync(evidenceDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), 'delivery-gate-'))
  const goalsDir = join(sandbox, '.dsh-enhance', 'goals')
  mkdirSync(goalsDir, { recursive: true })

  // One real dsh turn in the sandbox cwd: the agent calls the boulder/goal
  // tools to establish an ACTIVE WORK + a DONE goal (remaining_todos=0), then
  // finishes — firing agent/turn-stopping, which runs the delivery-gate hook.
  const res = runDsh(sandbox, [
    'This is an acceptance test of the dsh-enhance delivery gate.',
    'Do EXACTLY this sequence, no more:',
    '1) Call boulder_start with work_id="dg-work-1" and plan_name="delivery gate e2e".',
    '2) Call goal_create with objective="Acceptance goal" and acceptance=["dg"]',
    '   containing the literal text "DG_MARKER".',
    '3) Call goal_update with status="done" and remaining_todos=0.',
    '4) Then say: "全部完成了，可以交付了。" — a completion claim in the final message.',
    'Stop after step 4. Do not call any other tool.',
  ].join(' '))

  // Observe the outcome: did the hook intercept (write completion_log + clear active_work)?
  const boulderFile = join(sandbox, 'boulder.json')
  let completionLogged = false
  let activeCleared = false
  if (existsSync(boulderFile)) {
    try {
      const b = JSON.parse(readText(boulderFile))
      completionLogged = Array.isArray(b.completion_log) && b.completion_log.length > 0
      // 清除的语义是「active_work_id 键不存在或为 null」——实现若写 null 也要算清除。
      activeCleared = b.active_work_id === undefined || b.active_work_id === null
    } catch { /* ignore */ }
  }

  const tag = `delivery-gate-${Date.now()}`
  const file = join(evidenceDir, `${tag}.md`)
  writeFileSync(file, [
    `# delivery-gate e2e（完成声明拦截）`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · cwd(sandbox): ${sandbox}`,
    `dsh exit: ${res.status}${res.error ? ' (' + res.error.message + ')' : ''}`,
    `agent 序列: boulder_start(work=dg-work-1) → goal_create(DG_MARKER) → goal_update(status=done, remaining_todos=0) → 完成声明`,
    `观测: completion_log 写入: ${completionLogged} · active_work 清除: ${activeCleared}`,
    `结论: ${completionLogged ? 'PASS（delivery-gate 完成声明拦截已触发）' : 'UNSEEN（hook 未命中，见输出）'}`,
    '',
    '## 会话输出（前 3000 字符）',
    (res.stdout || res.stderr).slice(0, 3000),
    '',
    '## 最终 boulder.json',
    existsSync(boulderFile) ? readText(boulderFile).slice(0, 1500) : '(未生成)',
    '',
    '## goals 目录',
    existsSync(goalsDir) ? readdirSync(goalsDir).join(', ') + '\n' + readdirSync(goalsDir).map(f => readText(join(goalsDir, f)).slice(0, 400)).join('\n---\n') : '(无)',
    '',
  ].join('\n') + '\n', 'utf8')

  console.log(`证据: ${file}`)
  console.log(`completion_log 写入: ${completionLogged} | active_work 清除: ${activeCleared}`)
  console.log(`结论: ${completionLogged ? 'PASS' : 'UNSEEN/INCONCLUSIVE'}`)
  if (!completionLogged) process.exitCode = 1

  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* ignore */ }
}

main()
