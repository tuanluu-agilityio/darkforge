import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyInit } from "../scripts/lib/init.mjs";
import { writeState } from "../scripts/lib/state.mjs";
import { collect, defaultOut, render, section, tableRows } from "../scripts/lib/dashboard.mjs";
import { main } from "../scripts/darkforge.mjs";

const EVIL = "</script><img src=x onerror=alert(1)>";

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df dash "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  applyInit(root, { config: { project: { name: "dash", ownerLanguage: "vi" } } });
  const mb = (f) => path.join(root, "memory-bank", f);
  fs.mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "plans", "phase-1-core.md"),
    [
      "# Phase 1: Core",
      "",
      "## Tasks",
      "",
      "| Task | Title | Depends | Risk | Implementer/model | Reviewer/model | Acceptance | Tests |",
      "|---|---|---|---|---|---|---|---|",
      "| 001 | Add sum | none | low | builder/sonnet | reviewer/sonnet | sum works | sum_test |",
      `| 002 | ${EVIL} | 001 | medium | builder/sonnet | reviewer/opus | x | y |`,
      "| 003 | Export | 001, 002 | high | specialist/opus | security-reviewer/opus | z | w |",
      "",
      "## Exit checklist",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(root, "docs", "plans", "phase-2-next.md"), "# Phase 2: Next\n\n## Tasks\n\n| Task | Title |\n|---|---|\n| 010 | Later |\n");
  fs.appendFileSync(mb("progress.md"), "| 001 | task/001-add-sum | builder | sonnet | done | 120 |\n");
  const ac = fs.readFileSync(mb("activeContext.md"), "utf8")
    .replace("## Where we are\n", "## Where we are\n\nTask 001 merged.\n")
    .replace(/## Next\n[\s\S]*?## Waiting on owner\n/, "## Next\n\nTask 002.\n\n## Waiting on owner\n\n| ID | Question | Blocks |\n|---|---|---|\n| Q-01 | Which export format? | 003 |\n");
  fs.writeFileSync(mb("activeContext.md"), ac);
  fs.appendFileSync(mb("decisions.md"), "| D-001 | 2026-11-26 | Use CSV | 001 |\n");
  fs.appendFileSync(mb("backlog.md"), "- Stream large exports\n");
  writeState(root, { task: "002", phase: "review" });
  const rec = (o) => JSON.stringify({ at: "x", agent: null, kind: "subagent", model: "claude-sonnet", usage: { cacheRead: 10 }, ...o });
  fs.writeFileSync(
    path.join(root, ".darkforge", "ledger.jsonl"),
    [
      rec({ task: "001", phase: "implement", tokens: 100 }),
      rec({ task: "001", phase: "orchestrator", kind: "orchestrator", model: "claude-opus", tokens: 50, session: "aaaaaaaa-1" }),
      rec({ task: "002", phase: "implement", tokens: 30 }),
      rec({ task: "002", phase: "orchestrator", kind: "orchestrator", model: "claude-opus", tokens: 70, session: "aaaaaaaa-1" }),
      rec({ task: null, phase: "orchestrator", kind: "orchestrator", model: "claude-opus", tokens: 5 }),
    ].join("\n") + "\n",
  );
  return root;
}

test("section and tableRows read markdown sections and tables", () => {
  const md = "# T\n\n## A\n\n| X | Y |\n|---|:-:|\n| 1 | 2 |\n\n## B\nb\n";
  assert.deepEqual(section(md, "## B"), ["b", ""]);
  assert.deepEqual(tableRows(section(md, "## A")), [{ x: "1", y: "2" }]);
  assert.deepEqual(section(null, "## A"), []);
});

test("collect: phases, task status, questions, ledger, sessions, memory bank", (t) => {
  const root = project(t);
  const d = collect(root, new Date("2026-11-26T10:00:00Z"));
  assert.equal(d.project, "dash");
  assert.equal(d.ownerLanguage, "vi");
  assert.equal(d.current, 1);
  assert.deepEqual(d.phases.map((p) => [p.n, p.title, p.status]), [[1, "Core", "active"], [2, "Next", "planned"]]);
  const tasks = Object.fromEntries(d.phases[0].tasks.map((x) => [x.id, x]));
  assert.equal(tasks["001"].status, "done");
  assert.equal(tasks["002"].status, "run");
  assert.equal(tasks["002"].title, EVIL);
  assert.equal(tasks["003"].status, "blocked");
  assert.deepEqual(tasks["003"].blockedBy, ["Q-01"]);
  assert.deepEqual(tasks["003"].deps, ["001", "002"]);
  assert.deepEqual(tasks["001"].deps, []);
  assert.ok(d.where.startsWith("Task 001 merged."), d.where);
  assert.equal(d.next, "Task 002.");
  assert.deepEqual(d.questions, [{ id: "Q-01", question: "Which export format?", blocks: "003" }]);
  assert.deepEqual(d.decisions, [{ id: "D-001", date: "2026-11-26", text: "Use CSV" }]);
  assert.deepEqual(d.backlog, ["Stream large exports"]);
  assert.equal(d.ledger.total, 255);
  assert.equal(d.ledger.kinds.orchestrator, 125);
  assert.equal(d.ledger.cacheRead, 50);
  assert.deepEqual(d.ledger.byTask["001"], { implement: 100, review: 0, fix: 0, orchestrator: 50, total: 150, session: "aaaaaaaa-1" });
  assert.equal(d.ledger.byTask["(no task)"].total, 5);
  assert.deepEqual(d.ledger.sessions, [{ id: "aaaaaaaa", tasks: ["001", "002"] }]);
  assert.match(d.plugin, /^\d+\.\d+\.\d+$/);
});

