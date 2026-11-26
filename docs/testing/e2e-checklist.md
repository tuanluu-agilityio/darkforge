# End-to-end checklist (manual, before each release)

CI runs only the `node:test` suites. Before each release, run this once on Windows and once on Linux or macOS, in a live Claude Code session, and record the results below. Do not edit plugin files during the run; any needed edit is a defect.

## Setup

1. Create an empty fixture repository with one source file and a test command that passes (any stack). Optional: a GitHub remote with branch protection on `main` and one required check.
2. Install the plugin from the branch or tag under test.
3. Note: date, OS, Node version (`node --version`), Claude Code version (`claude --version`), plugin commit.

## Run A: without superpowers

Disable or uninstall superpowers first.

- [ ] `/darkforge:init`: questions come one at a time with reasons; "not decided yet" becomes a `Q-NN`; `.darkforge/config.json`, `memory-bank/`, constraints file, `CLAUDE.md` block written; gate prints the marker. Put one model in `models.banned`. Commit and push the init files to the base branch, as the skill asks; `.darkforge/ledger.jsonl` is in `.gitignore`.
- [ ] Session restart shows the three-line brief.
- [ ] `/darkforge:plan-phase` for a tiny phase with two tasks (one `low`, one `medium` risk): phase plan and two packages written, plan merged.
- [ ] `/darkforge:next-task` (first task): branch created, implementer and a different reviewer dispatched with explicit models, gate passes, memory bank updated, merged; report shows ledger numbers.
- [ ] `/darkforge:next-task` (second task): same; if a fix round happens, it goes to the same implementer via `SendMessage` with only the defect list.
- [ ] Manually ask for a subagent with the banned model: denied with an actionable reason.
- [ ] `/darkforge:phase-review`: security-reviewer dispatched with an explicit model (`routing.high.reviewer.model`), checklist ticked with evidence, review merged.
- [ ] `/darkforge:status`: brief, read-only, numbers match `ledger report`.
- [ ] A second repository without `.darkforge/`: no brief, no hook output, normal agent calls work.

## Run B: with superpowers

Install superpowers; write a two-task plan with its planning skill into `docs/superpowers/plans/` and leave it uncommitted.

- [ ] `/darkforge:plan-phase` uses that plan as input instead of the requirements interview; it stashes the uncommitted plan file around `task start`, and the plan file is committed on `task/P<N>-plan` and reaches the base branch with the merge.
- [ ] `/darkforge:next-task` ×2 and `/darkforge:phase-review` as in run A.

## Results

| Date | OS | Node | Claude Code | Plugin commit | Run | Result | Notes |
|---|---|---|---|---|---|---|---|
| 2026-11-25 | Windows 11 | 24.20.0 | 2.1.332 | 5a5efbd | A | pass, all 9 items | Run headless: `claude -p --plugin-dir <clone>`, owner answers given with `--resume`; superpowers installed but `superpowers: "off"`; local merge, no remote; `core.autocrlf=true`. Found: merged task branches kept after local merges (fixed after the run); init applied before the owner OK'd the summary (skill wording fixed); this checklist named the wrong phase-review agent (fixed). |
| | | | | | B | | |

Paste the final `darkforge ledger report` for each run:

```
(ledger report)
```

Run A, 2026-11-25 (after `/darkforge:status`):

```
task       implement  review  fix  orchestrator    total
(no task)          0       0    0       1196857  1196857
P1                 0       0    0       1097297  1097297
001           285025   40454    0       1021700  1347179
002           350729   24512    0        603822   979063
P1R                0  109540    0        507492   617032

claude-opus-5-5    4577162
claude-sonnet-5-5   660266

orchestrator  4427168
subagents      810260
total         5237428
total breakdown: input 244, output 43575, cache write 339000, cache read 4854609
```

The ledger matched Claude Code's own usage for the next-task 001 session (opus cache reads 1,006,021 = orchestrator 982,028 + reviewer 23,993).
