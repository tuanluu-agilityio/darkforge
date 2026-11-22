import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setRunner, resetRunner } from "../scripts/lib/exec.mjs";
import { readState, writeState } from "../scripts/lib/state.mjs";
import { startTask, mergeTask, setSleep, resetSleep } from "../scripts/lib/task.mjs";
import { main } from "../scripts/darkforge.mjs";

let sleeps = [];
beforeEach(() => {
  sleeps = [];
  setSleep((ms) => sleeps.push(ms));
});
afterEach(() => {
  resetRunner();
  resetSleep();
});

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const ACTIVE = "# Active\n\n## Where we are\nx\n\n## Next\ny\n\n## Waiting on owner\nnone\n";
const MB_DIFF = "memory-bank/activeContext.md\nmemory-bank/progress.md\nsrc/a.rs\n";
const URL = "https://github.com/o/r/pull/42\n";
const STATUS =
  "git status --porcelain -- . :(exclude).darkforge/state.json :(exclude).darkforge/gate.json :(exclude).darkforge/offsets :(exclude).darkforge/ledger.jsonl";

/** Temp project (name contains spaces) with config, memory bank and a fresh gate record. */
function project(git = {}, { gate = true, task = "7" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df task "));
  fs.mkdirSync(path.join(root, ".darkforge"));
  fs.writeFileSync(path.join(root, ".darkforge", "config.json"), JSON.stringify({ schemaVersion: 1, git }));
  fs.mkdirSync(path.join(root, "memory-bank"));
  fs.writeFileSync(path.join(root, "memory-bank", "activeContext.md"), ACTIVE);
  fs.writeFileSync(path.join(root, "memory-bank", "progress.md"), "| Task | Status |\n| 7 | done |\n");
  if (gate) {
    fs.writeFileSync(path.join(root, ".darkforge", "gate.json"), JSON.stringify({ head: HEAD, ok: true, dirty: false }));
  }
  if (task) writeState(root, { task, phase: "review" });
  return root;
}

/** Fake runner: records every call; `responses` maps "cmd arg arg" to a result or a function. */
function fake(responses = {}) {
  const calls = [];
  setRunner((cmd, args, opts) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(" ");
    const base = {
      "git rev-parse HEAD": { code: 0, stdout: HEAD + "\n", stderr: "" },
      "git branch --show-current": { code: 0, stdout: "task/7-add-thing\n", stderr: "" },
    };
    const r = Object.hasOwn(responses, key) ? responses[key] : base[key];
    const out = typeof r === "function" ? r(opts) : r;
    return { code: 0, stdout: "", stderr: "", ...out };
  });
  return {
    calls,
    /** Calls as strings; multi-line args (the PR body) shown as <body>. */
    lines: () => calls.map((c) => c.map((a) => (a.includes("\n") ? "<body>" : a)).join(" ")),
  };
}

const PRECHECKS = [
  "git branch --show-current",
  "git rev-parse HEAD",
  STATUS,
  "git rev-parse HEAD",
  "git diff --name-only origin/main...HEAD",
];
const noPushOrGh = (lines) => lines.every((l) => !l.startsWith("gh ") && !l.startsWith("git push") && !l.startsWith("git merge") && !l.startsWith("git switch"));

// ---------- start ----------

test("start (clean, remote): fetch, check local+remote, branch from remote base, state set", () => {
  const root = project({}, { task: null });
  const f = fake();
  const r = startTask(root, "7", "add-thing");
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(f.lines(), [
    STATUS,
    "git fetch --prune origin",
    "git branch --list task/7-*",
    "git branch -r --list origin/task/7-*",
    "git switch -c task/7-add-thing origin/main",
  ]);
  assert.deepEqual(readState(root), { task: "7", phase: "implement" });
  assert.match(r.message, /task\/7-add-thing/);
});

test("start clears lastTask left by the previous merge", () => {
  const root = project({}, { task: null });
  writeState(root, { lastTask: "6" });
  fake();
  assert.equal(startTask(root, "7", "add-thing").ok, true);
  assert.deepEqual(readState(root), { task: "7", phase: "implement" });
});

