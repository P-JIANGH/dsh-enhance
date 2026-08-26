// oh-my-dsh 插件激活实驱 —— dsh 真实会话 QA
//
// 用途：验证 oh-my-dsh 插件在真实 dsh 会话中被激活并贡献其能力。
// 覆盖（架构第 8 节 dsh 实驱）：插件加载、work-rules 段、打包技能、doctor 工具。
//
// 运行方式（PowerShell）：
//   node qa/omd-drive.mjs --dump    # 零成本：仅确认 bundle 合入 compose config
//   node qa/omd-drive.mjs --llm     # 真实 headless（需 DEEPSEEK_API_KEY，消耗 token）
//
// 隔离纪律（架构 8.2/8.3）：脚本默认记录证据到 <cwd>/.omd/evidence/，
// 并在输出中标注本次所用的 profile 与 $DSH_HOME，便于审计未污染真实环境。
// 依赖了一个已 link 到本仓库的 profile（package.json: "oh-my-dsh": "link:<repo>"）。

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const PROFILE = process.env.OMD_PROFILE ?? 'oh-my'
const evidenceDir = join(ROOT, '.omd', 'evidence')

const SYNC_MARKERS = ['pluginLoaded: true', 'work-rules', 'bundled', 'oh-my-dsh']

/**
 * Resolve how to launch dsh. Prefer running `@deepseek-ai/dsh/lib/bin.js` with
 * the current node (no shell trampoline, no DEP0190 warning) by locating dsh's
 * install dir via the PATH shim (`where`/`which`). Fall back to a raw command.
 * @returns {[string, string[]]}
 */
function resolveDsh () {
  if (process.env.DSH_BIN) return [process.env.DSH_BIN, []]
  const finder = process.platform === 'win32' ? 'where.exe' : 'which'
  const shimName = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const info = spawnSync(finder, [shimName], { encoding: 'utf8' })
  if (!info.error && info.status === 0 && info.stdout) {
    const shim = info.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean)
    if (shim) {
      const installDir = join(shim, '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (existsSync(installDir)) return [process.execPath, [installDir]]
    }
  }
  return [process.platform === 'win32' ? 'dsh.cmd' : 'dsh', []]
}

const [DSH_CMD, DSH_PREFIX] = resolveDsh()

function runDsh (args) {
  const res = spawnSync(DSH_CMD, [...DSH_PREFIX, ...args], { encoding: 'utf8', cwd: ROOT })
  if (res.error) {
    console.error(`dsh 启动失败：${res.error.message}`)
    process.exit(2)
  }
  return { stdout: res.stdout, stderr: res.stderr, status: res.status }
}

function writeEvidence(tag, content) {
  mkdirSync(evidenceDir, { recursive: true })
  const file = join(evidenceDir, `omd-drive-${tag}.md`)
  writeFileSync(file, content)
  console.log(`证据已记录：${file}`)
}

const args = process.argv.slice(2)
const fileSafe = Date.now()

if (args.includes('--llm')) {
  const task = args.slice(args.indexOf('--llm') + 1).join(' ') ||
    'You are in a diagnostic session. Report: (1) the names of the packaged skills available via the skill tool, and (2) whether the oh-my-dsh orientation said the bundle is active. Keep it under 5 lines. Run the doctor tool if it exists.'
  if (!process.env.DEEPSEEK_API_KEY && !process.env.PI_CREDENTIALS) {
    console.warn('未检测到 DEEPSEEK_API_KEY；实驱会失败或取默认凭据。')
  }
  const { stdout, stderr, status } = runDsh(['--profile', PROFILE, task])
  const out = stdout + stderr
  const hit = SYNC_MARKERS.filter(m => out.includes(m))
  writeEvidence(`llm-${fileSafe}`, [
    `# oh-my-dsh LLM 实驱（--llm）`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · DSH_HOME: ${process.env.DSH_HOME || '(default)'}`,
    `dsh exit: ${status}`,
    `同步信号命中的：${hit.join(', ') || '(无)'}`,
    '',
    '## 输出',
    out,
    '',
  ].join('\n') + '\n')
  console.log(out)
  process.exitCode = hit.length && status === 0 ? 0 : 1
} else {
  // 默认（零成本）：dump-config 确认 oh-my-dsh bundle 合入 compose。
  const { stdout, stderr, status } = runDsh(['--profile', PROFILE, '--dump-config'])
  const out = stdout + stderr
  const layer = /# == .*oh-my-dsh|cordis\.patch\.yml/.test(out)
  writeEvidence(`dump-${fileSafe}`, [
    `# oh-my-dsh bundle 合入检查（--dump）`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · DSH_HOME: ${process.env.DSH_HOME || '(default)'}`,
    `dsh exit: ${status}`,
    `bundle 层出现：${layer}`,
    '',
    '## 输出（节选）',
    out.split('\n').filter(l => /oh-my-dsh|cordis\.patch/.test(l)).join('\n'),
    '',
  ].join('\n') + '\n')
  console.log(layer && status === 0 ? 'OK：oh-my-dsh bundle 已合入 compose。' : 'WARN：未发现 oh-my-dsh 层。')
  process.exitCode = layer && status === 0 ? 0 : 1
}
