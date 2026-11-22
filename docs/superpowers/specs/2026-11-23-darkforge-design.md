# darkforge: design

Date: 2026-11-23 · Status: draft for owner approval · Licence: MIT

## 1. Intent

darkforge is a public Claude Code plugin that runs an AI-first software project the way Dark Clipboard (a Rust clipboard manager built by the owner) has been run for 20+ tasks: small written task packages, one implementing subagent per task, an independent reviewer, a model chosen by risk, a quality gate, PR-only merges, a short memory bank, and a token ledger.

Why it exists:

1. **Cost.** The owner wants the lowest token spend that still keeps code safe to merge. In Dark Clipboard about 6.5 M subagent tokens were spent; the biggest avoidable costs were fix rounds, mechanical steps done by the model, an oversized always-read context file, and an unmeasured orchestrator session. Expensive models used by default (subagents inheriting the session model) are a known cost trap.
2. **Reuse.** The process should not be rebuilt by hand for every new project, and every project should get process improvements when the plugin updates.

darkforge is the **run-and-govern** layer. Thinking work (brainstorming, specs, plans, TDD discipline) can come from the optional `superpowers` plugin; darkforge works fully without it.

## 2. Goals, non-goals, anti-goals

Goals
- `init` interviews the user and sets up any project, any stack, with a config file and a project layer they own.
- `plan-phase` turns requirements (or a superpowers plan) into a phase plan and task packages, after a plan interrogation step (`grill`).
- `next-task` runs one task end to end: branch, implementer, independent reviewer, fix rounds, gate, ledger, memory bank, PR, merge.
- `phase-review` and `status` as in Dark Clipboard.
- Model policy is configuration, enforced by a hook, not by prose.
- Mechanical steps are deterministic Node.js scripts bundled in the plugin; the model only makes judgment calls.
- Token use is measured per task, including the orchestrator session.
- Works on Windows, macOS and Linux.

Non-goals
- No stack-specific templates (no Rust/TS/Python presets). Every project fills its own gate and constraints at `init`.
- No network access by darkforge itself apart from `git` and `gh` calls the user's workflow already makes. No telemetry.
- Not a replacement for superpowers' thinking skills; not a second task executor (darkforge does not use `superpowers:subagent-driven-development`).
- No GUI.

Anti-goals (failure even if it "works")
- Running a project with darkforge costs more tokens than the same process done by hand.
- darkforge silently overrides the user (changes a model choice, merges, rewrites approved docs) without saying so.
- The owner's personal preferences (e.g. "never Fable", Vietnamese) are hard-coded into the public plugin.
- darkforge breaks when superpowers is absent, or when superpowers renames a skill or path.
- Rules that matter live only in prose that the model may skip.

## 3. Constraints