test("render embeds the data so no file content can end the script element", (t) => {
  const root = project(t);
  const data = collect(root);
  const html = render(data);
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(!html.includes(EVIL), "raw title must not appear");
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1, "only the page's own closing tag");
  const json = html.match(/const DATA=(.*);\nconst \$=/)[1];
  assert.deepEqual(JSON.parse(json), data);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), "no network URLs in the page");
});

test("CLI: dashboard --out writes the page and prints its path; default goes to the temp dir", async (t) => {
  const root = project(t);
  const out = path.join(root, "out dir", "dash.html");
  let stdout = "";
  let stderr = "";
  const ctx = { cwd: root, stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) };
  assert.equal(await main(["dashboard", "--out", out], ctx), 0, stderr);
  assert.equal(stdout, `dashboard: ${out}\n`);
  assert.match(fs.readFileSync(out, "utf8"), /darkforge dashboard/);
  assert.equal(await main(["dashboard", "--bogus"], ctx), 1);
  assert.match(stderr, /usage: darkforge dashboard/);
  assert.ok(defaultOut(root).startsWith(os.tmpdir()));
  assert.equal(defaultOut(root), defaultOut(root + path.sep));
});

test("collect works on a fresh project with no plans and no ledger", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df dash empty "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  applyInit(root, {});
  const d = collect(root);
  assert.deepEqual(d.phases, []);
  assert.equal(d.current, null);
  assert.equal(d.ledger.total, 0);
  assert.deepEqual(d.ledger.sessions, []);
  assert.ok(render(d).includes("const DATA="));
});

test("a ledger or progress row named __proto__ is just a key", (t) => {
  const root = project(t);
  fs.appendFileSync(path.join(root, ".darkforge", "ledger.jsonl"), JSON.stringify({ at: "x", task: "__proto__", phase: "implement", kind: "subagent", model: "__proto__", tokens: 7 }) + "\n");
  fs.appendFileSync(path.join(root, "memory-bank", "progress.md"), "| __proto__ | x | x | x | done | - |\n");
  const d = collect(root);
  assert.equal(Object.getPrototypeOf(d.ledger.byTask), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(d.ledger.byTask, "__proto__").value.total, 7);
  assert.equal(Object.getOwnPropertyDescriptor(d.ledger.byModel, "__proto__").value, 7);
  assert.equal({}.total, undefined, "Object.prototype untouched");
  assert.equal(JSON.parse(render(d).match(/const DATA=(.*);\nconst \$=/)[1]).ledger.total, d.ledger.total);
});

test("default output: a per-user private directory, the page readable by its owner only", { skip: process.platform === "win32" }, async (t) => {
  const root = project(t);
  const out = defaultOut(root);
  t.after(() => fs.rmSync(out, { force: true }));
  const ctx = { cwd: root, stdout: () => {}, stderr: (s) => assert.fail(s) };
  assert.equal(await main(["dashboard"], ctx), 0);
  assert.equal(fs.statSync(path.dirname(out)).mode & 0o077, 0, "directory 0700");
  assert.equal(fs.statSync(out).mode & 0o077, 0, "file 0600");
});

test("default output directory that is a symlink is refused", { skip: process.platform === "win32" }, async (t) => {
  const root = project(t);
  const dir = path.dirname(defaultOut(root));
  const real = fs.mkdtempSync(path.join(os.tmpdir(), "df real "));
  t.after(() => fs.rmSync(real, { recursive: true, force: true }));
  const had = fs.existsSync(dir);
  if (had) return; // a real per-user dir already exists on this machine; nothing to plant
  fs.symlinkSync(real, dir);
  t.after(() => fs.rmSync(dir, { force: true }));
  let err = "";
  assert.equal(await main(["dashboard"], { cwd: root, stdout: () => {}, stderr: (s) => (err += s) }), 1);
  assert.match(err, /not a plain directory/);
});
