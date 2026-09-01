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
  }
}

test('[doctor] renderReport 输出中文章节，无英文 key=value 堆砌', () => {
  const report = {
    pluginLoaded: true,
    skills: [{ name: 'code-review', source: 'bundled' }],
    workRulesSection: 'dsh-enhance/work-rules',
    config: fullConfig(),
  }
  const text = renderReport(report, true)
  assert.ok(text.includes('# dsh-enhance 诊断'), '标题应为中文')
  assert.ok(text.includes('插件已加载：是'), '应含中文状态')
  assert.ok(text.includes('工作准则段落：dsh-enhance/work-rules'), '应含工作准则段')
  assert.ok(text.includes('技能：') && text.includes('code-review'), '应列出技能')
  // 避免英文堆砌的负向断言
  assert.equal(text.includes('pluginLoaded:'), false, '不应再输出英文 key=value')
  assert.equal(text.includes('workRulesSection:'), false, '不应再输出英文 key=value')
  assert.equal(text.includes('skills:'), false, '不应再输出英文小节头')
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
    skills: [{ name: 'code-review', source: 'bundled' }],
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
