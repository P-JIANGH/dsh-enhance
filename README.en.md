# dsh-enhance

An oh-my-zsh-style enhancement bundle for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`). One install gives you packaged skills, a persistent working-rules prompt
section, a diagnostic doctor tool, and a growing v2 surface: work tracking
(boulder + write token; goals stay **native**), guards with a delivery gate,
worktrees, a companion-review advisor runtime, and an orchestrator preset
**Enhance** (id `enhance`) that dispatches scout / librarian / reviewer / task as
scoped subagents — and carries a deep-work contract (`enhance-mode`) as a
persistent, preset-scoped system-prompt section.

> 中文说明见 [README.md](README.md)（本文件是英文版）。

## What you get

| Capability | What it does | How to turn it off |
|---|---|---|
| **Packaged skills** (`code-review`, `git-workflow`, `tdd`) | Skills shipped with the bundle, exposed through the standard `skill` tool | always on |
| **work-rules section** | A persistent system-prompt section (`dsh-enhance/work-rules`) holding general working discipline | `workRules: ''` |
| **doctor tool** | `dsh_enhance_doctor` reports live assembly state (plugin loaded, registered skills, effective config) and an actionable next step | `doctorTool: false` |
| **Human commands** (`/doctor`, `/boulder`) | Entries that belong to this bundle in the `/` menu; results render in the UI only — no tokens, never part of the model's history | `commands: false` |
| **Guards + delivery gate** | write-existing / path-traversal / bash-read guards, a rules injector (reads `.dsh-enhance/rules/` only), and a completion-claim gate bound to a `verify` script plus a **sha256 protected-file manifest** (any later edit is `tampered`); a native goal that is not finished makes a claim a progress report | `guards: false` |
| **Work tracking** | boulder (CAS) + write token + start-work / delivery-gate hooks. **Goals are native**: `create_goal` / `get_goal` / `update_goal` + `dsh-goal-round-driver` | `workTracking: false` |
| **Worktrees** | `worktree_create` / `worktree_list` / `worktree_cleanup` wired into boulder | `worktree: false` |
| **enhance-mode section** | A deep-work contract contributed as `@dsh-enhance/dsh-enhance/enhance-mode` and mounted **only inside the Enhance preset**: sessions on that preset always carry it, sessions on any other preset never see it. No trigger word, no exit action | not in the preset, not present (`preset-enhance` row) |
| **Advisor** | A companion reviewer following every main session: it reads each turn's transcript increment and steers back at most one suggestion (`nit` / `concern` / `blocker`) | `advisor: false` |
| **Agent preset** | This bundle ships exactly **one**: `Enhance` (id `enhance`). Presets are declared by the bundle patch (`cordis.patch.yml`) — **there is no install step**, and the other roster entries (standard / ptc / minimal / cordis) come from upstream | see `docs/modes.md` |
| **Settings page** | The built-in Plugins panel shows a config entry on this bundle's row: six switches plus the advisor model, applied as you save (written to the user layer of your profile patch; each field resets independently) | nothing to configure; only `workRules` still needs YAML |

## What you will see after installing

A bundle is a **profile-level** plugin: it mounts when the profile starts and
**every session shares it**, so it is already active without picking a preset
(`dsh_enhance_doctor` reports "plugin loaded: yes").

| You see | How to reach it | Needs |
|---|---|---|
| **Packaged skills** in the `/` menu | type `/`, or type `/tdd` directly — a typed skill name injects its body for that turn, deterministically | the bundle mounted |
| **This bundle's commands** `/doctor`, `/boulder` | type `/` and pick one (both take no arguments; Enter runs them) | `commands: true` (default) |
| **The `Enhance` preset** | pick it in the preset menu next to a new session's title, or set it as the default in settings | the bundle mounted (the preset row rides with it) |
| **Model-facing tools** `dsh_enhance_doctor`, `boulder_*`, `worktree_*` (goals use the native `create_goal` / `get_goal` / `update_goal`) | just let the model use them, or ask it to "run dsh_enhance_doctor" | the matching switch (all on by default) |
| **This bundle's settings page** | sidebar → Plugins panel → `@dsh-enhance/dsh-enhance` → its row's config entry | desktop app or loopback Web (the browser half ships with the bundle) |

Two easy misunderstandings:

- **A preset is fixed when the session is created.** Upstream refuses to switch a
  live session's preset (its history was produced under the previous tool
  surface). To try **Enhance**, create a new session; setting a new default only
  affects sessions created afterwards.
- **enhance-mode is not an instruction and not a trigger word** — it is a
  persistent prompt section scoped to the Enhance preset. The row-based preset
  registry requires **dsh ≥ 0.2.0** (see `docs/installing-plugins.md`).

## Install

You need the `dsh` CLI (npm: `@deepseek-ai/dsh`). The examples use a profile named
`dsh-enhance`; substitute your own name.

```sh
# from the GitHub source (the package builds itself through `prepare`)
dsh plugin --profile dsh-enhance add github:<owner>/dsh-enhance

