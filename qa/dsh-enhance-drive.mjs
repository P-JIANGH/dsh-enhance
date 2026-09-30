// dsh-enhance 插件激活实驱 —— dsh 真实会话 QA
//
// 用途：验证 dsh-enhance 插件在真实 dsh 会话中被激活并贡献其能力。
// 覆盖（架构第 8 节 dsh 实驱）：插件加载、work-rules 段、打包技能、doctor 工具。
//
// 运行方式（PowerShell）：
//   node qa/dsh-enhance-drive.mjs --dump    # 零成本：仅确认 bundle 合入 compose config
//   node qa/dsh-enhance-drive.mjs --llm     # 真实 headless（需 DEEPSEEK_API_KEY，消耗 token）
//
// 隔离纪律（架构 8.2/8.3）：脚本默认记录证据到 <cwd>/.dsh-enhance/evidence/，
// 并在输出中标注本次所用的 profile 与 $DSH_HOME，便于审计未污染真实环境。
// 依赖了一个已 link 到本仓库的 profile（package.json: "dsh-enhance": "link:<repo>"）。

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { preflight } from './dsh-launch.mjs'

const ROOT = process.cwd()
const PROFILE = process.env.DSH_ENHANCE_PROFILE ?? 'dsh-enhance'
const evidenceDir = join(ROOT, '.dsh-enhance', 'evidence')

/**
 * 同步信号。doctor 报告自 M2 起为中文渲染（「插件已加载：是」），英文 key=value
 * 已不再出现；这里同时接受中英文，避免标记集随文案中文化而失效。
 * 判定要求：至少命中一条「实质」信号（证明插件真的装配），再叠加软信号计数。
 */
const SUBSTANTIVE_MARKERS = ['插件已加载：是', 'pluginLoaded: true', 'dsh-enhance/work-rules']
const SOFT_MARKERS = ['bundled', 'dsh-enhance']

const args = process.argv.slice(2)
const needsApp = args.includes('--llm')
const { cmd: DSH_CMD, prefix: DSH_PREFIX } = preflight(PROFILE, { requireApp: needsApp })

function runDsh (cmdArgs) {
  const res = spawnSync(DSH_CMD, [...DSH_PREFIX, ...cmdArgs], { encoding: 'utf8', cwd: ROOT })
  if (res.error) {
    console.error(`dsh 启动失败：${res.error.message}`)
    process.exit(2)
  }
  return { stdout: res.stdout, stderr: res.stderr, status: res.status }
}

function writeEvidence(tag, content) {
  mkdirSync(evidenceDir, { recursive: true })
  const file = join(evidenceDir, `dsh-enhance-drive-${tag}.md`)
  writeFileSync(file, content)
  console.log(`证据已记录：${file}`)
}

const fileSafe = Date.now()

if (args.includes('--llm')) {
  const task = args.slice(args.indexOf('--llm') + 1).join(' ') ||
    'You are in a diagnostic session. Report: (1) the names of the packaged skills available via the skill tool, and (2) whether the dsh-enhance orientation said the bundle is active. Keep it under 5 lines. Run the doctor tool if it exists.'
  if (!process.env.DEEPSEEK_API_KEY && !process.env.PI_CREDENTIALS) {
    console.warn('未检测到 DEEPSEEK_API_KEY；实驱会失败或取默认凭据。')
  }
  const { stdout, stderr, status } = runDsh(['--profile', PROFILE, task])
  const out = stdout + stderr
  const substantive = SUBSTANTIVE_MARKERS.filter(m => out.includes(m))
  const soft = SOFT_MARKERS.filter(m => out.includes(m))
  const passed = status === 0 && substantive.length > 0
  writeEvidence(`llm-${fileSafe}`, [
    `# dsh-enhance LLM 实驱（--llm）`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · DSH_HOME: ${process.env.DSH_HOME || '(default)'}`,
    `dsh exit: ${status}`,
    `实质信号命中（至少 1 条即证明插件已装配）：${substantive.join(', ') || '(无)'}`,
    `辅助信号：${soft.join(', ') || '(无)'}`,
    `结论：${passed ? 'PASS' : 'FAIL'}`,
    '',
    '## 输出',
    out,
    '',
  ].join('\n') + '\n')
  console.log(out)
  process.exitCode = passed ? 0 : 1
} else {
  // 默认（零成本）：dump-config 确认 dsh-enhance bundle 合入 compose。
  const { stdout, stderr, status } = runDsh(['--profile', PROFILE, '--dump-config'])
  const out = stdout + stderr
  const layer = /# == .*dsh-enhance|cordis\.patch\.yml/.test(out)
  writeEvidence(`dump-${fileSafe}`, [
    `# dsh-enhance bundle 合入检查（--dump）`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · DSH_HOME: ${process.env.DSH_HOME || '(default)'}`,
    `dsh exit: ${status}`,
    `bundle 层出现：${layer}`,
    '',
    '## 输出（节选）',
    out.split('\n').filter(l => /dsh-enhance|cordis\.patch/.test(l)).join('\n'),
    '',
  ].join('\n') + '\n')
  console.log(layer && status === 0 ? 'OK：dsh-enhance bundle 已合入 compose。' : 'WARN：未发现 dsh-enhance 层。')
  process.exitCode = layer && status === 0 ? 0 : 1
}
