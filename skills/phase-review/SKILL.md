---
name: phase-review
description: Whole-phase review before declaring a darkforge phase complete - cross-task review by an independent agent, gate, exit checklist with evidence, memory bank update. Use when all tasks of a phase are merged.
user-invocable: true
---

# Phase review

`df <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" <args>`. Talk to the owner in `project.ownerLanguage` from `.darkforge/config.json`; files stay in English. You coordinate; you do not fix code yourself.

## 1. Ready?
Read `memory-bank/activeContext.md`, `memory-bank/progress.md` and the phase plan `docs/plans/phase-N-*.md`. Every task in the plan's table must be `done` in `progress.md` and you must be on an up-to-date base branch with a clean tree. Otherwise stop and tell the owner what is missing.

## 2. Branch
The review's records are merged like a task, and its tokens land under its id. Id `<RID>` = `P<N>R`; if `git branch -a --list "*task/P<N>R-*"` lists a branch or `progress.md` has a `| P<N>R ` row (an earlier review), use `P<N>R2`, then `P<N>R3`, and so on. Run `df task start <RID> review`.

## 3. Review
Apply `model-routing` for the `high` risk reviewer tier: use `routing.high.reviewer.model`. Run `df ledger phase review`, then dispatch `darkforge:specialist` with that `model` explicitly and this prompt:

`Read-only whole-phase review of phase N. Plan: docs/plans/phase-N-<slug>.md. Packages: docs/tasks/<ids>. Base ref: <base>. Report APPROVED or CHANGES REQUIRED with file:line defects. Check: interface contracts that drifted between tasks; constraint bypasses (constraintsPath); Review Focus items without a test that proves them; claims in docs or reports not backed by a test or command output. Do not edit files. Run the gate once; its result is your last line.`

`<base>` is the commit that landed the phase plan: `git log -1 --format=%H --grep "P<N>-plan" --grep "Phase N plan"`. If none is found, ask the owner for it.

## 4. Defects
For each `blocking` defect: add a fix task to the phase plan table and write its package with `task-package-writing`. The phase is not complete: leave the checklist unticked in step 5 and record the phase as blocked in step 6. `should-fix` items go to `memory-bank/backlog.md`.

## 5. Checklist
Tick each item of the plan's exit checklist only with evidence next to it (the specialist's gate line, test name, PR number or commit). An item without evidence stays unticked.

## 6. Record and merge
- `progress.md`: row `| <RID> | task/<RID>-review | specialist | <model> | done | <total from df ledger report> |`.
- `activeContext.md`: phase N complete (or blocked by the fix tasks); `## Next` = next phase planning or the first fix task.
- `decisions.md`: one line per decision made.
Stage only `git add memory-bank/ docs/plans docs/tasks` (never `git add -A` or `.`), commit `docs: phase N review`, then `df memory lint`, `df gate`, `df ledger phase orchestrator`, `df task merge <RID> --title "Phase N review"`.

Tell the owner briefly: verdict, defects and fix tasks, checklist result, phase tokens from `df ledger report`.
