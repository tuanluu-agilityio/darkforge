---
name: next-task
description: Run the next darkforge task end to end - branch, implementer, independent review, fix rounds, gate, memory bank, merge and token report. Use when the owner asks for the next task or to continue the plan.
user-invocable: true
---

# Next task

You orchestrate. You never write task code or tests yourself. `df <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" <args>`. Talk to the owner in `project.ownerLanguage` from `.darkforge/config.json`; files stay in English. When a `df` command exits non-zero, stop and report its output; never work around a refusal.

## 1. Pick
Read only `memory-bank/activeContext.md` and `memory-bank/progress.md`. The task is the one under `## Next`. If `## Next` is planning or `phase-review`, or the current task id starts with `P`, tell the owner to run `/darkforge:plan-phase` or `/darkforge:phase-review` and stop. Stop and ask the owner if a `## Waiting on owner` question blocks it or `docs/tasks/NNN-*.md` does not exist. From the package read only its header line (agent, model, branch, reviewer, risk); the agents read the rest.
If the previous task's row says `auto-merge pending`: `gh pr list --state merged --head task/<id>-<slug> --json number`; if it prints `[]`, tell the owner its PR has not merged and stop; else set that row to `done` in step 6.

Resuming (the session brief names a current task): stay on its branch, skip `task start`, and continue from the first step not yet done (check `git log` on the branch).

## 2. Start
`df task start NNN <slug>`, slug from the header's `task/NNN-<slug>`. Then apply `model-routing` to get implementer and reviewer (agent + model).

## 3. Implement
`df ledger phase implement`, then dispatch `darkforge:<implementer>` with the routed `model` and a short prompt: `Implement docs/tasks/NNN-<slug>.md on branch task/NNN-<slug>.` Do not paste the package. Keep the returned agent id. Wait for its report before step 4; never start the review while it runs. If it reports blocked, answer from the docs via `SendMessage` to that agent, or ask the owner.

## 4. Review
`df ledger phase review`, then dispatch `darkforge:<reviewer>` (a different agent from the implementer) with the routed `model` and: `Review branch task/NNN-<slug> against docs/tasks/NNN-<slug>.md. Base ref: <base>.` Base is `<git.remote>/<git.baseBranch>`, or `git.baseBranch` when `git.remote` is null. Keep its agent id.

## 5. Fix rounds
First report line `CHANGES REQUIRED` with a `blocking` defect:
1. Note `git rev-parse HEAD` as <previous HEAD>. `df ledger phase fix`; `SendMessage` to the SAME implementer with only the defect lines (file:line, trigger, severity). No review prose, no package text.
2. `df ledger phase review`; `SendMessage` to the same reviewer: re-check only those defects and the commits after <previous HEAD>, run the gate once.
3. Count the round and apply the escalation rules of `model-routing` (raise one tier after `escalation.raiseAfterFixRounds`, ask the owner after `escalation.askOwnerAfterFixRounds`).

`should-fix` items alone do not block: note them for the backlog.

## 6. Memory bank
After `APPROVED`, edit:
- `progress.md`: row `| NNN | task/NNN-<slug> | <agent> | <model(s)> | done | <task total from df ledger report> |` (status `auto-merge pending` instead of `done` when `git.autoMerge` is true).
- `activeContext.md`: one line under `## Where we are`; under `## Next` the next task from the phase plan whose dependencies are merged, or `phase-review`; drop answered `Q-NN` rows. Keep it under 60 lines.
- `decisions.md`: one line per decision the reports made; `backlog.md`: should-fix items and follow-ups.

Stage only `git add memory-bank/` (never `git add -A` or `.`) and commit `docs: task NNN memory bank`. `df memory lint` must print `memory: ok`; fix, commit, re-run otherwise.

## 7. Gate
Run `df gate` (the memory-bank commit moved HEAD; `task merge` refuses a stale gate). On failure send the failing lines to the implementer as a fix round (step 5).

## 8. Merge
`df ledger phase orchestrator`, then `df task merge NNN --title "<package title>"`. It pushes, opens the PR, waits for checks and merges, or merges locally without a remote. If it refuses, fix the cause it names and re-run.

## 9. Report
Run `df ledger report`. Tell the owner in `ownerLanguage`, at most 6 lines: task and result, models used, fix rounds, the task's row (implement/review/fix/orchestrator/total), anything the owner must decide, next task. This turn's own orchestrator tokens are added to the task when the turn ends.
