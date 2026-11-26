# Live Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `darkforge dashboard --watch` serves the dashboard on loopback and pushes fresh data to the open page within about a second, including the running step and the questions the session is asking the owner right now.

**Architecture:** Hooks and existing `df` commands write a few more fields to `.darkforge/state.json`. A new `scripts/lib/dashboard-server.mjs` runs a `node:http` server on `127.0.0.1` behind a random token, watches the source directories (fs.watch + 2 s poll), re-runs `collect()` and sends the JSON over Server-Sent Events. The single template gets a live flag; in live mode it opens an `EventSource` and re-renders in place.

**Tech Stack:** Node >= 18 ESM, `node:http`, `node:fs`, `node:test`; no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-live-dashboard-design.md`

## Global Constraints

- Node >= 18; no npm dependencies; tests run with `npm test` (`node --test`).
- Windows, macOS and Linux; do not use `fs.watch(..., { recursive: true })`.
- Server binds `127.0.0.1` only; every path outside `/<token>/` → 404 empty body; non-GET → 405; bad `Host` → 421; 9th event stream → 503.
- Token: 32 random bytes, base64url, new per start.
- Debounce 200 ms; poll 2000 ms; SSE keep-alive comment every 25 s (all three injectable for tests).
- Page CSP exactly: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Every response: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- `waiting.questions` items cut to 300 characters.
- Hooks are best effort: never throw, never block a tool call, exit code 0.
- Every project value reaches the page as text (`esc()` / `textContent`); JSON sent anywhere is escaped like `render()` does (`<`, U+2028, U+2029).
- Static mode (`dashboard`, `--out`, `--open`) still writes one file, starts no server, opens no connection.
- Files stay in English; UI strings in both English and Vietnamese via the template's `T`/`V` helpers.

## Review Focus

1. A browser tab closed mid-stream (or the laptop sleeping) must not crash the server or leak the stream slot: the 9th connection after 8 closed ones must succeed. → Task 4 test `closed streams free their slot`.
2. A question text with newlines, `</script>` and Vietnamese must arrive over SSE intact and render as text. → Task 4 test `event data survives newlines, script tags and unicode`.
3. The project's config deleted or broken while watching: server stays up, page shows the error, recovers when the file is restored. → Task 4 test `collect error is pushed and the server recovers`.
4. Nothing changed: the poll must not push (and must not re-run `collect()` when no file signature changed), so a big ledger does not cost CPU every 2 s. → Task 4 test `idle poll does not collect`.
5. `--port` already in use: a clear error and exit 1, not a crash trace or a silent other port. → Task 4 test `busy port is an error`.

---

### Task 1: Running-step state (`since`, roles, `round`)

**Files:**
- Modify: `scripts/lib/state.mjs` (`writeState`)
- Modify: `scripts/lib/flow.mjs` (`beginTask`, ~line 98)
- Modify: `scripts/lib/ledger.mjs` (`ledgerCommand`, ~line 225)
- Modify: `hooks/model-guard.mjs` (allowed-dispatch branch, ~line 38)
- Test: `test/live-state.test.mjs` (new)

**Interfaces:**
- Produces, in `state.json` (read back by `readState`, which already keeps unknown keys):
  - `since: string` (ISO), set by `writeState` whenever the patch sets `phase` to a value different from the stored one.
  - `implementer`, `reviewer`: `{ agent: string, model: string }`.
  - `round: number`.
  - When a patch sets `task: null`, `writeState` drops `since`, `implementer`, `reviewer`, `round` (keeps `waiting`, Task 2 owns it).
- `writeState(root, patch, now = new Date())`: new optional third parameter for tests.

- [ ] **Step 1: Write the failing tests** in `test/live-state.test.mjs` (temp project via `applyInit` like `test/dashboard.test.mjs`):
  - `since is set when phase changes and kept when it does not`: `writeState(root,{phase:"implement"},T1)` → `since === T1.toISOString()`; `writeState(root,{phase:"implement"},T2)` → still T1; `writeState(root,{phase:"review"},T2)` → T2.
  - `clearing the task drops the running-step fields`: state with all four fields + `waiting`, then `writeState(root,{task:null,phase:null})` → none of the four present, `waiting` still present.
  - `ledger phase fix increments round`: `main(["ledger","phase","fix"])` twice from `round:0` → `round === 2`; `ledger phase review` leaves it 2.
  - `beginTask writes roles and round 0 on a new task, keeps round on resume`: use the existing `test/flow.test.mjs` git fixture helpers (copy its setup); after begin, `implementer` equals `{agent:"builder",model:"sonnet"}` from the header, `reviewer` likewise, `round === 0`; set `round:2`, begin again on the same branch → `round === 2`.
  - `model-guard records an escalated model for the dispatched role`: spawn `hooks/model-guard.mjs` (pattern of `test/ledger.test.mjs:34`) with an allowed `Agent` input `{subagent_type:"darkforge:builder", model:"opus"}` while `task` is set → `state.implementer.model === "opus"`; with no task → no `implementer` key.

- [ ] **Step 2: Run** `node --test test/live-state.test.mjs` — expect FAIL (fields absent).

- [ ] **Step 3: Implement.**
  - `writeState`: compute `since` and the task-null drop before `writeAtomic`.
  - `beginTask`: on a new start `writeState(root, { implementer: h.implementer, reviewer: h.reviewer, round: 0 })` after `startTask` succeeds; on resume write only the two roles.
  - `ledgerCommand` phase branch: for `fix`, `writeState(root, { phase: name, round: (Number.isInteger(s.round) ? s.round : 0) + 1 })`.
  - `model-guard`: inside the existing try, when `phase && state.task`, also write `{ [phase === "review" ? "reviewer" : "implementer"]: { agent: <name after "darkforge:">, model: String(tool_input.model ?? "") } }` — only when `tool_input.model` is a non-empty string.

- [ ] **Step 4: Run** `npm test` — expect all PASS (existing flow/ledger/guard tests unchanged).

- [ ] **Step 5: Commit** `feat(state): record running step, roles and fix round for the live dashboard`.

---

### Task 2: Questions waiting on the owner (`waiting`)

**Files:**
- Create: `hooks/ask-watch.mjs`
- Modify: `hooks/hooks.json` (add `PreToolUse` and `PostToolUse` entries, matcher `AskUserQuestion`, `timeout: 10`, same shape as the model-guard entry)
- Modify: `hooks/ledger.mjs` (on `Stop`, also clear `waiting`)
- Modify: `skills/next-task/SKILL.md` (steps 3, 4.3, 6: "ask the owner" → "ask the owner with `AskUserQuestion`")
- Test: `test/ask-watch.test.mjs` (new)

**Interfaces:**
- Produces in `state.json`: `waiting: { since: string, questions: string[] }`, or no `waiting` key.
- `hooks/ask-watch.mjs` reads `hook_event_name`: `PreToolUse` → set, `PostToolUse` → `writeState(root, { waiting: undefined })` (JSON drops it). Ignores other tools, other events, non-darkforge dirs, malformed input. Writes no stdout.

- [ ] **Step 1: Write the failing tests** (spawn the hook as in `test/ledger.test.mjs:34`):
  - `PreToolUse AskUserQuestion records the questions`: input `{hook_event_name:"PreToolUse", tool_name:"AskUserQuestion", cwd:root, tool_input:{questions:[{question:"Merge now?"},{question:"x".repeat(400)}]}}` → `waiting.questions` is `["Merge now?", "x".repeat(300)]`, `waiting.since` is ISO; stdout empty; exit 0.
  - `PostToolUse clears it`.
  - `Stop clears it`: run `hooks/ledger.mjs` with `{hook_event_name:"Stop", cwd:root, transcript_path:<missing file>}` → no `waiting`.
  - `malformed input and other tools leave state alone`: `"not json"`, `{tool_name:"Bash"}`, `tool_input:{questions:"nope"}` → state unchanged, exit 0.
  - `next-task asks with AskUserQuestion`: `skills/next-task/SKILL.md` contains `AskUserQuestion` at least 3 times.
  - `hooks.json registers ask-watch for AskUserQuestion on PreToolUse and PostToolUse`.

- [ ] **Step 2: Run** `node --test test/ask-watch.test.mjs` — expect FAIL.

- [ ] **Step 3: Implement** the hook (copy model-guard's stdin/try/`process.exitCode = 0` skeleton), the `hooks.json` entries, the Stop clear in `hooks/ledger.mjs` (own try/catch, before `recordStop`, so a ledger failure never keeps a stale question), and the skill wording.

- [ ] **Step 4: Run** `npm test` — expect PASS (including `test/skills.test.mjs`).

- [ ] **Step 5: Commit** `feat(hooks): record questions waiting on the owner`.

---

### Task 3: Page shows the running step and live questions; live flag

**Files:**
- Modify: `scripts/lib/dashboard.mjs` (`collect`, `render`)
- Modify: `templates/dashboard.html`
- Test: `test/dashboard.test.mjs`

**Interfaces:**
- Consumes: Task 1 and 2 state fields.
- Produces: `collect(root, now)` → `state` becomes `{ task, phase, since, round, implementer, reviewer, waiting }`, each sanitized: strings or `null`, `round` integer >= 0, roles `{agent, model}` of strings or `null`, `waiting` `{since, questions: string[]}` or `null`.
- Produces: `render(data, { live = false } = {})` → string; replaces `/*DARKFORGE_LIVE*/false` with `true` when live. Throws if either placeholder is missing.
- Template, live mode: `const LIVE=/*DARKFORGE_LIVE*/false;` if `LIVE`, `new EventSource("events")`; `message` event → `DATA = JSON.parse(e.data)` then `render()` keeping `phaseN`, `filter`, `sel`, `lang`, `scrollY` (fallback to `firstPick()` when gone); named event `failed` → banner with `e.data` as text over the last good data; `error`/`open` → indicator.

- [ ] **Step 1: Write the failing tests** in `test/dashboard.test.mjs`:
  - `collect passes the running step through, sanitized`: state `{task:"002",phase:"fix",since:"2026-11-27T01:00:00.000Z",round:2,implementer:{agent:"builder",model:"opus"},waiting:{since:"…",questions:[EVIL]}}` → those values in `data.state`; `round:"2"` or `implementer:"x"` → `0` / `null`.
  - `render live flag`: `render(d)` contains `/*DARKFORGE_LIVE*/false` nowhere and `const LIVE=false`; `render(d,{live:true})` contains `const LIVE=true`; `render(d)` still escapes `EVIL` (existing test pattern).
  - `the page opens an EventSource only behind the live flag`: the template text matches `/if\s*\(LIVE\)[\s\S]*new EventSource\("events"\)/` and has exactly one `new EventSource`.
  - `waiting questions render as text`: extend the existing XSS test so `waiting.questions` carries `EVIL` and the rendered script contains no raw `</script><img`.

- [ ] **Step 2: Run** `node --test test/dashboard.test.mjs` — expect FAIL.

- [ ] **Step 3: Implement** `collect` sanitizing, `render` option, and the template:
  - "now" chips: task; phase; working agent+model derived from phase (`implement`/`fix` → `implementer`, `review` → `reviewer`, `orchestrator` → "main session" / "phiên chính"); "since hh:mm (N min)"; "fix round N" when N > 0.
  - "Waiting on you" panel: `waiting.questions` first, each marked "asked in Claude Code now" / "đang hỏi trong Claude Code"; the panel heading gets the warning colour when `waiting` is non-null; the figure count includes them.
  - Live only: indicator in the header ("Live · updated hh:mm:ss" / "Trực tiếp · cập nhật hh:mm:ss"; "Disconnected, retrying" / "Mất kết nối, đang thử lại"); footer "Live page served by `darkforge dashboard --watch` on this computer only. Stop it with Ctrl+C." / "Trang trực tiếp do `darkforge dashboard --watch` phục vụ, chỉ trên máy này. Dừng bằng Ctrl+C."; ledger note adds "Tokens are added when each agent finishes, not while it runs." / "Token được cộng khi mỗi agent xong, không phải trong lúc nó đang chạy."

- [ ] **Step 4: Run** `npm test` — PASS. Then `node scripts/darkforge.mjs dashboard --out <scratch>/d.html` on this repo's test fixture and open it: static page renders, no console errors.

- [ ] **Step 5: Commit** `feat(dashboard): show running step and live questions; live flag in the template`.

---

### Task 4: `dashboard --watch` server, watcher and docs

**Files:**
- Create: `scripts/lib/dashboard-server.mjs`
- Modify: `scripts/lib/dashboard.mjs` (`dashboardCommand`, `USAGE`; export `openFile` for reuse or move it)
- Modify: `docs/user-guide.md` (Dashboard section), `skills/status/SKILL.md`, `CHANGELOG.md` (Unreleased entry)
- Test: `test/dashboard-server.test.mjs` (new)

**Interfaces:**
- Consumes: `collect`, `render(data, { live: true })` (Task 3).
- Produces: `startLiveServer(root, { port = 0, pollMs = 2000, debounceMs = 200, keepAliveMs = 25000, maxStreams = 8, onCollect = null } = {})` (`onCollect`: test hook called once per `collect()` run) → `Promise<{ url: string, port: number, close(): Promise<void> }>`; rejects with an `Error` whose message names the port when listen fails.
- Events: `data: <json>\n\n` for data; `event: failed\ndata: <message>\n\n` for a `collect()` error; `: keep-alive\n\n`.
- CLI: `darkforge dashboard --watch [--open] [--port <n>]`; `--watch` with `--out` → usage error exit 1; `--port` must be an integer 0–65535. Prints `dashboard: <url>`; resolves on SIGINT/SIGTERM after `close()`, exit 0.

- [ ] **Step 1: Write the failing tests** (`http.get` against `startLiveServer(root,{pollMs:50,debounceMs:10,keepAliveMs:100})`; temp project as in `test/dashboard.test.mjs`; always `close()` in `t.after`):
  - `token, path, method and Host are enforced`: `/` and `/<wrong>/` → 404 empty body; POST `/<token>/` → 405; `Host: evil.test:<port>` → 421; `Host: localhost:<port>` → 200.
  - `the page is live and locked down`: GET `/<token>/` → 200, `content-type` html, body contains `const LIVE=true`, CSP header equals the Global Constraints value, `cache-control: no-store`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, no `access-control-allow-origin`.
  - `a stream gets the data at once and one event per change`: open `/<token>/events`, first `data:` parses with `state.task === "002"`; `writeState(root,{phase:"fix"})` → next `data:` has `state.phase === "fix"` within 1 s; a write that changes nothing collected (e.g. touch `backlog.md` with same content) → no further data event within 300 ms.
  - Review Focus 2 — `event data survives newlines, script tags and unicode`: `waiting.questions = ["a\nb </script> Gộp ngay? "]` → each event is one `data:` line; parsed value equals the input.
  - Review Focus 3 — `collect error is pushed and the server recovers`: write invalid JSON to `.darkforge/config.json` → `event: failed`; restore → a `data:` event follows.
  - Review Focus 4 — `idle poll does not collect`: inject a counter (`startLiveServer(..., { onCollect })` test hook) → after the initial collect, 300 ms idle adds 0.
  - `stream limit`: 8 open streams, 9th → 503.
  - Review Focus 1 — `closed streams free their slot`: open 8, destroy all, wait 50 ms, open 1 more → 200, and no `ERR_STREAM_WRITE_AFTER_END` on the next change.
  - Review Focus 5 — `busy port is an error`: start one server, start a second with the first's port → rejects, message contains the port; CLI with that `--port` → exit 1, stderr one line `darkforge: …`.
  - `keep-alive comments are sent`: a `: keep-alive` line within 300 ms.
  - `CLI rejects --watch with --out and a bad --port`: exit 1 with usage.

- [ ] **Step 2: Run** `node --test test/dashboard-server.test.mjs` — expect FAIL.

- [ ] **Step 3: Implement** `startLiveServer`:
  - Watch `.darkforge`, `memory-bank`, `docs/plans` with `fs.watch` (non-recursive, `error` listener closes that watcher; poll covers it); missing dirs are retried each poll.
  - Signature = `size:mtimeMs` of every file `collect` reads (`config.json`, `state.json`, `ledger.jsonl`, `memory-bank/*.md`, `docs/plans/phase-*.md`); poll compares it and schedules a re-collect only on change; a watch event always schedules one (debounced).
  - After a collect, push only if `JSON.stringify` of the data minus `generatedAt` differs from the last pushed one; a `collect` throw sends `failed` once per distinct message.
  - Track streams in a `Set`; remove on `close`; never write to a destroyed response.
  - `close()` closes watchers, timers, streams and the server.
- [ ] **Step 4: Wire the CLI** in `dashboardCommand`: parse `--watch`/`--port`, call `startLiveServer`, print the URL, `--open` via the existing opener, wait for SIGINT/SIGTERM, `close()`, return 0.

- [ ] **Step 5: Docs.** `docs/user-guide.md`: add `--watch` (loopback only, secret URL, tokens per finished agent, Ctrl+C), and reword "makes no network requests" to apply to the static page. `skills/status/SKILL.md`: one line pointing to `dashboard --watch --open`. `CHANGELOG.md`: Unreleased → Added.

- [ ] **Step 6: Run** `npm test` — all PASS. Then manually: `node scripts/darkforge.mjs dashboard --watch --open` in a darkforge project, run `node scripts/darkforge.mjs ledger phase fix` in another terminal → page updates (phase chip, fix round 1) within ~1 s without losing the selected task; Ctrl+C → page shows disconnected.

- [ ] **Step 7: Commit** `feat(dashboard): --watch serves a live page on loopback`.