# or from a local checkout
dsh plugin --profile dsh-enhance add ./path/to/dsh-enhance

# or as a live link for debugging (point it at your checkout; run `pnpm build` after src/ edits)
dsh plugin --profile dsh-enhance add link:<checkout>
```

> The package name is `@dsh-enhance/dsh-enhance` — **not** the bare name
> `dsh-enhance`, which is a different, unrelated name on npm. All three install
> forms above resolve by path or repository, so the package name never appears in
> the command.

Verify what the profile will actually assemble:

```sh
dsh --profile dsh-enhance --dump-config   # look for the "# == @dsh-enhance/dsh-enhance" layer
```

### Presets (no install step)

Presets are declared by the bundle's patch layer, **not** by a directory:
`cordis.patch.yml` inserts this bundle's plugin row and the `preset-enhance` row
(`@deepseek-ai/dsh-agent-preset`). Mount the bundle and **Enhance** appears in the
roster (this bundle ships only that one). There is no `/presets install`, no
`postinstall`, and the plugin never writes to your home directory at startup.

`config.plugins` is the session agent's **entire** composition (**there is no
inheritance**): the Enhance preset lists its persona (a `prefix` — the persona
prose), `agent-instructions` (the AGENTS.md chain), tool rows, four scoped
subagents, and the `@dsh-enhance/dsh-enhance/enhance-mode` row. Those four
subagents (scout / librarian / reviewer / task) are part of the preset and no
longer appear in the roster themselves.

> **Compatibility (important)**: `@deepseek-ai/dsh-agent-preset` only exists in the
> **dsh ≥ 0.2.0** row-based preset registry. An old CLI (such as an nvm-installed
> `0.1.0-rc.6`, whose mechanism was the retired directory-based
> `dsh-agent-presets`) cannot resolve the row; it becomes an inactive entry (with
> a startup warning) rather than failing installation. This bundle deliberately
> does not invent a conditional-insert mechanism for that.
>
> **Presets are only selectable on the Web/desktop surface**: the `agentPresets`
> service comes from the Web composition (`@deepseek-ai/dsh-web-app`). A
> headless-only (or acp / sdk) profile therefore prints one line at startup —
> `preset-enhance (@deepseek-ai/dsh-agent-preset): pending (waiting for service: agentPresets)`.
> That is upstream's preset row waiting for its service, **not an install
> failure**: the plugin itself works there (tools, commands and the work-rules
> section are all present), there is simply no preset menu. `pnpm qa:pack` pins
> that line as "known, and the only one".

## Configuration

The plugin row accepts a `config` block, overridable in your profile's
`cordis.patch.yml` or in `$DSH_HOME/cordis.patch.yml`:

```yaml
- id: dsh-enhance
  name: '@dsh-enhance/dsh-enhance'
  config:
    workRules: |
      # Team rules
      Always run the full test suite before pushing.
    doctorTool: true
