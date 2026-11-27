import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resetRunner } from "../scripts/lib/exec.mjs";
import { applyInit } from "../scripts/lib/init.mjs";
import { readState, writeState } from "../scripts/lib/state.mjs";
import { beginTask } from "../scripts/lib/flow.mjs";
import { main } from "../scripts/darkforge.mjs";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks", "model-guard.mjs");
const HEADER = "Agent: builder · Model: sonnet · Branch: task/001-demo · Reviewer: reviewer/opus · Risk: medium";

function plain(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df live "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  applyInit(root, { config: { project: { name: "live" } } });
  return root;
}

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

function gitProject(t) {
  resetRunner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df live git "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "--template=");
  git(root, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "check.js"), 'console.log("ALL CHECKS PASSED")\n');
  applyInit(root, {
    config: {
      project: { name: "live" },
      gate: { command: { windows: "node check.js", unix: "node check.js" } },
      git: { remote: null, prFlow: false },
    },
  });
  fs.mkdirSync(path.join(root, "docs", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "tasks", "001-demo.md"), `# Task 001: Demo\n\n${HEADER}\n\n## Files\n\nsrc/a.txt\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

test("since is set when phase changes and kept when it does not", (t) => {
  const root = plain(t);
  const T1 = new Date("2026-01-01T00:00:00.000Z");
  const T2 = new Date("2026-01-01T00:05:00.000Z");
  writeState(root, { phase: "implement" }, T1);
  assert.equal(readState(root).since, T1.toISOString());
  writeState(root, { phase: "implement" }, T2);
  assert.equal(readState(root).since, T1.toISOString());
  writeState(root, { phase: "review" }, T2);
  assert.equal(readState(root).since, T2.toISOString());
});

test("clearing the task drops the running-step fields", (t) => {
  const root = plain(t);
  writeState(root, {
    task: "001",
    phase: "fix",
    since: "x",
    implementer: { agent: "builder", model: "sonnet" },
    reviewer: { agent: "reviewer", model: "opus" },
    round: 1,
    waiting: { q: 1 },
  });
  writeState(root, { task: null, phase: null });
  const s = readState(root);
  for (const k of ["since", "implementer", "reviewer", "round"]) assert.equal(k in s, false, k);
  assert.deepEqual(s.waiting, { q: 1 });
});

test("ledger phase fix increments round", async (t) => {
  const root = plain(t);
  writeState(root, { task: "001", round: 0 });
  const ctx = { cwd: root, stdout() {}, stderr() {} };
  await main(["ledger", "phase", "fix"], ctx);
  await main(["ledger", "phase", "fix"], ctx);
  assert.equal(readState(root).round, 2);
  await main(["ledger", "phase", "review"], ctx);
  assert.equal(readState(root).round, 2);
});

test("beginTask writes roles and round 0 on a new task, keeps round on resume", (t) => {
  const root = gitProject(t);
  assert.equal(beginTask(root, "001").ok, true);
  let s = readState(root);
  assert.deepEqual(s.implementer, { agent: "builder", model: "sonnet" });
  assert.deepEqual(s.reviewer, { agent: "reviewer", model: "opus" });
  assert.equal(s.round, 0);
  writeState(root, { round: 2 });
  assert.equal(beginTask(root, "001").ok, true);
  s = readState(root);
  assert.equal(s.round, 2);
  assert.deepEqual(s.implementer, { agent: "builder", model: "sonnet" });
});

test("model-guard records an escalated model for the dispatched role", (t) => {
  const root = plain(t);
  const run = (tool_input) =>
    spawnSync(process.execPath, [hook], {
      cwd: root,
      input: JSON.stringify({ cwd: root, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input }),
      encoding: "utf8",
    });
  run({ subagent_type: "darkforge:builder", model: "opus" });
  assert.equal("implementer" in readState(root), false);
  writeState(root, { task: "001" });
  run({ subagent_type: "darkforge:builder", model: "opus" });
  assert.deepEqual(readState(root).implementer, { agent: "builder", model: "opus" });
  run({ subagent_type: "darkforge:reviewer", model: "opus" });
  assert.deepEqual(readState(root).reviewer, { agent: "reviewer", model: "opus" });
});
