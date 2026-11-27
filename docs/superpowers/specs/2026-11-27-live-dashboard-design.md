# darkforge: live dashboard

Date: 2026-11-27 · Status: approved by owner 2026-11-27

## 1. Why

The owner wants to keep the dashboard open beside Claude Code while `next-task` runs and see, without asking the session:

1. where the running task is (which step, which agent, which fix round);
2. how many tokens it has used so far;
3. what is waiting on the owner's decision.

Today `darkforge dashboard` writes one static HTML page (data inlined, opened as `file://`) and exits; it has to be re-run to refresh. Asking the session "where are we?" costs a main-session turn, which re-reads the whole context (see the 0.2.0 design: the main session is 85% of all tokens).

## 2. Goals, non-goals, anti-goals

Goals
- `darkforge dashboard --watch` serves the dashboard and pushes new data to the open page within about 1 second of a source file changing.
- The page shows the running step (phase, agent, model, since when, fix round) and any decision the session is waiting on, including questions asked mid-task in chat, which today are written nowhere.
- The page keeps what the owner is looking at (selected phase, task, filter, language, scroll) across updates.

Non-goals
- Answering decisions from the page. The owner answers in Claude Code, as now. The page stays read-only.
- Token counts while a subagent is still running. Tokens arrive when the ledger hook writes them (each subagent stop, each main-session turn end). The page says so.
- Starting or stopping the watcher from `next-task` or any skill. The owner starts it.
- A Claude Code status line (possible later; separate work).
- New npm dependencies.

Anti-goals (a failure even if it works)
- Any way for another web page, another local user or the network to read the project's data, or to write anything through the server.
- `next-task` getting more main-session turns or more tokens to feed the dashboard. The new state must be written by hooks and existing `df` commands, not by extra steps the model runs.
- Changing how the static mode works: `dashboard` and `dashboard --out/--open` still write one self-contained file, start no server, open no connection and run no live code. (The static page does show the new state fields of 5.5 as a snapshot; that is wanted, not a regression.)

## 3. Constraints

- Node >= 18, no dependencies (`package.json` `engines`), `node --test`.
- Windows, macOS and Linux. `fs.watch` with `recursive` is not available on Linux before Node 20, and `fs.watch` is unreliable in general (duplicate, missing or renamed events, editors that replace files).
- Files the dashboard reads are unchanged: config, `.darkforge/state.json`, `memory-bank/*.md`, `docs/plans/phase-*.md`, `.darkforge/ledger.jsonl`, plus the plugin's `plugin.json`.
- `state.json` is gitignored and written atomically by `writeState` (`scripts/lib/state.mjs`); several hooks may write it.
- Project files are untrusted data: every value is shown as text (current template rule).

## 4. Approaches

Considered:

- **A. Local server + push (chosen).** `dashboard --watch` runs an HTTP server from `node:http` on `127.0.0.1`, watches the source files and pushes the new data to the page over Server-Sent Events. Updates in about 1 s, no flicker, UI state kept. Costs a long-running process and changes the "no network" promise to "loopback only".
- **B. Rewrite the file, page reloads on a timer.** No server, but a `file://` page cannot tell whether the file changed, so it reloads blindly every few seconds: flicker, lost scroll and selection, latency equal to the interval.
- **C. Claude Code status line instead of a page.** Always visible, but one line: no task detail or token tables. Complementary, not a replacement.

The owner picked A (2026-11-27), because the page stays open all day and B's blind reloads would be distracting.

## 5. Design

### 5.1 Command

```
darkforge dashboard --watch [--open] [--port <n>]
```

- Without `--watch` nothing changes. `--watch` and `--out` are mutually exclusive (usage error).
- Binds `127.0.0.1` only. `--port` default 0 (OS picks); a busy port is an error, not a fallback.
- Prints one line, `dashboard: http://127.0.0.1:<port>/<token>/`, and with `--open` opens that URL with the existing `openFile` opener (no shell).
- Runs until Ctrl+C (SIGINT/SIGTERM): closes the watchers and streams, exits 0.
- If `collect()` throws (for example the config becomes invalid), the server keeps running and pushes an error event; the page shows the error in a banner over the last good data. It does not exit.

### 5.2 Server

- `<token>`: 32 random bytes, base64url, new on every start. Every path outside `/<token>/` returns 404 with an empty body.
- Routes, GET only (others: 405):
  - `/<token>/`: the page: `render(collect(root))` with a live flag set (5.4).
  - `/<token>/events`: `text/event-stream`. On connect sends the current data at once; then one `data` event per change; a comment line every 25 s as keep-alive.
