# darkforge: estimated cost on the dashboard, cheaper high-risk routing

Date: 2026-11-27 · Status: approved by owner 2026-11-27

## 1. Why

The dashboard shows tokens, and tokens hide where the money goes. On dark-compare (150 ledger records, 112.94 M tokens), 94% of the tokens are cache reads. Priced with the current Anthropic price list (platform.claude.com/docs/en/about-claude/pricing, read 2026-11-27):

| Kind | Tokens | Estimated cost | Share |
|---|---|---|---|
| Opus cache write (1 h) | 5.78 M | ~$46 | ~53% |
| Opus cache read | 103 M | ~$21 | ~24% |
| Opus output | 0.83 M | ~$17 | ~19% |
| Sonnet, all kinds | 7.36 M | ~$4 | ~4% |

The transcripts show that every cache write was the 1-hour kind ($8/MTok on Opus 5.5). The ledger sums 5-minute and 1-hour writes together, so it cannot tell them apart.

By agent, `specialist` on Opus used 64.86 M tokens (57% of all). 14 of 24 tasks were rated high risk, and the default routing sends high risk to `specialist/opus` plus `security-reviewer/opus`.

The owner wants (1) an estimated cost on the dashboard, so they can see where the money goes and check the effect of later optimizations, and (2) cheaper routing for high-risk tasks.

## 2. Goals, non-goals, anti-goals

Goals
- The dashboard shows estimated USD cost next to tokens: per task, per model, per spender (orchestrator / subagents), and a breakdown by token kind (input, output, cache write, cache read).
- From this version on, the ledger records 5-minute and 1-hour cache writes separately.
- The default routing for high risk becomes implementer `specialist/sonnet`, reviewer `security-reviewer/opus`.

Non-goals
- Exact billing. Subscription plans, negotiated discounts, Batch API, fast mode, data residency (1.1x) and Haiku 5.5's long-prompt prices are not modelled. The page says "estimated at API list prices".
- Changing the config of existing projects. Their `routing` stays as written.
- Context-size optimizations (`df test`, agent `tools:` allow-lists, package size limits). Separate work.
- Showing cost in `ledger report`, `task finish` or `progress.md`. Dashboard only.

Anti-goals
- A cost that looks exact when it is not. Every figure is labelled estimated, and records whose cost cannot be computed (unknown model, no usage breakdown) are counted and named, not silently dropped.
- Losing or rewriting ledger history. The ledger stays append-only; old records stay as they are.
- Weakening review on high-risk tasks. The reviewer stays on Opus, and escalation still raises the implementer.

## 3. Constraints

- Node >= 18, no dependencies, `node --test`; Windows, macOS, Linux.
- Ledger records are appended by hooks (`hooks/ledger.mjs` → `scripts/lib/ledger.mjs`); usage is summed from transcript lines by `sumUsage`. Transcript `message.usage` has `cache_creation_input_tokens` and, in current Claude Code, `cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }`.
- Config: `loadConfig` keeps unknown top-level keys, so a new `prices` key needs no schema change, but it must be validated before use.
- `~/.darkforge/defaults.json` may hold a saved `routing` that pre-fills `init`. It is the owner's file and is not changed.
- Every value reaches the page as text (existing template rule).

## 4. Approaches

Cost:
- **A. Price table in darkforge, cost computed when the page is built (chosen).** A dated table per model; `config.json` `prices` can override. A wrong price is fixed by editing the table, and history is recomputed.
- B. Cost frozen into each ledger record by the hook. Simple, but a wrong or changed price can never be corrected for old records.
- C. No built-in prices; the owner supplies them. Exact for negotiated prices, but the column is empty by default. Kept as A's override.

Routing:
- **A. Change the default for high risk to `specialist/sonnet` (chosen).** Every new project benefits; existing projects change their config by hand (CHANGELOG says how).
- B. Change only dark-compare's config. Fast, but no other project benefits.
- C. As A, and raise high-risk implementers to Opus after the first fix round. Safer, but saves less.

