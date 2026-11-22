// SubagentStop / Stop hook: append token-usage records to .darkforge/ledger.jsonl (best effort).
// Silent (exit 0, no output) outside a darkforge project, for other events, and on malformed input.
import { findProjectRoot, loadConfig } from "../scripts/lib/config.mjs";
import { recordStop, recordSubagentStop } from "../scripts/lib/ledger.mjs";

const oneLine = (s) => String(s).replace(/\s*[\r\n]+\s*/g, " ").trim();

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
  const event = input.hook_event_name;
  if (event !== "SubagentStop" && event !== "Stop") return;

  const start = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
  const root = findProjectRoot(start);
  if (!root) return;

  const loaded = loadConfig(root);
  if (!loaded.ok) {
    process.stderr.write(`darkforge: token ledger disabled, ${oneLine(loaded.error)}\n`);
    return;
  }

  if (event === "SubagentStop") recordSubagentStop(root, input);
  else recordStop(root, input);
}

try {
  await main();
} catch (e) {
  try {
    process.stderr.write(`darkforge: token ledger internal error, nothing recorded: ${oneLine(e?.message ?? e)}\n`);
  } catch {
    // nothing left to report to
  }
}
process.exitCode = 0;