test("start (clean, no remote): branch from local base, no fetch", () => {
  const root = project({ remote: null, baseBranch: "trunk" }, { task: null });
  const f = fake();
  assert.equal(startTask(root, "12", "x").ok, true);
  assert.deepEqual(f.lines(), [STATUS, "git branch --list task/12-*", "git switch -c task/12-x trunk"]);
});

test("start (dirty tree): refuse, nothing else runs, state untouched", () => {
  const root = project({}, { task: null });
  const f = fake({ [STATUS]: { stdout: " M src/a.rs\n" } });
  const r = startTask(root, "7", "add-thing");
  assert.equal(r.ok, false);
  assert.match(r.message, /uncommitted changes/);
  assert.deepEqual(f.lines(), [STATUS]);
  assert.deepEqual(readState(root), { task: null, phase: null });
});

test("start: id exists locally or remotely -> refuse before switch", () => {
  for (const [key, out] of [
    ["git branch --list task/7-*", "  task/7-old\n"],
    ["git branch -r --list origin/task/7-*", "  origin/task/7-old\n"],
  ]) {
    const root = project({}, { task: null });
    const f = fake({ [key]: { stdout: out } });
    const r = startTask(root, "7", "add-thing");
    assert.equal(r.ok, false);
    assert.match(r.message, /task 7 already exists/);
    assert.ok(f.lines().every((l) => !l.startsWith("git switch")));
    assert.equal(readState(root).task, null);
  }
});

test("start: fetch failure stops with its stderr", () => {
  const root = project({}, { task: null });
  const f = fake({ "git fetch --prune origin": { code: 128, stderr: "fatal: no network" } });
  const r = startTask(root, "7", "a");
  assert.equal(r.ok, false);
  assert.match(r.message, /fatal: no network/);
  assert.deepEqual(f.lines(), [STATUS, "git fetch --prune origin"]);
});

test("start: invalid id or slug -> refuse without running git", () => {
  const root = project({}, { task: null });
  const f = fake();
  for (const [id, slug] of [["7/x", "a"], ["", "a"], ["7", "Bad"], ["7", "a--b"], ["7", "-a"], ["7", ""], ["7", "a b"]]) {
    const r = startTask(root, id, slug);
    assert.equal(r.ok, false, `${id} ${slug}`);
    assert.match(r.message, /invalid (id|slug)/);
  }
  assert.deepEqual(f.calls, []);
});

// ---------- merge: PR flow ----------

test("merge with PR + autoMerge: push, create, merge --auto, stop; state cleared", () => {
  const root = project({ autoMerge: true, mergeMethod: "squash" });
  const f = prFake();
  const r = mergeTask(root, "7", { title: "Add thing" });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(f.lines(), [
    ...PRECHECKS,
    "git push origin task/7-add-thing",
    "gh pr create --base main --head task/7-add-thing --title Add thing --body <body>",
    `gh pr merge 42 --squash --delete-branch --auto --match-head-commit ${HEAD}`,
  ]);
  assert.match(r.message, /auto-merge enabled for PR #42; it merges when required checks pass/);
  assert.deepEqual(readState(root), { task: null, phase: null, lastTask: "7" });
  const body = f.calls.find((c) => c[1] === "pr" && c[2] === "create").at(-1);
  assert.match(body, /Task 7/);
  assert.match(body, /Add thing/);
  assert.match(body, /Gate: passed on 0123456/);
  assert.match(body, /Memory bank updated/);
  assert.equal(body.trimEnd().split("\n").at(-1), "Merged with darkforge");
});

/** Wrap the current fake so `pick(key)` can answer before the table (for args we cannot spell exactly). */
function setRunnerFor(f, pick) {
  const calls = f.calls;
  const table = {
    "git rev-parse HEAD": { stdout: HEAD + "\n" },
    "git branch --show-current": { stdout: "task/7-add-thing\n" },
    [PRECHECKS.at(-1)]: { stdout: MB_DIFF },
    ...(f.extra ?? {}),
  };
  setRunner((cmd, args) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(" ");
    const out = pick(key) ?? (Object.hasOwn(table, key) ? table[key] : {});
    return { code: 0, stdout: "", stderr: "", ...(typeof out === "function" ? out() : out) };
  });
}

