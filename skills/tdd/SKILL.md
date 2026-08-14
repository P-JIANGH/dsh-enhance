---
name: tdd
description: Use when implementing a new behavior or fixing a bug that can be covered by tests — a test-driven cycle: write the failing test, watch it fail for the right reason, implement minimally, and refactor under green
---

# Test-driven development

Follow the red-green-refactor cycle. The test is the specification; the implementation is what makes it pass.

## The cycle

1. **Red:** write one failing test that pins the desired behavior. Run it and confirm it fails for the stated reason (not a compile or setup error).
2. **Green:** implement the minimal change that makes the test pass. Resist adding anything the test does not demand.
3. **Refactor:** clean up under a green suite — rename, extract, remove duplication — and re-run the tests after each step.

## Discipline

- One behavior at a time; keep steps small.
- Test the behavior, not the implementation: assert outcomes, not internal calls.
- Cover the edge cases that matter: boundaries, empty input, error paths, cancellation.
- When a bug surfaces in production, first write a test that reproduces it, then fix.

## Integration

- Run the project's existing test command before and after your change.
- Match the repository's testing conventions (framework, fixtures, naming) — read AGENTS.md and the project's testing docs first.
