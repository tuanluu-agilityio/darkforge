# Backlog for 0.1.1

Minor findings deferred during the 0.1.0 build (triaged by the final review as 'can wait').

- Manual end-to-end run (docs/testing/e2e-checklist.md) not done yet.
- (T2) test gaps (banned middle tier, custom tiers, BOM, object wrong type) + temp dirs not removed; duplicated unknown-field copy logic
- (T3) matcher "Agent|Task" for older Claude Code
- (T5) FAIL_RE matches "0 errors" (display only); quiet:false and CLI --full untested
- (T6) last model wins per window; phase:null not in a column; orchestrator-phase subagents confusing in kind split; offsets never trimmed
- (T7) no CRLF test; tab after task id not accepted
- (T8) skeleton created even when custom gate command configured; .gitignore equivalent entries not recognised; existing constraints.md untouched test
- (T9) gateFresh could return the SHA it validated (tiny race between gateFresh and rev-parse)
- (T10) builder/scaffolder/specialist share steps (3 places to fix); "model is a default" line costs tokens
- (T11) phase-review third-review id detection relies on P<N>R2 progress row