/** PR-flow fake: create prints URL; `extra` maps keys to results; `pick` overrides. */
function prFake(extra = {}, createOut = { stdout: URL }) {
  const f = { calls: [], extra };
  f.lines = () => f.calls.map((c) => c.map((a) => (a.includes("\n") ? "<body>" : a)).join(" "));
  setRunnerFor(f, (key) => (key.startsWith("gh pr create") ? (extra["gh pr create"] ?? createOut) : null));
  return f;
}

test("merge with PR + watch: checks, merge, switch, pull, delete local branch", () => {
  const root = project({});
  const f = prFake({ "git branch --list task/7-add-thing": { stdout: "* task/7-add-thing\n" } });
  const r = mergeTask(root, "7", { title: "Add thing" });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(f.lines(), [
    ...PRECHECKS,
    "git push origin task/7-add-thing",
    "gh pr create --base main --head task/7-add-thing --title Add thing --body <body>",
    "gh pr checks 42 --watch --required",
    `gh pr merge 42 --merge --delete-branch --match-head-commit ${HEAD}`,
    "git switch main",
    "git pull --ff-only origin main",
    "git branch --list task/7-add-thing",
    "git branch -d task/7-add-thing",
  ]);
  assert.deepEqual(readState(root), { task: null, phase: null, lastTask: "7" });
});

test("merge with PR + watch: local branch already deleted by gh -> skip branch -d", () => {
  const root = project({});
  const f = prFake();
  assert.equal(mergeTask(root, "7", { title: "T" }).ok, true);
  assert.deepEqual(f.lines().slice(-3), ["git switch main", "git pull --ff-only origin main", "git branch --list task/7-add-thing"]);
});

const CHECKS = "gh pr checks 42 --watch --required";
const MERGE = `gh pr merge 42 --merge --delete-branch --match-head-commit ${HEAD}`;
const NO_CHECKS = { code: 1, stderr: "no checks reported on the 'task/7-add-thing' branch" };
/** Responder returning `seq[i]` on the i-th call, the last entry afterwards. */
const sequence = (...seq) => {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
};

test("merge with PR + watch: 'no required checks' (stderr) -> merge at once, no retry", () => {
  const root = project({ requiredChecks: ["ci"] });
  const f = prFake({ [CHECKS]: { code: 1, stderr: "no required checks reported on the 'task/7-add-thing' branch" } });
  assert.equal(mergeTask(root, "7", { title: "T" }).ok, true);
  assert.equal(f.lines().filter((l) => l === CHECKS).length, 1);
  assert.deepEqual(sleeps, []);
  assert.ok(f.lines().includes(MERGE));
});

test("merge with PR + watch: 'no checks reported' then checks pass -> retry, merge", () => {
  const root = project({ requiredChecks: ["ci"] });
  const f = prFake({ [CHECKS]: sequence(NO_CHECKS, NO_CHECKS, { code: 0, stdout: "ci pass" }) });
  assert.equal(mergeTask(root, "7", { title: "T" }).ok, true);
  assert.equal(f.lines().filter((l) => l === CHECKS).length, 3);
  assert.deepEqual(sleeps, [10000, 10000]);
  assert.equal(f.lines()[f.lines().indexOf(MERGE) - 1], CHECKS);
});

test("merge with PR + watch: 'no checks reported' after all retries, requiredChecks empty -> merge", () => {
  const root = project({});
  const f = prFake({ [CHECKS]: NO_CHECKS });
  assert.equal(mergeTask(root, "7", { title: "T" }).ok, true);
  assert.equal(f.lines().filter((l) => l === CHECKS).length, 4);
  assert.deepEqual(sleeps, [10000, 10000, 10000]);
  assert.ok(f.lines().includes(MERGE));
});

test("merge with PR + watch: 'no checks reported' after all retries, requiredChecks set -> refuse, no merge", () => {
  const root = project({ requiredChecks: ["ci", "lint"] });
  const f = prFake({ [CHECKS]: NO_CHECKS });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /no checks reported for PR #42/);
  assert.match(r.message, /ci, lint/);
  assert.equal(f.lines().filter((l) => l === CHECKS).length, 4);
  assert.equal(f.lines().at(-1), CHECKS);
  assert.ok(!f.lines().some((l) => l.startsWith("gh pr merge")));
  assert.equal(readState(root).task, "7");
});

