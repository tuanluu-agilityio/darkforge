// PreToolUse / PostToolUse(AskUserQuestion) hook: record the questions waiting on the owner in
// .darkforge/state.json (`waiting`) so the live dashboard can show them; clear them once answered.
// Best effort: silent (exit 0, no stdout) outside a darkforge project, for other tools and on malformed input.
import { findProjectRoot } from "../scripts/lib/config.mjs";
import { writeState } from "../scripts/lib/state.mjs";

const oneLine = (s) => String(s).replace(/\s*[\r\n]+\s*/g, " ").trim();
const MAX_QUESTION = 300;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let input;
  try {
    input = JSON.parse((await readStdin()).replace(/^﻿/, ""));
  } catch {
    return;
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) return;
  if (input.tool_name !== "AskUserQuestion") return;
  const event = input.hook_event_name;
  if (event !== "PreToolUse" && event !== "PostToolUse") return;

  const start = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
  const root = findProjectRoot(start);
  if (!root) return;

  if (event === "PostToolUse") {
    writeState(root, { waiting: undefined });
    return;
  }
  const raw = input.tool_input?.questions;
  if (!Array.isArray(raw)) return;
  const questions = raw
    .map((q) => q?.question)
    .filter((q) => typeof q === "string")
    .map((q) => q.slice(0, MAX_QUESTION));
  if (questions.length === 0) return;
  writeState(root, { waiting: { since: new Date().toISOString(), questions } });
}

try {
  await main();
} catch (e) {
  try {
    process.stderr.write(`darkforge: ask-watch internal error, nothing recorded: ${oneLine(e?.message ?? e)}\n`);
  } catch {
    // nothing left to report to
  }
}
process.exitCode = 0;
