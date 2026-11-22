// Memory-bank lint: keeps activeContext.md short and current.
import fs from "node:fs";
import path from "node:path";
import { findProjectRoot } from "./config.mjs";
import { readState } from "./state.mjs";

const MAX_LINES = 60;
const HEADINGS = ["## Where we are", "## Next", "## Waiting on owner"];
const ACTIVE = "memory-bank/activeContext.md";
const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function lintMemory(root) {
  const problems = [];
  const mb = path.join(root, "memory-bank");
  const active = read(path.join(mb, "activeContext.md"));
  if (active === null) {
    problems.push(`${ACTIVE}: missing (rule 1)`);
  } else {
    const lines = active.replace(/\r?\n$/, "").split(/\r?\n/);
    if (lines.length > MAX_LINES) problems.push(`${ACTIVE}: ${lines.length} lines (max ${MAX_LINES})`);
    const trimmed = lines.map((l) => l.trimEnd());
    for (const h of HEADINGS) {
      if (!trimmed.includes(h)) problems.push(`${ACTIVE}: missing heading "${h}" (rule 2)`);
    }
    const decisions = read(path.join(mb, "decisions.md"));
    const start = trimmed.indexOf("## Waiting on owner");
    if (decisions !== null && start >= 0) {
      let end = trimmed.findIndex((l, i) => i > start && l.startsWith("## "));
      if (end < 0) end = trimmed.length;
      const ids = new Set(trimmed.slice(start + 1, end).join("\n").match(/\bQ-\d+\b/g) ?? []);
      for (const id of ids) {
        if (new RegExp(`\\b${escapeRe(id)}\\b`).test(decisions)) {
          problems.push(`${ACTIVE}: ${id} under "## Waiting on owner" is answered in memory-bank/decisions.md; remove it (rule 3)`);
        }
      }
    }
  }
  const { task } = readState(root);
  if (task) {
    const progress = read(path.join(mb, "progress.md"));
    if (progress === null) {
      problems.push(`memory-bank/progress.md: missing, but task ${task} is active (rule 4)`);
    } else {
      const prefix = `| ${task}`;
      const has = progress.split(/\r?\n/).some((l) => {
        const t = l.trimStart();
        return t.startsWith(prefix) && (t.length === prefix.length || /[ |]/.test(t[prefix.length]));
      });
      if (!has) problems.push(`memory-bank/progress.md: no row starting with "| ${task}" (rule 4)`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export async function memoryCommand(args, ctx) {
  if (args[0] !== "lint") {
    ctx.stderr("usage: darkforge memory lint\n");
    return 1;
  }
  const root = findProjectRoot(ctx.cwd);
  if (!root) {
    ctx.stderr("darkforge: no .darkforge/config.json found in this directory or its parents\n");
    return 1;
  }
  const r = lintMemory(root);
  ctx.stdout(r.ok ? "memory: ok\n" : r.problems.join("\n") + "\n");
  return r.ok ? 0 : 1;
}
