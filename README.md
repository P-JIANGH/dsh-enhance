# oh-my-dsh

oh-my-zsh-style enhancement bundle for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). One install gives you a curated set of working aids — packaged skills, a persistent work-rules prompt section, a session-start orientation hook, and a doctor tool — plus a growing v2 surface: a reviewed 6-role agent set (`planner` / `scout` / `librarian` / `task` / `reviewer` / `advisor`), single-source prompt generation, and a delivery-gate discipline. Install and go.

Inspired by the `oh-my-pi` ecosystem and open-source agent enhancement tools: opinionated defaults that make an agent harness noticeably more useful out of the box.

## What you get

| Piece | What it does | Turn it off |
|---|---|---|
| **Packaged skills** (`code-review`, `git-workflow`, `tdd`) | Skill bundles shipped inside the package and exposed through the standard `skill` tool | `skills` are always on |
| **Work-rules section** | A persistent system-prompt section (`oh-my-dsh/work-rules`) with general working discipline | `workRules: ''` |
| **Orientation hook** | At each session start, injects one message naming the active bundle and its skills | `orientOnSessionStart: false` |
| **Doctor tool** | `oh_my_dsh_doctor` reports live assembly state: loaded plugin, registered skills, effective config | `doctorTool: false` |
| **Agent presets** (`planner`, `reviewer`, `scout`, `librarian`, `task`) | Optional preset directories shipped in `presets/`, generated from `prompts/agents/` single sources | Not mounted by default |

## Install

Requires the `dsh` CLI (npm: `@deepseek-ai/dsh`).

```sh
# from npm (once published)
dsh plugin --profile my-profile add oh-my-dsh

# or straight from this checkout
dsh plugin --profile my-profile add ./path/to/oh-my-dsh

# or from git (the package builds itself via `prepare`)
dsh plugin --profile my-profile add git@gitcode.com:jiangh_hnr/oh-my-dsh.git
```

The bundle is a patch layer: it inserts one `oh-my-dsh` plugin row into the profile. Verify with:

```sh
dsh --profile my-profile --dump-config   # look for the "# == oh-my-dsh" layer
```

## Configure

The plugin row takes a `config` block — override it in your profile's `cordis.patch.yml` or home `$DSH_HOME/cordis.patch.yml`:

```yaml
- id: oh-my-dsh
  name: oh-my-dsh
  config:
    workRules: |
      # My team's rules
      Always run the full test suite before pushing.
    orientOnSessionStart: true
    doctorTool: true
```

| Field | Default | Meaning |
|---|---|---|
| `workRules` | built-in discipline prose | Prompt-section text; empty string drops the section |
| `orientOnSessionStart` | `true` | Inject the one-time orientation message at session start |
| `doctorTool` | `true` | Register the `oh_my_dsh_doctor` tool |

## Agent presets (optional)

`presets/` ships five agent compositions for `dsh-agent-presets`: **planner / reviewer / scout / librarian / task**. (The v2 role set, see `docs/roles.md`, also includes **advisor**, but it is a session-level companion-review mechanism, not a standalone preset persona.) They are **not mounted by default** because mounting the agent-presets row claims the profile's preset roster. To use one:

1. Copy the preset directory into your presets root, e.g. `$DSH_HOME/.agent-presets/planner/`, or point `agent-presets.roots` at `<install>/node_modules/oh-my-dsh/presets`.
2. Select it as the default preset for the profile.

The preset directories are generated from the single-source persona files under `prompts/agents/` — edit the `.persona.md`, then `pnpm sync:presets`. Never hand-edit `presets/`; a byte-pin test (`tests/presets-pin.test.mjs`) fails if the generated output drifts from the source.

## Development

```sh
pnpm install
pnpm build          # tsc → lib/
pnpm typecheck
pnpm test           # node --test
pnpm sync:presets   # regenerate presets/ from prompts/agents/ single sources
```

The package is ESM with zero runtime dependencies: all `@deepseek-ai/dsh-*` imports are type-only (erased at build), and `@deepseek-ai/cordis` is a peer provided by the harness.

## Design docs

- `docs/architecture.md` — v2 architecture & the M1–M8 milestone plan.
- `docs/roles.md` — the 6-role agent set (decided; this package implements it).
- `docs/prompts-review/` — per-prompt review drafts: persona/review sources + constraint-mapping + size check + drive-state.
- `docs/archive/` — superseded/obsolete documents kept for history.
- `docs/borrowing-analysis.md` — pattern borrowing from MIT ecosystems (lazycodex, oh-my-pi) and how each lands.

## Roadmap (v2 milestones)

- **M1 ✅ skeleton**: `src/` reorg into per-capability dirs; `prompts/agents/` single sources + generation + byte-pin; 5 agent presets landed.
- **M2 ✅ prompt review**: all prompts reviewed & Chineseized; 6-role system adopted.
- M3 guards (write-pending / path-traversal / delivery-gate) — next.
- M4 work tracking (boulder), M5 worktree, M6 skill-trigger routing, M7 LSP/comment-check.
- M8 team mode (roadmap, post-stabilization).
- More packaged skills (debugging, refactoring, docs-writing); a CLI surface; theme-like prompt presets.
