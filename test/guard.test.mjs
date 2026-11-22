import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "../scripts/lib/config.mjs";
import { decide } from "../scripts/lib/guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const hook = path.join(repo, "hooks", "model-guard.mjs");
const fixtures = path.join(here, "fixtures", "hook-inputs");

function cfg(models = {}, extra = {}) {
  const c = structuredClone(DEFAULT_CONFIG);
  Object.assign(c.models, models);
  return Object.assign(c, extra);
}
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));

// ---- decide ----

test("banned model denied for a non-darkforge agent", () => {
  const r = decide({ subagent_type: "general-purpose", model: "fable" }, cfg({ banned: ["fable"] }));
  assert.equal(r.allow, false);
  assert.match(r.reason, /fable/);
});

test("banned match is case-insensitive", () => {
  assert.equal(decide({ subagent_type: "general-purpose", model: "Fable" }, cfg({ banned: ["fable"] })).allow, false);
  assert.equal(decide({ subagent_type: "general-purpose", model: "fable" }, cfg({ banned: ["FABLE"] })).allow, false);
});

test("banned entry matches a full model ID segment", () => {
  const c = cfg({ banned: ["fable"] });
  assert.equal(decide({ subagent_type: "general-purpose", model: "claude-fable-5-2" }, c).allow, false);
  assert.equal(decide({ subagent_type: "general-purpose", model: "claude-fable-5-2[1m]" }, c).allow, false);
  assert.equal(decide({ subagent_type: "general-purpose", model: "Claude-FABLE-5" }, c).allow, false);
});

test("banned entry does not match a substring that is not a segment", () => {
  const c = cfg({ banned: ["fable"] });
  assert.deepEqual(decide({ subagent_type: "general-purpose", model: "claude-fabler-5" }, c), { allow: true });
  assert.deepEqual(decide({ subagent_type: "general-purpose", model: "sonnet" }, c), { allow: true });
});

test("banned model denied even for fork and darkforge agents", () => {
  const c = cfg({ banned: ["fable"] });
  assert.equal(decide({ subagent_type: "fork", model: "fable" }, c).allow, false);
  assert.equal(decide({ subagent_type: "darkforge:builder", model: "fable" }, c).allow, false);
  assert.equal(decide({ model: "fable" }, c).allow, false);
});

test("other plugin agent without model allowed", () => {
  assert.deepEqual(decide({ subagent_type: "superpowers:x" }, cfg()), { allow: true });
  assert.deepEqual(decide({ subagent_type: "general-purpose" }, cfg()), { allow: true });
  assert.deepEqual(decide({}, cfg()), { allow: true });
});

test("darkforge agent without model denied; reason names routing model", () => {
  const r = decide({ subagent_type: "darkforge:builder" }, cfg());
  assert.equal(r.allow, false);
  assert.match(r.reason, /sonnet/);
  assert.match(r.reason, /model/);
  assert.match(r.reason, /darkforge:builder/);
});

test("missing-model reason lists every routing model for the agent", () => {
  const r = decide({ subagent_type: "darkforge:reviewer" }, cfg());
  assert.equal(r.allow, false);
  assert.match(r.reason, /sonnet/);
  assert.match(r.reason, /opus/);
});

test("missing-model reason ignores inherited routing keys", () => {
  const r = decide({ subagent_type: "darkforge:scaffolder" }, cfg());
  assert.equal(r.allow, false);
  assert.match(r.reason, /model/);
});

test("empty-string model counts as missing", () => {
  assert.equal(decide({ subagent_type: "darkforge:builder", model: "" }, cfg()).allow, false);
});

test("fork without model allowed", () => {
  assert.deepEqual(decide({ subagent_type: "fork", model: undefined }, cfg()), { allow: true });
  assert.deepEqual(decide({ subagent_type: "fork" }, cfg({ requireExplicit: "all" })), { allow: true });
});

test("darkforge agent below floor denied", () => {
  const r = decide({ subagent_type: "darkforge:specialist", model: "haiku" }, cfg());
  assert.equal(r.allow, false);
  assert.match(r.reason, /sonnet/);
});

test("full model ID below floor denied", () => {
  assert.equal(decide({ subagent_type: "darkforge:specialist", model: "claude-haiku-4-5" }, cfg()).allow, false);
});

test("darkforge agent at or above floor allowed", () => {
  assert.deepEqual(decide({ subagent_type: "darkforge:specialist", model: "sonnet" }, cfg()), { allow: true });
  assert.deepEqual(decide({ subagent_type: "darkforge:specialist", model: "opus" }, cfg()), { allow: true });
  assert.deepEqual(decide({ subagent_type: "darkforge:builder", model: "haiku" }, cfg()), { allow: true });
});

test("floor applies only to darkforge agents", () => {
  assert.deepEqual(decide({ subagent_type: "other:specialist", model: "haiku" }, cfg()), { allow: true });
});

test("inherited floor keys are ignored", () => {
  assert.deepEqual(decide({ subagent_type: "darkforge:constructor", model: "haiku" }, cfg()), { allow: true });
});

test("requireExplicit off allows darkforge agent without model", () => {
  assert.deepEqual(decide({ subagent_type: "darkforge:builder" }, cfg({ requireExplicit: "off" })), { allow: true });
});

