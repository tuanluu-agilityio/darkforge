# darkforge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build darkforge 0.1.0, a public Claude Code plugin that runs an AI-first project (task packages, risk-based model routing, independent review, gate, PR flow, memory bank, token ledger) with deterministic Node.js scripts for the mechanics.

**Architecture:** Markdown skills and agents carry judgment; one zero-dependency Node CLI (`scripts/darkforge.mjs`) plus hook scripts carry mechanics. Everything project-specific lives in the project's `.darkforge/config.json` and project layer written by `init`.

**Tech Stack:** Node.js ≥ 18 standard library only (ESM, `node:test`, `node:child_process`), git, gh (optional), Claude Code plugin format.

**Spec:** `docs/superpowers/specs/2026-11-23-darkforge-design.md`

## Global Constraints

- Node.js ≥ 18; no npm runtime dependencies; no `npm install` for users. ESM (`"type": "module"`).
- Works on Windows, macOS, Linux. Paths via `node:path`; spawn without a shell (`spawnSync(cmd, args)`), except the project gate command which runs through the platform shell.
- No network access except `git` and `gh` subprocesses. No telemetry.
- English everywhere in the repo. Owner language is a config value used only in skill instructions for talking to the owner.
- Nothing project-specific to Dark Clipboard/Darkshot; Dark Clipboard appears only as a credited example in `docs/`.
- Credit superpowers (Jesse Vincent, MIT) and grill-me (Matt Pocock, MIT) in README; copy no text from them.
- Hooks never change a tool call silently: they allow, or deny with an actionable reason.
- Hooks are no-ops (exit 0, no output) when the project has no `.darkforge/config.json` or when the config is invalid (they print one warning line to stderr in the invalid case).
- Licence MIT. Version 0.1.0.
- Never use the model `fable` for any subagent while building this plugin (owner rule).

## Review Focus

1. A project with no `.darkforge/config.json` (any other repo the user opens): every hook exits 0 silently. Test in Task 3 and Task 6.
2. A malformed or partial config (missing fields, wrong types, `schemaVersion` ≠ 1): `loadConfig` fills defaults for missing fields and returns a clear error for wrong types; hooks fail open with a stderr warning, CLI commands fail closed with exit 1. Test in Task 2.
3. Paths with spaces (e.g. `D:\2026 - Tuan\x`): CLI, gate and hooks work. Test in Task 5 (gate command with a space in cwd) and Task 3 (hook cwd with space).
4. Re-running `init apply` on a project already initialised or with an existing `CLAUDE.md`/gate script: only the marked block and config change; nothing else is overwritten. Test in Task 8.
5. Agent calls from other plugins (e.g. `superpowers:*` or built-in `general-purpose`) without `model`: allowed; with a banned model: denied. Test in Task 3.

---

## File Structure

```
.claude-plugin/plugin.json            plugin manifest
.claude-plugin/marketplace.json       single-plugin marketplace
package.json                          "type":"module", "engines":{"node":">=18"}, "scripts":{"test":"node --test test/"}
LICENSE, README.md, CHANGELOG.md, .gitattributes (eol=lf), .gitignore
.github/workflows/ci.yml              node --test on windows/macos/ubuntu, Node 18 and 22
scripts/darkforge.mjs                 CLI entry: argv dispatch only
scripts/lib/config.mjs                load/validate/default config
scripts/lib/exec.mjs                  subprocess wrapper (injectable for tests)
scripts/lib/models.mjs                tier order, compare, routing lookup
scripts/lib/guard.mjs                 pure model-guard decision
scripts/lib/state.mjs                 .darkforge/state.json read/write
scripts/lib/ledger.mjs                transcript usage parsing, ledger append, report
scripts/lib/gate.mjs                  run gate, quiet filter, gate.json
scripts/lib/memory.mjs                memory lint rules
scripts/lib/task.mjs                  task start / merge
scripts/lib/init.mjs                  write project layer from answers; user defaults
scripts/lib/doctor.mjs                environment checks
hooks/hooks.json                      hook registrations
hooks/model-guard.mjs                 PreToolUse(Agent) entry → guard.mjs
hooks/ledger.mjs                      SubagentStop/Stop entry → ledger.mjs
hooks/session-brief.mjs               SessionStart entry
agents/{builder,specialist,reviewer,security-reviewer,scaffolder,verifier}.md
skills/{init,plan-phase,grill,next-task,phase-review,status,task-package-writing,model-routing}/SKILL.md
templates/…                           project-layer templates (Task 8)
docs/{user-guide,config,example-dark-clipboard}.md, docs/testing/e2e-checklist.md
test/*.test.mjs, test/fixtures/…
```

