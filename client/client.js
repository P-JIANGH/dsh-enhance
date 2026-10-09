/**
 * dsh-enhance 的浏览器半侧：内置「插件」面板上本插件那一行的配置页。
 *
 * 契约（全部在本机 desktop 0.2.0-rc.2 上考证，见 docs/design-web-settings-card.md）：
 * - 宿主半侧把 7 个开关标成 `volatile()`，于是 `settings.describe()` 以
 *   `ns: 'dsh-enhance'` 服务这个条目；客户端用 `ctx.configForms.get('dsh-enhance')`
 *   拿到的就是**同一个**共享表单（同一条命名空间只有一个控制器，不存在双写者）。
 * - 页面注册进 `plugins.row.config`（keyed 槽，由 `@deepseek-ai/dsh-client-ui-plugin-manager`
 *   声明并派发），key 必须是 `<包名>#<行 id>`（= 该 bundle 的 cordis.patch.yml 里那一行的 `id`）。
 *   页面对每一行用 `rowConfigKey(pkg.name, row.rowId)` 查台账，命中才给那一行加「配置」入口。
 * - 组件收到 `{ view: 'summary' | 'page' }`：`summary` 渲染一行摘要，`page` 渲染表单。
 * - `whileServed` 让整页只在宿主确实服务该命名空间时出现。
 *
 * 本文件**不经构建**：模块加载器按 package.json 的 `exports["./client"]` 原样取用，
 * 只能在 `factory(require)` 里用宿主提供的模块表（react / react-dom /
 * `@deepseek-ai/dsh-client-ui-primitives`），所以这里显式手写而不引入打包链。
 * 常量 `ROW_CONFIG_KEY` 与 package.json + cordis.patch.yml 的一致性由
 * tests/client-contract.test.mjs 钉住。
 */