test("merge with PR + watch: 'no checks' text on stdout only is a failure", () => {
  const root = project({});
  const f = prFake({ [CHECKS]: { code: 1, stdout: "lint  fail  no checks reported by sub-job", stderr: "" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /checks did not pass/);
  assert.deepEqual(sleeps, []);
  assert.ok(!f.lines().some((l) => l.startsWith("gh pr merge")));
});

test("merge local: failing git merge adds the abort hint", () => {
  const root = project({ prFlow: false });
  prFake({ "git merge --no-ff task/7-add-thing -m Merge task/7-add-thing": { code: 1, stdout: "CONFLICT (content): a.rs" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /CONFLICT/);
  assert.match(r.message, /run "git merge --abort" to undo the partial merge/);
  assert.equal(readState(root).task, "7");
});

test("start and merge refuse a remote or baseBranch that is empty or starts with '-'", () => {
  for (const git of [{ remote: "--upload-pack=x" }, { remote: "" }, { baseBranch: "-x" }, { baseBranch: "" }]) {
    const root = project(git);
    const f = fake();
    const s = startTask(root, "7", "a");
    const m = mergeTask(root, "7", { title: "T" });
    for (const r of [s, m]) {
      assert.equal(r.ok, false, JSON.stringify(git));
      assert.match(r.message, /^invalid git\.(remote|baseBranch) .*must .*not start with "-"/);
    }
    assert.deepEqual(f.calls, [], JSON.stringify(git));
  }
});

test("merge with PR + watch: failing checks -> no merge, state kept", () => {
  const root = project({});
  const f = prFake({ "gh pr checks 42 --watch --required": { code: 1, stdout: "ci  fail  1m  https://x" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /ci {2}fail/);
  assert.equal(f.lines().at(-1), "gh pr checks 42 --watch --required");
  assert.ok(!f.lines().some((l) => l.startsWith("gh pr merge")));
  assert.equal(readState(root).task, "7");
});

test("merge: push failure stops everything after it", () => {
  const root = project({});
  const f = prFake({ "git push origin task/7-add-thing": { code: 1, stderr: "rejected" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /rejected/);
  assert.equal(f.lines().at(-1), "git push origin task/7-add-thing");
  assert.equal(readState(root).task, "7");
});

test("merge: unparseable PR URL -> refuse with gh output", () => {
  const root = project({});
  const f = prFake({}, { stdout: "Creating pull request...\nsomething odd\n" });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /something odd/);
  assert.ok(f.lines().at(-1).startsWith("gh pr create"));
  assert.equal(readState(root).task, "7");
});

test("merge: PR already exists -> reuse its number", () => {
  const root = project({ autoMerge: true });
  const f = prFake({
    "gh pr create": { code: 1, stderr: 'a pull request for branch "task/7-add-thing" into branch "main" already exists:\nhttps://github.com/o/r/pull/9\n' },
  });
  assert.equal(mergeTask(root, "7", { title: "T" }).ok, true);
  assert.equal(f.lines().at(-1), `gh pr merge 9 --merge --delete-branch --auto --match-head-commit ${HEAD}`);
});

test("merge: failing cleanup after a successful merge reports it, state already cleared", () => {
  const root = project({});
  prFake({ "git pull --ff-only origin main": { code: 1, stderr: "diverged" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /PR #42 merged/);
  assert.match(r.message, /diverged/);
  assert.deepEqual(readState(root), { task: null, phase: null, lastTask: "7" });
});

// ---------- merge: local ----------

test("merge local (prFlow false, remote set): switch base, pull --ff-only, merge --no-ff, push base", () => {
  const root = project({ prFlow: false });
  const f = prFake();
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(f.lines(), [
    ...PRECHECKS,
    "git switch main",
    "git pull --ff-only origin main",
    "git merge --no-ff task/7-add-thing -m Merge task/7-add-thing",
    "git push origin main",
  ]);
  assert.match(r.message, /pushed to origin/);
  assert.deepEqual(readState(root), { task: null, phase: null, lastTask: "7" });
});

test("merge local (prFlow false, remote set): failing pull stops before the merge", () => {
  const root = project({ prFlow: false });
  const f = prFake({ "git pull --ff-only origin main": { code: 1, stderr: "diverged" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /diverged/);
  assert.equal(f.lines().at(-1), "git pull --ff-only origin main");
  assert.equal(readState(root).task, "7");
});

test("merge local (prFlow false, remote set): failing push after the merge says so, state already cleared", () => {
  const root = project({ prFlow: false });
  prFake({ "git push origin main": { code: 1, stderr: "rejected" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /merged task\/7-add-thing into main locally, but the push failed; run "git push origin main"/);
  assert.match(r.message, /rejected/);
  assert.deepEqual(readState(root), { task: null, phase: null, lastTask: "7" });
});

test("merge local (remote null): diff against local base", () => {
  const root = project({ remote: null, baseBranch: "dev" });
  const f = fake({ "git diff --name-only dev...HEAD": { stdout: MB_DIFF } });
  assert.equal(mergeTask(root, "7", { title: "T" }).ok, true);
  assert.deepEqual(f.lines(), [
    ...PRECHECKS.slice(0, 4),
    "git diff --name-only dev...HEAD",
    "git switch dev",
    "git merge --no-ff task/7-add-thing -m Merge task/7-add-thing",
  ]);
});

// ---------- merge: refusals (no push / gh / merge issued) ----------

test("merge refused: not on task/<id>-* branch", () => {
  for (const branch of ["main", "task/70-x", "task/7"]) {
    const root = project({});
    const f = fake({ "git branch --show-current": { stdout: branch + "\n" } });
    const r = mergeTask(root, "7", { title: "T" });
    assert.equal(r.ok, false);
    assert.match(r.message, /not on a task\/7-\* branch/);
    assert.deepEqual(f.lines(), ["git branch --show-current"]);
  }
});

test("merge refused: stale gate (other HEAD, no gate.json, dirty tree)", () => {
  const cases = [
    [project({}), { "git rev-parse HEAD": { stdout: "ffff\n" } }],
    [project({}, { gate: false }), {}],
    [project({}), { [STATUS]: { stdout: "?? new.txt\n" } }],
  ];
  for (const [root, resp] of cases) {
    const f = fake({ [PRECHECKS.at(-1)]: { stdout: MB_DIFF }, ...resp });
    const r = mergeTask(root, "7", { title: "T" });
    assert.equal(r.ok, false);
    assert.match(r.message, /gate has not passed on this commit/);
    assert.ok(noPushOrGh(f.lines()), f.lines().join("\n"));
    assert.ok(!f.lines().some((l) => l.startsWith("git diff")));
    assert.equal(readState(root).task, "7");
  }
});

test("merge refused: memory bank not changed on the branch", () => {
  for (const diff of ["src/a.rs\n", "memory-bank/progress.md\n", "memory-bank/activeContext.md\n", ""]) {
    const root = project({});
    const f = fake({ [PRECHECKS.at(-1)]: { stdout: diff } });
    const r = mergeTask(root, "7", { title: "T" });
    assert.equal(r.ok, false);
    assert.match(r.message, /memory bank not updated/);
    assert.deepEqual(f.lines(), PRECHECKS);
  }
});

test("merge refused: diff command fails", () => {
  const root = project({});
  const f = fake({ [PRECHECKS.at(-1)]: { code: 128, stderr: "fatal: bad revision" } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /bad revision/);
  assert.ok(noPushOrGh(f.lines()));
});

test("merge refused: memory lint fails", () => {
  const root = project({});
  fs.writeFileSync(path.join(root, "memory-bank", "activeContext.md"), "# nothing\n");
  const f = fake({ [PRECHECKS.at(-1)]: { stdout: MB_DIFF } });
  const r = mergeTask(root, "7", { title: "T" });
  assert.equal(r.ok, false);
  assert.match(r.message, /memory lint failed/);
  assert.match(r.message, /missing heading/);
  assert.deepEqual(f.lines(), PRECHECKS);
});

test("merge refused: invalid id or empty title, no git at all", () => {
  const root = project({});
  const f = fake();
  assert.match(mergeTask(root, "7;x", { title: "T" }).message, /invalid id/);
  assert.match(mergeTask(root, "7", { title: "  " }).message, /title/);
  assert.match(mergeTask(root, "7", {}).message, /title/);
  assert.deepEqual(f.calls, []);
});

// ---------- CLI ----------

test("CLI: task start / merge dispatch and usage errors", async () => {
  const root = project({ prFlow: false }, { task: null });
  let out = "";
  const ctx = { cwd: root, stdout: (s) => (out += s), stderr: (s) => (out += s) };
  const f = prFake();
  assert.equal(await main(["task", "start", "7", "add-thing"], ctx), 0);
  assert.ok(f.lines().includes("git switch -c task/7-add-thing origin/main"));
  out = "";
  assert.equal(await main(["task", "merge", "7", "--title", "Add thing"], ctx), 0);
  assert.ok(f.lines().includes("git merge --no-ff task/7-add-thing -m Merge task/7-add-thing"));
  assert.equal(await main(["task"], ctx), 1);
  assert.equal(await main(["task", "start", "7"], ctx), 1);
  assert.equal(await main(["task", "merge", "7"], ctx), 1);
  assert.equal(await main(["task", "merge", "7", "--title"], ctx), 1);
  assert.match(out, /usage: darkforge task/);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "df bare "));
  assert.equal(await main(["task", "start", "7", "a"], { ...ctx, cwd: bare }), 1);
});

// ---------- real git, local path end to end ----------

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

test("real git: start and local merge in a temp repo with a space in its path", () => {
  resetRunner();
  const root = project({ remote: null, prFlow: false }, { gate: false, task: null });
  fs.writeFileSync(path.join(root, ".gitignore"), ".darkforge/\n");
  git(root, "init", "-q");
  git(root, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");

  const s = startTask(root, "3", "demo-task");
  assert.equal(s.ok, true, s.message);
  assert.equal(git(root, "branch", "--show-current"), "task/3-demo-task");
  assert.equal(readState(root).task, "3");
  assert.equal(startTask(root, "3", "other").ok, false); // dirty? no: exists

  fs.writeFileSync(path.join(root, "feature.txt"), "x\n");
  fs.appendFileSync(path.join(root, "memory-bank", "progress.md"), "| 3 | done |\n");
  fs.appendFileSync(path.join(root, "memory-bank", "activeContext.md"), "more\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "work");

  // Gate not run yet: refused.
  assert.match(mergeTask(root, "3", { title: "Demo" }).message, /gate has not passed/);
  const head = git(root, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(root, ".darkforge", "gate.json"), JSON.stringify({ head, ok: true, dirty: false }));

  const m = mergeTask(root, "3", { title: "Demo" });
  assert.equal(m.ok, true, m.message);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "log", "-1", "--format=%s"), "Merge task/3-demo-task");
  assert.equal(git(root, "rev-parse", "HEAD^2"), head);
  assert.ok(fs.existsSync(path.join(root, "feature.txt")));
  assert.deepEqual(readState(root), { task: null, phase: null, lastTask: "3" });
});

test("real git: start refuses an uncommitted change to the tracked .darkforge/config.json, ignores local darkforge files", () => {
  resetRunner();
  const root = project({ remote: null, prFlow: false }, { gate: false, task: null });
  fs.writeFileSync(path.join(root, ".gitignore"), ".darkforge/state.json\n.darkforge/gate.json\n.darkforge/offsets/\n.darkforge/ledger.jsonl\n");
  git(root, "init", "-q");
  git(root, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");

  fs.appendFileSync(path.join(root, ".darkforge", "config.json"), "\n");
  const s = startTask(root, "4", "demo");
  assert.equal(s.ok, false);
  assert.match(s.message, /uncommitted changes[\s\S]*\.darkforge\/config\.json/);

  git(root, "checkout", "--", ".darkforge/config.json");
  fs.writeFileSync(path.join(root, ".darkforge", "gate.json"), "{}");
  assert.equal(startTask(root, "4", "demo").ok, true);
});
