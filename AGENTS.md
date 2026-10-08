# AGENTS.md — working in dsh-enhance (`dsh-enhance`)

Guidance for agents and humans editing this repository. Read this before changing anything.

## What this repo is

`dsh-enhance` (short form **dsh-enhance**) is an oh-my-zsh-style enhancement bundle for DeepSeek Harness (`dsh`): a single installable plugin that contributes packaged skills, human commands (`/doctor`, `/boulder`, `/presets`), a persistent `dsh-enhance/work-rules` prompt section, a session-start orientation hook, a `dsh_enhance_doctor` diagnostic tool, guard + delivery-gate discipline, boulder work tracking (**goals are native**), worktree tools, the `ulw` deep-work mode, an advisor companion-review runtime, and an orchestrating persona (**「Enhance 模式」**) that dispatches four subagent personas.

Refer to this project only as **dsh-enhance** or **dsh-enhance**.

Key docs before you start: `docs/architecture.md`, `docs/roles.md`, `docs/prompts-review/README.md`.

## Layout

- `src/index.ts` — plugin entry (`apply`), config schema, wiring of every feature.
- `src/features/` — capability implementations: `skills-provider`, `commands` (the human `/doctor` + `/boulder` + `/presets` surface), `presets/` (the shared preset installer behind the CLI, `/presets` and `postinstall`), `skill-trigger` (ulw), `boulder/` (work tracking), `worktree/`, `delivery-gate/`, `advisor/` (runtime, prompt, severity, emission-guard).
- `src/hooks/` — prompt/hook wiring: `work-rules`, `orient`, `rules-injector`, `start-work`, `delivery-gate`.
- `src/features/boulder/` — boulder state (`boulder.json` under `.dsh-enhance/`) + the write token. Goals are **not** here: they are the native `ctx.goals` service.
- `src/tools/` — model-facing tools: `doctor`, `guards`, `guard-register`, `boulder-tools`, `worktree-tools`. Authored as raw `ToolDefinition`s with complete `output.schema` (see below).
- `prompts/` — single-source prompt text: `agents/<role>.persona.md`, `modes/ultrawork.md`, `modes/advisor.md`.
- `presets/` — **generated** agent presets. Never hand-edit; regenerate (see "Single-source discipline").
- `scripts/` — `sync-presets.mjs` (5 role presets), `sync-dsh-enhance-preset.mjs` (main orchestrator preset + subagent tool rows), `install-presets.mjs` (thin CLI over `src/features/presets/install.ts`: idempotent install of `presets/` into `$DSH_HOME/.agent-presets`, with backup, `--status`, `--check`, `--dry-run`, `--prune-renamed`, `--if-installed` for the `postinstall` hook).
- `qa/` — real-dsh LLM drivers (`dsh-enhance-drive.mjs`, `worktracking-drive.mjs`, `delivery-gate-drive.mjs`, `webbridge-drive.mjs`). They consume tokens and write evidence under `.dsh-enhance/evidence/`.
- `tests/` — `node --test` unit tests, incl. `presets-pin.test.mjs` (byte-pin), `tool-output-schema.test.mjs`, `advisor.test.mjs`.

## Single-source discipline (important)

- Edit the persona text only in `prompts/agents/<role>.persona.md`; the generated `presets/<role>/agent.cordis.yml` + `preset.yml` are **regenerated**, not hand-edited. Hand-editing or editing the source without regenerating breaks `tests/presets-pin.test.mjs` (byte-for-byte), which is intentional.
- The main orchestrator persona lives in `prompts/agents/dsh-enhance.persona.md`; the four dispatachable sub-personas reuse `scout / librarian / reviewer / task` sources. Regenerate with `node scripts/sync-dsh-enhance-preset.mjs`.
- Keep `docs/prompts-review/*.md` consistent when you change a persona's constraints.

## Build / test / verify

```sh
pnpm install
pnpm build          # tsc → lib/  (run after any src/ change)
pnpm typecheck      # tsc --noEmit
pnpm test           # node --test (all tests)
node scripts/sync-presets.mjs ; node scripts/sync-dsh-enhance-preset.mjs   # regenerate presets after persona edits
pnpm install:presets ; pnpm check:presets   # install presets/ into $DSH_HOME/.agent-presets, then verify
```

- **Tools must declare full `output.schema`.** A tool whose `execute` returns fields that `output.schema` does not cover is rejected by the harness ("returned invalid output") and breaks real sessions. When changing a tool's return shape, update the schema and add a case in `tests/tool-output-schema.test.mjs` (it runs the tool against a real schema check).
- Real-dsh QA scripts need a `DEEPSEEK_API_KEY` (they run true LLM sessions) and a profile linked to this checkout (e.g. `dsh-enhance`). They write evidence to `.dsh-enhance/evidence/` — do not commit transient sandboxes.

## Agent roles (from `docs/roles.md`)

Six roles: five persona presets **planner / scout / librarian / task / reviewer**, plus **advisor** (a per-session companion-review mechanism, not a selectable persona). The orchestrator preset (`dsh-enhance`) makes scout/librarian/reviewer/task dispatchable as scoped subagents, each with a `toolFilter` limiting its surface.

## Non-goals（刻意不做 —— 加功能前先读这一节）

上游 dsh 很厚：每加一块原生能力，重复面就从"加分"变成"负债"。下面这些**刻意不做**，除非有新证据推翻：

- **不做 goal 存储或 `goal_*` 工具**：目标是原生 `ctx.goals`（`create_goal`/`get_goal`/`update_goal` + `dsh-goal-round-driver`）。本插件曾自带 `goal_create/get/update` + `.dsh-enhance/goals/`，两套近邻 API 并存会让模型二选一 —— 已退役（`docs/value-assessment.md` §3）。
- **不读 `AGENTS.md`**：原生 `@deepseek-ai/dsh-agent-instructions` 负责完整指令链（`$DSH_HOME/AGENTS.md` + 项目根→cwd + 覆盖文件 + 嵌套重发现）。`rules-injector` 只读 `.dsh-enhance/rules/`。
- **不做 todo 续作驱动**：原生 goal 轮次驱动 + `todo_write` 已覆盖"继续干"；自建计数器没有写入者就是死代码。
- **不重复原生策略**：输出截断（原生 `tool-result-pruner`）、先读后写（原生 `fs-observation-policy`）—— 保留为已测纯函数，不在运行时接线。
- **不做团队模式（M8）**：原生 Agent Teams 已有成员/共享任务板/邮箱。
- **不新增并行 API**：任何"我们也来一个 X"之前，先用 `cordis_inspect_query` 在 live 运行时核对上游是否已提供。

## Working practice

- Read `AGENTS.md` and the relevant docs before changing code. Prefer existing helpers and conventions.
- Keep changes focused: one concern per change, add or update tests, run `pnpm test` + `pnpm typecheck` and `pnpm build`.
- Update `README.md` and any affected `docs/*` when behavior changes.
- Report failures honestly with the exact error; propose the next attempt.
- Task discipline: one `in_progress`, verify when done, commit increments.
