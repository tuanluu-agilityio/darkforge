# darkforge user guide

## What it is

darkforge is a Claude Code plugin that runs a project the way a careful lead would: work is split into phases and small task packages, each task is built by one agent on its own branch, reviewed by a different agent, checked by the project's quality gate, and merged through a pull request. Models are chosen per task by risk, and every subagent call names its model. A memory bank keeps the current state short, so each session starts cheaply, and a token ledger shows where tokens went.

The mechanical parts (branches, gate, merge, ledger, lint) are a Node CLI (`scripts/darkforge.mjs`). The judgment parts are skills the main session follows. Hooks enforce the model policy and record token use.

## Requirements

- Claude Code 2.1.330 or newer (tested), with plugin support and the `Agent` tool (the hooks match on that tool name). Older builds may not run exec-form hooks, and the guard then never runs.
- Node.js 18 or newer on `PATH`. No `npm install`: the plugin has no dependencies.
- `git`.
- `gh`, authenticated, for the pull-request flow. Without it, set `git.prFlow` to `false` or `git.remote` to `null` and tasks merge locally. With `prFlow: false` and a remote set, `task merge` pulls the base branch (`--ff-only`) before the merge and pushes it after, so the next task starts from the merged code; with `remote: null` nothing is pulled or pushed.
- CI checks: in the pull-request flow, darkforge waits on the checks GitHub marks as required (branch protection). List the names you expect in `git.requiredChecks`: if GitHub reports no checks at all and that list is non-empty, the merge is refused. Mark these checks as required in branch protection.
- Windows, macOS or Linux.

## Install

```
/plugin marketplace add tuanluu-agilityio/darkforge
/plugin install darkforge@darkforge
```

Restart Claude Code if it asks. `node "<plugin dir>/scripts/darkforge.mjs" doctor` checks Node, git and gh.

## First run

Open the repository (new or existing) and run `/darkforge:init`. It checks the environment, then asks one question at a time, each with the reason: owner language, project name, stack and gate commands, constraints, risk areas, model policy, git and CI, superpowers. "Not decided yet" is fine: it becomes an open question `Q-NN` in `memory-bank/activeContext.md`.

It writes `.darkforge/config.json`, `memory-bank/`, the constraints file, a marked block in `CLAUDE.md`, and gate skeletons `scripts/check.ps1`/`check.sh` if you want them. Existing files are never overwritten; re-running init changes only the config and the marked block. At the end you can save your policy answers (banned models, routing, language) to `~/.darkforge/defaults.json` to pre-fill the next project's init.

## Daily flow

| Command | What it does |
|---|---|
| `/darkforge:plan-phase` | Clarifies requirements, writes `docs/plans/phase-N-*.md` with risk and models per task, stress-tests the plan, writes task packages in `docs/tasks/`, merges them. |
| `/darkforge:next-task` | Runs one task: branch, implementer, independent review, fix rounds, gate, memory bank, merge, short report with token numbers. |
| `/darkforge:phase-review` | When every task of the phase is merged: whole-phase review by an independent agent, gate, exit checklist with evidence. |
| `/darkforge:status` | Read-only: where you are, what is next, open questions, token ledger. |

When a session starts in a darkforge project, a three-line brief names the project and the current task.

Inside `next-task`, two CLI commands do the mechanical steps, so the main session spends its model calls on dispatch, review and the memory bank:

- `darkforge task begin <id>` reads the package header (agent, model, branch, reviewer, risk), refuses a task that an open `Q-NN` names or whose models the policy denies, starts or resumes `task/<id>-<slug>`, and prints the implementer, the reviewer and the base ref.
- `darkforge task finish <id> --title "<title>"` fills the task's token total into its `progress.md` row (a `-` in the Tokens cell), commits `memory-bank/` only, runs `memory lint` and the gate, merges, and prints the task's ledger row. It stops at the first failure with that step's output; a failing gate ends with `next: fix round`. A re-run continues where it stopped; if the gate already passed on the current commit (a merge refusal, a merge queue) it changes nothing and goes straight to the merge. It runs only on the task's own branch while that task is active, so it never commits onto the base branch.

`task start` and `task merge` remain for `plan-phase` and `phase-review` and for manual use.

## Dashboard

`node "<plugin dir>/scripts/darkforge.mjs" dashboard --open` (or ask `/darkforge:status` for a visual view) writes one read-only HTML page and opens it: phases and their tasks with status, risk, models, dependencies and blocking questions; task details (acceptance, tests, tokens); the next step; open questions; tokens by task, by model and orchestrator vs subagents; tasks per Claude Code session; recent decisions and the backlog. Each panel names the file it was read from.

- It reads only the project's files (config, `.darkforge/state.json`, `memory-bank/`, `docs/plans/phase-*.md`, `.darkforge/ledger.jsonl`) and writes only the page.
- The page goes to the OS temp directory (one file per project), so the working tree never changes; `--out <file.html>` writes it elsewhere.
- The page makes no network requests (system fonts, data inline) and runs no code from your files: every value is shown as text.
- Run the command again to refresh it. "Tasks per session" needs ledger records with a session id, which darkforge records from this version on.

## Keeping token use down

