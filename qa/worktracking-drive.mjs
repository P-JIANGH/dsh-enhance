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

const task = [
  'This is an acceptance test of the dsh-enhance work-tracking and guards.',
  'Do EXACTLY this sequence, no more:',
  '1) Call boulder_start with work_id="qa-e2e" and plan_name="E2E work tracking".',
  '2) Call goal_create with objective="Acceptance goal" and acceptance=["a"] ',
  '   containing the literal text "QAE2E_MARKER".',
  '3) Call the write tool with file_path="../escape-QAE2E.txt" and content="x" ',
  '   — this deliberate path escape should be REJECTED by the path-traversal guard.',
  '4) Then boulder_status and goal_get, and report what you observed.',
  'Stop. Do not touch any other tool.',
].join(' ')

function main() {
  mkdirSync(evidenceDir, { recursive: true })
  // 1) throwaway git repo (so worktrees/boulder are scoped there)
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-enhance-e2e-'))
  spawnSync('git', ['init', '-q'], { cwd: sandbox, encoding: 'utf8' })

  // 2) run the real LLM session scoped to the sandbox cwd
  const res = runDsh(sandbox, task)

  const boulderFile = join(sandbox, 'boulder.json')
  const goalsDir = join(sandbox, '.dsh-enhance', 'goals')
  const worked = existsSync(boulderFile) && readText(boulderFile).includes('qa-e2e')
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
  const passed = Boolean(worked && goalFound && !escaped && guardExercised)

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
    `结论: ${passed ? 'PASS（工作追踪落盘 + 守卫真实拦截越界写）' : 'FAIL（见输出与轨迹）'}`,
    '',
    '## 会话输出（前 3000 字符）',
    (res.stdout || res.stderr).slice(0, 3000),
    '',
    '## boulder.json（若存在）',
    existsSync(boulderFile) ? readText(boulderFile).slice(0, 1500) : '(未生成)',
    '',
  ].join('\n') + '\n', 'utf8')

  console.log(`证据: ${file}`)
  console.log(`boulder_start: ${worked} | goal_create: ${goalFound} | 守卫被行使: ${guardExercised} | escape 落盘: ${escaped}`)
  console.log(`结论: ${passed ? 'PASS' : 'FAIL'}`)
  if (!passed) process.exitCode = 1

  // Cleanup sandbox (best-effort) but keep the evidence file in the repo.
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* ignore */ }
}

function readText(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

main()
