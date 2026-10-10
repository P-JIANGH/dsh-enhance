# AGENTS.md — working in dsh-enhance (`dsh-enhance`)

Guidance for agents and humans editing this repository. Read this before changing anything.

## What this repo is

`dsh-enhance` (short form **dsh-enhance**) is an oh-my-zsh-style enhancement bundle for DeepSeek Harness (`dsh`): a single installable plugin that contributes packaged skills, human commands (`/doctor`, `/boulder`), a persistent `dsh-enhance/work-rules` prompt section, a `dsh_enhance_doctor` diagnostic tool, guard + delivery-gate discipline, boulder work tracking (**goals are native**), worktree tools, the **Enhance** agent preset (with its persistent `dsh-enhance/enhance-mode` prompt section and four scoped subagents), an advisor companion-review runtime, and a browser half that puts the plugin's switches on the built-in Plugins panel.

Refer to this project only as **dsh-enhance** or **dsh-enhance**.

Key docs before you start: `docs/architecture.md`, `docs/roles.md`, `docs/prompts-review/README.md`, `docs/installing-plugins.md`.

## Layout

- `src/index.ts` — plugin entry (`apply`), config schema, wiring of every feature.
- `src/enhance-mode.ts` — `@p-jiangh/dsh-enhance/enhance-mode`: the deep-work contract as a **preset-scoped** system-prompt section (only the `preset-enhance` row mounts it).
- `src/features/` — capability implementations: `skills-provider`, `commands` (the human `/doctor` + `/boulder` surface), `boulder/` (work tracking), `worktree/`, `delivery-gate/`, `advisor/` (runtime, prompt, severity, emission-guard).
- `src/hooks/` — prompt/hook wiring: `work-rules`, `rules-injector`, `start-work`, `delivery-gate`.
- `src/features/boulder/` — boulder state (`boulder.json` under `.dsh-enhance/`) + the write token. Goals are **not** here: they are the native `ctx.goals` service.
- `src/tools/` — model-facing tools: `doctor`, `guards`, `guard-register`, `boulder-tools`, `worktree-tools`. Authored as raw `ToolDefinition`s with complete `output.schema` (see below).
- `client/client.js` — the browser half: registers the plugin's configuration page on the built-in Plugins panel (`plugins.row.config`). **Hand-authored, not built** — the module loader takes it verbatim through `exports["./client"]` and only `require`s the host module table (`react`, `react-dom`, `@deepseek-ai/dsh-client-ui-primitives`). Keep it consistent with `package.json` + `cordis.patch.yml`; `tests/client-contract.test.mjs` pins that.
- `prompts/` — single-source prompt text: `agents/<role>.persona.md`, `modes/enhance-mode.md`, `modes/advisor.md`.
- `cordis.patch.yml` — the bundle patch: the plugin install row **and** the `preset-enhance` agent-preset row. Also **generated** — never hand-edit.
- `scripts/` — `sync-dsh-enhance-preset.mjs` (the plugin row + the single Enhance preset row → `cordis.patch.yml`), `check-pack-payload.mjs` (published-payload shape: required files present, deleted sources' compiled output gone).
- `qa/` — real-dsh drivers: `pack-install-drive.mjs` (**zero-token** pack-install acceptance) plus the LLM drivers (`dsh-enhance-drive.mjs`, `worktracking-drive.mjs`, `delivery-gate-drive.mjs`, `webbridge-drive.mjs`). The LLM ones consume tokens; all write evidence under `.dsh-enhance/evidence/`.
- `tests/` — `node --test` unit tests, incl. `presets-pin.test.mjs` (byte-pin), `enhance-mode.test.mjs` (single-source pin), `tool-output-schema.test.mjs`, `advisor.test.mjs`, `host-contract.test.mjs` (event bindings against the installed host typings + injection provenance).

## Single-source discipline (important)

- Agent presets are **plugin rows**, not directories: on dsh 0.2.x `@deepseek-ai/dsh-agent-preset` registers `{ id, name, description, order, plugins }` into `ctx.agentPresets`, and the retired `$DSH_HOME/.agent-presets/<id>/` scan is gone. The rows are generated from the persona single sources and pinned byte-for-byte by `tests/presets-pin.test.mjs`.
- Edit the persona text only in `prompts/agents/<role>.persona.md`; `cordis.patch.yml` is **regenerated**, not hand-edited. Hand-editing or editing the source without regenerating breaks the byte-pin test, which is intentional.
- The main orchestrator persona lives in `prompts/agents/dsh-enhance.persona.md`; the four dispatachable sub-personas reuse `scout / librarian / reviewer / task` sources. Regenerate with `pnpm sync:enhance-preset`.
- The enhance-mode prose is single-sourced in `prompts/modes/enhance-mode.md` and mirrored as `ENHANCE_MODE_TEXT` in `src/enhance-mode.ts`; `tests/enhance-mode.test.mjs` pins the two together.
- Keep `docs/prompts-review/*.md` consistent when you change a persona's constraints.

## Settings surface（改配置面之前必读）

本插件的配置页挂在**内置「插件」面板**上：`client/client.js` 在 `plugins.row.config` 里认领 key `<包名>#<行 id>`（= `@p-jiangh/dsh-enhance#dsh-enhance`），控件经 `ctx.configForms.get('dsh-enhance')` 读写**同一个**共享表单（→ 永远只有一个写者）。机制依据与真机证据在 `docs/design-web-settings-card.md` §8–§10。三条不可忘：

1. **只有 `volatile()` 字段能被设置面编辑**。宿主 `SettingsForms` 对每个 Loader 条目取 `volatileForm(Config)`；一个 volatile 字段都没有的条目**根本不出现在 `describe()` 里**，写非 volatile 路径会直接抛错。新加一个"用户可调"的开关 = 在 `src/index.ts` 的 `Config` 里给它 `.volatile()`，并且**在 `client/client.js` 的 `SWITCHES`/字典里补一行**（`tests/client-contract.test.mjs` 钉字段集合）。
2. **volatile 改动不重挂插件**。`cordis-plugin-loader` 只把新值原地写进 accessor，并在本插件自己的 fiber 上发 `loader/volatile-update`。所以凡是"管的是一次注册"的开关（工具、命令、钩子、advisor 运行时），必须由 `applyFeatures` 这一代接线来落实 —— 现有实现是收到该事件后**先卸载再重挂**子插件。**新加开关时不要绕过这条**，否则开关会静默失效（第一轮真机探针就是这么抓到问题的）。
3. **`apply` 收到的 volatile 字段是 accessor，不是值**。用 `fieldValue(...)`（`src/index.ts`）解包；旧写法 `config.x ?? true` 对 accessor 恒为真。

## Build / test / verify

```sh
pnpm install
pnpm build          # tsc → lib/  (run after any src/ change)
pnpm typecheck      # tsc --noEmit
pnpm test           # node --test (all tests)
pnpm check:pack     # npm pack payload shape (required files present, deleted sources' output gone)
pnpm qa:pack        # pack-install acceptance, zero tokens: real tarball → throwaway profile → assertions
pnpm sync:enhance-preset   # regenerate cordis.patch.yml after persona edits
```

- **Tools must declare full `output.schema`.** A tool whose `execute` returns fields that `output.schema` does not cover is rejected by the harness ("returned invalid output") and breaks real sessions. When changing a tool's return shape, update the schema and add a case in `tests/tool-output-schema.test.mjs` (it runs the tool against a real schema check).
- Real-dsh QA scripts need a `DEEPSEEK_API_KEY` (they run true LLM sessions) and a profile linked to this checkout (e.g. `dsh-enhance`). They write evidence to `.dsh-enhance/evidence/` — do not commit transient sandboxes.
- **Bind only events the target host declares.** `src` is typechecked against the installed `@deepseek-ai/*` typings, and `tests/host-contract.test.mjs` fails when a `ctx.on('<ns>/<name>')` binding is not declared by the owning package's typings. This is not pedantry: two default-on hooks sat on `agent/session-start`, a name the 0.2.0 catalogue does not contain, and had never fired. A listener on a name nobody emits fails silently. When you migrate a binding, honour the event's declared contract — `agent/created`, for instance, is dispatched serially and awaited *before agent creation resolves* ("a throw or rejection fails creation"), and it also fires for delegated children, which `isDelegatedSession` must filter out.
- **Injected user-role context declares our own producer kind.** Never `source: { kind: 'user' }`: `user` means "the human typed this" in the harness's vocabulary. Use `CONTEXT_SOURCE_KIND` from `src/shared/provenance.ts` (pinned by `tests/host-contract.test.mjs`).
- **`pnpm test` runs on a `link:` install and therefore cannot see packaging defects.** `link:` makes module resolution land in this checkout's own `node_modules`. Anything about what a *user's* install looks like belongs in `pnpm qa:pack` (real tarball). See the dependency rule in `README.md`: host-supplied service packages are peers, never dependencies.

## Agent roles (from `docs/roles.md`)

Six roles: five persona presets **planner / scout / librarian / task / reviewer**, plus **advisor** (a per-session companion-review mechanism, not a selectable persona). The orchestrator preset (**Enhance**, id `enhance`) makes scout/librarian/reviewer/task dispatchable as scoped subagents, each with a `toolFilter` limiting its surface, and is the only preset that mounts the `enhance-mode` prompt section.

## Non-goals（刻意不做 —— 加功能前先读这一节）

上游 dsh 很厚：每加一块原生能力，重复面就从"加分"变成"负债"。下面这些**刻意不做**，除非有新证据推翻：

- **不做 goal 存储或 `goal_*` 工具**：目标是原生 `ctx.goals`（`create_goal`/`get_goal`/`update_goal` + `dsh-goal-round-driver`）。本插件曾自带 `goal_create/get/update` + `.dsh-enhance/goals/`，两套近邻 API 并存会让模型二选一 —— 已退役（`docs/value-assessment.md` §3）。
- **不读 `AGENTS.md`**：原生 `@deepseek-ai/dsh-agent-instructions` 负责完整指令链（`$DSH_HOME/AGENTS.md` + 项目根→cwd + 覆盖文件 + 嵌套重发现）。`rules-injector` 只读 `.dsh-enhance/rules/`。
- **不做 todo 续作驱动**：原生 goal 轮次驱动 + `todo_write` 已覆盖"继续干"；自建计数器没有写入者就是死代码。
- **不重复原生策略**：输出截断（原生 `tool-result-pruner`）、先读后写（原生 `fs-observation-policy`）—— 保留为已测纯函数，不在运行时接线。
- **不做团队模式（M8）**：原生 Agent Teams 已有成员/共享任务板/邮箱。
- **不新增并行 API**：任何"我们也来一个 X"之前，先用 `cordis_inspect_query` 在 live 运行时核对上游是否已提供。
- **不自建设置 tab、不自建 Remote**：官方席位是内置「插件」面板的 `plugins.row.config`，数据通道就是 `volatile()` Config + 宿主 `SettingsForms` / 客户端 `ctx.configForms`。旧方案（`settings.register` 桥接层、自建 `settings.plugins.tab`、自有 `@Remote` + typert）在 0.2.0-rc.2 上已无必要（`docs/design-web-settings-card.md` §8）。

## Working practice

- Read `AGENTS.md` and the relevant docs before changing code. Prefer existing helpers and conventions.
- Keep changes focused: one concern per change, add or update tests, run `pnpm test` + `pnpm typecheck` and `pnpm build`.
- Update `README.md` and any affected `docs/*` when behavior changes.
- Report failures honestly with the exact error; propose the next attempt.
- Task discipline: one `in_progress`, verify when done, commit increments.
