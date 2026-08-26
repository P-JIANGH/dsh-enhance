# AGENTS.md — working in oh-my-dsh (`omd`)

Guidance for agents and humans editing this repository. Read this before changing anything.

## What this repo is

`oh-my-dsh` (short form **omd**) is an oh-my-zsh-style enhancement bundle for DeepSeek Harness (`dsh`): a single installable plugin that contributes packaged skills, a persistent `oh-my-dsh/work-rules` prompt section, a session-start orientation hook, a `oh_my_dsh_doctor` diagnostic tool, guard + delivery-gate discipline, boulder/goal work tracking, worktree tools, the `ulw` deep-work mode, an advisor companion-review runtime, and an orchestrating persona that dispatches four subagent personas.

Refer to this project only as **oh-my-dsh** or **omd**.

Key docs before you start: `docs/architecture.md`, `docs/roles.md`, `docs/prompts-review/README.md`.

## Layout

- `src/index.ts` — plugin entry (`apply`), config schema, wiring of every feature.
- `src/features/` — capability implementations: `skills-provider`, `skill-trigger` (ulw), `boulder/` (work tracking), `worktree/`, `delivery-gate/`, `advisor/` (runtime, prompt, severity, emission-guard).
- `src/hooks/` — prompt/hook wiring: `work-rules`, `orient`, `rules-injector`, `start-work`, `todo-continuation`, `delivery-gate`.
- `src/tools/` — model-facing tools: `doctor`, `guards`, `guard-register`, `boulder-tools`, `worktree-tools`. Authored as raw `ToolDefinition`s with complete `output.schema` (see below).
- `prompts/` — single-source prompt text: `agents/<role>.persona.md`, `modes/ultrawork.md`, `modes/advisor.md`.
- `presets/` — **generated** agent presets. Never hand-edit; regenerate (see "Single-source discipline").
- `scripts/` — `sync-presets.mjs` (5 role presets), `sync-omd-preset.mjs` (main orchestrator preset + subagent tool rows).
- `qa/` — real-dsh LLM drivers (`omd-drive.mjs`, `worktracking-drive.mjs`, `delivery-gate-drive.mjs`, `webbridge-drive.mjs`). They consume tokens and write evidence under `.omd/evidence/`.
- `tests/` — `node --test` unit tests, incl. `presets-pin.test.mjs` (byte-pin), `tool-output-schema.test.mjs`, `advisor.test.mjs`.

## Single-source discipline (important)

- Edit the persona text only in `prompts/agents/<role>.persona.md`; the generated `presets/<role>/agent.cordis.yml` + `preset.yml` are **regenerated**, not hand-edited. Hand-editing or editing the source without regenerating breaks `tests/presets-pin.test.mjs` (byte-for-byte), which is intentional.
- The main orchestrator persona lives in `prompts/agents/oh-my-dsh.persona.md`; the four dispatachable sub-personas reuse `scout / librarian / reviewer / task` sources. Regenerate with `node scripts/sync-omd-preset.mjs`.
- Keep `docs/prompts-review/*.md` consistent when you change a persona's constraints.

## Build / test / verify

```sh
pnpm install
pnpm build          # tsc → lib/  (run after any src/ change)
pnpm typecheck      # tsc --noEmit
pnpm test           # node --test (all tests)
node scripts/sync-presets.mjs ; node scripts/sync-omd-preset.mjs   # regenerate presets after persona edits
```

- **Tools must declare full `output.schema`.** A tool whose `execute` returns fields that `output.schema` does not cover is rejected by the harness ("returned invalid output") and breaks real sessions. When changing a tool's return shape, update the schema and add a case in `tests/tool-output-schema.test.mjs` (it runs the tool against a real schema check).
- Real-dsh QA scripts need a `DEEPSEEK_API_KEY` (they run true LLM sessions) and a profile linked to this checkout (e.g. `omd`). They write evidence to `.omd/evidence/` — do not commit transient sandboxes.

## Agent roles (from `docs/roles.md`)

Six roles: five persona presets **planner / scout / librarian / task / reviewer**, plus **advisor** (a per-session companion-review mechanism, not a selectable persona). The orchestrator preset (`oh-my-dsh`) makes scout/librarian/reviewer/task dispatchable as scoped subagents, each with a `toolFilter` limiting its surface.

## Working practice

- Read `AGENTS.md` and the relevant docs before changing code. Prefer existing helpers and conventions.
- Keep changes focused: one concern per change, add or update tests, run `pnpm test` + `pnpm typecheck` and `pnpm build`.
- Update `README.md` and any affected `docs/*` when behavior changes.
- Report failures honestly with the exact error; propose the next attempt.
- Task discipline: one `in_progress`, verify when done, commit increments.
