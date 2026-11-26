---
name: next-task
description: Run the next darkforge task end to end - branch, implementer, independent review, fix rounds, gate, memory bank, merge and token report. Use when the owner asks for the next task or to continue the plan.
user-invocable: true
---

# Next task

You orchestrate. You never write task code or tests yourself. `df <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" <args>`. Talk to the owner in `project.ownerLanguage` from `.darkforge/config.json`; files stay in English. When a `df` command exits non-zero, stop and report its output; never work around a refusal. Every model call re-reads this whole session: batch independent tool calls in one message, and read nothing you do not need.

## 1. Pick
Read `memory-bank/activeContext.md` and `memory-bank/progress.md` (one message, nothing else). The task is the one under `## Next`. If `## Next` is planning or `phase-review`, tell the owner to run `/darkforge:plan-phase` or `/darkforge:phase-review` and stop.
If the previous task's row says `auto-merge pending`: `gh pr list --state merged --head task/<id>-<slug> --json number`; if it prints `[]`, tell the owner its PR has not merged and stop; else set that row to `done` in step 5.

## 2. Begin
`df task begin NNN`. It reads the package header, refuses a blocked task or a model the policy denies, starts (or resumes) `task/NNN-<slug>`, and prints the implementer, the reviewer (agent + model) and the base ref. Do not read the package; the agents do. Resumed: continue from the first step not yet done (`git log` on the branch).

## 3. Implement and review
Dispatch the implementer (`darkforge:<agent>`, its `model`) with: `Implement docs/tasks/NNN-<slug>.md on branch task/NNN-<slug>.` Keep its agent id and wait for its report. If it reports blocked, answer from the docs via `SendMessage`, or ask the owner.
Then dispatch the reviewer the same way with: `Review branch task/NNN-<slug> against docs/tasks/NNN-<slug>.md. Base ref: <base>.` Keep its id. The model-guard hook sets the ledger phase for both dispatches.

## 4. Fix rounds
First report line `CHANGES REQUIRED` with a `blocking` defect:
1. Note `git rev-parse HEAD` as <previous HEAD>. `df ledger phase fix`; `SendMessage` to the SAME implementer with only the defect lines (file:line, trigger, severity). No review prose, no package text.
2. `df ledger phase review`; `SendMessage` to the same reviewer: re-check only those defects and the commits after <previous HEAD>, run the gate once.
3. Count the round; apply the escalation rules of `model-routing` (raise one tier after `escalation.raiseAfterFixRounds`, ask the owner after `escalation.askOwnerAfterFixRounds`).

`should-fix` items alone do not block: note them for the backlog.

## 5. Memory bank
After `APPROVED`, edit in one message:
- `progress.md`: row `| NNN | task/NNN-<slug> | <agent> | <model(s)> | done | - |` (`task finish` fills the tokens; `auto-merge pending` instead of `done` only when `git.autoMerge`, `git.prFlow` and `git.remote` are all set).
- `activeContext.md`: one line under `## Where we are`; under `## Next` the next task from the phase plan whose dependencies are merged, or `phase-review`; drop answered `Q-NN` rows. Under 60 lines.
- `decisions.md`: one line per decision the reports made; `backlog.md`: should-fix items and follow-ups.
Do not commit; step 6 does.

## 6. Finish
`df task finish NNN --title "<package title>"`: fills the tokens, commits `memory-bank/` only, `memory lint`, gate, merge (PR after the checks, or local), ledger row. It stops at the first failure: a lint problem, fix the memory bank and re-run; gate lines plus `next: fix round`, run step 4 with them, then re-run; a merge refusal, fix what it names and re-run. In a merge queue: stop, tell the owner; a re-run once merged only cleans up.

## 7. Report
From the `finish` output, tell the owner in `ownerLanguage`, at most 6 lines: task and result, models used, fix rounds, the token row, anything the owner must decide, next task. Last line: start a fresh session (`/clear`) before `/darkforge:next-task`, so the next task does not re-read this one.
