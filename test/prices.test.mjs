import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICES, PRICES_AS_OF, modelKey, resolvePrices, priceFor, costOf } from "../scripts/lib/prices.mjs";

const row = (input, output, cacheWrite5m, cacheWrite1h, cacheRead) => ({ input, output, cacheWrite5m, cacheWrite1h, cacheRead });

test("built-in table matches the spec", () => {
  assert.equal(PRICES_AS_OF, "2026-11-27");
  assert.deepEqual(PRICES["fable-5-2"], row(8, 40, 10, 16, 0.2));
  assert.deepEqual(PRICES["fable-5-1"], row(10, 50, 12.5, 20, 0.25));
  assert.deepEqual(PRICES["fable-5"], row(10, 50, 12.5, 20, 1));
  assert.deepEqual(PRICES["opus-5-5"], row(4, 20, 5, 8, 0.2));
  assert.deepEqual(PRICES["opus-5"], row(5, 25, 6.25, 10, 0.5));
  assert.deepEqual(PRICES["sonnet-5-5"], row(2, 10, 2.5, 4, 0.1));
  assert.deepEqual(PRICES["sonnet-5"], row(2, 10, 2.5, 4, 0.2));
  assert.deepEqual(PRICES["haiku-5-5"], row(0.1, 0.5, 0.125, 0.2, 0.01));
  assert.deepEqual(PRICES["haiku-4-5"], row(1, 5, 1.25, 2, 0.1));
  assert.equal(Object.keys(PRICES).length, 9);
});

test("model ids match by family and version only", () => {
  assert.equal(modelKey("claude-opus-5-5"), "opus-5-5");
  assert.equal(modelKey("Claude-Opus-5-5"), "opus-5-5");
  assert.equal(modelKey("claude-sonnet-5-5-20261101"), "sonnet-5-5");
  assert.equal(modelKey("claude-fable-5"), "fable-5");
  assert.equal(modelKey("opus-5-5"), "opus-5-5");
  assert.equal(priceFor("claude-opus-5-50", PRICES), null);
  assert.equal(priceFor("gpt-4", PRICES), null);
  assert.equal(modelKey("<synthetic>"), null);
  assert.equal(modelKey("__proto__"), null);
  assert.equal(modelKey(42), null);
  assert.deepEqual(priceFor("claude-opus-5-5", PRICES), PRICES["opus-5-5"]);
});

test("costOf on Opus 5.5", () => {
  const c = costOf({ input: 1e6, output: 1e6, cacheWrite: 3e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6, cacheRead: 1e6 }, PRICES["opus-5-5"]);
  assert.equal(c.total, 4 + 20 + 5 + 8 + 8 + 0.2);
  assert.equal(c.assumed1h, 1e6);
  assert.equal(c.cacheWrite, 21);
  assert.equal(c.input, 4);
  assert.equal(c.output, 20);
  assert.equal(c.cacheRead, 0.2);
});

test("costOf on Sonnet 5.5", () => {
  const c = costOf({ input: 0, output: 2e6, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 10e6 }, PRICES["sonnet-5-5"]);
  assert.equal(c.total, 21);
});

test("split above cacheWrite gives no unknown kind", () => {
  const c = costOf({ cacheWrite: 100, cacheWrite5m: 80, cacheWrite1h: 80 }, PRICES["opus-5-5"]);
  assert.equal(c.assumed1h, 0);
  assert.equal(c.cacheWrite, (80 * 5 + 80 * 8) / 1e6);
});

test("costOf never returns NaN", () => {
  const c = costOf({ input: NaN, output: -5, cacheWrite: "x", cacheRead: Infinity }, PRICES["opus-5-5"]);
  assert.deepEqual(c, { total: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, assumed1h: 0 });
  assert.equal(costOf(undefined, PRICES["opus-5-5"]).total, 0);
});

test("invalid overrides are ignored and reported", () => {
  const r = resolvePrices({
    "opus-5-5": { input: "4", output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
    "claude-sonnet-5-5": { input: 1, output: 5, cacheWrite5m: 1, cacheWrite1h: 2, cacheRead: 0.05 },
    "haiku-5-5": { input: -1 },
    "__proto__": {},
  });
  assert.deepEqual(r.table["opus-5-5"], PRICES["opus-5-5"]);
  assert.equal(r.table["sonnet-5-5"].input, 1);
  assert.deepEqual(r.overridden, ["sonnet-5-5"]);
  assert.equal(r.warnings.length, 2);
  assert.equal(Object.getPrototypeOf(r.table), Object.prototype);
  assert.equal(PRICES["sonnet-5-5"].input, 2, "built-in table is not mutated");
});

test("own __proto__ key from JSON never touches a prototype", () => {
  const r = resolvePrices(JSON.parse('{"__proto__": {"input":1,"output":1,"cacheWrite5m":1,"cacheWrite1h":1,"cacheRead":1}}'));
  assert.equal(r.warnings.length, 1);
  assert.equal(({}).input, undefined);
  assert.equal(Object.getPrototypeOf(r.table), Object.prototype);
});

test("non-object prices never throw", () => {
  assert.deepEqual(resolvePrices(null).table, PRICES);
  const s = resolvePrices("x");
  assert.deepEqual(s.table, PRICES);
  assert.equal(s.warnings.length, 1);
  assert.equal(resolvePrices(undefined).warnings.length, 0);
});
