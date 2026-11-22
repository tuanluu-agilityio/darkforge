import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../scripts/lib/config.mjs";
import { TIERS, tierIndex, isBelowFloor, route, raiseTier } from "../scripts/lib/models.mjs";

const cfg = () => structuredClone(DEFAULT_CONFIG);

test("tiers and index", () => {
  assert.deepEqual(TIERS, ["haiku", "sonnet", "opus", "fable"]);
  assert.equal(tierIndex("opus", cfg()), 2);
  assert.equal(tierIndex("nope", cfg()), -1);
  const c = cfg(); c.models.tiers = ["a", "b"];
  assert.equal(tierIndex("b", c), 1);
});

test("isBelowFloor", () => {
  assert.equal(isBelowFloor("specialist", "haiku", cfg()), true);
  assert.equal(isBelowFloor("specialist", "sonnet", cfg()), false);
  assert.equal(isBelowFloor("builder", "haiku", cfg()), false);
});

test("route", () => {
  const r = route("high", cfg());
  assert.deepEqual(r.implementer, { agent: "specialist", model: "opus" });
  assert.deepEqual(r.reviewer, { agent: "security-reviewer", model: "opus" });
  assert.deepEqual(route("low", cfg()).reviewer, { agent: "reviewer", model: "sonnet" });
});

test("raiseTier", () => {
  assert.equal(raiseTier("sonnet", cfg()), "opus");
  assert.equal(raiseTier("opus", cfg()), "fable");
  const c = cfg(); c.models.banned = ["fable"];
  assert.equal(raiseTier("opus", c), "opus");
  assert.equal(raiseTier("fable", cfg()), "fable");
});