test("requireExplicit all denies any non-fork agent without model", () => {
  const c = cfg({ requireExplicit: "all" });
  assert.equal(decide({ subagent_type: "superpowers:x" }, c).allow, false);
  assert.equal(decide({ subagent_type: "general-purpose" }, c).allow, false);
  assert.deepEqual(decide({ subagent_type: "general-purpose", model: "sonnet" }, c), { allow: true });
});

test("decide tolerates junk input", () => {
  assert.deepEqual(decide(undefined, cfg()), { allow: true });
  assert.deepEqual(decide(null, cfg()), { allow: true });
  assert.deepEqual(decide({ subagent_type: 5, model: 7 }, cfg({ banned: [null, 3, ""] })), { allow: true });
});

// ---- hook process ----

function tmpDir(cfgObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge guard "));
  if (cfgObj !== undefined) {
    fs.mkdirSync(path.join(dir, ".darkforge"));
    fs.writeFileSync(path.join(dir, ".darkforge", "config.json"), typeof cfgObj === "string" ? cfgObj : JSON.stringify(cfgObj));
  }
  return dir;
}

function runHook(input, cwd, cmd = process.execPath, args = [hook]) {
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  const r = spawnSync(cmd, args, { cwd, input: stdin, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
}

const withCwd = (input, cwd) => ({ ...input, cwd });

test("hook: no config -> exit 0, no output", () => {
  const dir = tmpDir();
  const r = runHook(withCwd(fixture("agent-banned-model.json"), dir), dir);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("hook: banned model in a cwd with a space -> deny JSON", () => {
  const dir = tmpDir({ schemaVersion: 1, models: { banned: ["fable"] } });
  assert.match(dir, / /);
  const r = runHook(withCwd(fixture("agent-banned-model.json"), dir), dir);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /fable/);
});

test("hook: subdirectory cwd finds the project root", () => {
  const dir = tmpDir({ schemaVersion: 1, models: { banned: ["fable"] } });
  const sub = path.join(dir, "a b", "c");
  fs.mkdirSync(sub, { recursive: true });
  const r = runHook(withCwd(fixture("agent-banned-model.json"), sub), sub);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("hook: missing cwd in input falls back to process cwd", () => {
  const dir = tmpDir({ schemaVersion: 1, models: { banned: ["fable"] } });
  const input = fixture("agent-banned-model.json");
  delete input.cwd;
  const r = runHook(input, dir);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("hook: darkforge agent without model -> deny naming sonnet", () => {
  const dir = tmpDir({ schemaVersion: 1 });
  const r = runHook(withCwd(fixture("agent-darkforge-no-model.json"), dir), dir);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /sonnet/);
});

test("hook: allowed call -> exit 0, no output", () => {
  const dir = tmpDir({ schemaVersion: 1 });
  const input = withCwd(fixture("agent-darkforge-no-model.json"), dir);
  input.tool_input.model = "sonnet";
  const r = runHook(input, dir);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("hook: non-Agent tool -> exit 0, no output", () => {
  const dir = tmpDir({ schemaVersion: 1, models: { banned: ["fable"] } });
  const r = runHook(withCwd(fixture("bash.json"), dir), dir);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("hook: invalid config -> exit 0, no stdout, one stderr line", () => {
  for (const bad of ["{not json", JSON.stringify({ schemaVersion: 1, models: { banned: "fable", tiers: 3 } }), JSON.stringify({ schemaVersion: 2 })]) {
    const dir = tmpDir(bad);
    const r = runHook(withCwd(fixture("agent-banned-model.json"), dir), dir);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
    const lines = r.stderr.split(/\r?\n/).filter((l) => l !== "");
    assert.equal(lines.length, 1, r.stderr);
    assert.match(lines[0], /^darkforge:/);
  }
});

test("hook: malformed stdin -> exit 0, no output", () => {
  const dir = tmpDir({ schemaVersion: 1, models: { banned: ["fable"] } });
  for (const input of ["", "not json", "null", "[1,2]", JSON.stringify({ tool_name: "Agent", tool_input: "x", cwd: 5 })]) {
    const r = runHook(input, dir);
    assert.equal(r.code, 0, input);
    assert.equal(r.stdout, "", input);
    assert.equal(r.stderr, "", input);
  }
});

test("hooks.json registers model-guard in exec form and runs from a plugin root with spaces", () => {
  const h = JSON.parse(fs.readFileSync(path.join(repo, "hooks", "hooks.json"), "utf8"));
  const groups = h.hooks.PreToolUse;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].matcher, "Agent");
  const handler = groups[0].hooks[0];
  assert.equal(handler.type, "command");
  assert.equal(handler.command, "node");
  assert.deepEqual(handler.args, ["${CLAUDE_PLUGIN_ROOT}/hooks/model-guard.mjs"]);

  // Simulate Claude Code: copy the plugin files under a root with a space and substitute the placeholder.
  const pluginRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "darkforge plugin ")), "plug in");
  for (const rel of ["hooks/model-guard.mjs", "scripts/lib/guard.mjs", "scripts/lib/config.mjs", "scripts/lib/models.mjs"]) {
    fs.mkdirSync(path.dirname(path.join(pluginRoot, rel)), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), path.join(pluginRoot, rel));
  }
  const args = handler.args.map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot));
  const dir = tmpDir({ schemaVersion: 1, models: { banned: ["fable"] } });
  const r = runHook(withCwd(fixture("agent-banned-model.json"), dir), dir, process.execPath, args);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});