---

### Task 1: Repo scaffold and CI

**Files:** Create everything in the first six lines of File Structure, plus `test/smoke.test.mjs`.

**Interfaces:**
- Produces: `npm test` runs `node --test test/`; plugin name `darkforge`; marketplace name `darkforge`, one plugin entry with `"source": "./"`.

- [ ] **Step 1:** Verify the current plugin manifest and marketplace schema against the official Claude Code plugin docs (use a `claude-code-guide` subagent or the docs site). Record any field that differs from this plan in the task report.
- [ ] **Step 2:** Write `test/smoke.test.mjs`: parses `.claude-plugin/plugin.json` and asserts `name === "darkforge"`, `version === "0.1.0"`, `license === "MIT"`; parses `marketplace.json` and asserts `plugins[0].name === "darkforge"`.
- [ ] **Step 3:** Run `node --test test/` → FAIL (files missing).
- [ ] **Step 4:** Create manifests, `package.json`, MIT `LICENSE` (owner: Tuan Luu), README skeleton (what it is, install via `/plugin marketplace add <user>/darkforge`, requirements, credits), `CHANGELOG.md` with `## [Unreleased]`, `.gitattributes` (`* text=auto eol=lf`), `.gitignore` (`node_modules/`), CI matrix `[windows-latest, macos-latest, ubuntu-latest] × node [18, 22]` running `npm test`.
- [ ] **Step 5:** `node --test test/` → PASS. Commit `chore: scaffold plugin, manifests and CI`.

### Task 2: Config loading and model tiers

**Files:** Create `scripts/lib/config.mjs`, `scripts/lib/models.mjs`, `test/config.test.mjs`, `test/models.test.mjs`, `docs/config.md`.

**Interfaces:**
- Produces:
  - `DEFAULT_CONFIG` (object, exact defaults below).
  - `findProjectRoot(startDir: string): string | null` — nearest ancestor containing `.darkforge/config.json`.
  - `loadConfig(root: string): { ok: true, config: Config } | { ok: false, error: string }` — deep-merges file over defaults; rejects `schemaVersion !== 1` and wrong types.
  - `TIERS = ["haiku", "sonnet", "opus", "fable"]` (overridable by `config.models.tiers`).
  - `tierIndex(model: string, config): number` (−1 if unknown); `isBelowFloor(agentShortName, model, config): boolean`; `route(risk: "low"|"medium"|"high", config): { implementer: {agent, model}, reviewer: {agent, model} }`; `raiseTier(model, config): string` (next tier, skipping banned; returns same model if none).

Exact defaults:
```json
{
  "schemaVersion": 1,
  "project": { "name": "", "ownerLanguage": "en" },
  "gate": { "command": { "windows": "", "unix": "" }, "successMarker": "ALL CHECKS PASSED", "quiet": true },
  "constraintsPath": "docs/plans/constraints.md",
  "riskAreas": [],
  "routing": {
    "low":    { "implementer": { "agent": "builder",    "model": "sonnet" }, "reviewer": { "agent": "reviewer",          "model": "sonnet" } },
    "medium": { "implementer": { "agent": "builder",    "model": "sonnet" }, "reviewer": { "agent": "reviewer",          "model": "opus" } },
    "high":   { "implementer": { "agent": "specialist", "model": "opus" },   "reviewer": { "agent": "security-reviewer", "model": "opus" } }
  },
  "models": { "tiers": ["haiku", "sonnet", "opus", "fable"], "banned": [], "requireExplicit": "darkforge", "floors": { "specialist": "sonnet", "security-reviewer": "sonnet" } },
  "escalation": { "raiseAfterFixRounds": 2, "askOwnerAfterFixRounds": 3 },
  "git": { "baseBranch": "main", "remote": "origin", "prFlow": true, "requiredChecks": [], "mergeMethod": "merge", "autoMerge": false },
  "superpowers": "auto"
}
```
`requireExplicit` ∈ `"darkforge" | "all" | "off"`; `mergeMethod` ∈ `"merge" | "squash" | "rebase"`; `superpowers` ∈ `"auto" | "off"`; `git.remote` may be `null` (local merges).

