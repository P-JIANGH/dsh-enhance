# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
version scheme is [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Detailed rationale for each decision lives in `docs/` (the ledger in
`docs/known-issues.md` records what was measured, and why it changed).

## [0.1.2] — 2026-10-10

The first release published through the GitHub Packages workflow. Nothing about
plugin behaviour changed; the test suite became portable and CI now proves it.

### Fixed

- **`desktopRootOf` parsed Windows paths with the host's `path` semantics.** The
  function's input domain is a Windows shim path (`…\dsh.cmd`), but it used
  `path.dirname`, which on Linux is the POSIX version: five iterations over a
  backslash-separated path turned it into `'.'` instead of the application root. It now
  uses `win32.dirname`. This was invisible until the suite first ran on Linux — the
  publish workflow was that first run, and it failed on exactly this test.
- **The "a state with no timestamp counts as stale" write-token test never built such a
  state.** Its `seed()` helper filled `exec_holder_at` with `Date.now()` and the pid with
  the live test process, so the case being asserted could not occur; it passed only when
  writing the file happened to cross a millisecond boundary (`now - stampedAt > 0`). It
  now deletes the fields explicitly, and a complementary control asserts that a holder
  stamped exactly at `now` with a live process is *not* stale — together they pin the
  rule without depending on timing.

### Changed

- **CI runs on `windows-latest` and `ubuntu-latest`.** The workflow previously said, in
  its own header, that Windows-only was a deliberate choice because the suite had
  platform assumptions, with cross-platform left as a v2 item. Those assumptions were
  the two defects above, and they surfaced in a *release* run instead of in CI. With them
  fixed, the Linux leg exists so this class of failure is caught before a merge rather
  than at publish time. Only the CRLF skill-tree regression stays Windows-only, because
  CRLF is a Windows checkout property.

[0.1.2]: https://github.com/P-JIANGH/dsh-enhance/releases/tag/v0.1.2

## [0.1.1] — 2026-10-10

A packaging release: **nothing about plugin behaviour changed**. The plugin row id
(`dsh-enhance`), the prompt section names (`dsh-enhance/work-rules`,
`dsh-enhance/enhance-mode`), the tool names, the config namespace and the settings
page key all stay the same, so existing `cordis.patch.yml` overrides keep working
unchanged.

### Changed

- **The npm package is now `@p-jiangh/dsh-enhance`** (it was
  `@dsh-enhance/dsh-enhance`). Reason: GitHub Packages documents the package scope as
  the **repository owner** — `@my-org/test` is published to the `my-org/test`
  repository — and names/scopes must be lowercase. `@p-jiangh` matches this
  repository, so the plugin can be published to a registry without an organisation.
  The project name is still **dsh-enhance**; only the package name carries the scope.

### Added

- **`.github/workflows/publish-github-packages.yml`** — publishes to GitHub Packages
  on manual dispatch, authenticating with the workflow's own `GITHUB_TOKEN`
  (`packages: write`), so no personal access token is involved. It asserts that the
  checked-out commit **is** the `v<version>` tag before publishing, which keeps the
  "publish from the tag, never from master" rule enforced by machine rather than by
  discipline.
- The channel itself is documented in `docs/releasing.md` §5.5, including the part
  that matters to users: GitHub Packages requires an access token to **install**
  packages too, even public ones, so it is an alternative channel and not a
  replacement for the token-free release tarball.

[0.1.1]: https://github.com/P-JIANGH/dsh-enhance/releases/tag/v0.1.1

## [0.1.0] — 2026-10-09

First release: M1–M6 of `docs/architecture.md` plus the settings surface. It is an
oh-my-zsh-style bundle for DeepSeek Harness — install it into a profile and the
capabilities below are simply there.

### Added

- **Packaged skills** (`code-review`, `git-workflow`, `tdd`) exposed through the
  standard `skill` tool.
- **`dsh-enhance/work-rules`** — a persistent system-prompt section carrying the
  working-rules discipline; `workRules: ''` removes it.
- **`dsh_enhance_doctor`** — one tool that reports live assembly state (plugin
  loaded, registered skills, effective config) with an actionable next step.
- **Human commands** `/doctor` and `/boulder` in the `/` menu: zero tokens, never
  part of the model's history.
- **Guards + delivery gate** — write-existing / path-traversal / bash-read guards,
  a rules injector that reads this bundle's own `.dsh-enhance/rules/*.md`, and a
  completion-claim gate that binds a work item to its `verify` script plus a
  sha256 protected-file manifest (any edit after the snapshot is `tampered`).
- **Boulder work tracking** — CAS state, an exclusive write token, and
  start-work / delivery-gate hooks. Goals are **native** (`ctx.goals`), not ours.
- **Worktree tools** — `worktree_create` / `worktree_list` / `worktree_cleanup`,
  wired into boulder.
- **Advisor** — a companion reviewer that follows every main session: it reads
  each turn's transcript increment and steers back at most one emission
  (`nit` / `concern` / `blocker`) through an emission guard.
- **The `Enhance` agent preset** (id `enhance`) — a single preset row declared by
  this bundle's patch: it keeps orchestration (scout / librarian / reviewer /
  task as scoped subagents behind tool filters) and mounts the deep-work contract
  as a persistent prompt section. Install the bundle and the preset is simply in
  the roster; there is no install step and nothing is written to your home.
