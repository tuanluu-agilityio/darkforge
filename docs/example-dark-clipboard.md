# Worked example: the process darkforge came from

darkforge packages a process first run by hand on **Dark Clipboard**, a local-first clipboard manager for Windows, macOS and Linux written in Rust, by Tuan Luu (the author of this plugin). This page shows that process so the plugin's steps have a concrete picture. Nothing here is required to use darkforge, and darkforge contains nothing specific to that project.

## The hand-made setup

- `CLAUDE.md` with the rules: phase discipline, one task = one branch = one agent, independent review, quality gate before merge, protected `main` with pull requests, privacy rules that are never negotiable.
- `memory-bank/activeContext.md` and `progress.md`, read at the start of every session; nothing else unless the task needs it.
- `docs/plans/global-constraints.md` with numbered constraints (for example, never read clipboard content before the privacy policy decision; never log content).
- `docs/plans/phase-N-*.md` phase plans and `docs/tasks/NNN-*.md` task packages with "Read first", files, interfaces, exact tests and "not doing".
- Project agents (builder, specialist, reviewer, security-reviewer, scaffolder, platform verifier) and project skills (`next-task`, `phase-review`, `status`, plus domain checklists such as a privacy gate).
- `scripts/check.ps1` / `check.sh` printing `ALL CHECKS PASSED` as the gate.

## One task, as it ran

1. The session read the two memory-bank files and picked the next task from `activeContext.md`.
2. It created `task/NNN-short-name` from the latest `main`.
3. It chose the model by risk: a storage or capture task went to the specialist on opus and was reviewed by the security reviewer on opus; a documentation task went to a cheaper model.
4. The implementer followed the package test-first and ran the gate.
5. A different agent reviewed the diff against the package and the constraints. Defects went back to the same implementer as a short list.
6. The session updated `progress.md` (status, model, tokens) and `activeContext.md` (next task), pushed, opened a pull request, merged it after CI, and synced `main`.

## What darkforge changed

| By hand | darkforge |
|---|---|
| Branch, PR, merge commands typed by the session each time | `darkforge task start` / `task merge` with precondition checks |
| "Never use model X" as a rule in `CLAUDE.md` | `models.banned` enforced by the model-guard hook |
| Model chosen per task from memory of the rules | `routing` per risk level, explicit `model` on every darkforge agent call |
| Token counts copied into `progress.md` by hand | Ledger hooks and `darkforge ledger report` |
| Memory-bank drift found late | `darkforge memory lint`, checked by `task merge` |
| Gate output read in full every time | Quiet gate: failing lines or the success marker only |
| Project-specific agents | Generic agents that read the project config and constraints file |
