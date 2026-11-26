---
name: plan-phase
description: Plan the next darkforge phase - clarify requirements (or use a superpowers plan), write the phase plan with risk and model routing, stress-test it, then write the task packages. Use when the owner wants to start or plan a phase.
user-invocable: true
---

# Plan a phase

`df <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" <args>`. Talk to the owner in `project.ownerLanguage` from `.darkforge/config.json`; write files in English. You plan; you do not write product code.

## 1. Context
Read `memory-bank/activeContext.md`, `memory-bank/progress.md`, the constraints file (`constraintsPath`) and the names of `docs/plans/phase-*.md`. Phase N = highest existing + 1 unless the owner names one. Agree a short slug.
Input: if `superpowers` in the config is `auto` and `docs/superpowers/plans/` has a plan for this phase (ask the owner which one if unsure), that file is the input. Otherwise the input is the owner's requirements.

## 2. Branch
Planning is merged like a task, so the plan reaches the base branch that task branches start from.
- If `docs/superpowers/` has untracked or uncommitted files (`git status --porcelain -- docs/superpowers` prints a line, e.g. the spec and the plan): `git stash push -u -- docs/superpowers`, `df task start P<N> plan`, `git stash pop`. They are committed on the plan branch in step 6.
- Otherwise: `df task start P<N> plan`.
Then: with a superpowers plan, read its tasks and acceptance (do not copy its text); without one, ask the owner for the requirements and load the `grill` skill in requirements mode.

## 3. Phase plan
Copy `${CLAUDE_PLUGIN_ROOT}/templates/phase-plan.md` to `docs/plans/phase-N-<slug>.md` and fill it:
- Goal: one paragraph, observable.
- Review Focus: the risks a reviewer must probe, each naming the test that covers it.
- Tasks table: id (next free number after those in `progress.md` and `docs/tasks/`, three digits), title, dependencies, risk, implementer/model and reviewer/model from the `model-routing` skill, acceptance, test names. One branch and one session per task.
- Exit checklist: keep the template items; add phase-specific ones.

## 4. Stress test
Load `grill` in plan mode on the new plan and apply its changes.

## 5. Task packages
Load `task-package-writing`; write one package per task in `docs/tasks/`.

## 6. Record and merge
- `memory-bank/decisions.md`: one line per new decision.
- `memory-bank/progress.md`: row `| P<N> | task/P<N>-plan | orchestrator | - | done | - |`.
- `memory-bank/activeContext.md`: `## Where we are` = phase N planned; `## Next` = the first task with no open dependency; keep open `Q-NN` rows.
- Stage only `git add docs/plans docs/tasks` (plus `docs/superpowers/` with the spec and plan, if used); never `git add -A` or `.`. Commit `docs: phase N plan`.
- `df task finish P<N> --title "Phase N plan"`: commits `memory-bank/`, `memory lint`, gate, merge. If it stops, fix what it names and re-run.

Tell the owner, briefly: the task table (id, title, risk, models), open questions, and `/darkforge:next-task` to start.
