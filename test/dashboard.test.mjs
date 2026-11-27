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
  const json = html.match(/DATA=(.*);\nconst \$=/)[1];
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
  assert.ok(render(d).includes("DATA="));
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
  assert.equal(JSON.parse(render(d).match(/DATA=(.*);\nconst \$=/)[1]).ledger.total, d.ledger.total);
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

test("collect passes the running step through, sanitized", (t) => {
  const root = project(t);
  const since = "2026-11-27T01:00:00.000Z";
  writeState(root, { task: "002", phase: "fix", round: 2, implementer: { agent: "builder", model: "opus" }, waiting: { since, questions: [EVIL] } });
  const s = collect(root).state;
  assert.equal(s.task, "002");
  assert.equal(s.phase, "fix");
  assert.equal(typeof s.since, "string");
  assert.equal(s.round, 2);
  assert.deepEqual(s.implementer, { agent: "builder", model: "opus" });
  assert.equal(s.reviewer, null);
  assert.deepEqual(s.waiting, { since, questions: [EVIL] });
  writeState(root, { round: "2", implementer: "x", reviewer: { agent: 5, model: "m" }, waiting: { since: 1, questions: "no" } });
  const b = collect(root).state;
  assert.equal(b.round, 0);
  assert.equal(b.implementer, null);
  assert.deepEqual(b.reviewer, { agent: null, model: "m" });
  assert.deepEqual(b.waiting, { since: null, questions: [] });
  writeState(root, { waiting: "x" });
  assert.equal(collect(root).state.waiting, null);
});

test("render live flag", (t) => {
  const d = collect(project(t));
  assert.ok(!render(d).includes("/*DARKFORGE_LIVE*/false"));
  assert.ok(render(d).includes("const LIVE=false"));
  assert.ok(render(d, { live: true }).includes("const LIVE=true"));
  assert.ok(!render(d).includes(EVIL));
});

test("the page opens an EventSource only behind the live flag", () => {
  const tpl = fs.readFileSync(new URL("../templates/dashboard.html", import.meta.url), "utf8");
  assert.match(tpl, /if\s*\(LIVE\)[\s\S]*new EventSource\("events"\)/);
  assert.equal((tpl.match(/new EventSource/g) ?? []).length, 1);
});

test("waiting questions render as text", (t) => {
  const root = project(t);
  writeState(root, { waiting: { since: "2026-11-27T01:00:00.000Z", questions: [EVIL] } });
  const html = render(collect(root), { live: true });
  assert.ok(!html.includes("</script><img"));
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
});

test("template: EventSource only inside the if(LIVE) block; waiting questions escaped; focus kept on update", () => {
  const tpl = fs.readFileSync(new URL("../templates/dashboard.html", import.meta.url), "utf8");
  const script = tpl.match(/<script>([\s\S]*)<\/script>/)[1];
  const open = script.indexOf("if(LIVE){") + "if(LIVE)".length;
  let depth = 0;
  let end = open;
  for (let i = open; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}" && --depth === 0) { end = i; break; }
  }
  const block = script.slice(open, end);
  assert.ok(block.includes('new EventSource("events")'));
  assert.equal(script.replace(block, "").includes("EventSource"), false, "no EventSource outside the live block");
  assert.match(script, /wq\.map\(q=>[^\n]*\$\{esc\(q\)\}/, "waiting questions go through esc()");
  assert.match(block, /e\.data===lastRaw/, "unchanged payloads skip the render");
  assert.match(block, /\.focus\(\{preventScroll:true\}\)/, "focus is restored after a render without scrolling");
  assert.match(block, /readyState===2/, "a closed-for-good stream says to restart");
});

const STATIC_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">`;
const metas = (html) => html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/g) ?? [];

test("meta CSP: static page stays connect-src none, live page allows connect-src 'self'", (t) => {
  const d = collect(project(t));
  assert.deepEqual(metas(render(d)), [STATIC_META]);
  const live = metas(render(d, { live: true }));
  assert.ok(live.every((m) => m.includes("connect-src 'self'")), live.join(" "));
});

// ---- estimated cost ----
const TPL = () => fs.readFileSync(new URL("../templates/dashboard.html", import.meta.url), "utf8");
function costProject(t, records, config) {
  const root = project(t);
  if (config) {
    const f = path.join(root, ".darkforge", "config.json");
    fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), ...config }));
  }
  const line = (o) => JSON.stringify({ at: "x", agent: null, kind: "subagent", phase: "implement", ...o });
  fs.writeFileSync(path.join(root, ".darkforge", "ledger.jsonl"), records.map(line).join("\n") + "\n");
  return root;
}
const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-6, `${a} vs ${b}`);
const sum = (o, f = (v) => v.usd) => Object.values(o).reduce((s, v) => s + f(v), 0);
const OPUS = { task: "001", model: "claude-opus-5-5", tokens: 1500000, usage: { input: 1e6, output: 5e5 } }; // 4 + 10
const OPUS2 = { task: "002", model: "claude-opus-5-5", kind: "orchestrator", phase: "orchestrator", tokens: 2e6, usage: { cacheWrite: 1e6, cacheWrite5m: 1e6, cacheWrite1h: 0, cacheRead: 1e6 } }; // 5 + 0.2
const SON = { task: "002", model: "claude-sonnet-5-5", tokens: 2e6, usage: { input: 1e6, cacheWrite: 1e6 } }; // 2 + 4 (no split: 1h)

