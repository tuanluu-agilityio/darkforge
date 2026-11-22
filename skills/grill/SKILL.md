---
name: grill
description: Use to clarify requirements before a phase plan (requirements mode) or to stress-test a written phase plan before task packages (plan mode). Asks the owner one question at a time and only what the repo cannot answer.
user-invocable: false
---

# Grill

Ask in `project.ownerLanguage` from `.darkforge/config.json`; write results in English.

## Rules
- One question per message. Each question says in one sentence why it matters (what the build does differently depending on the answer). Offer 2-4 concrete options with your recommendation first when you can.
- Answer from the repo first: `memory-bank/`, the constraints file (`constraintsPath`), `docs/plans/`, existing code and tests. Ask the owner only what they must decide. Say which file answered a point you did not ask.
- "Not decided yet" is a valid answer: record it as an open question `Q-NN` (next free number) under `## Waiting on owner` in `memory-bank/activeContext.md`, with what it blocks. Never guess.
- Record each answer that changes the build as one line in `memory-bank/decisions.md`.
- Stop when nothing open would change what gets built. Do not ask about style, naming or wording.
- Order questions by impact: what decides scope and interfaces first, details last.

## Requirements mode
Goal: enough to write the phase plan. Cover, skipping what the docs settle:
1. Outcome: what the user can do when the phase is done; how we observe it.
2. Scope: what is in, what is explicitly out.
3. Constraints touched (constraints file ids) and any new non-negotiable.
4. Risk: which `riskAreas` the work enters; data loss, security, concurrency, external APIs.
5. Acceptance: a check that passes or fails, not an opinion.
End with a 5-10 line summary in English for the phase plan.

## Plan mode
Input: the phase plan file. Work through this checklist; fix the plan yourself where the docs decide, ask only the rest:
1. Interface contracts: every value one task produces and another consumes has an exact name, signature, format and owner task.
2. Hidden dependencies: shared files, migrations, config fields, generated code, ordering the dependency column does not show.
3. Under-rated risk: a task touching `riskAreas`, concurrency, persistence, security or an external API marked lower than `high`.
4. Measurable acceptance: each task's acceptance is observable and maps to named tests.
5. Scope creep: work outside the phase goal, or "while we are at it" items; move them to `memory-bank/backlog.md`.
End with the list of plan changes made and the questions still open.
