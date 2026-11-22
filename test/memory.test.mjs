import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintMemory } from "../scripts/lib/memory.mjs";
import { main } from "../scripts/darkforge.mjs";

const GOOD = "# Active\n\n## Where we are\nx\n\n## Next\ny\n\n## Waiting on owner\n- Q-12 something\n\n## Other\nz\n";

function project({ active = GOOD, decisions, progress, task } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge memory "));
  fs.mkdirSync(path.join(dir, ".darkforge"));
  fs.writeFileSync(path.join(dir, ".darkforge", "config.json"), JSON.stringify({ schemaVersion: 1 }));
  if (task) fs.writeFileSync(path.join(dir, ".darkforge", "state.json"), JSON.stringify({ task, phase: null }));
  const mb = path.join(dir, "memory-bank");
  fs.mkdirSync(mb);
  if (active !== null) fs.writeFileSync(path.join(mb, "activeContext.md"), active);
  if (decisions !== undefined) fs.writeFileSync(path.join(mb, "decisions.md"), decisions);
  if (progress !== undefined) fs.writeFileSync(path.join(mb, "progress.md"), progress);
  return dir;
}

test("clean fixture passes", () => {
  const dir = project({ decisions: "D-1 about Q-120\n", progress: "| 10 | done |\n", task: "10" });
  assert.deepEqual(lintMemory(dir), { ok: true, problems: [] });
});

test("rule 1: missing activeContext", () => {
  const r = lintMemory(project({ active: null }));
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /memory-bank\/activeContext\.md: .*missing/);
});

test("rule 1: line count boundary (60 ok, 61 fails, trailing newline not counted)", () => {
  const head = "## Where we are\n## Next\n## Waiting on owner\n";
  const fill = (n) => Array.from({ length: n - 3 }, () => "l").join("\n");
  assert.equal(lintMemory(project({ active: head + fill(60) + "\n" })).ok, true);
  const r = lintMemory(project({ active: head + fill(61) + "\n" }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ["memory-bank/activeContext.md: 61 lines (max 60)"]);
});

test("rule 2: missing headings", () => {
  const r = lintMemory(project({ active: "## Where we are   \n## Next\n" }));
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /activeContext\.md.*## Waiting on owner/);
  assert.equal(lintMemory(project({ active: "  ## Next\n## Where we are\n## Waiting on owner\n" })).problems.length, 1);
});

test("rule 3: stale question id", () => {
  const dir = project({ decisions: "Answered Q-12: yes\n" });
  const r = lintMemory(dir);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /activeContext\.md.*Q-12.*decisions\.md/);
});

test("rule 3: whole word only, section bounded, missing decisions passes", () => {
  assert.equal(lintMemory(project({ decisions: "Q-123 and XQ-12 and Q-12x\n" })).ok, true);
  const outside = "## Where we are\nQ-12\n## Next\n## Waiting on owner\n- none\n";
  assert.equal(lintMemory(project({ active: outside, decisions: "Q-12\n" })).ok, true);
  assert.equal(lintMemory(project({})).ok, true);
});

test("rule 4: task row required, prefix is exact", () => {
  let r = lintMemory(project({ task: "10", progress: "| 101 | x |\n" }));
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /progress\.md.*10/);
  assert.equal(lintMemory(project({ task: "10", progress: "  | 10\n" })).ok, true);
  assert.equal(lintMemory(project({ task: "10", progress: "| 10| x\n" })).ok, true);
  r = lintMemory(project({ task: "10" }));
  assert.match(r.problems[0], /progress\.md.*missing/);
  assert.equal(lintMemory(project({})).ok, true);
});

test("CLI: memory lint", async () => {
  const run = async (dir, args = ["lint"]) => {
    let out = "", err = "";
    const code = await main(["memory", ...args], { cwd: dir, stdout: (s) => (out += s), stderr: (s) => (err += s) });
    return { code, out, err };
  };
  let r = await run(project());
  assert.deepEqual([r.code, r.out], [0, "memory: ok\n"]);
  r = await run(project({ decisions: "Q-12\n" }));
  assert.equal(r.code, 1);
  assert.match(r.out, /Q-12/);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge memory "));
  r = await run(bare);
  assert.equal(r.code, 1);
  assert.match(r.err, /darkforge/);
  assert.equal((await run(bare, ["bogus"])).code, 1);
});
