import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, findProjectRoot, loadConfig, validateConfig } from "../scripts/lib/config.mjs";

function tmpProject(cfg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge test "));
  fs.mkdirSync(path.join(root, ".darkforge"));
  const text = typeof cfg === "string" ? cfg : JSON.stringify(cfg);
  fs.writeFileSync(path.join(root, ".darkforge", "config.json"), text);
  return root;
}

test("minimal config equals defaults", () => {
  const r = loadConfig(tmpProject({ schemaVersion: 1 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.config, DEFAULT_CONFIG);
});

test("partial merge keeps other defaults; arrays replace", () => {
  const r = loadConfig(tmpProject({ schemaVersion: 1, models: { banned: ["fable"] }, git: { remote: null } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.models.banned, ["fable"]);
  assert.deepEqual(r.config.models.tiers, DEFAULT_CONFIG.models.tiers);
  assert.equal(r.config.git.remote, null);
  assert.equal(r.config.git.baseBranch, "main");
});

test("unknown fields are kept", () => {
  const r = loadConfig(tmpProject({ schemaVersion: 1, extra: { a: 1 } }));
  assert.deepEqual(r.config.extra, { a: 1 });
});

test("schemaVersion 2 rejected", () => {
  const r = loadConfig(tmpProject({ schemaVersion: 2 }));
  assert.equal(r.ok, false);
  assert.match(r.error, /schemaVersion/);
});

test("wrong types name the field", () => {
  let r = loadConfig(tmpProject({ schemaVersion: 1, riskAreas: "x" }));
  assert.equal(r.ok, false);
  assert.match(r.error, /riskAreas/);
  r = loadConfig(tmpProject({ schemaVersion: 1, models: { requireExplicit: "bogus" } }));
  assert.equal(r.ok, false);
  assert.match(r.error, /models\.requireExplicit/);
  r = loadConfig(tmpProject({ schemaVersion: 1, git: { mergeMethod: "x" } }));
  assert.match(r.error, /git\.mergeMethod/);
  r = loadConfig(tmpProject({ schemaVersion: 1, superpowers: "x" }));
  assert.match(r.error, /superpowers/);
  r = loadConfig(tmpProject({ schemaVersion: 1, gate: { quiet: "yes" } }));
  assert.match(r.error, /gate\.quiet/);
  r = loadConfig(tmpProject({ schemaVersion: 1, git: { remote: 5 } }));
  assert.match(r.error, /git\.remote/);
});

test("invalid JSON and missing file", () => {
  assert.equal(loadConfig(tmpProject("{nope")).ok, false);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge test "));
  assert.equal(loadConfig(empty).ok, false);
});

test("non-object root rejected", () => {
  assert.equal(loadConfig(tmpProject("[]")).ok, false);
});

test("returns a fresh copy", () => {
  const r = loadConfig(tmpProject({ schemaVersion: 1 }));
  r.config.models.tiers.push("x");
  r.config.routing.low.implementer.model = "zzz";
  assert.deepEqual(DEFAULT_CONFIG.models.tiers, ["haiku", "sonnet", "opus", "fable"]);
  assert.equal(DEFAULT_CONFIG.routing.low.implementer.model, "sonnet");
});

test("findProjectRoot from nested dir with spaces", () => {
  const root = tmpProject({ schemaVersion: 1 });
  const nested = path.join(root, "a b", "c d");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findProjectRoot(nested), root);
  const none = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge test "));
  assert.equal(findProjectRoot(none), null);
});

test("array and map elements must be strings", () => {
  for (const [cfg, field] of [
    [{ models: { tiers: ["haiku", 3] } }, /models\.tiers\[1\]/],
    [{ models: { banned: [null] } }, /models\.banned\[0\]/],
    [{ riskAreas: [{}] }, /riskAreas\[0\]/],
    [{ git: { requiredChecks: ["ci", false] } }, /git\.requiredChecks\[1\]/],
    [{ models: { floors: { builder: 5 } } }, /models\.floors\.builder/],
  ]) {
    const r = loadConfig(tmpProject({ schemaVersion: 1, ...cfg }));
    assert.equal(r.ok, false, JSON.stringify(cfg));
    assert.match(r.error, field);
  }
});

test("a __proto__ key in the file never changes an object's prototype", () => {
  const text = '{"schemaVersion":1,"models":{"floors":{"__proto__":{"builder":"opus"}}},"__proto__":{"polluted":1}}';
  const r = loadConfig(tmpProject(text));
  assert.equal(r.ok, true, r.error);
  assert.equal(Object.getPrototypeOf(r.config.models.floors), Object.prototype);
  assert.equal(r.config.models.floors.builder, undefined);
  assert.equal(Object.getPrototypeOf(r.config), Object.prototype);
  assert.equal(r.config.polluted, undefined);
  assert.equal({}.builder, undefined);
});

test("high risk defaults to a Sonnet implementer and an Opus reviewer", () => {
  const want = { implementer: { agent: "specialist", model: "sonnet" }, reviewer: { agent: "security-reviewer", model: "opus" } };
  assert.deepEqual(DEFAULT_CONFIG.routing.high, want);
  const vr = validateConfig({ schemaVersion: 1 });
  assert.equal(vr.ok, true);
  assert.deepEqual(vr.config.routing.high, want);
  const root = tmpProject({ schemaVersion: 1, routing: { high: { implementer: { model: "opus" } } } });
  assert.equal(loadConfig(root).config.routing.high.implementer.model, "opus");
});