The first live end-to-end run (`docs/testing/e2e-checklist.md`, run A) measured where tokens go: the main session (the one you type in) used 85% of them, the subagents 15%, and 93% of all tokens were cache reads. Each model call of the main session re-reads its whole context, so its cost is roughly the number of calls times the context size.

- **One task per session.** `next-task` ends by asking you to start a fresh session (`/clear`) before the next task; the memory bank carries everything the next one needs. Running several tasks in one session makes every later call re-read the earlier tasks.
- **The main session's model is your session model.** Subagents always use their routed models, but the orchestration itself runs on whatever `/model` is set. A cheaper session model lowers the cost of the largest share; the routed implementers and reviewers are not affected.
- **Keep the memory bank short.** `activeContext.md` stays under 60 lines (lint rule) and is read at every start.

## Superpowers (optional)

darkforge works without other plugins. With `superpowers: "auto"` (default) and the [superpowers](https://github.com/obra/superpowers) plugin installed:

- `plan-phase` uses a plan in `docs/superpowers/plans/` for the phase as its requirements input instead of interviewing you.
- Implementer agents load superpowers' test-driven-development skill when it is available.

Set `superpowers` to `"off"` to ignore it.

## Model policy and model-guard

`routing` maps each risk level (`low`, `medium`, `high`) to an implementer and a reviewer, each with an agent and a model. Areas in `riskAreas` always count as high risk. After `escalation.raiseAfterFixRounds` failed fix rounds the implementer moves up one model tier; after `escalation.askOwnerAfterFixRounds` the session stops and asks you.

The model-guard hook checks every `Agent` call in a darkforge project:

- a model in `models.banned` is denied for any agent, including built-in agents and other plugins;
- a darkforge agent call without `model` is denied (`models.requireExplicit`: `"darkforge"` default, `"all"`, `"off"`);
- a model below `models.floors` for that agent is denied;
- forks are exempt from the explicit-model rule.

A denial names the rule and the fix. Outside a darkforge project every hook does nothing.

## Configuration

All fields, types and defaults: [config.md](config.md).

## Known limits

Model guard:

- An `Agent` call without `model` to a non-darkforge agent inherits the session model, which the hook cannot see. If the session itself runs a banned model, switch the session model (`/model`); the hook cannot stop that case.
- Hooks need a Claude Code version that names the subagent tool `Agent` in hook input.

Token ledger (`hooks/ledger.mjs`, `darkforge ledger report`) is best effort:

- Hook inputs carry no model. The model of a record is the `message.model` of the last transcript line that has one; it is `null` when no counted line has a model.
- `agent` is the SubagentStop `agent_type`; it is `null` when Claude Code sends an empty string (internal agents such as prompt suggestions in a session run without `--agent`).
- The transcript is written asynchronously and may lag the conversation when Stop fires. Lines not yet written are counted at the next Stop, so the last turn of a session may be missed.
- Lines that share a `message.id` (one API response logged per content block) count once. A response whose lines straddle two Stop (or two SubagentStop) events is counted at the first one; its later lines are skipped, so a few final output tokens may be missed.
- Sidechain lines are counted: a subagent transcript (SubagentStop `agent_transcript_path`) marks every line `isSidechain: true`, and a main transcript has none, so nothing is counted twice.
- `tokens` includes cache reads, which are billed far cheaper than other input; each record also stores `usage` (input, output, cache write, cache read), and the report prints the grand-total breakdown.
- Read offsets are kept per transcript in `.darkforge/offsets/`, so a resumed subagent is counted only for its new lines.
- Task and phase come from `.darkforge/state.json` at the moment the hook runs; set the phase with `darkforge ledger phase <implement|review|fix|orchestrator>`. The model-guard hook also sets it when it allows a darkforge dispatch during a task (builder, specialist, scaffolder: `implement`; reviewer, security-reviewer: `review`); fix rounds go through `SendMessage`, which the hook does not see, so `next-task` sets `fix` and `review` itself. A subagent that finishes after the phase changed is recorded under the new phase.
- Orchestrator tokens are recorded when the main session's turn ends (Stop). The first recorded Stop after `task merge` is attributed to the task just merged; later ones with no active task go to `(no task)`.
- `.darkforge/ledger.jsonl` is local and git-ignored (init adds it to `.gitignore`), so it never blocks a branch switch. `next-task` copies each task's token total into its `memory-bank/progress.md` row, so the committed history keeps the numbers.
- Claude Code runs SubagentStop for the built-in web-fetch subagent only from managed settings, so plugin hooks do not record its tokens.

Process:

- Memory lint rule 3 treats any mention of a `Q-NN` in `memory-bank/decisions.md` as its answer, so a question still listed under "## Waiting on owner" fails the lint: mention open questions in `decisions.md` only once answered.
- With a merge queue, `task merge` stops while the PR waits in the queue and the task stays active; run it again once GitHub shows the PR merged, and it only switches to the base branch, pulls and deletes the task branch.
- The end-to-end run of the skills (init, plan-phase, next-task, phase-review in a live session) is manual; see [testing/e2e-checklist.md](testing/e2e-checklist.md). CI runs the scripts and hooks, including an end-to-end run of the CLI and hooks in a real git repository (`test/e2e-cli.test.mjs`).