- `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, else 421. Defends against DNS rebinding.
- Headers on every response: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and on the page a CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- No CORS headers. No route writes anything.
- Event payload: the same JSON `collect()` returns, escaped as `render()` escapes it (no raw `<`, U+2028, U+2029), one line per event.
- At most 8 open event streams; the 9th gets 503. (One owner, a few tabs.)

### 5.3 Watching

- Watch, non-recursively, the directories `.darkforge/`, `memory-bank/`, `docs/plans/`. A directory that does not exist yet is checked again on each poll and watched once it appears.
- Any event in a watched directory schedules a re-collect after a 200 ms debounce.
- Polling fallback every 2 s: a signature of size and mtime of each file `collect()` reads; a changed signature schedules a re-collect. This covers missed `fs.watch` events and Linux on Node 18.
- After a re-collect, push only if the data differs from the last pushed data, ignoring `generatedAt`.
- A failed or half-written read (for example `state.json` between writes, which `writeAtomic` should prevent) is treated like any other `collect()` error: push the error, keep the last good data, try again on the next event or poll.

### 5.4 Page

- The template stays one file for both modes. `render()` gets an optional `{ live: true }`, which sets a second placeholder, `/*DARKFORGE_LIVE*/false`, to `true`.
- Live: the script opens `new EventSource("events")` (relative URL, inside the token path). On a `data` event it replaces `DATA` and calls the existing `render()`, keeping `phaseN`, `filter`, `sel`, `lang` and the scroll position. If the selected phase or task no longer exists, it falls back as on first load (`firstPick()`).
- Header shows a live indicator: "Live · updated hh:mm:ss" / "Trực tiếp · cập nhật hh:mm:ss"; when the stream drops, "Disconnected, retrying" / "Mất kết nối, đang thử lại" (EventSource retries by itself); on an error event, the error text in a banner.
- Footer text in live mode: "Live page served by `darkforge dashboard --watch` on this computer only. Stop it with Ctrl+C." (plus Vietnamese). Static mode keeps its current footer.
- Token panel note in live mode adds: "Tokens are added when each agent finishes, not while it runs." (plus Vietnamese).

### 5.5 New state the page shows

All in `.darkforge/state.json`, written by hooks or existing commands; `readState` keeps unknown keys, `collect()` passes them through as plain strings and numbers.

| Field | Meaning | Written by |
|---|---|---|
| `since` | ISO time the current `phase` started | `writeState`, centrally, whenever a write changes `phase` |
| `implementer`, `reviewer` | `{ agent, model }` for each role of the running task | `task begin`, from the package header it already parses; the model-guard hook overwrites the matching role when a dispatch uses another model (escalation) |
| `round` | fix round number, 0 before the first | `ledger phase fix` increments it; `task begin` sets 0 on a new task and keeps it on a resumed one |
| `waiting` | `{ since, questions: [string] }`, or absent | new hook on `AskUserQuestion` (below) |

The agent shown as working is derived from `phase`: `implement` and `fix` → `implementer`, `review` → `reviewer`, `orchestrator` → the main session. Fix rounds run by `SendMessage` to the same agents, not by new `Agent` calls, so the page must not rely on "last dispatched". (Builder's call, 2026-11-27.)

When a write sets `task` to null (the merge and cleanup paths in `scripts/lib/task.mjs`), `writeState` also drops `since`, `implementer`, `reviewer` and `round`, so an idle page shows no stale agent. There is no abandon command and none is added; a hand-edited `state.json` is read as is.

`waiting`:
- A new `PreToolUse` hook entry, matcher `AskUserQuestion`, writes `waiting` with the `question` text of each item in `tool_input.questions` (each cut to 300 characters) and the time.
- A `PostToolUse` entry with the same matcher removes `waiting`. A `Stop` (existing ledger hook) also removes it, so a question that errored or was cancelled does not stay forever.
- Both are best effort and never block the tool call, like the existing hooks.
- `next-task` step 3, step 4.3 and step 6 say "ask the owner"; they become "ask the owner with `AskUserQuestion`", so mid-task decisions reach the hook. No other skill text changes; questions other skills ask that way show up too, which is wanted.

On the page:
- The "now" chips show: task, phase, agent and model, "since hh:mm" (and elapsed minutes), "fix round N" when N > 0.
- The "Waiting on you" panel lists `waiting.questions` first, marked "asked in Claude Code now", above the `## Waiting on owner` rows from `activeContext.md`. A non-empty `waiting` also turns the panel's heading to the warning colour.

### 5.6 Docs

- `docs/user-guide.md` Dashboard section: the `--watch` mode, that it serves on `127.0.0.1` only with a secret URL, that tokens arrive per finished agent, how to stop it. The "makes no network requests" line becomes true of the static mode and "loopback only" for `--watch`.
- `skills/status/SKILL.md`: mention `dashboard --watch --open` for a page that stays current.
- `CHANGELOG.md` entry.

## 6. Tests (`node --test`)

- `render(data, { live: true })` sets the live flag; without it the flag stays `false` and the page opens no `EventSource` (check the script's branch, not the bytes).
- Server: wrong token, path outside the token, non-GET and bad `Host` are refused with the codes above; the page carries the CSP and no-store headers.
- Events: connect gets the current data; writing `state.json` in a temp project produces one event with the new data within the poll interval (interval injectable for the test); a write that does not change the data produces no event; invalid config produces an error event and the server stays up.
- Stream limit: the 9th stream gets 503.
- State: `ledger phase fix` increments `round`; `task begin` resets it on a new task and keeps it on resume; `since` changes only when `phase` does; setting `task` to null drops `since`, `implementer`, `reviewer`, `round`; the `AskUserQuestion` hooks set and clear `waiting`; the Stop hook clears it; a malformed hook input never throws.
- Static mode tests stay green unchanged.

## 7. Left to the builder

- Module split (for example `scripts/lib/dashboard-server.mjs`) and how watch, poll and debounce are wired, as long as the behaviour above holds.
- Exact wording and layout of the new chips, banner and indicator, in the template's current style.
- Whether `PostToolUse` and `PreToolUse` for `AskUserQuestion` live in one new hook file or in existing ones.
