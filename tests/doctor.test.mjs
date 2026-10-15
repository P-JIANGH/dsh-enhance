import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport, renderAdvisorStatus, suggestNext } from '../lib/tools/doctor.js'
import { inactiveAdvisorStatus } from '../lib/features/advisor/runtime.js'

/** 一个默认全开配置。 */
function fullConfig() {
  return {
    workRulesChars: 120,
    doctorTool: true,
    guards: true,
    workTracking: true,
    worktree: true,
    commands: true,
  }
}

/** advisor 开、且尚未触发过审查（接线后、第一个回合结束前的真实状态）。 */
function advisorOn(patch = {}) {
  return { ...inactiveAdvisorStatus(true), ...patch }
}

/** 报告骨架：默认只有本插件自己的一个技能，advisor 已接线。 */
function baseReport(patch = {}) {
  return {
    pluginLoaded: true,
    skills: [{ name: 'code-review', source: 'bundled', provider: 'dsh-enhance' }],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
    advisor: advisorOn(),
    ...patch,
  }
}

test('[doctor] renderReport 输出中文章节，无英文 key=value 堆砌', () => {
  const text = renderReport(baseReport())
  assert.ok(text.includes('# dsh-enhance 诊断'), '标题应为中文')
  assert.ok(text.includes('插件已加载：是'), '应含中文状态')
  assert.ok(text.includes('工作准则段落：dsh-enhance/work-rules'), '应含工作准则段')
  assert.ok(text.includes('本插件打包技能（1）：code-review'), '应只把本插件提供的技能算作打包技能')
  // 避免英文堆砌的负向断言
  assert.equal(text.includes('pluginLoaded:'), false, '不应再输出英文 key=value')
  assert.equal(text.includes('workRulesSection:'), false, '不应再输出英文 key=value')
  assert.equal(text.includes('skills:'), false, '不应再输出英文小节头')
})

test('[doctor] 其它 provider 的技能不得算作本插件打包技能', () => {
  // 真实场景：desktop profile 里 office-* 等技能的 source 同样是 bundled，
  // 但 provider 不是 dsh-enhance —— 按 source 过滤会把别人的技能算作本插件的贡献。
  const text = renderReport(baseReport({
    skills: [
      { name: 'code-review', source: 'bundled', provider: 'dsh-enhance' },
      { name: 'tdd', source: 'bundled', provider: 'dsh-enhance' },
      { name: 'office-docx', source: 'bundled', provider: 'desktop-office' },
      { name: 'diagnose-windows-sandbox-acl', source: 'bundled', provider: 'desktop-diagnostics' },
      { name: 'dingtalk-robot', source: 'user-agents', provider: 'user-agents' },
    ],
  }))
  assert.ok(text.includes('本插件打包技能（2）：code-review、tdd'), '只列 provider=dsh-enhance 的两个')
  assert.ok(text.includes('会话内其它来源技能：3 个'), '其它来源只报数量')
  assert.equal(text.includes('office-docx'), false, '不得把别人的技能列进本插件清单')
  assert.equal(text.includes('dingtalk-robot'), false, '不得把用户池技能列进本插件清单')
})

test('[doctor] 只有别人的技能时，本插件技能显示为无', () => {
  const text = renderReport(baseReport({
    skills: [{ name: 'office-docx', source: 'bundled', provider: 'desktop-office' }],
  }))
  assert.ok(text.includes('本插件打包技能：无'), '没有本插件技能时应提示检查装配')
  assert.ok(text.includes('检查插件装配'), '应给出可执行指引')
})

test('[doctor] renderReport 无技能时提示检查装配', () => {
  const text = renderReport(baseReport({ skills: [] }))
  assert.ok(text.includes('技能：无'), '无技能时应提示')
  assert.ok(text.includes('检查插件装配'), '应给出可执行指引')
})

test('[doctor] renderReport 全开时给出下一步建议', () => {
  const text = renderReport(baseReport())
  assert.ok(text.includes('下一步建议：'), '应含建议小节')
  assert.ok(text.includes('一切就绪'), '全开时指引用户直接开始')
})

test('[doctor] suggestNext 由 config 开关 + advisor 状态驱动，全开给就绪提示', () => {
  const all = suggestNext(fullConfig(), advisorOn())
  assert.equal(all.length, 1)
  assert.ok(all[0].includes('一切就绪'))
})