window.__ModuleLoader__.load({
  id: '@dsh-enhance/dsh-enhance',
  factory: (require) => {
    const { createElement: h } = require('react')
    const {
      Checkbox,
      SettingsForm,
      SettingsFormModel,
      SettingsValueField,
      Tag,
      settingsTextField,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    /** 宿主半侧服务这个条目的设置命名空间（= 配置补丁行的 id）。 */
    const SETTINGS_NS = 'dsh-enhance'

    /** 本页在插件面板上认领的格子：`<包名>#<行 id>`。 */
    const ROW_CONFIG_KEY = '@dsh-enhance/dsh-enhance#dsh-enhance'

    /** 本页拥有的字典命名空间。 */
    const LOCALE_NS = 'dsh-enhance.settings'

    /** 7 个开关：字段名 + 字典键。顺序即页面顺序。 */
    const SWITCHES = [
      { field: 'doctorTool', label: 'doctorTool', hint: 'doctorToolHint' },
      { field: 'commands', label: 'commands', hint: 'commandsHint' },
      { field: 'guards', label: 'guards', hint: 'guardsHint' },
      { field: 'workTracking', label: 'workTracking', hint: 'workTrackingHint' },
      { field: 'worktree', label: 'worktree', hint: 'worktreeHint' },
      { field: 'advisor', label: 'advisor', hint: 'advisorHint' },
    ]

    /** 英文文案。 */
    const en = {
      summary: 'Working discipline, packaged skills and the delivery gate — switch each part on or off here.',
      doctorTool: 'Register the dsh_enhance_doctor tool',
      doctorToolHint: 'When off, the model cannot see the diagnostic tool.',
      commands: 'Human commands (/doctor, /boulder)',
      commandsHint: 'Command output stays in the UI — it spends no model tokens.',
      guards: 'Tool guards and the delivery gate',
      guardsHint: 'Read-before-write, path traversal, bash file reads, and the completion gate.',
      workTracking: 'Work tracking (boulder + write token)',
      workTrackingHint: 'Goals are native and unaffected by this switch.',
      worktree: 'Worktree tools',
      worktreeHint: 'Requires work tracking.',
      advisor: 'Advisor companion review',
      advisorHint: 'Spawns one shadow sub-agent per session to review increments and steer back.',
      advisorModel: 'Advisor model',
      advisorModelHint: 'Leave empty to inherit the main session route.',
      advisorModelPlaceholder: 'e.g. deepseek-flash',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
    }

    /** 简体中文文案。 */
    const zh = {
      summary: '工作纪律、打包技能与交付门卫 —— 在这里逐项开关。',
      doctorTool: '注册 dsh_enhance_doctor 诊断工具',
      doctorToolHint: '关闭后模型看不到这个工具。',
      commands: '人类命令（/doctor、/boulder）',
      commandsHint: '命令只在界面里回显，不占模型 token。',
      guards: '工具守卫与交付门卫',
      guardsHint: '写前必读、路径越界、bash 读文件，以及交付前的完成门禁。',
      workTracking: '工作追踪（boulder + 写入令牌）',
      workTrackingHint: '目标（goal）是原生能力，不受这个开关影响。',
      worktree: 'worktree 工具',
      worktreeHint: '需要先打开工作追踪。',
      advisor: '顾问旁审（advisor）',
      advisorHint: '每个会话派一个影子子代理复核增量并回注建议。',
      advisorModel: '顾问模型',
      advisorModelHint: '留空表示沿用主会话的路由。',
      advisorModelPlaceholder: '例如 deepseek-flash',
      overridden: '已覆盖',
      reset: '恢复默认',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
    }

    /** 本页样式：只管排版与徽标/恢复按钮，颜色一律走主题 token。 */
    const CSS = [
      '.dsh-enhance-row{display:flex;flex-direction:column;gap:6px;padding:10px 0;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dsh-enhance-rowHead{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.dsh-enhance-rowLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}',
      '.dsh-enhance-badges{display:inline-flex;align-items:center;gap:8px}',
      '.dsh-enhance-reset{color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;background:0 0;border:0;padding:2px 4px}',
      '.dsh-enhance-reset:disabled{color:var(--dsw-alias-state-idle-primary);cursor:default}',
    ].join('')

    /** 本页样式的幂等标记（模块可能被多次挂载）。 */
    const CSS_ID = '@dsh-enhance/dsh-enhance/settings.css'

    /** 把本页样式注入文档一次。 */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@dsh-enhance/dsh-enhance'
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * 布尔字段的转换规格：`SettingsFormModel` 只认文本草稿，这里负责往返。
     * @param field - 该命名空间章节里的字段名。
     * @returns 字段的转换规格。
     */
    function settingsToggleField(field) {      return {
        field,
        format: (value) => (value === true ? 'true' : value === false ? 'false' : ''),
        parse: (text) => {
          const trimmed = text.trim()
          if (trimmed === 'true') return { kind: 'set', value: true }
          if (trimmed === 'false') return { kind: 'set', value: false }
          return undefined
        },
      }
    }

    /**
     * 本页的表单控制器：把共享的 `dsh-enhance` 表单桥到页面的分阶段表单上。
     */
    class EnhanceCardController {
      /**
       * @param scope - 绑定到 `dsh-enhance` 命名空间的共享配置表单。
       */
      constructor(scope) {
        this.form = new SettingsFormModel(scope, [
          ...SWITCHES.map((row) => settingsToggleField(row.field)),
          settingsTextField('advisorModel'),
        ])
        this.store = this.form.bind(() => this.projection())
      }

      /**
       * 重建投影：字段草稿随宿主值或本地编辑变化。
       * @returns 组件读到的快照。
       */
      projection() {
        const switches = {}
        for (const row of SWITCHES) switches[row.field] = this.form.field(row.field)
        return { ...this.form.shell(), switches, advisorModel: this.form.field('advisorModel') }
      }

      /**
       * 组装槽注册注入的面。
       * @returns 快照钩子与表单动作。
       */
      inject() {
        return { hooks: { enhanceCard: this.store }, ...this.form.actions() }
      }

      /** 释放对宿主已接受值的订阅。 */
      dispose() {
        this.form.dispose()
      }
    }

    /**
     * 一个开关行：标签 + 覆盖徽标/恢复 + 复选框（提示文本）。
     * @param props - 行文案、字段状态、是否可写，以及编辑/恢复动作。
     * @returns 该行元素。
     */
    function SwitchRow(props) {
      const { t, row, field, writable, edit, resetField } = props
      return h(
        'div',
        { className: 'dsh-enhance-row' },
        h(
          'div',
          { className: 'dsh-enhance-rowHead' },
          h('span', { className: 'dsh-enhance-rowLabel' }, t(row.label)),
          field.overridden
            ? h(
                'span',
                { className: 'dsh-enhance-badges' },
                h(Tag, { tone: 'neutral' }, t('overridden')),
                h('button', {
                  type: 'button',
                  className: 'dsh-enhance-reset',
                  disabled: !writable,
                  onClick: () => resetField(row.field),
                }, t('reset')),
              )
            : null,
        ),
        h(Checkbox, {
          checked: field.text === 'true',
          disabled: !writable,
          label: t(row.hint),
          onChange: (next) => edit(row.field, next ? 'true' : 'false'),
        }),
      )
    }

    /**
     * 插件面板上认领的配置页。
     * @param props - 页面要的视图、注入的窥孔/动作，以及本地化读取器。
     * @returns 一行摘要，或整张表单。
     */
    function EnhanceCard(props) {
      const { t } = props
      const state = props.useEnhanceCard((snapshot) => snapshot)
      if (props.view === 'summary') return t('summary')
      return h(
        SettingsForm,
        {
          labels: {
            unavailable: t('unavailable'),
            readOnly: t('readOnly'),
            saveFailed: t('saveFailed'),
            save: t('save'),
            saving: t('saving'),
          },
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        SWITCHES.map((row) =>
          h(SwitchRow, {
            key: row.field,
            t,
            row,
            field: state.switches[row.field],
            writable: state.writable,
            edit: props.edit,
            resetField: props.resetField,
          }),
        ),
        h(SettingsValueField, {
          id: 'dsh-enhance-advisor-model',
          label: t('advisorModel'),
          hint: t('advisorModelHint'),
          placeholder: t('advisorModelPlaceholder'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          disabled: !state.writable,
          text: state.advisorModel.text,
          overridden: state.advisorModel.overridden,
          invalid: state.advisorModel.invalid,
          invalidLabel: t('advisorModelHint'),
          onEdit: (text) => props.edit('advisorModel', text),
          onReset: () => props.resetField('advisorModel'),
        }),
      )
    }

    /** 本页需要的客户端服务。 */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * 挂载本插件在插件面板上的配置页。
     * @param ctx - 浏览器插件上下文。
     */
    function apply(ctx) {
      ensureStyle()
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(
        () => ctx.locale.register(LOCALE_NS, { zh, en }),
        'dsh-enhance: settings dictionaries',
      )
      const card = new EnhanceCardController(ctx.configForms.get(SETTINGS_NS))
      ctx.effect(
        () => () => {
          card.dispose()
        },
        'dsh-enhance: settings form subscription',
      )
      ctx.effect(
        () =>
          ctx.configForms.whileServed([SETTINGS_NS], () =>
            ctx.slots.inject('plugins.row.config', () =>
              ctx.slots.register(
                {
                  name: 'plugins.row.config',
                  key: ROW_CONFIG_KEY,
                  locale: LOCALE_NS,
                  inject: () => card.inject(),
                },
                EnhanceCard,
              ),
            ),
          ),
        'dsh-enhance: settings page',
      )
    }

    return { apply, inject }
  },
})
