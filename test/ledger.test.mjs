import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readState, writeState, readOffset, writeOffset } from "../scripts/lib/state.mjs";
import { sumUsage, appendRecord, readRecords, report } from "../scripts/lib/ledger.mjs";
import { main } from "../scripts/darkforge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const hook = path.join(repo, "hooks", "ledger.mjs");
const transcripts = path.join(here, "fixtures", "transcripts");
const inputs = path.join(here, "fixtures", "hook-inputs");

const mainText = () => fs.readFileSync(path.join(transcripts, "main.jsonl"), "utf8");
const tmpProject = (withConfig = true) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge ledger "));
  if (withConfig) {
    fs.mkdirSync(path.join(dir, ".darkforge"));
    fs.writeFileSync(path.join(dir, ".darkforge", "config.json"), JSON.stringify({ schemaVersion: 1 }));
  }
  return dir;
};
const ledgerFile = (root) => path.join(root, ".darkforge", "ledger.jsonl");
const records = (root) =>
  fs.existsSync(ledgerFile(root))
    ? fs.readFileSync(ledgerFile(root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

function runHook(cwd, input) {
  return spawnSync(process.execPath, [hook], { cwd, input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8" });
}
function hookInput(name, overrides) {
  return Object.assign(JSON.parse(fs.readFileSync(path.join(inputs, name), "utf8")), overrides);
}
const capture = (cwd) => {
  const out = { stdout: "", stderr: "" };
  return { out, ctx: { cwd, stdout: (s) => (out.stdout += s), stderr: (s) => (out.stderr += s) } };
};

// ---- sumUsage ----

test("sumUsage totals the fixture and ignores the malformed line", () => {
  const r = sumUsage(mainText(), 0);
  assert.equal(r.tokens, 1665);
  assert.equal(r.lines, 4);
  assert.equal(r.model, "claude-opus-4-1");
});

test("sumUsage counts only lines after fromLine", () => {
  const r = sumUsage(mainText(), 2);
  assert.equal(r.tokens, 550);
  assert.equal(r.lines, 4);
});

test("sumUsage ignores malformed and non-object lines", () => {
  const text = '42\nnull\n{"message":{"usage":"x"}}\n{oops\n{"message":{"usage":{"input_tokens":7,"output_tokens":"9"}}}\n';
  assert.equal(sumUsage(text, 0).tokens, 7);
  assert.equal(sumUsage(text, 0).model, null);
});

test("sumUsage counts a message id once (last line wins)", () => {
  const line = (out) => JSON.stringify({ message: { id: "m1", model: "claude-x", usage: { input_tokens: 10, output_tokens: out } } });
  const r = sumUsage(`${line(1)}\n${line(4)}\n`, 0);
  assert.equal(r.tokens, 14);
});

test("sumUsage does not count an unterminated partial last line", () => {
  const r = sumUsage('{"message":{"usage":{"input_tokens":3}}}\n{"message":{"usa', 0);
  assert.equal(r.tokens, 3);
  assert.equal(r.lines, 1);
});

test("sumUsage skips lines of the previous window's last message and returns lastId", () => {
  const line = (id, out) => JSON.stringify({ message: { id, usage: { input_tokens: 1000, output_tokens: out } } }) + "\n";
  const first = sumUsage(line("m1", 5), 0);
  assert.equal(first.tokens, 1005);
  assert.equal(first.lastId, "m1");
  const second = sumUsage(line("m1", 5) + line("m1", 5) + line("m2", 7), 1, first.lastId);
  assert.equal(second.tokens, 1007);
  assert.equal(second.lastId, "m2");
  assert.equal(sumUsage("", 0, "m9").lastId, "m9");
});

test("sumUsage skips sidechain lines and reports the usage breakdown", () => {
  const text =
    JSON.stringify({ isSidechain: true, message: { usage: { input_tokens: 100 } } }) +
    "\n" +
    JSON.stringify({
      message: { usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 } },
    }) +
    "\n";
  const r = sumUsage(text, 0);
  assert.equal(r.tokens, 10);
  assert.deepEqual(r.usage, { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 });
});

test("sumUsage skips the <synthetic> model", () => {
  const r = sumUsage(fs.readFileSync(path.join(transcripts, "subagent.jsonl"), "utf8"), 0);
  assert.equal(r.tokens, 500);
  assert.equal(r.model, "claude-sonnet-4-6");
});

// ---- state ----

test("readState returns defaults for a missing or corrupt file", () => {
  const root = tmpProject(false);
  assert.deepEqual(readState(root), { task: null, phase: null });
  fs.mkdirSync(path.join(root, ".darkforge"));
  fs.writeFileSync(path.join(root, ".darkforge", "state.json"), "{nope");
  assert.deepEqual(readState(root), { task: null, phase: null });
});

test("writeState creates .darkforge, merges, and drops a legacy offsets key", () => {
  const root = tmpProject(false);
  writeState(root, { task: "006-ledger" });
  writeState(root, { phase: "implement" });
  assert.deepEqual(readState(root), { task: "006-ledger", phase: "implement" });
  const file = path.join(root, ".darkforge", "state.json");
  fs.writeFileSync(file, JSON.stringify({ task: "T", phase: "fix", offsets: { a: 1 } }));
  assert.deepEqual(readState(root), { task: "T", phase: "fix" });
  writeState(root, { phase: "review" });
  assert.equal("offsets" in JSON.parse(fs.readFileSync(file, "utf8")), false);
});

test("offsets are kept per transcript in separate files", () => {
  const root = tmpProject(false);
  assert.deepEqual(readOffset(root, "/a b.jsonl"), { line: 0, lastId: null });
  writeOffset(root, "/a b.jsonl", { line: 3, lastId: "m1" });
  writeOffset(root, "/c.jsonl", { line: 1, lastId: null });
  assert.deepEqual(readOffset(root, "/a b.jsonl"), { line: 3, lastId: "m1" });
  assert.deepEqual(readOffset(root, "/c.jsonl"), { line: 1, lastId: null });
  assert.equal(fs.readdirSync(path.join(root, ".darkforge", "offsets")).length, 2);
});

// ---- report ----

test("report groups by task, model and kind, totals match", () => {
  const root = tmpProject();
  const at = "2026-11-23T00:00:00.000Z";
  appendRecord(root, { at, task: "T1", phase: "implement", kind: "subagent", agent: "builder", model: "sonnet", tokens: 100, usage: { input: 10, output: 20, cacheWrite: 30, cacheRead: 40 } });
  appendRecord(root, { at, task: "T1", phase: "review", kind: "subagent", agent: "reviewer", model: "opus", tokens: 40 });
  appendRecord(root, { at, task: "T1", phase: "fix", kind: "subagent", agent: "builder", model: "sonnet", tokens: 10 });
  appendRecord(root, { at, task: "T1", phase: "orchestrator", kind: "orchestrator", agent: null, model: "opus", tokens: 5 });
  appendRecord(root, { at, task: null, phase: null, kind: "subagent", agent: null, model: null, tokens: 7 });
  assert.equal(readRecords(root).length, 5);
  const text = report(root);
  assert.match(text, /^T1\s+100\s+40\s+10\s+5\s+155$/m);
  assert.match(text, /^\(no task\)\s+0\s+0\s+0\s+0\s+7$/m);
  assert.match(text, /^sonnet\s+110$/m);
  assert.match(text, /^opus\s+45$/m);
  assert.match(text, /^\(unknown\)\s+7$/m);
  assert.match(text, /^orchestrator\s+5$/m);
  assert.match(text, /^subagents\s+157$/m);
  assert.match(text, /^total\s+162$/m);
  assert.match(text, /^total breakdown: input 10, output 20, cache write 30, cache read 40$/m);
});

test("report on an empty ledger says so", () => {
  assert.match(report(tmpProject()), /no ledger records/);
});

// ---- hook process ----

test("no config: hook exits 0 silently and writes nothing", () => {
  const dir = tmpProject(false);
  const r = runHook(dir, hookInput("stop.json", { cwd: dir, transcript_path: path.join(transcripts, "main.jsonl") }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
  assert.equal(fs.existsSync(path.join(dir, ".darkforge")), false);
});

test("malformed stdin: hook exits 0 silently", () => {
  const dir = tmpProject();
  const r = runHook(dir, "not json");
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  assert.deepEqual(records(dir), []);
});

test("invalid config: one darkforge: warning line, no record", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, ".darkforge", "config.json"), JSON.stringify({ schemaVersion: 1, git: "x" }));
  const r = runHook(dir, hookInput("stop.json", { cwd: dir, transcript_path: path.join(transcripts, "main.jsonl") }));
  assert.equal(r.status, 0);
  assert.match(r.stderr, /^darkforge: [^\n]*\n$/);
  assert.deepEqual(records(dir), []);
});

test("SubagentStop records the subagent transcript with task and phase from state", () => {
  const dir = tmpProject();
  writeState(dir, { task: "T1", phase: "implement" });
  const r = runHook(
    dir,
    hookInput("subagent-stop.json", {
      cwd: dir,
      transcript_path: path.join(transcripts, "main.jsonl"),
      agent_transcript_path: path.join(transcripts, "subagent.jsonl"),
    }),
  );
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  const recs = records(dir);
  assert.equal(recs.length, 1);
  const { at, ...rest } = recs[0];
  assert.ok(!Number.isNaN(Date.parse(at)));
  assert.deepEqual(rest, {
    task: "T1",
    phase: "implement",
    kind: "subagent",
    agent: "darkforge:builder",
    model: "claude-sonnet-4-6",
    tokens: 500,
    usage: { input: 150, output: 100, cacheWrite: 50, cacheRead: 200 },
  });
});

test("resumed subagent: second SubagentStop records only new lines; transcripts keep separate offsets", () => {
  const dir = tmpProject();
  const a = path.join(dir, "agent a.jsonl");
  const b = path.join(dir, "agent b.jsonl");
  const line = (id, n) => JSON.stringify({ message: { id, model: "claude-sonnet-4-6", usage: { input_tokens: n } } }) + "\n";
  fs.writeFileSync(a, line("a1", 10));
  fs.writeFileSync(b, line("b1", 20));
  const stop = (p) => runHook(dir, hookInput("subagent-stop.json", { cwd: dir, agent_transcript_path: p }));
  stop(a);
  stop(b);
  fs.appendFileSync(a, line("a1", 10) + line("a2", 3));
  stop(a);
  stop(b);
  assert.deepEqual(
    records(dir).map((r) => r.tokens),
    [10, 20, 3],
  );
  assert.deepEqual(readOffset(dir, a), { line: 3, lastId: "a2" });
  assert.deepEqual(readOffset(dir, b), { line: 1, lastId: "b1" });
});

test("SubagentStop with empty agent_type and no state records nulls", () => {
  const dir = tmpProject();
  runHook(dir, hookInput("subagent-stop.json", { cwd: dir, agent_type: "", agent_transcript_path: path.join(transcripts, "subagent.jsonl") }));
  const [rec] = records(dir);
  assert.equal(rec.task, null);
  assert.equal(rec.phase, null);
  assert.equal(rec.agent, null);
});

test("Stop counts only lines after the stored offset; restarts when the transcript shrinks", () => {
  const dir = tmpProject();
  writeState(dir, { task: "T2", phase: "review" });
  const t = path.join(dir, "main transcript.jsonl");
  fs.writeFileSync(t, mainText());
  const input = hookInput("stop.json", { cwd: dir, transcript_path: t });

  assert.equal(runHook(dir, input).status, 0);
  let recs = records(dir);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, "orchestrator");
  assert.equal(recs[0].phase, "orchestrator");
  assert.equal(recs[0].task, "T2");
  assert.equal(recs[0].agent, null);
  assert.equal(recs[0].tokens, 1665);
  assert.equal(readOffset(dir, t).line, 4);
  assert.equal(readState(dir).phase, "review");

  // No new lines: no record.
  runHook(dir, input);
  assert.equal(records(dir).length, 1);

  fs.appendFileSync(t, JSON.stringify({ message: { id: "m9", model: "claude-haiku-4-5", usage: { input_tokens: 1, output_tokens: 2 } } }) + "\n");
  runHook(dir, input);
  recs = records(dir);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].tokens, 3);
  assert.equal(recs[1].model, "claude-haiku-4-5");
  assert.equal(readOffset(dir, t).line, 5);

  fs.writeFileSync(t, JSON.stringify({ message: { usage: { input_tokens: 8 } } }) + "\n");
  runHook(dir, input);
  recs = records(dir);
  assert.equal(recs.length, 3);
  assert.equal(recs[2].tokens, 8);
  assert.equal(readOffset(dir, t).line, 1);
});

