import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runGate, gateFresh } from "../scripts/lib/gate.mjs";
import { setRunner, resetRunner } from "../scripts/lib/exec.mjs";
import { main } from "../scripts/darkforge.mjs";

const NODE = `"${process.execPath}"`;
const js = (code) => `${NODE} -e "${code}"`;

function project(command, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df gate "));
  fs.mkdirSync(path.join(root, ".darkforge"));
  const gate = { command: { windows: command, unix: command }, successMarker: "ALL CHECKS PASSED", ...extra };
  fs.writeFileSync(path.join(root, ".darkforge", "config.json"), JSON.stringify({ schemaVersion: 1, gate }));
  return root;
}

test("passing command prints only the marker line", () => {
  const root = project(js("console.log('noise 1'); console.log('ALL CHECKS PASSED'); console.log('noise 2')"));
  const r = runGate(root);
  assert.equal(r.ok, true);
  assert.equal(r.output, "ALL CHECKS PASSED");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".darkforge", "gate.json"), "utf8")).ok, true);
});

test("exit 0 without marker is not ok", () => {
  const root = project(js("console.log('all good')"));
  const r = runGate(root);
  assert.equal(r.ok, false);
  assert.match(r.output, /gate: FAILED \(exit 0/);
});

test("failing command output trimmed to failing lines", () => {
  const root = project(js("console.log('fine 1'); console.log('test x FAIL'); console.log('fine 2'); console.error('fatal Error: boom'); process.exit(3)"));
  const r = runGate(root);
  assert.equal(r.ok, false);
  assert.equal(r.output, "test x FAIL\nfatal Error: boom\ngate: FAILED (exit 3)");
});

test("failure with no matching lines shows last 20 lines", () => {
  const root = project(js("for (let i=1;i<=30;i++) console.log('line '+i); process.exit(1)"));
  const out = runGate(root).output.split("\n");
  assert.equal(out[0], "line 11");
  assert.equal(out[19], "line 30");
  assert.equal(out[20], "gate: FAILED (exit 1)");
});

test("--full prints everything", () => {
  const root = project(js("console.log('a'); console.log('ALL CHECKS PASSED')"));
  assert.equal(runGate(root, { full: true }).output, "a\nALL CHECKS PASSED");
});

test("empty command is not configured", () => {
  const root = project("");
  const r = runGate(root);
  assert.equal(r.ok, false);
  assert.equal(r.output, "gate command not configured; run /darkforge:init");
});

test("CLI: exit codes and fail-closed", async () => {
  const root = project(js("console.log('ALL CHECKS PASSED')"));
  let out = "";
  const ctx = (cwd) => ({ cwd, stdout: (s) => (out += s), stderr: (s) => (out += s) });
  assert.equal(await main(["gate"], ctx(root)), 0);
  assert.equal(out, "ALL CHECKS PASSED\n");
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "df bare "));
  assert.equal(await main(["gate"], ctx(bare)), 1);
  const bad = project("x");
  fs.writeFileSync(path.join(bad, ".darkforge", "config.json"), "{ nope");
  assert.equal(await main(["gate"], ctx(bad)), 1);
});

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

test("gateFresh is false after a new commit, true before", () => {
  const root = project(js("console.log('ALL CHECKS PASSED')"));
  git(root, "init");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", "-A");
  git(root, "commit", "-m", "one");
  assert.equal(gateFresh(root), false); // no gate.json yet
  assert.equal(runGate(root).ok, true);
  assert.equal(gateFresh(root), true);
  git(root, "commit", "--allow-empty", "-m", "two");
  assert.equal(gateFresh(root), false);
});

test("outside git: head null, gate.json written, gateFresh false", () => {
  const root = project(js("console.log('ALL CHECKS PASSED')"));
  runGate(root);
  const rec = JSON.parse(fs.readFileSync(path.join(root, ".darkforge", "gate.json"), "utf8"));
  assert.equal(rec.head, null);
  assert.equal(gateFresh(root), false);
});

test("marker must be a whole line", () => {
  const root = project(js("console.log('NOT ALL CHECKS PASSED')"));
  assert.equal(runGate(root).ok, false);
});

function repo() {
  const root = project(js("console.log('ALL CHECKS PASSED')"));
  git(root, "init");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "a.txt"), "1");
  git(root, "add", "a.txt", ".darkforge/config.json");
  git(root, "commit", "-m", "one");
  return root;
}

test("gate on dirty tree: fresh false, warning appended", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "a.txt"), "2");
  const r = runGate(root);
  assert.equal(r.ok, true);
  assert.match(r.output, /gate: tree has uncommitted changes; commit before merge/);
  assert.equal(gateFresh(root), false);
});

test("modify tracked file or add untracked file after gate: fresh false", () => {
  const root = repo();
  runGate(root);
  assert.equal(gateFresh(root), true);
  fs.writeFileSync(path.join(root, "a.txt"), "2");
  assert.equal(gateFresh(root), false);
  git(root, "checkout", "a.txt");
  assert.equal(gateFresh(root), true);
  fs.writeFileSync(path.join(root, "new.txt"), "x");
  assert.equal(gateFresh(root), false);
});

test("changes to darkforge's local files (state, gate, offsets, ledger) do not affect freshness", () => {
  const root = repo();
  runGate(root);
  fs.writeFileSync(path.join(root, ".darkforge", "state.json"), "{}");
  fs.mkdirSync(path.join(root, ".darkforge", "offsets"));
  fs.writeFileSync(path.join(root, ".darkforge", "offsets", "abc.json"), "{}");
  fs.writeFileSync(path.join(root, ".darkforge", "ledger.jsonl"), "{}\n");
  assert.equal(gateFresh(root), true);
});

test("an uncommitted change to the tracked .darkforge/config.json makes the tree dirty", () => {
  const root = repo();
  runGate(root);
  assert.equal(gateFresh(root), true);
  fs.appendFileSync(path.join(root, ".darkforge", "config.json"), "\n");
  assert.equal(gateFresh(root), false);
  const r = runGate(root);
  assert.match(r.output, /gate: tree has uncommitted changes/);
});

test("a failing git status counts as a dirty tree", () => {
  const root = project("gate-cmd");
  const head = "0123456789abcdef0123456789abcdef01234567";
  setRunner((cmd, args) => {
    if (cmd === "gate-cmd") return { code: 0, stdout: "ALL CHECKS PASSED\n", stderr: "" };
    if (cmd === "git" && args[0] === "rev-parse") return { code: 0, stdout: head + "\n", stderr: "" };
    if (cmd === "git" && args[0] === "status") return { code: 128, stdout: "", stderr: "fatal: broken index" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
  try {
    const r = runGate(root);
    assert.equal(r.ok, true);
    assert.match(r.output, /gate: tree has uncommitted changes/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".darkforge", "gate.json"), "utf8")).dirty, true);
    fs.writeFileSync(path.join(root, ".darkforge", "gate.json"), JSON.stringify({ head, ok: true, dirty: false }));
    assert.equal(gateFresh(root), false);
  } finally {
    resetRunner();
  }
});

test("gate.json write failure returns ok:false", () => {
  const root = project(js("console.log('ALL CHECKS PASSED')"));
  fs.mkdirSync(path.join(root, ".darkforge", "gate.json"));
  const r = runGate(root);
  assert.equal(r.ok, false);
  assert.match(r.output, /gate: cannot write \.darkforge\/gate\.json/);
});
