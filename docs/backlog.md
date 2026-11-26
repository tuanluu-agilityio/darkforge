# Backlog

Deferred findings. Items marked (T<N>) come from the 0.1.0 build review.

- E2E checklist run B (with superpowers) not done yet; run A passed on 2026-11-25 (see docs/testing/e2e-checklist.md).
- Measured in run A (5.24M tokens, ~7.6 USD list): the main session (orchestrator) used 85% of all tokens, subagents 15%; 93% of all tokens were cache reads. next-task 001 alone: 29 main-session turns, orchestrator 1.02M vs implement 285k + review 40k. Cost driver is the number of main-session turns times its context, even in a fresh session. For 0.2.0: fold mechanical steps into fewer CLI calls (e.g. one `df task finish` for lint + gate + merge + report), keep the main session's reads small, and document running the main session on a cheaper model.
- (T2) test gaps (banned middle tier, custom tiers, BOM, object wrong type) + temp dirs not removed; duplicated unknown-field copy logic
- (T3) matcher "Agent|Task" for older Claude Code
- (T5) FAIL_RE matches "0 errors" (display only); quiet:false and CLI --full untested
- (T6) last model wins per window; phase:null not in a column; orchestrator-phase subagents confusing in kind split; offsets never trimmed
- (T7) no CRLF test; tab after task id not accepted
- (T8) skeleton created even when custom gate command configured; .gitignore equivalent entries not recognised; existing constraints.md untouched test
- (T9) gateFresh could return the SHA it validated (tiny race between gateFresh and rev-parse)
- (T10) builder/scaffolder/specialist share steps (3 places to fix); "model is a default" line costs tokens
- (T11) phase-review third-review id detection relies on P<N>R2 progress row