- Distributed as a Claude Code plugin from a public GitHub repo (`darkforge`) that also contains `.claude-plugin/marketplace.json`, installable with `/plugin marketplace add <user>/darkforge`. The owner creates the GitHub repo when asked.
- Node.js ≥ 18 is the only runtime dependency. Scripts use only the Node standard library (no npm install for users). `git` is required; `gh` is required only when the project uses GitHub PRs.
- Plugin docs, prompts, templates and code in English. The language used with the project owner is a config value.
- Nothing from Dark Clipboard or Darkshot is copied as project-specific rules (no clipboard privacy rules, no "decision 154"). Dark Clipboard may appear only as a credited worked example in the docs.
- Ideas credited in the README: superpowers (Jesse Vincent, MIT) for the thinking layer; grill-me (Matt Pocock, MIT) for the interrogation idea. No text copied from either.
- User instructions (`CLAUDE.md`) outrank skills (also superpowers' own rule), so hard rules go into the generated `CLAUDE.md` block and into hooks, never only into skills.

## 4. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| 1 | Markdown-only plugin (skills/agents/commands, one hook) | Simplest; but branch/PR/ledger/memory upkeep stay model work every task: costs tokens and drifts (Dark Clipboard's `next-task` step 11 went stale) | Rejected |
| 2 | **Markdown for judgment + bundled Node.js scripts for mechanics** | Cheapest and most reliable per task; one script set for all OSes. Requires Node ≥ 18 | **Chosen by the owner** |
| 3 | Template generator: `init` copies the whole process into the project | Each project independent; but no updates reach old projects, projects drift apart | Rejected |

Also decided in conversation: superpowers is **optional** (detected, used if present); a darkforge-own `grill` step instead of depending on grill-me; public sharing, so model policy is configuration with an empty default ban list.

## 5. Architecture

Two layers.

**Plugin layer (darkforge repo, updated by plugin releases)**

```
darkforge/
├─ .claude-plugin/plugin.json, marketplace.json
├─ skills/            (user-invocable ones are the slash commands)
│  ├─ init/           interview → config + project layer
│  ├─ plan-phase/     requirements or superpowers plan → phase plan → grill → task packages
│  ├─ grill/          one-question-at-a-time interrogation (requirements mode, plan mode)
│  ├─ next-task/      orchestrates one task (judgment steps only; calls scripts)
│  ├─ phase-review/
│  ├─ status/
│  ├─ task-package-writing/   rules + template for packages
│  └─ model-routing/          how to pick/escalate models from config
├─ agents/            builder, specialist, reviewer, security-reviewer, scaffolder, verifier
├─ hooks/hooks.json   model-guard (PreToolUse on the Agent tool), token ledger (SubagentStop, Stop), session brief (SessionStart, small)
├─ scripts/darkforge.mjs   single CLI: doctor | task start|merge | gate | ledger | memory lint
├─ templates/         memory-bank/*, phase-plan.md, task-package.md, constraints.md, claude-md-block.md, gate skeletons
├─ docs/              user guide, config reference, worked example (Dark Clipboard, credited)
└─ test/              node:test suites + fixture project
```

**Project layer (created by `init`, owned and edited by the project)**

```
.darkforge/config.json      see §6
.darkforge/ledger.jsonl     token records (append-only)
memory-bank/                activeContext.md (≤ 60 lines), progress.md, backlog.md, decisions.md (one-line index), systemPatterns.md, techContext.md, projectbrief.md
docs/plans/constraints.md   project's non-negotiables (filled at init)
docs/plans/phase-N-*.md     phase plans
docs/tasks/NNN-*.md         task packages
scripts/check.*             project's own gate (stack-specific; user/agent fills it)
CLAUDE.md                   darkforge block between <!-- darkforge:begin --> / <!-- darkforge:end --> markers; re-running init updates only that block
project skills              domain checklists the project adds itself (e.g. a privacy gate)
```

Agents are generic: they read the config for the constraints path, gate command and owner language. Project-specific checklists are project skills that agents load when the package names them.

## 6. Config (`.darkforge/config.json`)

Fields (names are the builder's call; content is decided):
- `project`: name, owner language (for talking to the owner), docs/code language.
- `gate`: command per OS family (or one command), success marker line (default `ALL CHECKS PASSED`), quiet mode on by default.
- `constraintsPath`.
- `riskAreas`: free-text list of areas that are always high risk (e.g. auth, payments, unsafe code, data deletion).
- `routing`: risk level (`low`, `medium`, `high`) → implementer agent + model, reviewer agent + model. Default: low → builder/sonnet + reviewer/sonnet; medium → builder/sonnet + reviewer/opus; high → specialist/opus + security-reviewer/opus.
- `models`: `banned` (default empty; the owner will put `fable` here), `requireExplicit` (default true), per-agent floor (default: specialist and security-reviewer never `haiku`).
- `escalation`: raise one tier after N failed fix rounds (default 2); stop and ask the owner after M rounds (default 3).
- `git`: base branch, remote yes/no, PR flow yes/no, required CI checks, merge method, auto-merge allowed.
- `superpowers`: `auto` (default: use if detected) | `off`.

## 7. Behaviour

**init.** Runs `doctor` (Node, git, gh). Asks one question at a time, explains why each matters, and accepts "not decided yet" (recorded as an open question `Q-NN` in `activeContext.md`, never guessed). Covers: stack and gate commands; constraints; risk areas; model policy (including banned models); git/PR/CI; owner language. Writes the project layer. Safe to re-run: updates config and the CLAUDE.md block, never overwrites memory-bank or docs the project changed.

Works on a fresh repo and on an existing codebase that has no darkforge files: it adds the project layer next to the code and never touches existing source, `CLAUDE.md` content outside its markers, or an existing gate script (it points the config at it instead). Importing another project's hand-made process (memory bank, task numbering, ledger) is out of scope; the owner will not use darkforge on Dark Clipboard.

User defaults: at the end of `init` the user may save their answers to policy questions (banned models, routing, owner language) as `~/.darkforge/defaults.json`; the next `init` pre-fills those answers and still shows them for confirmation. Defaults are only an `init` convenience; at run time only the project config counts (no config merging).

**plan-phase.**
1. Input: a superpowers plan in `docs/superpowers/plans/` if present and `superpowers` is `auto`; otherwise the user's requirements, clarified with `grill` (requirements mode).
2. Writes `docs/plans/phase-N-*.md`: goal, review focus, task table with dependencies, risk, agent/model from routing, acceptance criteria, exit checklist.
3. Runs `grill` in plan mode: interface contracts between tasks, hidden dependencies, under-rated risk, measurable acceptance criteria, scope creep. Answers anything the docs answer itself; asks the user only what they must decide.
4. Writes task packages from the template: Read first (specific sections, not whole files), Files, Interfaces (contract), Requirements, Tests with exact assertions, Not doing, risk, agent/model.

**next-task.** Judgment in the skill, mechanics in `darkforge task start|merge`:
1. Read `activeContext.md` + `progress.md` only. Pick the task.
2. `task start NNN`: clean-tree check, fetch, unused number, branch, status updates.
3. Dispatch implementer with an explicit model from routing.
4. Dispatch reviewer (different agent, model from routing; never weaker than the implementer for high risk).
5. Fix rounds go back to the **same** implementer with `SendMessage` and only the defect list; escalate per config.
6. Gate via `darkforge gate` (quiet: prints only failing steps and the success marker). The orchestrator does not re-run it if the reviewer already ran it on the same commit.
   Changed 2026-11-23: the gate always runs after the memory-bank commit, because task merge requires the gate on the exact merged commit.
7. Ledger and memory bank: `darkforge ledger` records tokens; the skill writes decisions/patterns; `darkforge memory lint` must pass (activeContext length, stale open questions, task status consistent with progress).
8. `task merge NNN`: refuses if memory bank was not updated on the branch or the gate marker is missing for HEAD; push, PR, wait for required checks (or auto-merge), merge, sync base, delete branch. Without a remote: local `--no-ff` merge.
9. Short report to the owner in the owner language.

**grill.** One question at a time, each saying why it matters; explores the repo instead of asking when it can; stops when nothing that changes the build is open. Two modes: requirements, plan.

**model-guard hook.** Scope (orchestrator's call, see §10): the hook is a no-op in a project without `.darkforge/config.json`. Inside a darkforge project, on every Agent tool call:
- deny if `model` is in `banned`, for **any** agent (built-in, darkforge, superpowers or other plugins), because that is the point of a ban;
- deny if `model` is missing, only for darkforge's own agents (`requireExplicit: "darkforge"`, the default; `"all"` and `"off"` are the other values). Built-in and other plugins' agents without a model pass, so superpowers and normal use never break;
- forks are exempt from the explicit-model rule (they ignore `model`);
- deny below the per-agent floor.
Deny messages are actionable (they name the model routing gives). The hook never changes a call silently. Known limit, documented in the user guide: a call without `model` inherits the session model, which the hook may not be able to see; if the session itself runs a banned model, the guide tells the user to switch it.

**Token ledger.** Best effort, documented as such. `darkforge task start` writes `.darkforge/state.json` (current task id); the `next-task` skill sets the current phase of work (`implement`, `review`, `fix`, `orchestrator`) in the same file through `darkforge ledger phase <name>` before each dispatch. SubagentStop and Stop hooks append usage records (task id, agent, model, phase of work, tokens) to `ledger.jsonl` using that state; records without a task get `task: null`. `status` and `darkforge ledger report` summarise per task, per model, and orchestrator vs subagents.

**SessionStart brief.** Small: the current task line from `activeContext.md` and pointers to the skills. Keep its token cost minimal.

## 8. Success criteria

- In a fresh fixture project: `init` → `plan-phase` → two `next-task` runs → `phase-review` complete without hand edits to plugin files. This end-to-end run is **manual**, done before each release on Windows and on Linux or macOS, and recorded in `docs/testing/` with date, versions and the ledger summary. CI does not run live Claude sessions (cost, secrets, flaky output).
- CI (no model calls) runs the `node:test` suites for scripts and hooks on Windows, macOS and Linux, using recorded hook inputs and a fixture project.
- A banned model on any Agent call, and a missing model on a darkforge agent call, are blocked every time (hook tests).
- With superpowers uninstalled every command works; with superpowers present `plan-phase` consumes its plan.
- The ledger shows orchestrator and subagent tokens per task.
- Scripts are covered by `node:test`; the plugin repo's CI runs them on Windows, macOS and Linux.

## 9. Left to the builder

- Exact config field names and JSON schema; exact CLI flags.
- Whether slash commands are user-invocable skills or `commands/` files, following current Claude Code plugin docs.
- How to read token usage in SubagentStop/Stop hooks (hook input, transcript parsing); verify against current docs and record any limit honestly in the user guide.
- How plugin agents are referenced (namespacing) and which frontmatter fields plugin agents support.
- Gate skeleton shape for projects (PowerShell/bash pair or a Node wrapper calling project commands).
- Versioning (semver), CHANGELOG format, release steps.

## 10. Calls made by the orchestrator after the builder check (owner to confirm)

1. End-to-end test is manual per release; CI runs only scripts and hooks (§8). Reason: cost goal; live sessions in CI need an API key and are flaky.
2. model-guard scope: no-op without a darkforge config; bans apply to every agent; explicit model required only for darkforge agents by default; forks exempt (§7).
3. Ledger task/phase come from a state file set by `task start` and the skill; best effort, documented (§7).
4. `init` supports existing codebases without darkforge files; no import of hand-made processes like Dark Clipboard's (§7).
5. User-level defaults only pre-fill `init`; no runtime config merging (§7).
