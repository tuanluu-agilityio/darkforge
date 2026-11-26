import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resetRunner } from "../scripts/lib/exec.mjs";
import { applyInit } from "../scripts/lib/init.mjs";
import { readState } from "../scripts/lib/state.mjs";
import { beginTask, blockingQuestions, fillTokens, finishTask, parseHeader, taskTokens } from "../scripts/lib/flow.mjs";

const TEMPLATE = fs.readFileSync(fileURLToPath(new URL("../templates/task-package.md", import.meta.url)), "utf8");
const HEADER = "Agent: builder · Model: sonnet · Branch: task/001-demo · Reviewer: reviewer/opus · Risk: medium";

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Real git repo (local merges, no remote) set up by init, with one package and a passing gate. */
function project(t, { header = HEADER, config = {}, gateOk = true } = {}) {
  resetRunner();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df flow "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "--template=");
  git(root, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "check.js"), gateOk ? 'console.log("ALL CHECKS PASSED")\n' : 'console.log("CHECK FAILED: test x"); process.exit(1)\n');
  applyInit(root, {
    config: {
      project: { name: "flow" },
      gate: { command: { windows: "node check.js", unix: "node check.js" } },
      git: { remote: null, prFlow: false },
      ...config,
    },
  });
  fs.mkdirSync(path.join(root, "docs", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "tasks", "001-demo.md"), `# Task 001: Demo\n\n${header}\n\n## Files\n\nsrc/a.txt\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

const ledger = (root, recs) =>
  fs.writeFileSync(path.join(root, ".darkforge", "ledger.jsonl"), recs.map((r) => JSON.stringify({ at: "x", agent: null, model: "m", kind: "subagent", ...r }) + "\n").join(""));

// ---------- parseHeader / blockingQuestions / fillTokens ----------

test("parseHeader reads the header line of the package template, filled in", () => {
  const filled = TEMPLATE.replace("<NNN>", "001")
    .replace("<agent>", "builder")
    .replace("<model>", "sonnet")
    .replace("task/<NNN>-<name>", "task/001-demo")
    .replace("<agent/model>", "reviewer/opus")
    .replace("<low/medium/high>", "medium");
  assert.deepEqual(parseHeader(filled), {
    implementer: { agent: "builder", model: "sonnet" },
    reviewer: { agent: "reviewer", model: "opus" },
    branch: "task/001-demo",
    risk: "medium",
  });
});

test("parseHeader names what is wrong", () => {
  assert.match(parseHeader("# T\n\nno header").error, /no header line/);
  assert.match(parseHeader("Agent: builder · Model: sonnet · Branch: task/1-x · Risk: low").error, /missing: reviewer/);
  assert.match(parseHeader("Agent: builder · Model: sonnet · Branch: task/1-x · Reviewer: opus · Risk: low").error, /<agent>\/<model>/);
  assert.match(parseHeader("Agent: builder · Model: sonnet · Branch: task/1-x · Reviewer: reviewer/opus · Risk: huge").error, /Risk must be/);
  assert.match(parseHeader("Agent: Builder X · Model: sonnet · Branch: task/1-x · Reviewer: reviewer/opus · Risk: low").error, /lowercase/);
});

test("blockingQuestions: only questions whose row names the task id", (t) => {
  const root = project(t);
  const ac = path.join(root, "memory-bank", "activeContext.md");
  const text = fs.readFileSync(ac, "utf8").replace(
    "## Waiting on owner\n",
    "## Waiting on owner\n\n| ID | Question | Blocks |\n|---|---|---|\n| Q-01 | Node version? | CI matrix |\n| Q-02 | Export columns? | task 001 |\n| Q-03 | Other? | 0010 |\n",
  );
  fs.writeFileSync(ac, text);
  assert.deepEqual(blockingQuestions(root, "001"), ["Q-02"]);
  assert.deepEqual(blockingQuestions(root, "002"), []);
});

test("fillTokens fills '-' in the task's row only, keeps numbers and CRLF", (t) => {
  const root = project(t);
  const file = path.join(root, "memory-bank", "progress.md");
  fs.writeFileSync(file, "| Task | Tokens |\r\n|---|---|\r\n| 000 | 5 |\r\n| 001 | - |\r\n| 0010 | - |\r\n");
  assert.equal(fillTokens(root, "001", 1234), true);
  assert.equal(fs.readFileSync(file, "utf8"), "| Task | Tokens |\r\n|---|---|\r\n| 000 | 5 |\r\n| 001 | 1234 |\r\n| 0010 | - |\r\n");
  assert.equal(fillTokens(root, "001", 99), false, "a filled number is never overwritten");
  assert.equal(fillTokens(root, "000", 99), false);
});

// ---------- begin ----------

test("begin: starts the branch from the package and prints who does what", (t) => {
  const root = project(t);
  const r = beginTask(root, "001");
  assert.equal(r.ok, true, r.message);
  assert.equal(
    r.message,
    "task 001 started on task/001-demo (risk medium)\nimplementer: darkforge:builder model sonnet\nreviewer: darkforge:reviewer model opus\nbase: main",
  );
  assert.equal(git(root, "branch", "--show-current"), "task/001-demo");
  assert.deepEqual(readState(root), { task: "001", phase: "implement" });
});

test("begin: resumes on the same branch without starting again", (t) => {
  const root = project(t);
  assert.equal(beginTask(root, "001").ok, true);
  const r = beginTask(root, "001");
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /^task 001 resumed on task\/001-demo/);
});

test("begin refusals: no package, branch mismatch, same agent, banned model, floor, blocked", (t) => {
  const cases = [
    [{}, "002", /no package docs\/tasks\/002-\*\.md/],
    [{ header: HEADER.replace("task/001-demo", "task/001-other") }, "001", /does not match the file name \(expected task\/001-demo\)/],
    [{ header: HEADER.replace("reviewer/opus", "builder/opus") }, "001", /same agent/],
    [{ config: { models: { banned: ["sonnet"] } } }, "001", /model "sonnet" is banned/],
    [{ header: HEADER.replace("Agent: builder · Model: sonnet", "Agent: specialist · Model: haiku") }, "001", /below the floor "sonnet"/],
  ];
  for (const [opts, id, re] of cases) {
    const root = project(t, opts);
    const r = beginTask(root, id);
    assert.equal(r.ok, false, `${re} expected refusal`);
    assert.match(r.message, re);
    assert.equal(git(root, "branch", "--show-current"), "main");
    assert.equal(readState(root).task, null);
  }
  const root = project(t);
  const ac = path.join(root, "memory-bank", "activeContext.md");
  fs.writeFileSync(ac, fs.readFileSync(ac, "utf8").replace("## Waiting on owner\n", "## Waiting on owner\n\n| Q-07 | Which format? | 001 |\n"));
  git(root, "commit", "-qam", "q");
  const r = beginTask(root, "001");
  assert.equal(r.ok, false);
  assert.match(r.message, /blocked by Q-07/);
});

// ---------- finish ----------

/** begin, do the work, edit the memory bank (left uncommitted, as the skill leaves it). */
function workDone(root) {
  assert.equal(beginTask(root, "001").ok, true);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.txt"), "x\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "work");
  ledger(root, [
    { task: "001", phase: "implement", tokens: 100 },
    { task: "001", phase: "review", tokens: 40 },
    { task: "000", phase: "implement", tokens: 7 },
  ]);
  fs.appendFileSync(path.join(root, "memory-bank", "progress.md"), "| 001 | task/001-demo | builder | sonnet | done | - |\n");
  const ac = path.join(root, "memory-bank", "activeContext.md");
  fs.writeFileSync(ac, fs.readFileSync(ac, "utf8").replace("## Where we are\n", "## Where we are\n\nTask 001 done.\n"));
}

test("finish: tokens, memory-bank commit, lint, gate, merge, ledger row", (t) => {
  const root = project(t);
  workDone(root);
  fs.writeFileSync(path.join(root, "staged-elsewhere.txt"), "y\n");
  git(root, "add", "staged-elsewhere.txt");
  const r = finishTask(root, "001", { title: "Demo" });
  // The staged non-memory file must not ride along in the memory-bank commit, and it makes the tree dirty for the gate.
  assert.equal(r.ok, false);
  assert.match(r.message, /memory bank: committed/);
  assert.ok(!git(root, "show", "--name-only", "--format=", "HEAD").includes("staged-elsewhere.txt"));
  assert.match(git(root, "log", "-1", "--format=%s"), /^docs: task 001 memory bank$/);

  git(root, "rm", "-q", "--cached", "staged-elsewhere.txt");
  fs.rmSync(path.join(root, "staged-elsewhere.txt"));
  const r2 = finishTask(root, "001", { title: "Demo" });
  assert.equal(r2.ok, true, r2.message);
  assert.match(r2.message, /memory: ok/);
  assert.match(r2.message, /^ALL CHECKS PASSED$/m);
  assert.match(r2.message, /merged task\/001-demo into main/);
  assert.match(r2.message, /tokens 001: implement 100 · review 40 · fix 0 · orchestrator 0 · total 140/);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.match(fs.readFileSync(path.join(root, "memory-bank", "progress.md"), "utf8"), /\| 001 \| task\/001-demo \| builder \| sonnet \| done \| 140 \|/);
  assert.deepEqual(readState(root), { task: null, phase: null, lastTask: "001" });
});

test("finish: failing gate stops before the merge with a fix-round hint; re-run after the fix merges", (t) => {
  const root = project(t, { gateOk: false });
  workDone(root);
  const r = finishTask(root, "001", { title: "Demo" });
  assert.equal(r.ok, false);
  assert.match(r.message, /CHECK FAILED: test x/);
  assert.match(r.message, /next: fix round/);
  assert.equal(git(root, "branch", "--show-current"), "task/001-demo");
  assert.equal(readState(root).task, "001");

  fs.writeFileSync(path.join(root, "check.js"), 'console.log("ALL CHECKS PASSED")\n');
  git(root, "commit", "-qam", "fix gate");
  const r2 = finishTask(root, "001", { title: "Demo" });
  assert.equal(r2.ok, true, r2.message);
  assert.doesNotMatch(r2.message, /memory bank: committed/, "nothing left to commit on the re-run");
  assert.equal(git(root, "branch", "--show-current"), "main");
});

test("finish: memory lint failure stops before the gate", (t) => {
  const root = project(t);
  workDone(root);
  const ac = path.join(root, "memory-bank", "activeContext.md");
  fs.writeFileSync(ac, fs.readFileSync(ac, "utf8").replace("## Next", "## Nxt"));
  const r = finishTask(root, "001", { title: "Demo" });
  assert.equal(r.ok, false);
  assert.match(r.message, /memory lint failed/);
  assert.match(r.message, /missing heading "## Next"/);
  assert.doesNotMatch(r.message, /ALL CHECKS PASSED/);
});

test("finish: refuses a bad id or empty title before touching anything", (t) => {
  const root = project(t);
  assert.match(finishTask(root, "../x", { title: "T" }).message, /invalid id/);
  assert.match(finishTask(root, "001", { title: " " }).message, /--title is required/);
  assert.deepEqual(taskTokens(root, "001"), { implement: 0, review: 0, fix: 0, orchestrator: 0, total: 0 });
});
