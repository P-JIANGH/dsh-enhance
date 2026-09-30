// work-tracking + guards e2e driver: exercise boulder/goal tools and the
// path-traversal guard in a REAL dsh LLM session running inside a throwaway git
// repo (sandbox cwd). Sandboxed so boulder/goal land under .dsh-enhance/ there, not in
// the dsh-enhance checkout.
//
//   node qa/worktracking-drive.mjs        # runs one sandboxed LLM session
//
// Requires DEEPSEEK_API_KEY (or dsh credentials) and the `dsh-enhance` profile linked
// to this checkout. Consumes tokens.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { preflight, resolveQaTarget } from './dsh-launch.mjs'
import { boulderFileFor } from '../lib/features/boulder/store.js'
import { isPidAlive } from '../lib/features/boulder/write-token.js'

const ROOT = process.cwd()
// 目标解析：显式 env 优先，否则默认落到仓库内的隔离 QA home（真实 $DSH_HOME 不会被碰）。
const TARGET = resolveQaTarget()
const PROFILE = TARGET.profile
const evidenceDir = join(ROOT, '.dsh-enhance', 'evidence')

// 启动器解析 + profile 自检（缺 app bundle 的 profile 会静默不产出）。
const { cmd: D_CMD, prefix: D_PREFIX, env: D_ENV } = preflight(PROFILE, { dshHome: TARGET.home })
console.log(`[qa] 目标：profile=${PROFILE} · DSH_HOME=${TARGET.home}${TARGET.isolated ? '（隔离 QA home）' : '（真实 home）'}`)

function runDsh(cwd, task) {
  const res = spawnSync(D_CMD, [...D_PREFIX, '--profile', PROFILE, task], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, ...(D_ENV ?? {}), ...TARGET.env },
  })
  return { stdout: res.stdout, stderr: res.stderr, status: res.status, error: res.error }
}

const task = [
  'This is an acceptance test of the dsh-enhance work-tracking and guards.',
  'Do EXACTLY this sequence, no more:',
  '1) Call boulder_start with work_id="qa-e2e" and plan_name="E2E work tracking".',
  '2) Call goal_create with objective="Acceptance goal" and acceptance=["QAE2E_MARKER"].',
  '3) Call the write tool with file_path="../escape-QAE2E.txt" and content="x" ',
  '   — this deliberate path escape should be REJECTED by the path-traversal guard.',
  '4) Call the write tool with file_path="inside-ok.txt" and content="ok" ',
  '   — a legitimate in-workspace write that must SUCCEED (the write-token guard',
  '   must not block the session that owns the active work).',
  '5) Then boulder_status and goal_get, and report what you observed.',
  'Stop. Do not touch any other tool.',
].join(' ')

function main() {
  mkdirSync(evidenceDir, { recursive: true })
  // 1) throwaway git repo (so worktrees/boulder are scoped there)
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-enhance-e2e-'))
  spawnSync('git', ['init', '-q'], { cwd: sandbox, encoding: 'utf8' })

  // 2) run the real LLM session scoped to the sandbox cwd
  const res = runDsh(sandbox, task)

  const boulderFile = boulderFileFor(sandbox)
  const goalsDir = join(sandbox, '.dsh-enhance', 'goals')
  const worked = existsSync(boulderFile) && readText(boulderFile).includes('qa-e2e')
  // architecture §5.5：状态必须落在 .dsh-enhance/ 下；仓库根出现 boulder.json 就是污染用户的仓库。
  const rootPolluted = existsSync(join(sandbox, 'boulder.json'))
  let goalFound = false
  if (existsSync(goalsDir)) {
    for (const f of readdirSync(goalsDir)) {
      if (readText(join(goalsDir, f)).includes('QAE2E_MARKER')) goalFound = true
    }
  }
  const escaped = existsSync(join(sandbox, '..', 'escape-QAE2E.txt'))
  // 守卫是否真的被行使过：确认输出里出现守卫自己的拒绝文案。
  // 只有「模型确实尝试了越界写 + 被拒绝 + 文件没落盘」才算守卫通过；
  // 模型没尝试越界写时不算通过（否则 escape=false 会白送一个 PASS）。
  const guardExercised = /路径越界|已拒绝写入/.test(res.stdout || res.stderr || '')
  // §5.5.1 端到端：合法的工作区内写必须成功（写令牌门卫不能误伤持有者）……
  const insideOk = existsSync(join(sandbox, 'inside-ok.txt'))
  // ……而令牌不得被死进程一直占着：headless 退出不触发 agent/disposed，所以
  // 断言的是「记录的持有者 pid 已死 ⇒ 任何新会话可立即接管」，而不是「字段消失」。
  let tokenLive = false
  if (existsSync(boulderFile)) {
    try {
      const b = JSON.parse(readText(boulderFile))
      tokenLive = Boolean(b.exec_holder) && isPidAlive(b.exec_holder_pid)
    } catch { /* ignore */ }
  }
  const passed = Boolean(worked && goalFound && !escaped && guardExercised && insideOk && !tokenLive && !rootPolluted)

  const tag = `worktracking-${Date.now()}`
  const file = join(evidenceDir, `${tag}.md`)
  writeFileSync(file, [
    `# Work-tracking + guards e2e`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · cwd(sandbox): ${sandbox}`,
    `dsh exit: ${res.status}${res.error ? ' (' + res.error.message + ')' : ''}`,
    `boulder_start 落盘 (qa-e2e work): ${worked}`,
    `goal_create 落盘 (QAE2E_MARKER): ${goalFound}`,
    `path-traversal 守卫被行使（输出含拒绝文案）: ${guardExercised}`,
    `path-traversal write 的确逃逸到父目录 (escape-QAE2E.txt 存在): ${escaped}`,
    `§5.5.1 合法工作区内写成功 (inside-ok.txt 存在): ${insideOk}`,
    `§5.5.1 令牌未被活进程占用（死 pid 可立即接管）: ${!tokenLive}`,
    `§5.5 状态落在 .dsh-enhance/ 且仓库根未被污染 (根目录无 boulder.json): ${!rootPolluted}`,
    `结论: ${passed ? 'PASS（工作追踪落盘 + 守卫真实拦截越界写 + 写令牌纪律成立 + 仓库根干净）' : 'FAIL（见输出与轨迹）'}`,
    '',
    '## 会话输出（前 3000 字符）',
    (res.stdout || res.stderr).slice(0, 3000),
    '',
    '## boulder.json（若存在）',
    existsSync(boulderFile) ? readText(boulderFile).slice(0, 1500) : '(未生成)',
    '',
  ].join('\n') + '\n', 'utf8')

  console.log(`证据: ${file}`)
  console.log(`boulder_start: ${worked} | goal_create: ${goalFound} | 守卫被行使: ${guardExercised} | escape 落盘: ${escaped} | 合法写: ${insideOk} | 令牌被活进程占用: ${tokenLive} | 仓库根被污染: ${rootPolluted}`)
  console.log(`结论: ${passed ? 'PASS' : 'FAIL'}`)
  if (!passed) process.exitCode = 1

  // Cleanup sandbox (best-effort) but keep the evidence file in the repo.
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* ignore */ }
}

function readText(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

main()
