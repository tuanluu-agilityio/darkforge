# darkforge user guide

## What it is

darkforge is a Claude Code plugin that runs a project the way a careful lead would: work is split into phases and small task packages, each task is built by one agent on its own branch, reviewed by a different agent, checked by the project's quality gate, and merged through a pull request. Models are chosen per task by risk, and every subagent call names its model. A memory bank keeps the current state short, so each session starts cheaply, and a token ledger shows where tokens went.

The mechanical parts (branches, gate, merge, ledger, lint) are a Node CLI (`scripts/darkforge.mjs`). The judgment parts are skills the main session follows. Hooks enforce the model policy and record token use.

## Requirements

- Claude Code with plugin support and the `Agent` tool (the hooks match on that tool name).
- Node.js 18 or newer on `PATH`. No `npm install`: the plugin has no dependencies.
- `git`.
- `gh`, authenticated, for the pull-request flow. Without it, set `git.prFlow` to `false` or `git.remote` to `null` and tasks merge locally.
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
- Sidechain transcript lines are skipped.
- `tokens` includes cache reads, which are billed far cheaper than other input; each record also stores `usage` (input, output, cache write, cache read), and the report prints the grand-total breakdown.
- Read offsets are kept per transcript in `.darkforge/offsets/`, so a resumed subagent is counted only for its new lines.
- Task and phase come from `.darkforge/state.json` at the moment the hook runs; set the phase with `darkforge ledger phase <implement|review|fix|orchestrator>`. A subagent that finishes after the phase changed is recorded under the new phase.
- Orchestrator tokens are recorded when the main session's turn ends (Stop). If one turn runs a whole task including `task merge`, the task state is already cleared by then, so that turn's orchestrator tokens are recorded under `(no task)`.
- Claude Code runs SubagentStop for the built-in web-fetch subagent only from managed settings, so plugin hooks do not record its tokens.

Process:

- The end-to-end run (init, plan-phase, next-task, phase-review in a live session) is manual; see [testing/e2e-checklist.md](testing/e2e-checklist.md). CI runs only the scripts and hooks.
