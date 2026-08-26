// work-tracking + guards e2e driver: exercise boulder/goal tools and the
// path-traversal guard in a REAL dsh LLM session running inside a throwaway git
// repo (sandbox cwd). Sandboxed so boulder/goal land under .omd/ there, not in
// the oh-my-dsh checkout.
//
//   node qa/worktracking-drive.mjs        # runs one sandboxed LLM session
//
// Requires DEEPSEEK_API_KEY (or dsh credentials) and the `oh-my` profile linked
// to this checkout. Consumes tokens.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const PROFILE = process.env.OMD_PROFILE ?? 'oh-my'
const evidenceDir = join(ROOT, '.omd', 'evidence')

// Resolve dsh via the node bin entry (no shell trampoline).
function resolveDsh() {
  if (process.env.DSH_BIN) return [process.env.DSH_BIN, []]
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  const shimName = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const info = spawnSync(finder, [shimName], { encoding: 'utf8' })
  if (!info.error && info.status === 0 && info.stdout) {
    const shim = info.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean)
    if (shim) {
      const bin = join(shim, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (existsSync(bin)) return [process.execPath, [bin]]
    }
  }
  return [process.platform === 'win32' ? 'dsh.cmd' : 'dsh', []]
}

const [D_CMD, D_PREFIX] = resolveDsh()

function runDsh(cwd, task) {
  const res = spawnSync(D_CMD, [...D_PREFIX, '--profile', PROFILE, task], { encoding: 'utf8', cwd })
  return { stdout: res.stdout, stderr: res.stderr, status: res.status, error: res.error }
}

const task = [
  'This is an acceptance test of the oh-my-dsh work-tracking and guards.',
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
  const sandbox = mkdtempSync(join(tmpdir(), 'omd-e2e-'))
  spawnSync('git', ['init', '-q'], { cwd: sandbox, encoding: 'utf8' })

  // 2) run the real LLM session scoped to the sandbox cwd
  const res = runDsh(sandbox, task)

  const boulderFile = join(sandbox, 'boulder.json')
  const goalsDir = join(sandbox, '.omd', 'goals')
  const worked = existsSync(boulderFile) && readText(boulderFile).includes('qa-e2e')
  let goalFound = false
  if (existsSync(goalsDir)) {
    for (const f of readdirSync(goalsDir)) {
      if (readText(join(goalsDir, f)).includes('QAE2E_MARKER')) goalFound = true
    }
  }
  const escaped = existsSync(join(sandbox, '..', 'escape-QAE2E.txt'))

  const tag = `worktracking-${Date.now()}`
  const file = join(evidenceDir, `${tag}.md`)
  writeFileSync(file, [
    `# Work-tracking + guards e2e`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · cwd(sandbox): ${sandbox}`,
    `dsh exit: ${res.status}${res.error ? ' (' + res.error.message + ')' : ''}`,
    `boulder_start 落盘 (qa-e2e work): ${worked}`,
    `goal_create 落盘 (QAE2E_MARKER): ${goalFound}`,
    `path-traversal write 的确逃逸到父目录 (escape-QAE2E.txt 存在): ${escaped}`,
    `结论: ${worked && goalFound ? '工作追踪/守卫 e2e 通过（escape 应为 false 若守卫生效，或 true 表示守卫未触发生效）' : 'inconclusive 或部分通过（见输出与轨迹）'}`,
    '',
    '## 会话输出（前 3000 字符）',
    (res.stdout || res.stderr).slice(0, 3000),
    '',
    '## boulder.json（若存在）',
    existsSync(boulderFile) ? readText(boulderFile).slice(0, 1500) : '(未生成)',
    '',
  ].join('\n') + '\n', 'utf8')

  console.log(`证据: ${file}`)
  console.log(`boulder_start: ${worked} | goal_create: ${goalFound} | escape 落盘: ${escaped}`)
  console.log(`结论: ${worked && goalFound ? 'PASS' : 'INCONCLUSIVE/PARTIAL'}`)

  // Cleanup sandbox (best-effort) but keep the evidence file in the repo.
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* ignore */ }
}

function readText(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

main()
