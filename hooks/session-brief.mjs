// SessionStart hook: add a three-line brief (project, current task, entry skills) to the session context.
// Silent (exit 0, no output) outside a darkforge project and on malformed input.
import { findProjectRoot, loadConfig } from "../scripts/lib/config.mjs";
import { readState } from "../scripts/lib/state.mjs";

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
  if (input.hook_event_name !== undefined && input.hook_event_name !== "SessionStart") return;

  const start = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
  const root = findProjectRoot(start);
  if (!root) return;

  const loaded = loadConfig(root);
  if (!loaded.ok) {
    process.stderr.write(`darkforge: session brief disabled, ${oneLine(loaded.error)}\n`);
    return;
  }

  const name = oneLine(loaded.config.project.name) || "(unnamed)";
  const task = readState(root).task;
  const brief = [
    `darkforge project: ${name}`,
    `current task: ${task ? oneLine(task) : "none"}`,
    "use /darkforge:status or /darkforge:next-task",
  ].join("\n");
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: brief } }) + "\n",
  );
}

try {
  await main();
} catch (e) {
  try {
    process.stderr.write(`darkforge: session brief internal error: ${oneLine(e?.message ?? e)}\n`);
  } catch {
    // nothing left to report to
  }
}
process.exitCode = 0;