- [ ] **Step 1:** Tests: `loadConfig` on fixture with only `{"schemaVersion":1}` equals `DEFAULT_CONFIG`; partial `models.banned:["fable"]` keeps other defaults; `schemaVersion: 2` → `ok:false` with message containing `schemaVersion`; `riskAreas: "x"` → `ok:false` naming `riskAreas`; invalid JSON → `ok:false`. `findProjectRoot` from a nested dir with spaces in its path returns the root. Models: `isBelowFloor("specialist","haiku")` true, `("builder","haiku")` false; `route("high")` returns specialist/opus + security-reviewer/opus; `raiseTier("opus")` with `banned:["fable"]` returns `"opus"`, without ban returns `"fable"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Write `docs/config.md` (every field, type, default, meaning). Commit `feat: config loading and model tiers`.

### Task 3: model-guard hook

**Files:** Create `scripts/lib/guard.mjs`, `hooks/model-guard.mjs`, `hooks/hooks.json` (model-guard entry only), `test/guard.test.mjs`, `test/fixtures/hook-inputs/*.json`.

**Interfaces:**
- Consumes: `loadConfig`, `findProjectRoot`, `isBelowFloor`, `route` (Task 2).
- Produces: `decide(toolInput: {subagent_type?, model?}, config): { allow: true } | { allow: false, reason: string }`.
  - darkforge agent ⇔ `subagent_type` starts with `darkforge:`; short name = part after the colon.
  - Order: banned model → deny (any agent); fork (`subagent_type === "fork"`) → allow; missing model and (`requireExplicit === "all"` or (`"darkforge"` and darkforge agent)) → deny, reason names the routing models for that agent; darkforge agent below floor → deny; else allow.
- Hook I/O: reads hook JSON from stdin (`tool_name`, `tool_input`, `cwd`); acts only when `tool_name === "Agent"`; deny output is the PreToolUse permission-decision JSON (`hookSpecificOutput.permissionDecision: "deny"` + reason) — confirm the exact current shape in the hooks docs in Step 1.

- [ ] **Step 1:** Confirm PreToolUse input/output shape and the subagent tool name (`Agent`) in current hooks docs; save two real-shaped sample inputs as fixtures.
- [ ] **Step 2:** Tests for `decide`: `{subagent_type:"general-purpose", model:"fable"}` with `banned:["fable"]` → deny; `{subagent_type:"superpowers:x"}` (no model) → allow; `{subagent_type:"darkforge:builder"}` no model → deny and reason contains `sonnet`; `{subagent_type:"fork", model:undefined}` → allow; `{subagent_type:"darkforge:specialist", model:"haiku"}` → deny; `requireExplicit:"off"` + darkforge no model → allow. Process tests (spawn `node hooks/model-guard.mjs` with fixture stdin): no config in cwd → exit 0, empty stdout; cwd with a space and banned model → deny JSON; invalid config → exit 0, empty stdout, one stderr line.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement (`hooks.json` command: `node "${CLAUDE_PLUGIN_ROOT}/hooks/model-guard.mjs"`, matcher `Agent`). **Step 5:** Run → PASS. Commit `feat: model-guard hook`.

### Task 4: CLI entry, exec wrapper, doctor

**Files:** Create `scripts/darkforge.mjs`, `scripts/lib/exec.mjs`, `scripts/lib/doctor.mjs`, `test/cli.test.mjs`, `test/doctor.test.mjs`.

**Interfaces:**
- Produces:
  - `run(cmd: string, args: string[], opts?: {cwd?, input?}): { code: number, stdout: string, stderr: string }` (spawnSync, no shell); `runShell(command: string, opts?): same` (platform shell; used only by gate). `setRunner(fake)` / `resetRunner()` for tests.
  - CLI: `node scripts/darkforge.mjs <command> [sub] [--flags]`; commands registered in a map; unknown command → usage on stderr, exit 2; every command prints plain text and exits 0 on success, 1 on failure.
  - `doctor(): { ok: boolean, lines: string[] }` — Node ≥ 18 (fail), `git --version` (fail), `gh --version` (warn only), `gh auth status` (warn only, only if config `git.prFlow`).

- [ ] **Step 1:** Tests: unknown command exits 2; `doctor` with fake runner where `git` fails → `ok:false` and a line mentioning git; `gh` missing → `ok:true` with a `warn` line.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat: CLI entry and doctor`.

### Task 5: Gate

**Files:** Create `scripts/lib/gate.mjs`, `test/gate.test.mjs`, `test/fixtures/gate-project/` (config + tiny pass/fail scripts as `node -e` commands).

**Interfaces:**
- Consumes: `loadConfig`, `runShell`.
- Produces: `runGate(root): { ok, output }` — picks `gate.command.windows` on win32 else `unix`; empty command → `ok:false`, "gate command not configured; run /darkforge:init". Ok ⇔ exit 0 **and** stdout contains `successMarker`. Quiet: output = lines containing `FAIL`/`error`/`CHECK FAILED` (case-insensitive) plus the marker line, else last 20 lines on failure. Writes `.darkforge/gate.json` `{ head: <git rev-parse HEAD>, ok, at: ISO }`. `gateFresh(root): boolean` — gate.json ok and head equals current HEAD.
- CLI: `darkforge gate [--full]`.

- [ ] **Step 1:** Tests: passing command prints only marker line; exit 0 without marker → not ok; failing command output trimmed to failing lines; cwd containing a space works; `gateFresh` false after a new commit in a temp git repo.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat: quiet gate with freshness record`.

### Task 6: State and token ledger

**Files:** Create `scripts/lib/state.mjs`, `scripts/lib/ledger.mjs`, `hooks/ledger.mjs`, add SubagentStop and Stop entries to `hooks/hooks.json`, `test/ledger.test.mjs`, `test/fixtures/transcripts/*.jsonl`.

**Interfaces:**
- Produces:
  - `readState(root) / writeState(root, patch)` → `.darkforge/state.json` `{ task: string|null, phase: "implement"|"review"|"fix"|"orchestrator"|null, offsets: { [transcriptPath]: number } }`.
  - `sumUsage(jsonlText, fromLine): { tokens: number, lines: number }` — sums `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens` from every line's `message.usage`; ignores malformed lines.
  - `appendRecord(root, { at, task, phase, kind: "subagent"|"orchestrator", agent, model, tokens })` → `.darkforge/ledger.jsonl`.
  - `report(root): string` — per task (implement/review/fix/orchestrator/total), per model, grand total, orchestrator vs subagents.
  - CLI: `darkforge ledger phase <name>`, `darkforge ledger report`.
- Hook: SubagentStop → record `kind:"subagent"` from the subagent transcript; Stop → record `kind:"orchestrator"`, phase `orchestrator`, only lines after the stored offset. No config → no-op.

- [ ] **Step 1:** Confirm in current hooks docs which fields SubagentStop/Stop receive (transcript path for the subagent, agent type, model). Where a field is missing, record `null` and note the limit in `docs/user-guide.md` (Task 11).
- [ ] **Step 2:** Tests: `sumUsage` on fixture = known total; malformed line ignored; offset makes a second Stop count only new lines; record carries task/phase from state; `report` totals match; no config → hook exits 0 without writing.
- [ ] **Step 3–5:** FAIL → implement → PASS. Commit `feat: token ledger hooks and report`.

### Task 7: Memory lint

**Files:** Create `scripts/lib/memory.mjs`, `test/memory.test.mjs`, fixtures.

**Interfaces:**
- Produces: `lintMemory(root): { ok, problems: string[] }`. Rules:
  1. `memory-bank/activeContext.md` exists and has ≤ 60 lines.
  2. `activeContext.md` has headings `## Where we are`, `## Next`, `## Waiting on owner`.
  3. Every `Q-NN` under `## Waiting on owner` must not appear in `memory-bank/decisions.md` (an answered question there means activeContext is stale).
  4. If `state.task` is set, `memory-bank/progress.md` has a row starting with `| <task>` .
- CLI: `darkforge memory lint`.

- [ ] **Step 1:** Tests: one fixture per rule failing, one clean fixture passing. **Step 2–4:** FAIL → implement → PASS. Commit `feat: memory-bank lint`.

### Task 8: Templates and init apply

**Files:** Create `templates/memory-bank/{activeContext,progress,backlog,decisions,systemPatterns,techContext,projectbrief}.md`, `templates/phase-plan.md`, `templates/task-package.md`, `templates/constraints.md`, `templates/claude-md-block.md`, `templates/gate/check.ps1`, `templates/gate/check.sh`, `scripts/lib/init.mjs`, `test/init.test.mjs`.

**Interfaces:**
- Consumes: `DEFAULT_CONFIG`, `lintMemory` (a fresh project must lint clean).
- Produces:
  - `applyInit(root, answers: { config: Partial<Config>, constraints: string[], openQuestions: {id, question, blocks}[], createGate: boolean }): { written: string[], skipped: string[] }`.
    - Writes `.darkforge/config.json` (merged over existing if present).
    - Writes each memory-bank and `docs/plans/constraints.md` file **only if absent**.
    - `CLAUDE.md`: create if absent; else replace only between `<!-- darkforge:begin -->` and `<!-- darkforge:end -->`, appending the block if markers are absent.
    - Gate skeletons only when `createGate` and the configured gate file is absent.
    - Appends `.darkforge/state.json` and `.darkforge/gate.json` to `.gitignore` (idempotent). Ledger is committed.
  - `saveDefaults(answers)` / `loadDefaults()` → `~/.darkforge/defaults.json` (path from `os.homedir()`; tests use an env override `DARKFORGE_HOME`).
  - CLI: `darkforge init apply --answers <file.json>`, `darkforge init defaults [--save <file.json>]`.
- Template content requirements: `task-package.md` sections — Header line (Agent · Model · Branch · Reviewer · Risk), Constraints, Read first (sections, not whole files), Files, Interfaces, Requirements, Tests (exact names and assertions), Not doing. `phase-plan.md` — Goal, Review Focus, task table (Task, Title, Depends, Risk, Implementer/model, Reviewer/model, Acceptance, Tests), Exit checklist. `claude-md-block.md` — the hard rules: one task/one branch/one implementer; reviewer is a different agent; explicit model on every darkforge dispatch; banned models from config; gate marker before merge; merge only via `darkforge task merge`; update memory bank after every task; talk to the owner in `{{ownerLanguage}}`.

- [ ] **Step 1:** Tests: fresh temp dir → files written, `lintMemory` clean; second run with an edited `activeContext.md` and a hand-written `CLAUDE.md` → those contents preserved except the marked block; existing gate script untouched; `.gitignore` lines not duplicated; defaults round-trip via `DARKFORGE_HOME`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat: project templates and init apply`.

### Task 9: Task start and merge

**Files:** Create `scripts/lib/task.mjs`, `test/task.test.mjs`.

**Interfaces:**
- Consumes: `run`, `loadConfig`, `writeState`, `gateFresh`, `lintMemory`.
- Produces:
  - `startTask(root, id: string, slug: string)`: refuse if working tree dirty; `git fetch --prune <remote>` when remote set; refuse if `task/<id>-*` exists locally or remotely; `git switch -c task/<id>-<slug> <baseBranch>`; `writeState({task:id, phase:"implement"})`.
  - `mergeTask(root, id, { title })`: refuse unless (a) `gateFresh`, (b) `git diff --name-only <base>...HEAD` contains `memory-bank/progress.md` and `memory-bank/activeContext.md`, (c) `lintMemory` ok. Then if `prFlow`: `git push <remote> <branch>`, `gh pr create --base <base> --head <branch> --title <title> --body <generated>`, then either `gh pr merge <n> --<method> --delete-branch --auto` (`autoMerge`) or `gh pr checks <n> --watch --required` followed by `gh pr merge <n> --<method> --delete-branch`; then `git switch <base>`, `git pull --ff-only <remote> <base>`, `git branch -d <branch>`. Without remote: `git switch <base>` + `git merge --no-ff <branch>`. Finally `writeState({task:null, phase:null})`.
  - CLI: `darkforge task start <id> <slug>`, `darkforge task merge <id> --title "<title>"`.

- [ ] **Step 1:** Tests with the fake runner asserting the exact command sequence for: start (clean), start (dirty → refuse), merge with PR + autoMerge, merge with PR + watch, merge local, merge refused for stale gate, refused for missing memory-bank change. One real-git test in a temp repo for the local path.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat: task start and merge`.

### Task 10: Agents

**Files:** Create `agents/{builder,specialist,reviewer,security-reviewer,scaffolder,verifier}.md`, `test/agents.test.mjs`.

**Interfaces:**
- Consumes: CLI commands (`gate`, `memory lint`), config fields `constraintsPath`, gate.
- Produces: agent names referenced by routing (`builder`, `specialist`, `reviewer`, `security-reviewer`, `scaffolder`, `verifier`), dispatched as `darkforge:<name>`.
- Content, generalised from Dark Clipboard's agents (no domain rules): implementers read only the package's "Read first" items plus the constraints file; tests first (load `superpowers:test-driven-development` if available, otherwise follow the inline TDD rules); keep Interfaces exactly; edit only listed files; never create/merge/push branches; run `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" gate` before reporting; short final report. Reviewers: read-only; first line `APPROVED` or `CHANGES REQUIRED`; defects as `file:line`, trigger, `blocking`/`should-fix`; last line gate result. Security reviewer additionally loads any project skill named in the package and maps findings to the project's threat IDs if a threat model exists. Verifier records raw evidence, never edits product code. No agent mentions a specific model ban.

- [ ] **Step 1:** Verify supported plugin-agent frontmatter fields in current docs. **Step 2:** Test: each file has frontmatter `name` and `description`, reviewers' `tools` exclude `Edit`/`Write`, no file contains `fable` or `Dark Clipboard`. **Step 3–5:** FAIL → write → PASS. Commit `feat: generic agents`.

### Task 11: Skills, session brief, docs

**Files:** Create `skills/*/SKILL.md` (8), `hooks/session-brief.mjs` + SessionStart entry, `test/skills.test.mjs`, `test/brief.test.mjs`, `docs/user-guide.md`, `docs/example-dark-clipboard.md`, `docs/testing/e2e-checklist.md`; update README and CHANGELOG.

**Interfaces:**
- Consumes: every CLI command; routing/escalation config; templates.
- Skill requirements (judgment only; mechanics call the CLI):
  - `init` (user-invocable): run `doctor`; load defaults; interview one question at a time with the reason for each, accepting "not decided yet" → open question; cover stack + gate commands, constraints, risk areas, model policy (banned models, routing, floors), git/PR/CI checks, owner language; write answers JSON to a temp file; `init apply`; offer `init defaults --save`.
  - `grill`: modes `requirements` and `plan`; one question at a time; answer from repo docs first; plan-mode checklist: interface contracts, hidden dependencies, risk under-rating, measurable acceptance, scope creep; stop when nothing build-changing is open.
  - `plan-phase` (user-invocable): if `superpowers` is `auto` and `docs/superpowers/plans/` has a plan for this phase, use it; else `grill requirements`; write phase plan from template with routing; `grill plan`; write task packages via `task-package-writing`.
  - `task-package-writing`: template rules; "Read first" names sections; tests with exact assertions; package ≤ ~4 KB.
  - `model-routing`: pick from config by risk; raise one tier after `raiseAfterFixRounds`; ask owner after `askOwnerAfterFixRounds`; always pass `model` explicitly.
  - `next-task` (user-invocable): the spec §7 steps; dispatches with explicit models; `ledger phase` before each dispatch; fix rounds via `SendMessage` to the same implementer with only the defect list; does not re-run gate when `gateFresh`; `task start`/`task merge`; reports in owner language.
  - `phase-review`, `status` (user-invocable): as in spec; `status` uses `ledger report` and reads only `activeContext.md` + `progress.md`.
- Session brief: when config exists, emit additional context ≤ 3 lines: project name, current task from state, "Use /darkforge:status or /darkforge:next-task". Else no-op.
- Docs: user guide (install, requirements, init, daily flow, superpowers optional, config, known limits incl. ledger best effort and session-model limit); worked example credits Dark Clipboard; e2e checklist = the manual run from spec §8.

- [ ] **Step 1:** Tests: every skill has `name`/`description` frontmatter; the four user-invocable skills are marked invocable per current docs; no skill contains `fable`; brief hook no-op without config and ≤ 3 lines with config.
- [ ] **Step 2–4:** FAIL → write → PASS. **Step 5:** Full `npm test` PASS; commit `feat: skills, session brief and docs`.

### Task 12: Manual end-to-end run (owner present)

**Files:** Create `docs/testing/2026-MM-DD-e2e-<os>.md`.

- [ ] **Step 1:** Install the plugin from the local path into a scratch project (outside dark-clipboard), run `init` → `plan-phase` (tiny phase, two tasks) → `next-task` ×2 → `phase-review`, once with superpowers enabled and once disabled.
- [ ] **Step 2:** Record date, OS, Node, Claude Code version, the ledger report, every deviation. Fix defects as new tasks. Commit `docs: e2e run`.
