import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport, suggestNext } from '../lib/tools/doctor.js'

/** 一个默认全开配置。 */
function fullConfig() {
  return {
    workRulesChars: 120,
    orientOnSessionStart: true,
    doctorTool: true,
    guards: true,
    workTracking: true,
    worktree: true,
    commands: true,
  }
}

test('[doctor] renderReport 输出中文章节，无英文 key=value 堆砌', () => {
  const report = {
    pluginLoaded: true,
    skills: [{ name: 'code-review', source: 'bundled', provider: 'dsh-enhance' }],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const text = renderReport(report, true)
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
  const report = {
    pluginLoaded: true,
    skills: [
      { name: 'code-review', source: 'bundled', provider: 'dsh-enhance' },
      { name: 'tdd', source: 'bundled', provider: 'dsh-enhance' },
      { name: 'office-docx', source: 'bundled', provider: 'desktop-office' },
      { name: 'diagnose-windows-sandbox-acl', source: 'bundled', provider: 'desktop-diagnostics' },
      { name: 'dingtalk-robot', source: 'user-agents', provider: 'user-agents' },
    ],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const text = renderReport(report, true)
  assert.ok(text.includes('本插件打包技能（2）：code-review、tdd'), '只列 provider=dsh-enhance 的两个')
  assert.ok(text.includes('会话内其它来源技能：3 个'), '其它来源只报数量')
  assert.equal(text.includes('office-docx'), false, '不得把别人的技能列进本插件清单')
  assert.equal(text.includes('dingtalk-robot'), false, '不得把用户池技能列进本插件清单')
})

test('[doctor] 只有别人的技能时，本插件技能显示为无', () => {
  const report = {
    pluginLoaded: true,
    skills: [{ name: 'office-docx', source: 'bundled', provider: 'desktop-office' }],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const text = renderReport(report, true)
  assert.ok(text.includes('本插件打包技能：无'), '没有本插件技能时应提示检查装配')
  assert.ok(text.includes('检查插件装配'), '应给出可执行指引')
})

test('[doctor] renderReport 无技能时提示检查装配', () => {
  const report = {
    pluginLoaded: true,
    skills: [],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const text = renderReport(report, true)
  assert.ok(text.includes('技能：无'), '无技能时应提示')
  assert.ok(text.includes('检查插件装配'), '应给出可执行指引')
})

test('[doctor] renderReport 全开时给出下一步建议', () => {
  const report = {
    pluginLoaded: true,
    skills: [{ name: 'code-review', source: 'bundled', provider: 'dsh-enhance' }],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const text = renderReport(report, true)
  assert.ok(text.includes('下一步建议：'), '应含建议小节')
  assert.ok(text.includes('一切就绪'), '全开时指引用户直接开始')
})

test('[doctor] suggestNext 由 config 开关 + advisor 状态驱动，全开给就绪提示', () => {
  const all = suggestNext(fullConfig(), true)
  assert.equal(all.length, 1)
  assert.ok(all[0].includes('一切就绪'))
})

test('[doctor] suggestNext 关闭项给出可执行的开启建议', () => {
  const next = suggestNext(
    { ...fullConfig(), guards: false, workTracking: false, worktree: false },
    false, // advisor 关
  )
  assert.ok(next.some(s => s.includes('守卫已关闭')))
  assert.ok(next.some(s => s.includes('工作追踪已关闭')))
  assert.ok(next.some(s => s.includes('worktree 已关闭')))
  assert.ok(next.some(s => s.includes('advisor 已关闭')))
  // 未关闭的 orient 不应出现在建议里
  assert.equal(next.some(s => s.includes('会话开场提示已关闭')), false)
})

test('[doctor] suggestNext 关闭 orientOnSessionStart 时提示开启', () => {
  const next = suggestNext({ ...fullConfig(), orientOnSessionStart: false }, true)
  assert.ok(next.some(s => s.includes('会话开场提示已关闭')))
})

test('[doctor] renderReport 点名人类指令（人可见入口），未提供名单时不臆造', () => {
  const report = {
    pluginLoaded: true,
    skills: [{ name: 'code-review', source: 'bundled', provider: 'dsh-enhance' }],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const named = renderReport(report, true, ['doctor', 'boulder'])
  assert.ok(named.includes('人类指令=开'), '回显应含人类指令开关')
  assert.ok(named.includes('人类指令（2）：/doctor、/boulder'), '应点名两条人类指令')
  // 名单由调用方给出（commands.ts 的 COMMAND_NAMES）；没有名单就不该凭开关脑补出清单。
  const unnamed = renderReport(report, true)
  assert.equal(unnamed.includes('人类指令（'), false, '未提供名单时不得列出指令')
})

test('[doctor] suggestNext 关闭人类指令时提示开启', () => {
  const next = suggestNext({ ...fullConfig(), commands: false }, true)
  assert.ok(next.some(s => s.includes('人类指令已关闭')), '应给出可执行的开启建议')
})

test('[doctor] renderReport 关闭人类指令时不列清单（开关与名单一致）', () => {
  const report = {
    pluginLoaded: true,
    skills: [],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const text = renderReport({ ...report, config: { ...fullConfig(), commands: false } }, true, ['doctor', 'boulder'])
  assert.ok(text.includes('人类指令=关'))
  assert.equal(text.includes('人类指令（'), false)
})