test('[doctor] suggestNext 关闭项给出可执行的开启建议', () => {
  const next = suggestNext(
    { ...fullConfig(), guards: false, workTracking: false, worktree: false },
    inactiveAdvisorStatus(false), // advisor 关
  )
  assert.ok(next.some(s => s.includes('守卫已关闭')))
  assert.ok(next.some(s => s.includes('工作追踪已关闭')))
  assert.ok(next.some(s => s.includes('worktree 已关闭')))
  assert.ok(next.some(s => s.includes('advisor 已关闭')))
  // 已退役机制（orient 开场钩子、ulw 触发词）不得出现在建议里。
  assert.equal(next.some(s => /会话开场|ulw|ultrawork|orient/i.test(s)), false)
})

test('[doctor] suggestNext 全开时的就绪提示指向 Enhance 预设，不再指向退出机制', () => {
  const next = suggestNext(fullConfig(), advisorOn())
  assert.equal(next.length, 1)
  assert.ok(next[0].includes('一切就绪'))
  assert.match(next[0], /Enhance/)
  assert.doesNotMatch(next[0], /ulw|ultrawork|orient|会话开场/i)
})

test('[doctor] renderReport 点名人类指令（人可见入口），未提供名单时不臆造', () => {
  const named = renderReport(baseReport(), ['doctor', 'boulder'])
  assert.ok(named.includes('人类指令=开'), '回显应含人类指令开关')
  assert.ok(named.includes('人类指令（2）：/doctor、/boulder'), '应点名两条人类指令')
  // 名单由调用方给出（commands.ts 的 COMMAND_NAMES）；没有名单就不该凭开关脑补出清单。
  const unnamed = renderReport(baseReport())
  assert.equal(unnamed.includes('人类指令（'), false, '未提供名单时不得列出指令')
})

test('[doctor] suggestNext 关闭人类指令时提示开启', () => {
  const next = suggestNext({ ...fullConfig(), commands: false }, advisorOn())
  assert.ok(next.some(s => s.includes('人类指令已关闭')), '应给出可执行的开启建议')
})

test('[doctor] renderReport 关闭人类指令时不列清单（开关与名单一致）', () => {
  const text = renderReport(
    baseReport({ skills: [], config: { ...fullConfig(), commands: false } }),
    ['doctor', 'boulder'],
  )
  assert.ok(text.includes('人类指令=关'))
  assert.equal(text.includes('人类指令（'), false)
})

// ── 顾问旁审状态：把「advisor 没动作」变成可读的一行 ────────────────────────────
// 触发原因（2026-10-15 实机）：会话默认路由是要求会话亲和的 provider，复核请求缺
// sessionId 被拒（400），运行时只写 stderr —— 用户看到的正是「advisor 好像没动作」。

test('[doctor] 顾问旁审：未触发审查时说明何时会审查', () => {
  const text = renderReport(baseReport())
  assert.ok(text.includes('顾问旁审：开'), '应回显 advisor 开关')
  assert.ok(text.includes('尚未触发审查'), '首个回合结束前应说明何时才会审查')
  assert.equal(renderAdvisorStatus(inactiveAdvisorStatus(false)), '顾问旁审：关')
})

test('[doctor] 顾问旁审：调用失败时回显路由与失败原因，并给出可执行建议', () => {
  const failed = advisorOn({
    reviews: 3,
    outcome: 'failed',
    detail: 'Request is missing x-opencode-session',
    route: 'opencode-go/deepseek-v4.1-flash',
    lastReviewAt: '2026-10-15T02:00:00.000Z',
  })
  const text = renderReport(baseReport({ advisor: failed }))
  assert.ok(text.includes('最近：调用失败'), '失败必须显示为失败')
  assert.ok(text.includes('opencode-go/deepseek-v4.1-flash'), '应回显实际路由')
  assert.ok(text.includes('Request is missing x-opencode-session'), '应回显失败原因')
  assert.ok(text.includes('已审查 3 次'), '应回显审查次数')
  assert.ok(
    suggestNext(fullConfig(), failed).some(s => s.includes('advisor 审查调用失败')),
    '失败要给下一步建议，而不是只说「一切就绪」',
  )
})

test('[doctor] 顾问旁审：成功回注时显示结局与次数，不再提示一切就绪之外的噪声', () => {
  const delivered = advisorOn({ reviews: 1, outcome: 'delivered', detail: '已回注 nit 建议', route: 'deepseek-official/deepseek-flash' })
  assert.equal(suggestNext(fullConfig(), delivered).length, 1, '成功回注不产生额外建议')
  const text = renderReport(baseReport({ advisor: delivered }))
  assert.ok(text.includes('最近：已回注建议'))
  assert.ok(text.includes('已回注 nit 建议'))
})
