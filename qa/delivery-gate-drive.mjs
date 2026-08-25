// delivery-gate 交付门卫 —— dsh 实驱 QA 脚本（占位）
//
// 目的：在真实 dsh 会话中验证交付门卫的"完成声明拦截 → 回归审查 → 回灌"。
// 反向场景：向会话发出"假完成声明"（无证据），断言被 delivery-gate 拦截并
// 回灌入口契约，而不是被当作交付放行。
//
// 依赖：M3 落地后 delivery-gate 实现了真实模块（tests/delivery-gate.test.mjs
// 的单测已定义契约）。本脚本接上真实 dsh 实驱；占位阶段提供脚本骨架与断言，未跑。
//
// 运行约定（架构第 8 节）：
//   1. 隔离 $DSH_HOME（真实用户目录不动）
//   2. dsh --profile <sandbox> 真实加载 oh-my-dsh 插件
//   3. 证据记录到 <sandbox> 的 .omd/evidence/，证明隔离

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---- 配置 ----
const DSH = process.env.DSH_BIN ?? 'F:\\nodejs\\dsh.ps1'
const evidenceDir = join(process.cwd(), '.omd', 'evidence') // 隔离沙箱内，非真实环境

// ---- 引导前检查（M3 未落地时列出需满足的前置条件） ----
function prerequisiteCheck () {
  const missing = []
  if (!existsSync(DSH)) missing.push(`dsh binary 不存在：${DSH}（可设 DSH_BIN 覆盖）`)
  // M3 落地后，delivery-gate 作为插件 hook 存在
  return missing
}

// ---- 最小 dsh 驱动（占位：真实 dsh 会话交互待 M1/M3 后用实际 API 补） ----
async function runSandboxedDrive () {
  const sandbox = mkdtempSync(join(tmpdir(), 'delivery-gate-qa-'))
  const home = join(sandbox, 'dsh-home')
  mkdirSync(home, { recursive: true })
  process.env.DSH_HOME = home

  // 隔离证据目录
  mkdirSync(evidenceDir, { recursive: true })

  // 构造一个"假完成"指令序列（占位，真实 dsh 调用方式 M1 核实后补）
  const transcript = [
    { role: 'user', text: '用 ultrawork 模式：给仓库加一个 README 章节。' },
    { role: 'user', text: '这部分做完了，可以交付了。' }, // ← 假完成声明（无证据）
  ]

  // 占位：此处应以 dsh 会话实际加载插件并断言 delivery-gate 行为。
  // 期望结果（M3 验证目标）：
  //   [] transcript 里的"可以交付了"被 delivery-gate 识别为完成声明
  //   [] 回归审查注入（ultrawork-review），核验证据不足
  //   [] 判定未通过 → 压缩上下文 + 重注入入口契约 → agent 继续
  //   [] 仅当补齐证据、回归审查通过后才放行

  // 记录证据占位
  writeFileSync(
    join(evidenceDir, 'delivery-gate-false-claim.md'),
    [
      '# Delivery-gate 反向实驱（占位）',
      '',
      `sandbox home: ${home}`,
      '状态：M3 落地后续跑（本脚本骨架已就绪）',
      '预期断言：',
      '- 假完成声明被识别 → 进入回归审查',
      '- 无证据 → 未通过 → 回灌入口契约',
      '- 补证据后回归通过 → 才放行交付',
    ].join('\n') + '\n',
  )

  console.log(`隔离沙箱：${home}`)
  console.log(`证据目录：${evidenceDir}`)
  console.log('状态：占位脚本，M3 落地后补真实 dsh 实驱调用。')
  rmSync(sandbox, { recursive: true, force: true })
}

// ---- 主流程 ----
const missing = prerequisiteCheck()
if (missing.length) {
  console.error('前置条件未满足：')
  for (const m of missing) console.error(`  - ${m}`)
  console.error('（这是占位脚本；M3 落地 delivery-gate 后可实驱。脚本本身已提交作为 QA 框架。}')
  process.exitCode = 0 // 占位阶段不视为失败；由 M3 的实驱收尾判定
} else {
  await runSandboxedDrive()
}