test("cost totals add up", (t) => {
  const c = collect(costProject(t, [OPUS, OPUS2, SON])).cost;
  close(c.total, 25.2);
  close(sum(c.byTask), c.total);
  close(sum(c.byModel), c.total);
  close(c.byKind.orchestrator.usd + c.byKind.subagent.usd, c.total);
  close(sum(c.byTokenKind, (v) => v), c.total);
  assert.deepEqual(Object.keys(c.byKind), ["orchestrator", "subagent"]);
  assert.equal(c.asOf, "2026-11-27");
  assert.equal(c.haiku55, false);
});

test("unknown model is unpriced, not free", (t) => {
  const c = collect(costProject(t, [OPUS, { task: "001", model: "claude-mystery-9", tokens: 777, usage: { input: 777 } }])).cost;
  assert.equal(c.unpriced.records, 1);
  assert.deepEqual(c.unpriced.models, ["claude-mystery-9"]);
  assert.equal(c.unpriced.tokens, 777);
  close(c.total, 14);
  assert.equal(c.byModel["claude-mystery-9"].usd, 0);
  assert.equal(c.byModel["claude-mystery-9"].unpricedTokens, 777);
});

test("partial pricing is marked", (t) => {
  const d = collect(costProject(t, [OPUS, { task: "001", model: "claude-opus-5-5", tokens: 40 }]));
  assert.ok(d.cost.byTask["001"].usd > 0);
  assert.equal(d.cost.byTask["001"].unpricedTokens, 40, "a record without usage is unpriced");
  assert.match(TPL(), /unpricedTokens>0\?[^\n]*\+\?/);
});

test("old records count as assumed 1h", (t) => {
  const c = collect(costProject(t, [{ task: "001", model: "claude-opus-5-5", tokens: 1000, usage: { cacheWrite: 1000 } }])).cost;
  assert.equal(c.assumed1h, 1000);
});

test("garbage usage fields cost as zero, never NaN", (t) => {
  const c = collect(costProject(t, [{ task: "001", model: "claude-opus-5-5", tokens: 5, usage: { input: "x", cacheWrite5m: -5, cacheRead: null } }])).cost;
  assert.ok(Number.isFinite(c.total));
  assert.ok(Object.values(c.byTokenKind).every(Number.isFinite));
});

test("config prices override", (t) => {
  const one = { input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 };
  const c = collect(costProject(t, [OPUS], { prices: { "opus-5-5": one, "sonnet-5-5": { input: 1 } } })).cost;
  assert.deepEqual(c.overridden, ["opus-5-5"]);
  close(c.total, 1.5);
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /sonnet-5-5/);
});

test("haiku 5.5 record sets the note flag", (t) => {
  assert.equal(collect(costProject(t, [{ task: "001", model: "claude-haiku-5-5", tokens: 1, usage: { input: 1 } }])).cost.haiku55, true);
});

test("money format", () => {
  const m = TPL().match(/const fmtUsd=[^\n]*;/);
  assert.ok(m, "fmtUsd is defined on one line");
  const fmtUsd = new Function(`${m[0]};return fmtUsd;`)();
  assert.equal(fmtUsd(0.001), "<$0.01");
  assert.equal(fmtUsd(0), "$0.00");
  assert.equal(fmtUsd(12.3), "$12.30");
  assert.equal(fmtUsd(0.005), "$0.01");
  assert.equal(fmtUsd(1234), "$1.2k");
});

test("page without cost data does not throw", () => {
  const script = TPL().match(/<script>([\s\S]*)<\/script>/)[1];
  const uses = script.match(/(?<![A-Za-z.])(?:DATA|d)\.cost\b(?!\?)/g) ?? [];
  assert.ok(script.includes("cost=DATA.cost"), "one guarded read of DATA.cost");
  assert.equal(uses.length, 1, `DATA.cost read once, then through a guard: ${uses}`);
  assert.match(script, /cost\?[^\n]*:""|!cost/, "cost elements are hidden when absent");
  assert.match(script, /id="costBox"|#costBox/);
});

test("cost text renders as text", (t) => {
  const root = costProject(t, [{ task: "001", model: "EVIL" + EVIL, tokens: 5, usage: { input: 5 } }]);
  const html = render(collect(root), { live: true });
  assert.ok(!html.includes("</script><img"));
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  assert.match(TPL(), /esc\(m\)/, "model names go through esc()");
});

test("a __proto__ task or model stays a plain key in cost", (t) => {
  const c = collect(costProject(t, [{ task: "__proto__", model: "__proto__", tokens: 7, usage: { input: 7 } }])).cost;
  assert.equal(Object.getPrototypeOf(c.byTask), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(c.byTask, "__proto__").value.unpricedTokens, 7);
  assert.equal(Object.getOwnPropertyDescriptor(c.byModel, "__proto__").value.unpricedTokens, 7);
});