The owner picked 1A + 2A on 2026-11-27.

## 5. Design

### 5.1 Ledger: split cache writes

- `sumUsage` also reads `message.usage.cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` (non-negative finite numbers, else 0) into `usage.cacheWrite5m` and `usage.cacheWrite1h`.
- `usage.cacheWrite` keeps its meaning (`cache_creation_input_tokens`, the total) so `tokens` and every existing reader are unchanged.
- Unknown kind = `max(0, cacheWrite − cacheWrite5m − cacheWrite1h)`, with a missing split field read as 0. It covers old records (no split at all) and partial splits alike. If the split sums to more than `cacheWrite`, the split values are used as they are and unknown kind is 0.
- Unknown-kind tokens are costed as 1-hour writes (the kind observed in Claude Code transcripts) and counted in `cost.assumed1h`; the page says so. (Builder's call, 2026-11-27.)
- A record has one `model` (the last one in its window). If the model changed inside a window, the whole record is priced at that model. Accepted as part of "estimated"; no schema change. (Builder's call.)

### 5.2 Prices and cost

New `scripts/lib/prices.mjs`:

- `PRICES_AS_OF = "2026-11-27"` and a table of USD per million tokens, copied from the price list on that date (platform.claude.com/docs/en/about-claude/pricing, "Model pricing"):

  | Model | input | output | cacheWrite5m | cacheWrite1h | cacheRead |
  |---|---|---|---|---|---|
  | Fable 5.2 | 8 | 40 | 10 | 16 | 0.20 |
  | Fable 5.1 | 10 | 50 | 12.50 | 20 | 0.25 |
  | Fable 5 | 10 | 50 | 12.50 | 20 | 1 |
  | Opus 5.5 | 4 | 20 | 5 | 8 | 0.20 |
  | Opus 5 | 5 | 25 | 6.25 | 10 | 0.50 |
  | Sonnet 5.5 | 2 | 10 | 2.50 | 4 | 0.10 |
  | Sonnet 5 | 2 | 10 | 2.50 | 4 | 0.20 |
  | Haiku 5.5 (prompts up to 100k tokens) | 0.10 | 0.50 | 0.125 | 0.20 | 0.01 |
  | Haiku 4.5 | 1 | 5 | 1.25 | 2 | 0.10 |

  Other models are unpriced (5.3). Haiku 5.5's higher price for prompts over 100k tokens is not modelled (the ledger has no per-request prompt size); the note says so.
- `priceFor(model, overrides)`: matches a ledger model id (for example `claude-opus-5-5`, `claude-sonnet-5-5-20261101`) to a table entry by its family and version; date suffixes are ignored. Returns null when nothing matches.
- `costOf(usage, price)`: input × input + output × output + 5m × cacheWrite5m + 1h × cacheWrite1h + unknown-kind × cacheWrite1h + cacheRead × cacheRead, over 1e6. Also returns the cost per kind.
- Overrides: `config.json` may hold `prices: { "<model id or family-version>": { input, output, cacheWrite5m, cacheWrite1h, cacheRead } }`. A valid entry replaces the built-in one for that model. Invalid entries (not an object, a missing field, a negative or non-finite number) are ignored and listed as a page warning, never thrown.

### 5.3 Dashboard

`collect()` adds, from the ledger, alongside the existing token figures:

- `cost.total`, `cost.byTask[id]`, `cost.byModel[model]`, `cost.byKind` (orchestrator / subagent), `cost.byTokenKind` (input, output, cacheWrite, cacheRead; `cacheWrite` merges 5m, 1h and unknown kind).
- Unpriced records (unknown model, or no `usage`) add nothing to any cost figure; their tokens still count in the token figures. A per-task, per-model or per-spender `$` that leaves out unpriced tokens is shown with a marker ("+?") and a tooltip naming how many tokens are unpriced. (Builder's call.)
- The page treats a missing `cost` (data from an older server) as "no cost data" and hides the cost figures; it never throws.
- `cost.unpriced`: the count and tokens of records that could not be costed (unknown model, or no `usage`), and the model ids involved.
- `cost.assumed1h`: tokens of cache writes costed as 1-hour because the split was missing.
- `cost.asOf` and `cost.overridden` (model ids priced from config), plus `cost.warnings`.

Page:
- Tokens-by-task rows, the By-model list and the Who-spent-them list each show a `$` figure next to the tokens.
- The headline figures row gets an "Estimated cost" figure (total $, with "API list prices, <asOf>").
- A new small block "Cost by token kind" with four rows (input, output, cache write, cache read), each with $ and share of total. This is the line that answers "where does the money go".
- The ledger note says: estimated at API list prices as of <asOf>; subscription plans and discounts are not reflected; N records unpriced (models …); cache writes before this version counted as 1-hour.
- Money format: `$0.42`, `$12.30`, `$1.2k`; under one cent shows `<$0.01`.
- Both languages via the template's `T`/`V`.

### 5.4 Routing default

- `DEFAULT_CONFIG.routing.high.implementer` becomes `{ agent: "specialist", model: "sonnet" }`. The reviewer stays `security-reviewer/opus`. `floors.specialist` is already `sonnet`.
- `skills/init/SKILL.md` and `docs/user-guide.md` show the new default table and say why (cost) and that escalation raises the implementer after `raiseAfterFixRounds` failed rounds.
- `loadConfig` merges the defaults under the file, so a project whose config never set `routing.high.implementer` picks up the new default at once. That is intended: such a project chose "the default". (Builder's call, 2026-11-27; it narrows the non-goal "existing projects keep their routing" to projects that wrote one.) No migration.
- CHANGELOG says both: projects without their own `routing.high.implementer` now use `specialist/sonnet`; projects that wrote one keep it, and adopt the new default by setting `routing.high.implementer.model` to `"sonnet"` in `.darkforge/config.json` (and in `~/.darkforge/defaults.json` if saved there).
- Every place that shows the default table is updated: `skills/init/SKILL.md`, `docs/user-guide.md`, `docs/config.md`, `site/index.html`. Earlier specs under `docs/superpowers/specs/` are history and stay as written.

### 5.5 Docs

User guide dashboard section: the cost figures, what they include and exclude, and the `prices` override. CHANGELOG entry.

## 6. Tests

- `sumUsage`: reads the 5m/1h split; missing split leaves both 0; `cacheWrite` and `tokens` unchanged for the same input as before.
- `priceFor`: matches `claude-opus-5-5`, a dated id, Sonnet 5.5, Haiku 5.5; unknown model → null; a valid override wins; an invalid override is ignored and reported.
- `costOf`: exact USD for a fixed usage on Opus 5.5 and Sonnet 5.5; unknown-kind cache write costed as 1-hour; a split summing above `cacheWrite` gives unknown kind 0.
- The built-in table equals the table in 5.2 (one test row per model).
- Template: data without `cost` renders without throwing and hides the cost figures.
- `collect`: cost totals per task, model and spender add up to `cost.total`; an unknown-model record goes to `unpriced`, not to zero cost; an old record without split counts in `assumed1h`; a `__proto__` model or task id stays a plain key.
- Template: the cost figure, the by-token-kind block and the note render as text in both languages (structural checks like the existing template tests).
- Config: `DEFAULT_CONFIG.routing.high.implementer` is `specialist/sonnet`; `task begin` on a high-risk package with the default routing is allowed by the policy check.
- Existing tests stay green.

## 7. Left to the builder

- Exact layout and styling of the new figure and block, in the template's existing style.
- How family/version is parsed from model ids, as long as the listed ids match and unknown ones return null.
- Whether the price table lives as a plain object or rows, and where the money formatter lives.
