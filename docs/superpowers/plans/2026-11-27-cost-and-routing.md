# Estimated Cost and High-Risk Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard shows estimated USD cost (per task, model, spender and token kind) from a dated price table, the ledger records 5-minute and 1-hour cache writes separately, and high-risk tasks default to a Sonnet implementer.

**Architecture:** `sumUsage` reads the cache-write split from transcripts into each new ledger record. A new `scripts/lib/prices.mjs` holds the price table, model matching and `costOf`. `collect()` in `scripts/lib/dashboard.mjs` adds a `cost` object computed from ledger records at page-build time; the template renders it. The routing change is a default in `scripts/lib/config.mjs` plus docs.

**Tech Stack:** Node >= 18 ESM, `node:test`; no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-27-cost-and-routing-design.md`

## Global Constraints

- Node >= 18, no npm dependencies, `npm test` (`node --test`); Windows, macOS, Linux.
- `PRICES_AS_OF = "2026-11-27"`; price table exactly as spec 5.2 (USD per million tokens: input, output, cacheWrite5m, cacheWrite1h, cacheRead).
- Unknown-kind cache write = `max(0, cacheWrite − cacheWrite5m − cacheWrite1h)` (missing split field = 0), costed as 1-hour.
- `usage.cacheWrite` and record `tokens` keep their current meaning.
- Unpriced records (unknown model, or no `usage`) add nothing to cost figures; their tokens still count in token figures.
- Every figure labelled estimated at API list prices; every value reaches the page as text; English and Vietnamese via `T`/`V`.
- Ledger stays append-only; old records are never rewritten.
- A missing `cost` in page data hides the cost figures and never throws.
- Default `routing.high.implementer` = `{ agent: "specialist", model: "sonnet" }`; reviewer stays `security-reviewer/opus`.

## Review Focus

1. A `prices` override with a string number (`"4"`), a negative or a missing field must be ignored with a page warning, not crash `collect()` or price at NaN. → Task 2 test `invalid overrides are ignored and reported`.
2. A ledger line whose `usage.cacheWrite5m` is a string or negative (hand-edited or corrupt) must not produce NaN dollars. → Task 3 test `garbage usage fields cost as zero, never NaN`.
3. A model id with odd case or a date suffix (`Claude-Opus-5-5`, `claude-sonnet-5-5-20261101`) must still price; a lookalike (`claude-opus-5-50`) must not. → Task 2 test `model ids match by family and version only`.
4. A tiny cost (one Haiku record) must show `<$0.01`, not `$0.00`; a large one `$1.2k`. → Task 3 test `money format`.
5. A task with priced and unpriced records must show its partial `$` with the `+?` marker, and the total must not count the unpriced tokens. → Task 3 test `partial pricing is marked`.

---

### Task 1: Ledger records the cache-write split

**Files:**
- Modify: `scripts/lib/ledger.mjs` (`USAGE_KEYS`, `zeroUsage`, `sumUsage`)
- Test: `test/ledger.test.mjs`

**Interfaces:**
- Produces: `sumUsage(...)` returns `usage` with two more fields, `cacheWrite5m` and `cacheWrite1h` (integers ≥ 0), read from `message.usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`. `tokens` = input + output + cacheWrite + cacheRead, unchanged. Appended records carry the new fields inside `usage`.

- [ ] **Step 1: Write the failing tests** in `test/ledger.test.mjs`:
  - `sumUsage reads the 5m/1h cache-write split`: a line with `usage:{input_tokens:2,output_tokens:10,cache_creation_input_tokens:300,cache_read_input_tokens:1000,cache_creation:{ephemeral_5m_input_tokens:100,ephemeral_1h_input_tokens:200}}` → `usage` deepEquals `{input:2,output:10,cacheWrite:300,cacheRead:1000,cacheWrite5m:100,cacheWrite1h:200}`, `tokens === 1312`.
  - `missing split leaves both zero`: same line without `cache_creation` → `cacheWrite5m === 0`, `cacheWrite1h === 0`, `cacheWrite === 300`.
  - `split on a repeated message id counts once` (same id on two lines, as the existing dedupe test does) → split counted once.
  - `garbage split values are zero`: `ephemeral_5m_input_tokens:"5"`, `ephemeral_1h_input_tokens:-3` → both 0.

- [ ] **Step 2: Run** `node --test test/ledger.test.mjs` — expect the new tests to FAIL.

- [ ] **Step 3: Implement** in `sumUsage`: after the existing `USAGE_KEYS` loop, read `msg.usage.cache_creation` when it is an object, same finite-and-positive rule. Add both keys to `zeroUsage()`.

- [ ] **Step 4: Run** `npm test` — all PASS (existing ledger tests that deepEqual `usage` are updated to include the two zero fields; nothing else changes).

- [ ] **Step 5: Commit** `feat(ledger): record 5-minute and 1-hour cache writes separately`.

---

### Task 2: Price table and cost function

**Files:**
- Create: `scripts/lib/prices.mjs`
- Test: `test/prices.test.mjs` (new)

**Interfaces:**
- Produces:
  - `PRICES_AS_OF: string` (`"2026-11-27"`).
  - `PRICES: Record<string, Price>` keyed `"<family>-<version>"`: `fable-5-2`, `fable-5-1`, `fable-5`, `opus-5-5`, `opus-5`, `sonnet-5-5`, `sonnet-5`, `haiku-5-5`, `haiku-4-5`. `Price = { input, output, cacheWrite5m, cacheWrite1h, cacheRead }` (numbers, USD per MTok), values from spec 5.2.
  - `modelKey(model: string): string | null` — lower-cases, strips a leading `claude-` and a trailing `-YYYYMMDD`, returns `"<family>-<major>[-<minor>]"` when the rest is `<family>-<digits>(-<digits>)?`, else null.
  - `resolvePrices(overrides: unknown): { table: Record<string, Price>, overridden: string[], warnings: string[] }` — built-in table plus valid overrides; override keys go through `modelKey` (a key that is already `opus-5-5` or a full id both work).
  - `priceFor(model: string, table): Price | null` — `table[modelKey(model)] ?? null`.
  - `costOf(usage, price): { total, input, output, cacheWrite, cacheRead, assumed1h }` — USD numbers; `assumed1h` = unknown-kind tokens (a count, not dollars). Non-finite or negative usage fields count as 0.

- [ ] **Step 1: Write the failing tests** in `test/prices.test.mjs`:
  - `built-in table matches the spec`: one `assert.deepEqual(PRICES[key], {...})` per model row of spec 5.2 (9 rows), and `PRICES_AS_OF === "2026-11-27"`.
  - Review Focus 3 — `model ids match by family and version only`: `modelKey("claude-opus-5-5") === "opus-5-5"`, `modelKey("Claude-Opus-5-5") === "opus-5-5"`, `modelKey("claude-sonnet-5-5-20261101") === "sonnet-5-5"`, `modelKey("claude-fable-5") === "fable-5"`, `modelKey("claude-opus-5-50")` prices as nothing (`priceFor(..., PRICES) === null`), `modelKey("gpt-4") === null` or unpriced, `modelKey("<synthetic>") === null`.
  - `costOf on Opus 5.5`: usage `{input:1e6,output:1e6,cacheWrite:3e6,cacheWrite5m:1e6,cacheWrite1h:1e6,cacheRead:1e6}` → `total === 4+20+5+8+8+0.2` (= 45.2; the third 1e6 is unknown kind at 1h), `assumed1h === 1e6`, `cacheWrite === 21`.
  - `costOf on Sonnet 5.5`: `{input:0,output:2e6,cacheWrite:0,cacheWrite5m:0,cacheWrite1h:0,cacheRead:10e6}` → `total === 21` (20 + 1).
  - `split above cacheWrite gives no unknown kind`: `{cacheWrite:100,cacheWrite5m:80,cacheWrite1h:80}` → `assumed1h === 0`, cost uses 80 + 80.
  - Review Focus 1 — `invalid overrides are ignored and reported`: `resolvePrices({ "opus-5-5": {input:"4",output:20,cacheWrite5m:5,cacheWrite1h:8,cacheRead:0.2}, "claude-sonnet-5-5": {input:1,output:5,cacheWrite5m:1,cacheWrite1h:2,cacheRead:0.05}, "haiku-5-5": {input:-1}, "__proto__": {} })` → `table["opus-5-5"]` is the built-in, `table["sonnet-5-5"].input === 1`, `overridden` deepEquals `["sonnet-5-5"]`, `warnings.length === 2` (opus, haiku), and `Object.getPrototypeOf(table) === Object.prototype` still. `resolvePrices(null)` and `resolvePrices("x")` → built-in table, no throw (a non-object `prices` adds one warning).

- [ ] **Step 2: Run** `node --test test/prices.test.mjs` — FAIL (module missing).

- [ ] **Step 3: Implement** `scripts/lib/prices.mjs` per Interfaces. Copy the table from spec 5.2 verbatim.

- [ ] **Step 4: Run** `npm test` — PASS.

- [ ] **Step 5: Commit** `feat(prices): dated API price table and cost estimate`.

---

### Task 3: Dashboard shows estimated cost

**Files:**
- Modify: `scripts/lib/dashboard.mjs` (`ledgerSummary` / `collect`)
- Modify: `templates/dashboard.html`
- Modify: `docs/user-guide.md` (Dashboard section), `CHANGELOG.md` (Unreleased → Added)
- Test: `test/dashboard.test.mjs`

**Interfaces:**
- Consumes: Task 1 `usage` fields; Task 2 `resolvePrices`, `priceFor`, `costOf`, `PRICES_AS_OF`.
- Produces: `collect()` data gains `cost`:
  `{ asOf, total, byTask: {id: {usd, unpricedTokens}}, byModel: {model: {usd, unpricedTokens}}, byKind: {orchestrator: {usd, unpricedTokens}, subagent: {...}}, byTokenKind: {input, output, cacheWrite, cacheRead}, unpriced: {records, tokens, models: string[]}, assumed1h, overridden: string[], warnings: string[] }` — all plain objects built with `Object.fromEntries` (a `__proto__` key stays a key), numbers rounded to 1e-6.
- Template: `fmtUsd(n)` → `"<$0.01"` for 0 < n < 0.005, `"$0.00"` for 0, `"$X.XX"` under 1000, `"$1.2k"` style (one decimal) from 1000.

- [ ] **Step 1: Write the failing tests** in `test/dashboard.test.mjs` (extend the existing `project()` fixture ledger with `usage` fields as needed):
  - `cost totals add up`: fixture with two Opus 5.5 records and one Sonnet 5.5 record with known usage → `data.cost.total` equals the hand-computed sum; sum of `byTask[*].usd` = sum of `byModel[*].usd` = `byKind.orchestrator.usd + byKind.subagent.usd` = `total` (within 1e-6); `byTokenKind` four values sum to `total`.
  - `unknown model is unpriced, not free`: a record with model `claude-mystery-9` → `unpriced.records === 1`, `unpriced.models` deepEquals `["claude-mystery-9"]`, its tokens in `unpriced.tokens`, `total` unchanged by it.
  - Review Focus 5 — `partial pricing is marked`: task with one priced and one unpriced record → `byTask[id].usd > 0` and `byTask[id].unpricedTokens > 0`; the template renders `+?` for that row (structural: the template contains the `+?` branch on `unpricedTokens`).
  - `old records count as assumed 1h`: a record with `usage.cacheWrite:1000` and no split → `assumed1h === 1000`.
  - Review Focus 2 — `garbage usage fields cost as zero, never NaN`: `usage:{input:"x",cacheWrite5m:-5,cacheRead:null}` → `Number.isFinite(data.cost.total)`.
  - `config prices override`: config `prices:{"opus-5-5":{input:1,output:1,cacheWrite5m:1,cacheWrite1h:1,cacheRead:1}}` → `overridden` deepEquals `["opus-5-5"]` and totals use it; an invalid entry appears in `warnings`.
  - Review Focus 4 — `money format`: extract `fmtUsd` from the rendered script (same extraction style as the existing template tests) and assert `fmtUsd(0.001)==="<$0.01"`, `fmtUsd(0)==="$0.00"`, `fmtUsd(12.3)==="$12.30"`, `fmtUsd(1234)==="$1.2k"`.
  - `page without cost data does not throw`: the template guards every `DATA.cost` use (structural: `DATA.cost&&` / optional chaining before each access), and the cost elements are hidden when absent.
  - `cost text renders as text`: a model named `EVIL` in the ledger → rendered page has no raw `</script><img`.

- [ ] **Step 2: Run** `node --test test/dashboard.test.mjs` — FAIL.

- [ ] **Step 3: Implement** `collect()` cost (read `config.prices` through `resolvePrices`; one pass over ledger records alongside `ledgerSummary`) and the template:
  - Figures row: new "Estimated cost" / "Chi phí ước tính" figure: `fmtUsd(total)`, sub-line "API list prices, <asOf>" / "giá API niêm yết, <asOf>".
  - Tokens-by-task rows, By-model rows and Who-spent rows: `fmtUsd(usd)` after the token count; `+?` with a `title` naming the unpriced tokens when `unpricedTokens > 0`.
  - New block under the ledger panel: "Cost by token kind" / "Chi phí theo loại token": four rows (input, output, cache write, cache read) with `$` and share %.
  - Ledger note adds: "Estimated at API list prices as of <asOf>; subscription plans and discounts are not reflected." / "Ước tính theo giá API niêm yết ngày <asOf>; không phản ánh gói thuê bao hay chiết khấu." plus, when non-zero, "N records unpriced (models …)." / "N bản ghi chưa có giá (model …)." and "Cache writes without a 5m/1h split counted as 1-hour." / "Cache write không tách 5m/1h được tính theo loại 1 giờ.", and "Haiku 5.5 prompts over 100k tokens are priced at the lower rate." / "Prompt Haiku 5.5 trên 100k token được tính theo giá thấp." only when a Haiku 5.5 record exists.
  - Warnings from `cost.warnings` shown as text in the note.
- [ ] **Step 4: Docs.** User guide Dashboard section: the cost figures, what they include and exclude, the `prices` override (shape and one example). CHANGELOG Unreleased → Added.

- [ ] **Step 5: Run** `npm test` — PASS. Then build a temp project like `project()` with Opus and Sonnet usage, run `node scripts/darkforge.mjs dashboard --out <scratch>/d.html`, and check the rendered page (headless or `node --check` on the script) shows the cost figure.

- [ ] **Step 6: Commit** `feat(dashboard): estimated cost per task, model, spender and token kind`.

---

### Task 4: High-risk tasks default to a Sonnet implementer

**Files:**
- Modify: `scripts/lib/config.mjs` (`DEFAULT_CONFIG.routing.high.implementer`)
- Modify: `skills/init/SKILL.md`, `docs/user-guide.md` (routing paragraph), `docs/config.md:37`, `site/index.html` (routing table/example that shows the high default, ~line 584), `CHANGELOG.md` (Unreleased → Changed)
- Test: `test/config.test.mjs`, `test/flow.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_CONFIG.routing.high` = `{ implementer: { agent: "specialist", model: "sonnet" }, reviewer: { agent: "security-reviewer", model: "opus" } }`.

- [ ] **Step 1: Write the failing tests:**
  - `test/config.test.mjs` — `high risk defaults to a Sonnet implementer and an Opus reviewer`: `DEFAULT_CONFIG.routing.high` deepEquals the value above; `validateConfig({})` gives the same; a config that sets `routing.high.implementer.model:"opus"` keeps `"opus"`.
  - `test/flow.test.mjs` — `task begin allows a high-risk package routed specialist/sonnet under the default policy`: package header `Agent: specialist · Model: sonnet · … · Reviewer: security-reviewer/opus · Risk: high` with the default config → `beginTask` ok (reuse the file's existing git fixture).

- [ ] **Step 2: Run** `node --test test/config.test.mjs test/flow.test.mjs` — the config test FAILS.

- [ ] **Step 3: Implement** the default change.

- [ ] **Step 4: Docs.** Update every place that shows the default table to `specialist / sonnet` for high (files above), with one sentence: Sonnet costs half of Opus per token, the Opus reviewer stays, and escalation raises the implementer after `escalation.raiseAfterFixRounds` failed rounds. CHANGELOG Changed: projects without their own `routing.high.implementer` now use `specialist/sonnet`; projects that set one keep it and can adopt the new default by setting `routing.high.implementer.model` to `"sonnet"` in `.darkforge/config.json` (and `~/.darkforge/defaults.json` if saved there). Do not edit earlier specs under `docs/superpowers/specs/`.

- [ ] **Step 5: Run** `npm test` — PASS; `grep -rn "specialist / opus\|specialist/opus" docs skills site README.md` finds nothing outside `docs/superpowers/specs/` and the CHANGELOG history.

- [ ] **Step 6: Commit** `feat(routing): high-risk tasks default to a Sonnet implementer`.
