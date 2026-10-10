// dsh-enhance 插件激活实驱 —— dsh 真实会话 QA
//
// 用途：验证 dsh-enhance 插件在真实 dsh 会话中被激活并贡献其能力。
// 覆盖（架构第 8 节 dsh 实驱）：插件加载、work-rules 段、打包技能、doctor 工具。
//
// 运行方式（PowerShell）：
//   node qa/dsh-enhance-drive.mjs --dump    # 零成本：仅确认 bundle 合入 compose config
//   node qa/dsh-enhance-drive.mjs --llm     # 真实 headless（需 DEEPSEEK_API_KEY，消耗 token）
//
// 隔离纪律（架构 8.2/8.3）：脚本默认记录证据到 <cwd>/.dsh-enhance/evidence/。
// 目标**默认隔离优先**：只要仓库内的 `.dsh-enhance/desktop-test-home` 存在，就只碰它
// （profile `qa`）；要指向别处就显式给 `DSH_HOME`（+ 可选 `DSH_ENHANCE_PROFILE`）。
// 证据里标注本次实际使用的 profile 与 home，便于审计未污染真实环境。

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { preflight, resolveQaTarget } from './dsh-launch.mjs'

const ROOT = process.cwd()
// 目标解析：显式 env 优先，否则默认落到仓库内的隔离 QA home（真实 $DSH_HOME 不会被碰）。
const TARGET = resolveQaTarget()
const PROFILE = TARGET.profile
const evidenceDir = join(ROOT, '.dsh-enhance', 'evidence')

/**
 * 同步信号。用**正则**而不是字面串：headless 只打印模型的最终文本，模型复述
 * doctor 输出时会改写标点（实测遇到「插件已加载=是」），字面匹配会造成假失败。
 * 其中 `[advisor]` 是本插件运行时自己写进 stderr 的确定性痕迹——它命中即证明
 * 插件运行时真的在本会话里跑起来了，不依赖模型如何措辞。
 */
const SUBSTANTIVE_MARKERS = [
  { label: 'advisor 运行时 trace', re: /\[advisor\]/ },
  { label: 'doctor 已加载（中文）', re: /插件已加载\s*[：:=＝]\s*是/ },
  { label: 'doctor 已加载（英文）', re: /pluginLoaded\s*[:=]\s*true/i },
  { label: 'work-rules 段', re: /dsh-enhance\/work-rules/ },
  { label: 'doctor 工具', re: /dsh_enhance_doctor/ },
]
const SOFT_MARKERS = ['bundled', 'dsh-enhance']

const args = process.argv.slice(2)
const needsApp = args.includes('--llm')
const { cmd: DSH_CMD, prefix: DSH_PREFIX, env: DSH_ENV } = preflight(PROFILE, { requireApp: needsApp, dshHome: TARGET.home })

function runDsh (cmdArgs) {
  const res = spawnSync(DSH_CMD, [...DSH_PREFIX, ...cmdArgs], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...(DSH_ENV ?? {}), ...TARGET.env },
  })
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
    'You are in a diagnostic session. Report: (1) the names of the packaged skills available via the skill tool, and (2) whether the dsh-enhance prompt sections (work-rules, and enhance-mode if this session runs the Enhance preset) are present. Keep it under 5 lines. Run the doctor tool if it exists.'
  if (!process.env.DEEPSEEK_API_KEY && !process.env.PI_CREDENTIALS) {
    console.warn('未检测到 DEEPSEEK_API_KEY；实驱会失败或取默认凭据。')
  }
  const { stdout, stderr, status } = runDsh(['--profile', PROFILE, task])
  const out = stdout + stderr
  const substantive = SUBSTANTIVE_MARKERS.filter(m => m.re.test(out)).map(m => m.label)
  const soft = SOFT_MARKERS.filter(m => out.includes(m))
  const passed = status === 0 && substantive.length > 0
  writeEvidence(`llm-${fileSafe}`, [
    `# dsh-enhance LLM 实驱（--llm）`,
    `time: ${new Date().toISOString()}`,
    `profile: ${PROFILE} · DSH_HOME: ${TARGET.home}${TARGET.isolated ? '（隔离 QA home）' : '（真实 home）'}`,
    `dsh exit: ${status}`,
    `实质信号命中（至少 1 条即证明插件已装配并运行）：${substantive.join(', ') || '(无)'}`,
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
    `profile: ${PROFILE} · DSH_HOME: ${TARGET.home}${TARGET.isolated ? '（隔离 QA home）' : '（真实 home）'}`,
    `dsh exit: ${status}`,
    `bundle 层出现：${layer}`,
    '',
    '## 输出（节选）',
    out.split('\n').filter(l => /dsh-enhance|cordis\.patch/.test(l)).join('\n'),
    '',
  ].join('\n') + '\n')
  if (layer && status === 0) {
    console.log('OK：dsh-enhance bundle 已合入 compose。')
  } else {
    // 缺层时给可执行的排查方向：历史上这里只报"未发现层"，而真实原因是它跑在一个
    // 不含本插件的真实 profile 上——报错本身把人引向了错误结论。
    console.error([
      'FAIL：该 profile 的 compose 里没有 dsh-enhance 层。',
      `  实际使用：profile=${PROFILE} · DSH_HOME=${TARGET.home}${TARGET.isolated ? '（隔离 QA home）' : '（真实 home）'}`,
      '  排查顺序：',
      "    1) 该 profile 的 dsh.profile.bundles 是否含 '@p-jiangh/dsh-enhance'；",
      '    2) 该 profile 的 node_modules 里是否有它（link/junction 指向本仓库）；',
      "    3) 换目标：$env:DSH_HOME='<隔离 home>' ; $env:DSH_ENHANCE_PROFILE='qa'",
    ].join('\n'))
  }
  process.exitCode = layer && status === 0 ? 0 : 1
}