test("a message split across two Stops is counted once", () => {
  const dir = tmpProject();
  const t = path.join(dir, "main.jsonl");
  const block = JSON.stringify({ message: { id: "m1", model: "claude-opus-4-1", usage: { input_tokens: 1000, output_tokens: 5 } } }) + "\n";
  const input = hookInput("stop.json", { cwd: dir, transcript_path: t });
  fs.writeFileSync(t, block);
  runHook(dir, input);
  fs.appendFileSync(t, block);
  runHook(dir, input);
  assert.deepEqual(
    records(dir).map((r) => r.tokens),
    [1005],
  );
  assert.deepEqual(readOffset(dir, t), { line: 2, lastId: "m1" });
});

test("Stop with a missing transcript is silent", () => {
  const dir = tmpProject();
  const r = runHook(dir, hookInput("stop.json", { cwd: dir, transcript_path: path.join(dir, "nope.jsonl") }));
  assert.equal(r.status, 0);
  assert.deepEqual(records(dir), []);
});

// ---- CLI ----

test("ledger phase sets the phase; unknown phase exits 1", async () => {
  const dir = tmpProject();
  let c = capture(dir);
  assert.equal(await main(["ledger", "phase", "fix"], c.ctx), 0);
  assert.equal(readState(dir).phase, "fix");
  c = capture(dir);
  assert.equal(await main(["ledger", "phase", "lunch"], c.ctx), 1);
  assert.match(c.out.stderr, /implement\|review\|fix\|orchestrator/);
  assert.equal(readState(dir).phase, "fix");
});

test("ledger report prints the report; no project exits 1", async () => {
  const dir = tmpProject();
  appendRecord(dir, { at: "x", task: "T1", phase: "fix", kind: "subagent", agent: null, model: "sonnet", tokens: 9 });
  let c = capture(dir);
  assert.equal(await main(["ledger", "report"], c.ctx), 0);
  assert.match(c.out.stdout, /^total\s+9$/m);
  c = capture(tmpProject(false));
  assert.equal(await main(["ledger", "report"], c.ctx), 1);
  assert.match(c.out.stderr, /darkforge/);
  c = capture(dir);
  assert.equal(await main(["ledger"], c.ctx), 1);
  assert.match(c.out.stderr, /usage/);
});
