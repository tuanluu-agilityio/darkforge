import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readState, writeState } from "../scripts/lib/state.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = path.join(repo, "hooks", "ask-watch.mjs");
const ledger = path.join(repo, "hooks", "ledger.mjs");

const tmpProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge ask "));
  fs.mkdirSync(path.join(dir, ".darkforge"));
  fs.writeFileSync(path.join(dir, ".darkforge", "config.json"), JSON.stringify({ schemaVersion: 1 }));
  return dir;
};
const run = (hook, cwd, input) =>
  spawnSync(process.execPath, [hook], { cwd, input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8" });
const ask = (root, event = "PreToolUse", questions = [{ question: "Merge now?" }]) => ({
  hook_event_name: event, tool_name: "AskUserQuestion", cwd: root, tool_input: { questions },
});

test("PreToolUse AskUserQuestion records the questions", () => {
  const root = tmpProject();
  const r = run(watch, root, ask(root, "PreToolUse", [{ question: "Merge now?" }, { question: "x".repeat(400) }]));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  const w = readState(root).waiting;
  assert.deepEqual(w.questions, ["Merge now?", "x".repeat(300)]);
  assert.equal(new Date(w.since).toISOString(), w.since);
});

test("PostToolUse clears it", () => {
  const root = tmpProject();
  run(watch, root, ask(root));
  assert.ok(readState(root).waiting);
  const r = run(watch, root, ask(root, "PostToolUse"));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(readState(root).waiting, undefined);
});

test("Stop clears it", () => {
  const root = tmpProject();
  run(watch, root, ask(root));
  const r = run(ledger, root, { hook_event_name: "Stop", cwd: root, transcript_path: path.join(root, "missing.jsonl") });
  assert.equal(r.status, 0);
  assert.equal(readState(root).waiting, undefined);
});

test("malformed input and other tools leave state alone", () => {
  const root = tmpProject();
  writeState(root, { waiting: { since: "2026-01-01T00:00:00.000Z", questions: ["keep"] } });
  const before = fs.readFileSync(path.join(root, ".darkforge", "state.json"), "utf8");
  const inputs = [
    "not json",
    { hook_event_name: "PreToolUse", tool_name: "Bash", cwd: root, tool_input: { questions: [{ question: "q" }] } },
    ask(root, "PreToolUse", "nope"),
    ask(root, "PreToolUse", [{ question: 5 }, null]),
    ask(root, "SessionStart"),
  ];
  for (const input of inputs) {
    const r = run(watch, root, input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(fs.readFileSync(path.join(root, ".darkforge", "state.json"), "utf8"), before);
  }
});

test("non-darkforge directory writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkforge plain "));
  const r = run(watch, dir, ask(dir));
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(dir, ".darkforge")), false);
});

test("next-task asks with AskUserQuestion", () => {
  const text = fs.readFileSync(path.join(repo, "skills", "next-task", "SKILL.md"), "utf8");
  assert.ok((text.match(/AskUserQuestion/g) ?? []).length >= 3);
});

test("hooks.json registers ask-watch for AskUserQuestion on PreToolUse and PostToolUse", () => {
  const h = JSON.parse(fs.readFileSync(path.join(repo, "hooks", "hooks.json"), "utf8"));
  for (const ev of ["PreToolUse", "PostToolUse"]) {
    const e = (h.hooks[ev] ?? []).find((x) => x.matcher === "AskUserQuestion");
    assert.ok(e, ev);
    assert.deepEqual(e.hooks[0].args, ["${CLAUDE_PLUGIN_ROOT}/hooks/ask-watch.mjs"]);
    assert.equal(e.hooks[0].timeout, 10);
  }
});
