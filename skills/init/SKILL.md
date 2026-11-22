---
name: init
description: Set up darkforge in this repository (new or existing) - interview the owner, then write .darkforge/config.json, memory bank, constraints and the CLAUDE.md block. Safe to re-run to change answers.
user-invocable: true
---

# Init

`df <args>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/darkforge.mjs" <args>`. Config field reference: `${CLAUDE_PLUGIN_ROOT}/docs/config.md` (read only the rows you need).

## 1. Check
Run `df doctor`. A `fail:` line: stop and tell the owner how to fix it. `warn: gh` means no PR flow until `gh` is installed and authenticated. If `.darkforge/config.json` exists, this is a re-run: read it and ask only what the owner wants to change.

## 2. Language
First question, asked in English: which language should darkforge use to talk to you? That becomes `project.ownerLanguage`; ask everything after it in that language. Repo files stay in English.

## 3. Pre-fill
Run `df init defaults`. If it prints JSON, its `config` (models, routing, ownerLanguage) pre-fills those answers; still show each one for confirmation. Look at the repo yourself (package files, CI files, existing `scripts/check.*`, README) and propose answers instead of asking blank questions.

## 4. Interview
One question per message. Each says in one sentence why it matters and offers your proposed answer. The owner may say "not decided yet": record it as `{ "id": "Q-NN", "question": "...", "blocks": "..." }` (Q-01, Q-02, ...) and use the default for now; never guess a value. Cover, in this order:
1. Project name.
2. Stack and gate: build, test and lint commands per OS. If the repo already has a gate script, point `gate.command.windows`/`gate.command.unix` at it and keep it. Otherwise propose `createGate: true` (skeletons `scripts/check.ps1`/`check.sh`). Success marker (default `ALL CHECKS PASSED`). If the commands are "not decided yet", also record the open question "gate has placeholder steps" (blocks: the first task).
3. Constraints: the project's non-negotiables (privacy, compatibility, licences, no network, ...). Each becomes one line in `constraints`.
4. Risk areas: parts of the code where any change is high risk (`riskAreas`).
5. Model policy: models that must never be used (`models.banned`); routing per risk level (show the default table from the config reference); floors per agent (`models.floors`); escalation rounds.
6. Git: base branch; remote name or none; pull-request flow; required CI check names; merge method; auto-merge.
7. Superpowers: `auto` (use if installed) or `off`.

## 5. Apply
Write the answers to a temp file outside the repo (e.g. the OS temp dir) as:
`{ "config": { <only fields that differ from defaults or were answered> }, "constraints": ["..."], "openQuestions": [...], "createGate": true|false }`
Show the owner a short summary, then run `df init apply --answers <file>`. It prints `written`/`skipped` per file and never overwrites memory-bank or docs files that exist; only the config and the marked block in `CLAUDE.md` change on a re-run.
If `createGate` was true: replace the skeleton steps in `scripts/check.ps1` and `scripts/check.sh` with the real commands from question 2, keeping the success-marker line last. Run `df gate`; it must print the marker.

## 6. Finish
Offer to save the policy answers (banned models, routing, language) for future projects: `df init defaults --save <file>`. Delete the temp file. Tell the owner in `project.ownerLanguage`: what was written, open questions, and that before `/darkforge:plan-phase` the new files must be committed and pushed to `<git.remote>/<git.baseBranch>` (through a pull request if that branch is protected), because task branches start from there. Without a remote, commit them on the base branch. Offer to do it, staging the listed `written` files only, never `git add -A`.
