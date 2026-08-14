---
name: git-workflow
description: Use when planning, committing, or rewriting git history — a safe git workflow: small atomic commits, clean history, stacked branches, and force-push discipline
---

# Git workflow

Work in small, reviewable steps and keep history clean. Verify before every history rewrite and never lose another person's work.

## Committing

- **Atomic commits:** one logical change per commit; keep whitespace and refactors out of behavior changes.
- **Commit messages:** imperative subject line, then a body explaining why (not what — the diff shows what).
- **Never commit secrets, credentials, or build artifacts.** Check `.gitignore` and `git status` before staging.

## Rewriting history

- Use `git rebase` for local cleanup; `git merge` for shared branches.
- **Never** raw `git push --force` on a shared branch. Use `--force-with-lease`; abort if the remote moved.
- Before any rebase, record the current state: `git reflog` is the escape hatch, and a stash or backup branch costs nothing.

## Reviewing your own work

- `git diff --check` for whitespace errors before committing.
- Re-read the staged diff (`git diff --cached`) as a reviewer would.
- For a stacked change, verify each commit builds on its base.

## Repo-specific rules

- Follow the repository's own commit conventions (scope prefixes, signed commits, branch naming) when AGENTS.md or CONTRIBUTING.md defines them.
