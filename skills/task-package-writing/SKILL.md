---
name: task-package-writing
description: Use when writing or fixing task packages (docs/tasks/NNN-*.md) from a phase plan, so an implementer agent can build the task without asking questions.
user-invocable: false
---

# Task package writing

Packages are written in English. Questions to the owner go in `project.ownerLanguage` from `.darkforge/config.json`, through `grill`.

## Shape
Copy `${CLAUDE_PLUGIN_ROOT}/templates/task-package.md` to `docs/tasks/NNN-<slug>.md` (NNN = the phase plan's task id, slug = lowercase words joined by hyphens). Keep every heading. Fill:
- Header line: agent, model, branch `task/NNN-<slug>`, reviewer agent/model, risk - all from the phase plan row (which came from `model-routing`).
- **Constraints**: ids from the constraints file that bind this task. Ids only, no copied text.
- **Read first**: file + heading of each section the implementer needs (e.g. `docs/plans/phase-2-sync.md § Interfaces`). Never a whole file, never "the spec".
- **Files**: exact paths to create or modify. Nothing else may change without a reason in the report.
- **Interfaces**: exact names, signatures, formats, error values, consumed and produced; same spelling as the phase plan and the packages that use them.
- **Requirements**: exact values and behaviour (limits, defaults, error messages, ordering). Numbered, testable, no "should consider".
- **Tests**: test names with the exact assertion each makes (input, expected output or error). Cover every requirement and each phase Review Focus line for this task. Include the failure paths.
- **Not doing**: what an eager implementer might add but must not.

## Rules
- One package = one branch = one implementer, finishable in one session. Split anything larger.
- Size: aim for 4 KB or less. Point to sections instead of restating them.
- No decisions hidden in a package: a choice the owner has not made becomes a `Q-NN` (via `grill`), not a default.
- Never name a banned model. Never weaken a constraint.
- Before finishing, check: could the implementer start without opening any file not under Read first? Do the tests prove each requirement? If not, fix the package.
