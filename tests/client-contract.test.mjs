/**
 * 浏览器半侧的**契约**测试：不跑真实 React，只钉住与宿主平台的接口。
 *
 * 为什么值得钉（每一条都对应一个真实失败模式）：
 * - `plugins.row.config` 的 key 必须是 `<包名>#<行 id>`：插件面板用
 *   `rowConfigKey(pkg.name, row.rowId)` 查台账，写错就永远不出现「配置」入口。
 *   这里直接从 package.json 与 cordis.patch.yml 推导期望值，改动任一文件都会红。
 * - `exports["./client"]` 必须真的指到本文件、`dsh.client.platform` 必须是 web，
 *   否则桌面端根本不会加载浏览器半侧。
 * - 布尔字段的文本往返（`true`/`false` ⇄ boolean）一旦写错，开关会静默失效。
 * - `whileServed` / 字典注册 / 服务注入名写错，会在真实页面里表现为"什么都不显示"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'))

/** 从 cordis.patch.yml 里取本 bundle 那一行的 `id`（行 id 即设置命名空间）。 */
function patchRowId() {
  const text = readFileSync(`${root}cordis.patch.yml`, 'utf8')
  const match = /- insert:\s*\n\s*- id:\s*(\S+)/.exec(text)
  assert.ok(match, 'cordis.patch.yml 必须有一个 insert 行')
  return match[1]
}

/** 记录模块加载器交出来的模块。 */
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded = module
    },
  },
}
await import('../client/client.js')

/** 假 React：`createElement` 只记录形状。 */
const react = {
  createElement: (type, props, ...children) => ({ type, props, children }),
}

