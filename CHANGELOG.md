# Changelog

## [Unreleased]

### Added

- The dashboard shows estimated cost at API list prices: a total, a price per task, model and spender, and cost by token kind. Unpriced records (unknown model or no usage) are flagged with `+?`, not counted as free. `prices` in `.darkforge/config.json` overrides the built-in table.

## [0.4.0] - 2026-11-27

### Added

- `darkforge dashboard --watch [--open] [--port <n>]`: serves the dashboard live on `127.0.0.1` (secret token in the URL, read-only, no CORS). The page shows the running step, fix round, questions waiting on the owner and tokens per finished agent, and updates within about a second of a change without losing the selection, scroll or focus. `--open` opens a private redirect file, so the token never appears in process arguments. Stop it with Ctrl+C.
- `.darkforge/state.json` records the running step: `since`, `implementer` and `reviewer` (agent and model), and the fix `round`. `task begin`, `ledger phase fix` and the model-guard hook write them.
- New `ask-watch` hook (PreToolUse/PostToolUse on `AskUserQuestion`) records the questions the session is asking the owner as `waiting`; the Stop hook clears them. `next-task` now asks the owner with `AskUserQuestion`.
- The static dashboard shows the same running-step fields as a snapshot.

### Known issues

- `dashboard --watch --open` has been tested on Windows only.
- Token counts arrive when each agent finishes, not while it runs.
- Reloading the live page while a project file is broken shows a plain error page; an open tab keeps the last good data with a banner.
- Two `--watch --open` runs on the same project share one launcher file name.

## [0.3.0] - 2026-11-26

### Added

- `darkforge dashboard [--out <file>] [--open]`: one read-only HTML page of the project (phases, tasks with status and blocking questions, task details, next step, open questions, tokens by task, model and orchestrator vs subagents, tasks per session, decisions, backlog), built from the project's files. Written to the OS temp dir by default, so the working tree never changes; no network requests; every value shown as text. `/darkforge:status` offers it for a visual view.
- Ledger records carry the Claude Code `session` id, so the dashboard can show when one session ran several tasks.

### Known issues

- The dashboard's tasks-per-session panel needs ledger records with a session id, recorded from this version on.
- `dashboard --open` on Windows may not open a path that contains a comma (it fails safely; the path is printed).
- End-to-end checklist run B (with superpowers) has not been done yet; token ledger is best effort.

## [0.2.0] - 2026-11-26

### Changed

- `next-task` hands its mechanical steps to two new CLI commands, so the main session makes fewer model calls. Re-measured on the run-A fixture (one run per task, `docs/testing/e2e-checklist.md`): main-session calls for task 001 went from 21 to 8, orchestrator tokens fell 66% (task 001) and 43% (task 002), and session cost fell 29% and 20%. Run A of the end-to-end checklist measured the main session at 85% of all tokens, with 21 model calls for one task, 12 of them mechanical.
  - `darkforge task begin <id>` reads the package header, refuses a task an open question names or whose models the policy denies, starts or resumes the branch and prints implementer, reviewer and base ref. The `model-routing` skill is loaded only for escalation.
  - `darkforge task finish <id> --title` fills the token total into `progress.md`, commits `memory-bank/` only, runs memory lint and the gate, merges and prints the ledger row; it stops at the first failure and a re-run continues.
- The model-guard hook sets the ledger phase when it allows a darkforge implementer (`implement`) or reviewer (`review`) dispatch during a task.
- `plan-phase` and `phase-review` close with `task finish`.
- `next-task` ends by asking for a fresh session (`/clear`) before the next task.

### Added

- User guide: "Keeping token use down", with the measured split and what drives it.

### Known issues

- Only `next-task` was re-measured under 0.2.0; `plan-phase` and `phase-review` were not.
- End-to-end checklist run B (with superpowers) has not been done yet.
- Token ledger is best effort; see Known limits in the user guide.

## [0.1.1] - 2026-11-26

### Fixed

- `next-task` marked a task `auto-merge pending` whenever `git.autoMerge` was true, even with a local merge (`git.prFlow: false` or `git.remote: null`); the next task then stopped. Only the pull-request flow sets it now.
- `task merge` reported a PR as merged as soon as `gh pr merge` succeeded; with a merge queue the PR was only queued. It now checks that the PR is `MERGED` and otherwise stops with the task still active. Re-running it after the merge only does the local cleanup, and only when a merged PR's head is the current commit and the tree is clean; an older merged PR for a reused branch name never skips the checks.
- `task merge` deleted the local task branch with `git branch -d`, which fails after a squash or rebase merge; it uses `-D` once GitHub reports the PR merged.
- The CLI ended with `process.exit()`, which can cut output written to a pipe; it sets the exit code instead.
- Local merges (`git.prFlow: false` or `git.remote: null`) left every merged task branch behind; `task merge` now deletes it with `git branch -d`, after the push when a remote is set (the branch tracks the remote base); a failure is reported and the merge stands.
- `init` could apply the answers before the owner saw the summary; the skill now waits for the owner's OK.
- Config: elements of `models.tiers`, `models.banned`, `riskAreas`, `git.requiredChecks` and values of `models.floors` must be strings; a `__proto__` key in the file is ignored instead of changing an object's prototype; routing and floors ignore inherited property names.

### Added

- `test/e2e-cli.test.mjs`: an end-to-end run of the CLI and hooks as real processes in a real git repository (init, session brief, task start, model guard, ledger, memory lint, gate, local merge, ledger report), run by CI on every platform.
- `docs/testing/e2e-checklist.md`: run A results (Windows, headless live session) and its ledger report; the phase-review item names the security-reviewer, as the skill does.

### Known issues

- End-to-end checklist run B (with superpowers) has not been done yet; run A passed on Windows (`docs/testing/e2e-checklist.md`).
- Token ledger is best effort; see Known limits in the user guide.

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
