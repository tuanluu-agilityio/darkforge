---
name: status
description: Show where the darkforge project stands - current phase and task, next step, open questions and the token ledger. Read-only. Use when the owner asks for status, progress or token use.
user-invocable: true
---

# Status

Read-only: change no file, branch or state, dispatch no agent.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" ledger report`.
2. Read only `memory-bank/activeContext.md` and `memory-bank/progress.md`.
3. Reply in `project.ownerLanguage` from `.darkforge/config.json`, at most 10 lines:
   - where we are and the current task, if any;
   - tasks done (count of `done` rows in `progress.md`); a total only if `activeContext.md` states one;
   - next step and the command for it (`/darkforge:next-task`, `/darkforge:plan-phase` or `/darkforge:phase-review`);
   - open questions waiting on the owner (ids and one line each);
   - tokens: total, orchestrator vs subagents, the top two models, and the last task's total. Copy numbers from the report; do not recompute.
4. If the owner asks for a visual or fuller view, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" dashboard --open` and give the path it prints (a read-only HTML page written to the OS temp dir).
