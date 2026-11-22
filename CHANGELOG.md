# Changelog

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