- **A settings page on the built-in Plugins panel** — six switches plus the
  advisor model, edited in place and applied immediately (writes the user layer
  of your profile patch; every field can be reset independently).

### Changed

- **Deep work is preset-scoped, not keyword-triggered.** The retired
  `ulw` / `ultrawork` trigger injected a contract when a token appeared in user
  input; the honest seat for "what a session is made of" is the agent preset, so
  the contract now lives in `enhance-mode` and only sessions on the Enhance
  preset carry it. No trigger word, no exit action.
- **One preset, not six.** The five role presets (planner / scout / librarian /
  task / reviewer) were retired as presets: those four roles ship as scoped
  subagents *inside* Enhance, which is what the roster should show.
- Development dependencies now match the runtime this bundle targets
  (`@deepseek-ai/*` at `0.2.0-rc.2`, `cordis` 4.0.4) instead of a different major
  line, so `tsc` checks the code against the host it actually runs on.
- Host-supplied packages follow the first-party convention: `schemastery` is a
  dependency (a pure data library, safe to duplicate — the host recognises native
  schemas through the global `Symbol.for('schemastery')`), while `cordis` and
  `dsh-llm` are optional peers, because the harness's runtime resolver already
  supplies installation and bundle packages to plugins.

### Fixed

- **A CRLF checkout made every packaged skill disappear.** `parseSkillBody` anchored
  its frontmatter fence with `\n`, so a checkout with `core.autocrlf=true` — git's
  Windows default, and therefore the `github:` install path on Windows — produced a
  tree where `list()` returned nothing: the directory existed, the plugin loaded, the
  doctor said it was fine, and not one skill was contributed. On a fresh repository
  this was caught by CI's first run, not by the local suite, because the local
  checkout happened to be LF. The parser now normalises line endings, `skills/**` is
  pinned to `eol=lf`, and CI rewrites the skills to CRLF and re-runs the tests so the
  guard no longer depends on how anything is checked out.
- **Two default-on hooks never fired.** `start-work` (`workTracking`) and the
  rules injector (`guards`) were bound to `agent/session-start`, an event that
  does not exist in the 0.2.0 catalogue — a listener on a name nobody emits fails
  silently. Both now bind `agent/created`, honour its contract (dispatched
  serially and awaited before agent creation resolves), and skip delegated
  children, so a subagent can never claim the write token.
- **Injections no longer claim to be the human.** Every user-role message this
  bundle creates was stamped `source: { kind: 'user' }`; the harness's own
  vocabulary says a producer declares its own kind, so all five call sites now
  stamp `plugin:dsh-enhance` and stay distinguishable from what you actually typed.
- Packaging: no host-supplied service package is declared as a dependency any
  more, so nothing is hoisted into a profile to shadow the host's copy (a
  duplicate of `dsh-llm` breaks module-level identity).
- QA: the launcher now resolves the desktop host (0.2.0-rc.2) instead of silently
  falling back to an old CLI, and the new `pnpm qa:pack` gate installs the real
  tarball into a throwaway profile and asserts the whole path, including that
  plugin loading needs nothing but the host.

### Removed

- Goal storage and the `goal_*` tools (native `ctx.goals` +
  `dsh-goal-round-driver` cover it; two near-identical APIs make the model guess).
- The `AGENTS.md` re-read (`@deepseek-ai/dsh-agent-instructions` owns that chain).
- The todo-continuation driver and the `orient` session-start hook (the event it
  bound does not exist in 0.2.0).
- Directory-based preset installation, `/presets`, the `postinstall` script and
  every write to your home directory: presets are patch rows, and installing this
  bundle is the only action.

### Compatibility

- The **preset row** needs dsh ≥ 0.2.0 (row-based preset registry). On older CLIs
  the row is reported as an inactive entry rather than failing installation.
- Presets are only selectable on the Web/desktop surface, so a headless-only
  profile prints one expected line at startup
  (`preset-enhance … pending (waiting for service: agentPresets)`); the plugin
  itself works there.

[0.1.0]: https://github.com/P-JIANGH/dsh-enhance/releases/tag/v0.1.0
