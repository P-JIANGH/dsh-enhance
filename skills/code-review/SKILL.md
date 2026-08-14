---
name: code-review
description: Use when reviewing a pull request, a changeset, or any diff — a systematic review workflow that verifies the change against its stated intent, the repository conventions, and the surrounding code before judging it
---

# Code review

**This skill is guidance, not a complete checklist.** Ground every review in the live repository: read the diff, the changed files, and enough surrounding code to understand the design. Verify the change compiles and passes the project's relevant checks before judging it.

## Before reviewing

1. Identify the change's stated intent (PR description, issue, or commit message).
2. Establish the base and head of the diff; note any retarget or merge that invalidates an earlier review.
3. Read the diff, then the full context of each changed file.

## Blocking issues (check first)

- **Correctness:** does the change do what it claims, including edge cases, error paths, and cancellation?
- **Scope:** does it touch files or behavior unrelated to its intent?
- **Contracts:** do changed interfaces, configs, formats, and public behavior update their documentation in the same change?
- **Regressions:** are existing tests and documented behaviors preserved?
- **Safety:** does it introduce credential, sandbox, permission, or resource-exhaustion hazards?
- **Cleanup:** does every registration, listener, process, or resource have a teardown path?

## Non-blocking notes

- Style, naming, and symmetry: prefer to point at the repo's own conventions.
- Tests: flag missing coverage for changed behavior, but do not demand coverage for coverage's sake.

## Reporting

- Prioritize: one substantiated blocker is more valuable than a list of nits.
- Cite exact files and lines; quote the problematic code.
- Separate "must fix" from "consider".
- A review that finds nothing blocking says so explicitly, with the checks that were run.
