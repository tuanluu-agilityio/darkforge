// PreToolUse(Agent) hook: deny Agent calls that break the project's model rules.
// Silent (exit 0, no output) outside a darkforge project, for other tools, and on malformed input.
import { findProjectRoot, loadConfig } from "../scripts/lib/config.mjs";
import { decide, dispatchPhase } from "../scripts/lib/guard.mjs";
import { readState, writeState } from "../scripts/lib/state.mjs";

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
  if (input.tool_name !== "Agent") return;

  const start = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : process.cwd();
  const root = findProjectRoot(start);
  if (!root) return;

  const loaded = loadConfig(root);
  if (!loaded.ok) {
    process.stderr.write(`darkforge: model-guard disabled, ${oneLine(loaded.error)}\n`);
    return;
  }

  const result = decide(input.tool_input, loaded.config);
  if (result.allow) {
    // Best effort: an allowed dispatch of a darkforge implementer or reviewer during a task starts that
    // ledger phase, so the skill need not run `ledger phase implement|review` itself. Never blocks the call.
    try {
      const phase = dispatchPhase(input.tool_input);
      if (phase && readState(root).task) writeState(root, { phase });
    } catch (e) {
      process.stderr.write(`darkforge: ledger phase not set, ${oneLine(e?.message ?? e)}
`);
    }
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: result.reason,
      },
    }) + "\n",
  );
}

try {
  await main();
} catch (e) {
  try {
    process.stderr.write(`darkforge: model-guard internal error, call allowed: ${oneLine(e?.message ?? e)}\n`);
  } catch {
    // nothing left to report to
  }
}
process.exitCode = 0;
