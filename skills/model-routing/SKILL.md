---
name: model-routing
description: Use before every darkforge subagent dispatch and after each failed fix round, to pick the agent and model for a task from the project's routing config and to escalate.
user-invocable: false
---

# Model routing

Source of truth: `.darkforge/config.json` (`riskAreas`, `routing`, `models`, `escalation`). Read it once per task. Talk to the owner in `project.ownerLanguage`.

## Pick
1. Risk = the `Risk:` field in the package header (`low`, `medium`, `high`). Use `high` instead when the task touches an area listed in `riskAreas`. Never lower the stated risk.
2. Implementer = `routing.<risk>.implementer`, reviewer = `routing.<risk>.reviewer` (each `{agent, model}`). If the package header names an agent or model, use it only when it passes the checks below and its model is not below routing's; otherwise use routing.
3. Checks, in order (tier order = `models.tiers`, lowest first):
   - the model is not in `models.banned`;
   - the model is not below `models.floors[<agent>]`;
   - the reviewer agent differs from the implementer agent;
   - for `high` risk the reviewer model is not below the implementer model.
   If a check fails, stop and show the owner the failing rule and the config line to change. Do not improvise another model.

## Dispatch
Always set `model` explicitly on the Agent call, even when it equals the agent's default: `subagent_type: "darkforge:<agent>"`, `model: "<model>"`. The model-guard hook denies darkforge calls without a model and calls with a banned or below-floor model; if it denies, read its reason and fix the choice, never retry the same call.

## Escalate
Count fix rounds per task (a round = defects sent to the implementer, then a re-review that is not APPROVED).
- After `escalation.raiseAfterFixRounds` failed rounds: raise the implementer one tier in `models.tiers`, skipping banned models. A running agent cannot change model, so dispatch a fresh implementer (same agent, raised model) with the package path, the branch name and the open defect list only.
- After `escalation.askOwnerAfterFixRounds` failed rounds: stop. Give the owner the open defects and the options (raise the model, change the package, take it over) and wait.
- No higher allowed tier: ask the owner instead of raising.

Record the model actually used (all of them, if escalated) in the task's `progress.md` row.