```

| Field | Default | Meaning |
|---|---|---|
| `workRules` | built-in discipline text | prompt-section text; the empty string removes the section |
| `doctorTool` | `true` | register the `dsh_enhance_doctor` tool |
| `commands` | `true` | register the `/doctor` and `/boulder` human commands |
| `guards` | `true` | master switch for the guards, the rules injector and the delivery gate |
| `workTracking` | `true` | boulder state, write token, start-work / delivery-gate hooks (goals are native and unaffected) |
| `worktree` | `true` | the `worktree_*` tools (needs workTracking) |
| `advisor` | `true` | the advisor companion-review runtime |
| `advisorModel` | — | the advisor subagent's own model; inherits the main agent's route by default |

> Overriding a key means carrying `name` **and** every field you want to keep —
> a patch replaces the row's whole `config`; an omitted field falls back to its
> schema default.

### Editing in the UI instead of YAML

Every field except `workRules` is marked `volatile()`, so the built-in **Plugins**
panel gives this bundle's row a config entry: toggles apply as you save (the
wiring is rebuilt immediately, no restart), and the change lands in the user layer
of your profile's `cordis.patch.yml`. Each row's reset removes that override and
falls back to the composed default.

- One writer per field: after editing in the UI, do not also hand-write the same
  key in a patch — the UI reads your override as the user layer and the two will
  overwrite each other.
- Known upstream limitation: a non-loopback browser cannot hold persistent
  settings and shows the page read-only; the desktop app and loopback Web are fine.
- Mechanism and real-app evidence (a `describe` / `update` round trip, the
  namespace key, why the wiring must be remounted):
  `docs/design-web-settings-card.md` §8–§10.

## Development

```sh
pnpm install
pnpm build          # tsc → lib/
pnpm typecheck
pnpm test           # node --test
pnpm sync:enhance-preset   # regenerate cordis.patch.yml from the persona + subagent rows
pnpm qa:pack        # pack-install acceptance (zero tokens): real tarball → throwaway profile → assertions
```

The package is ESM. **Dependency rule** (read this before touching the manifest —
it is an evidence-backed convention, not a preference):

| Package | Declared as | Why |
|---|---|---|
| `@deepseek-ai/schemastery` | `dependencies` | First-party dsh plugins declare it this way. It is a **pure data** library: the host recognises native schemas through the global `Symbol.for('schemastery')` (`dsh-app-boot`'s `isNativeConfigSchema`), so a same-version copy is safe. |
| `@deepseek-ai/cordis` | `peerDependencies` (optional) | The host *is* cordis; a profile never installs it, and we only import types. |
| `@deepseek-ai/dsh-llm` | `peerDependencies` (optional) | We do use it at runtime (`createUserMessage` / `BlockAssembler`), but it carries **module-level identity**: one profile may hold only the host's copy. |
| Other `@deepseek-ai/dsh-*` | `devDependencies` only | Type-only imports (erased at build), version-aligned with the host's `0.2.0-rc.2`. |

**Never** declare a service-class host package (`dsh-llm` / `dsh-agent` /
`dsh-tools` / `cordis` …) as a `dependencies` entry: that hoists a second copy
into the profile which then **shadows** the host's, breaking module-level identity.
The host's runtime resolver already supplies them for free — `dsh-app-boot`'s
`createRuntimeResolution`: *"The runtime resolution supplies packages carried by
the installation and selected bundles."* `pnpm qa:pack` pins that boundary on a
**real tarball install**, because the `link:` layout used by the rest of the test
suite hides it.

Contributor discipline: read `AGENTS.md` first; before touching prompts or roles
read `docs/architecture.md` and `docs/roles.md`; persona text is single-sourced in
`prompts/agents/` (never hand-edit the generated `cordis.patch.yml` — a byte-pin
test enforces this).

## Design documents

- `AGENTS.md` — how to work in this repository.
- `docs/architecture.md` — architecture and the M1–M8 plan.
- `docs/value-assessment.md` — **why this project exists**: each surface compared
  with the upstream native capability; the conclusion is to position it as a
  "policy package + acceptance scaffolding" and subtract rather than expand.
- `docs/roles.md` — the six-role agent set.
- `docs/modes.md` — the three working modes and how they orchestrate those roles.
- `docs/prompts-review/` — per-prompt review: source, constraint mapping, size
  checks, real-drive status.
- `docs/borrowing-analysis.md` — patterns borrowed from the MIT ecosystem.
- `docs/installing-plugins.md` — the full install / verify / configure / uninstall
  walkthrough, including the generic plugin mechanism.
- `docs/known-issues.md` — the ledger: what was measured, what changed, and why.

## Roadmap

**v1 is exactly M1–M6 plus the settings page**: a capability package that works as
soon as it is installed. M7 and the other unstarted items below are **v2**, not
unfinished v1.

- **M1 ✅ Skeleton** — capability-directory layout, single-sourced personas, byte pins.
- **M2 ✅ Prompt review** — every prompt reviewed and localised; the six-role system.
- **M3 ✅ Guards + delivery gate** — guards, rules injector, gate state machine,
  bound `verify`, tamper resistance.
- **M4 ✅ Work tracking** — boulder (CAS), write token, start-work + gate hooks.
  Goal storage and the `goal_*` tools were **retired** (native `ctx.goals`).
- **M5 ✅ Worktrees** — manager (create / list / find / cleanup / reuse), naming
  and path validation, boulder linkage, the three tools.
- **M6 ✅ enhance-mode** — the deep-work contract became a **persistent prompt
  section scoped to the Enhance preset**; the keyword trigger and directory-based
  preset delivery were retired.
- **M7 LSP / comment-check (v2)** — planned.
- **M8 Team mode (v2)** — **not recommended to build**: upstream already ships
  Agent Teams (members, shared task board, mailbox).

v2 candidates (decided, not started): mode B (Planner preset), mode C (Advisor
preset), the delivery gate's `verify` template library, the UI flagship (Chat Node
/ turn-tail status bar), the `playbooks/` onboarding layer, a larger skills pool.

## License

MIT