/** 假的 primitives：用字符串标记组件，记录 `SettingsFormModel` 收到的规格。 */
function fakePrimitives() {
  const seen = { specs: [], scopes: [] }
  class SettingsFormModel {
    constructor(scope, specs) {
      seen.scopes.push(scope)
      seen.specs = specs
      this.disposed = false
    }
    bind(project) {
      seen.projection = project()
      return { getSnapshot: () => seen.projection }
    }
    shell() {
      return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
    }
    field(name) {
      return { text: 'true', overridden: name === 'guards', invalid: false }
    }
    actions() {
      return { edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
    }
    dispose() {
      this.disposed = true
    }
  }
  return {
    seen,
    module: {
      Checkbox: 'Checkbox',
      SettingsForm: 'SettingsForm',
      SettingsFormModel,
      SettingsValueField: 'SettingsValueField',
      Tag: 'Tag',
      settingsTextField: (field) => ({ field, kind: 'text' }),
    },
  }
}

/** 装配一次浏览器半侧：返回注册记录与卸载句柄。 */
function mountClient() {
  const primitives = fakePrimitives()
  const registrations = []
  const effects = []
  const dictionaries = []
  const disposers = []
  const ctx = {
    locale: {
      bind: () => (key) => `t:${key}`,
      register: (ns, dicts) => {
        dictionaries.push({ ns, dicts })
        return () => {}
      },
    },
    configForms: {
      get: (ns) => {
        primitives.seen.namespace = ns
        return { namespace: ns }
      },
      whileServed: (namespaces, register) => {
        primitives.seen.served = namespaces
        const off = register(new Set(namespaces))
        return () => off?.()
      },
    },
    slots: {
      inject: (slot, register) => {
        primitives.seen.injectedSlot = slot
        const off = register()
        return () => off?.()
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    effect: (factory) => {
      const off = factory()
      effects.push(off)
      if (typeof off === 'function') disposers.push(off)
      return off
    },
  }
  const mod = loaded.factory((name) => {
    if (name === 'react') return react
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives.module
    throw new Error(`unexpected require: ${name}`)
  })
  mod.apply(ctx)
  return { mod, primitives, registrations, effects, dictionaries, disposers }
}

/** 最小 document 替身，供样式注入走一遍。 */
function fakeDocument() {
  const appended = []
  const previous = globalThis.document
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: {
      appendChild: (tag) => {
        appended.push(tag)
      },
    },
  }
  return { appended, restore: () => { globalThis.document = previous } }
}

test('[client] 模块 id 与包名一致，且声明的服务注入就是页面需要的三个', () => {
  assert.equal(loaded.id, pkg.name)
  const { mod } = mountClient()
  assert.deepEqual(mod.inject, ['slots', 'locale', 'configForms'])
})

test('[client] 页面认领 plugins.row.config，key 等于 <包名>#<行 id>', () => {
  const { primitives, registrations } = mountClient()
  assert.equal(primitives.seen.injectedSlot, 'plugins.row.config')
  assert.equal(registrations.length, 1)
  const { options } = registrations[0]
  assert.equal(options.name, 'plugins.row.config')
  assert.equal(options.key, `${pkg.name}#${patchRowId()}`)
  assert.equal(options.locale, 'dsh-enhance.settings')
  assert.equal(typeof options.inject, 'function')
})

test('[client] whileServed 盯的是 dsh-enhance，表单取自同一个共享命名空间', () => {
  const { primitives } = mountClient()
  assert.deepEqual(primitives.seen.served, ['dsh-enhance'])
  assert.equal(primitives.seen.namespace, 'dsh-enhance')
})

test('[client] 表单规格覆盖 8 个开关 + advisorModel，且布尔往返正确', () => {
  const { primitives } = mountClient()
  const fields = primitives.seen.specs.map((spec) => spec.field)
  assert.deepEqual(fields, [
    'orientOnSessionStart',
    'doctorTool',
    'commands',
    'guards',
    'workTracking',
    'worktree',
    'advisor',
    'ulwTrigger',
    'advisorModel',
  ])
  for (const spec of primitives.seen.specs.slice(0, 8)) {
    assert.equal(spec.format(true), 'true')
    assert.equal(spec.format(false), 'false')
    assert.deepEqual(spec.parse('true'), { kind: 'set', value: true })
    assert.deepEqual(spec.parse(' false '), { kind: 'set', value: false })
    assert.equal(spec.parse('maybe'), undefined)
  }
})

test('[client] 注册的注入面提供快照钩子与表单动作', () => {
  const { registrations } = mountClient()
  const face = registrations[0].options.inject()
  assert.equal(typeof face.hooks.enhanceCard.getSnapshot, 'function')
  for (const action of ['edit', 'resetField', 'save', 'discard']) {
    assert.equal(typeof face[action], 'function', `缺少动作 ${action}`)
  }
  assert.equal(face.hooks.enhanceCard.getSnapshot().switches.doctorTool.text, 'true')
})

test('[client] summary 视图只出一行摘要，page 视图出整张表单', () => {
  const { registrations } = mountClient()
  const Component = registrations[0].component
  const state = { switches: {}, advisorModel: { text: '', overridden: false, invalid: false }, writable: true }
  const useEnhanceCard = () => state
  assert.equal(Component({ t: (key) => `t:${key}`, view: 'summary', useEnhanceCard }), 't:summary')
  const page = Component({ t: (key) => `t:${key}`, view: 'page', useEnhanceCard, edit: () => {}, save: () => {}, discard: () => {} })
  assert.equal(page.type, 'SettingsForm')
  assert.equal(page.props.state, state)
  const [rows, modelRow] = page.children
  assert.equal(rows.length, 8, '8 个开关行')
  assert.deepEqual(rows[0].props.row.field, 'orientOnSessionStart')
  assert.equal(modelRow.type, 'SettingsValueField')
})

test('[client] 样式只注入一次，且带幂等标记', () => {
  const doc = fakeDocument()
  try {
    const { effects } = mountClient()
    assert.ok(effects.length >= 3, '字典/表单订阅/页面三处 effect')
    const style = doc.appended[0]
    assert.equal(style.dataset.plugin, '@dsh-enhance/dsh-enhance')
    assert.equal(style.dataset.pluginCss, '@dsh-enhance/dsh-enhance/settings.css')
    assert.ok(style.textContent.includes('--dsw-alias-label-primary'))
  } finally {
    doc.restore()
  }
})

test('[client] 包清单声明了浏览器半侧：exports["./client"] + dsh.client + files', () => {
  assert.equal(pkg.exports['./client'], './client/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'))
  assert.ok(pkg.files.includes('client'))
})

