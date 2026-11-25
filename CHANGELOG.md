# Changelog

## [Unreleased]

### Fixed

- `next-task` marked a task `auto-merge pending` whenever `git.autoMerge` was true, even with a local merge (`git.prFlow: false` or `git.remote: null`); the next task then stopped. Only the pull-request flow sets it now.
- `task merge` reported a PR as merged as soon as `gh pr merge` succeeded; with a merge queue the PR was only queued. It now checks that the PR is `MERGED` and otherwise stops with the task still active. Re-running it after the merge only does the local cleanup, and only when a merged PR's head is the current commit and the tree is clean; an older merged PR for a reused branch name never skips the checks.
- `task merge` deleted the local task branch with `git branch -d`, which fails after a squash or rebase merge; it uses `-D` once GitHub reports the PR merged.
- The CLI ended with `process.exit()`, which can cut output written to a pipe; it sets the exit code instead.
- Config: elements of `models.tiers`, `models.banned`, `riskAreas`, `git.requiredChecks` and values of `models.floors` must be strings; a `__proto__` key in the file is ignored instead of changing an object's prototype; routing and floors ignore inherited property names.

### Added

- `test/e2e-cli.test.mjs`: an end-to-end run of the CLI and hooks as real processes in a real git repository (init, session brief, task start, model guard, ledger, memory lint, gate, local merge, ledger report), run by CI on every platform.

## [0.1.0] - 2026-11-23

### Added

- Skills: `init`, `plan-phase`, `next-task`, `phase-review`, `status` (slash commands) and `grill`, `task-package-writing`, `model-routing` (used by the others).
- Agents: builder, specialist, reviewer, security-reviewer, scaffolder, verifier.
- CLI `scripts/darkforge.mjs`: `doctor`, `init apply|defaults`, `gate`, `memory lint`, `ledger phase|report`, `task start|merge`.
- Hooks: model-guard (PreToolUse on `Agent`), token ledger (SubagentStop, Stop), session brief (SessionStart).
- Templates for the project layer: memory bank, constraints, phase plan, task package, `CLAUDE.md` block, gate skeletons.
- Docs: user guide, config reference, worked example, end-to-end checklist.
- CI: `node --test` on Windows, macOS and Linux with Node 18 and 22.

### Known issues

- The manual end-to-end run (`docs/testing/e2e-checklist.md`) has not been done yet for this release.
- Token ledger is best effort; see Known limits in the user guide.
