// task begin / task finish: the mechanical steps around one task folded into two commands, so the
// main session spends its model calls on judgment (dispatch, review, memory bank) only.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { run } from "./exec.mjs";
import { gateFresh, runGate } from "./gate.mjs";
import { decide } from "./guard.mjs";
import { readRecords } from "./ledger.mjs";
import { lintMemory } from "./memory.mjs";
import { readState, writeState, PHASES } from "./state.mjs";
import { mergeTask, startTask } from "./task.mjs";

const ID_RE = /^[A-Za-z0-9]+$/;
const RISKS = ["low", "medium", "high"];
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const fail = (message) => ({ ok: false, message });
const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The one docs/tasks/<id>-<slug>.md file, or an error message. */
function findPackage(root, id) {
  const dir = path.join(root, "docs", "tasks");
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { error: `no docs/tasks/ directory; run /darkforge:plan-phase` };
  }
  const hits = names.filter((n) => n.startsWith(`${id}-`) && n.endsWith(".md"));
  if (hits.length !== 1) {
    return { error: hits.length ? `more than one package for task ${id}: ${hits.join(", ")}` : `no package docs/tasks/${id}-*.md` };
  }
  return { file: path.join(dir, hits[0]), slug: hits[0].slice(id.length + 1, -3) };
}

/**
 * Parse the package header line written by task-package-writing:
 * `Agent: <agent> · Model: <model> · Branch: task/<id>-<slug> · Reviewer: <agent>/<model> · Risk: <risk>`.
 */
export function parseHeader(text) {
  const line = text.split(/\r?\n/).slice(0, 12).find((l) => l.trim().startsWith("Agent:"));
  if (!line) return { error: "no header line starting with \"Agent:\" in the first lines of the package" };
  const fields = {};
  for (const part of line.split("·")) {
    const m = part.trim().match(/^([A-Za-z]+):\s*(.+)$/);
    if (m) fields[m[1].toLowerCase()] = m[2].trim();
  }
  const missing = ["agent", "model", "branch", "reviewer", "risk"].filter((k) => !fields[k]);
  if (missing.length) return { error: `header is missing: ${missing.join(", ")}` };
  const [revAgent, revModel, ...extra] = fields.reviewer.split("/").map((s) => s.trim());
  if (!revAgent || !revModel || extra.length) return { error: `header Reviewer must be <agent>/<model> (got "${fields.reviewer}")` };
  if (!NAME_RE.test(fields.agent) || !NAME_RE.test(revAgent)) return { error: "header agent names must be lowercase words" };
  if (!RISKS.includes(fields.risk)) return { error: `header Risk must be one of ${RISKS.join(", ")} (got "${fields.risk}")` };
  return {
    implementer: { agent: fields.agent, model: fields.model },
    reviewer: { agent: revAgent, model: revModel },
    branch: fields.branch,
    risk: fields.risk,
  };
}

/** Open questions under "## Waiting on owner" whose row names the task id. */
export function blockingQuestions(root, id) {
  const text = read(path.join(root, "memory-bank", "activeContext.md"));
  if (text === null) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## Waiting on owner");
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  const idRe = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(id)}([^A-Za-z0-9]|$)`);
  const out = [];
  for (const l of lines.slice(start + 1, end)) {
    const q = l.match(/\bQ-\d+\b/);
    if (!q) continue;
    // Drop every question id first, so "see Q-001" never reads as task 001.
    if (idRe.test(l.replace(/\bQ-\d+\b/g, ""))) out.push(q[0]);
  }
  return out;
}

const block = (id, h, base, extra = "") =>
  [
    `task ${id} ${extra || "started"} on ${h.branch} (risk ${h.risk})`,
    `implementer: darkforge:${h.implementer.agent} model ${h.implementer.model}`,
    `reviewer: darkforge:${h.reviewer.agent} model ${h.reviewer.model}`,
    `base: ${base}`,
  ].join("\n");

/** Read the package, check it can run, start (or resume) the task branch, print who does what. */
export function beginTask(root, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return fail(`invalid id "${id ?? ""}": use letters and digits only`);
  const loaded = loadConfig(root);
  if (!loaded.ok) return fail(loaded.error);
  const config = loaded.config;
  const pkg = findPackage(root, id);
  if (pkg.error) return fail(`refused: ${pkg.error}`);
  const rel = path.relative(root, pkg.file).split(path.sep).join("/");
  const h = parseHeader(fs.readFileSync(pkg.file, "utf8"));
  if (h.error) return fail(`refused: ${rel}: ${h.error}`);
  if (h.branch !== `task/${id}-${pkg.slug}`) {
    return fail(`refused: ${rel}: header Branch "${h.branch}" does not match the file name (expected task/${id}-${pkg.slug})`);
  }
  if (h.implementer.agent === h.reviewer.agent) return fail(`refused: ${rel}: implementer and reviewer are the same agent (${h.reviewer.agent})`);
  for (const who of [h.implementer, h.reviewer]) {
    const d = decide({ subagent_type: `darkforge:${who.agent}`, model: who.model }, config);
    if (!d.allow) return fail(`refused: ${rel}: ${d.reason}`);
  }
  const blocked = blockingQuestions(root, id);
  if (blocked.length) return fail(`refused: task ${id} is blocked by ${blocked.join(", ")} under "## Waiting on owner" in memory-bank/activeContext.md`);

  const base = config.git.remote ? `${config.git.remote}/${config.git.baseBranch}` : config.git.baseBranch;
  const current = run("git", ["branch", "--show-current"], { cwd: root }).stdout.trim();
  if (readState(root).task === id && current === h.branch) {
    writeState(root, { implementer: h.implementer, reviewer: h.reviewer });
    return { ok: true, message: block(id, h, base, "resumed") };
  }
  const s = startTask(root, id, pkg.slug);
  if (!s.ok) return s;
  writeState(root, { implementer: h.implementer, reviewer: h.reviewer, round: 0 });
  return { ok: true, message: block(id, h, base) };
}

/** Ledger totals for one task: { implement, review, fix, orchestrator, total }. */
export function taskTokens(root, id) {
  const row = { implement: 0, review: 0, fix: 0, orchestrator: 0, total: 0 };
  for (const r of readRecords(root)) {
    if (r.task !== id || !Number.isFinite(r.tokens)) continue;
    if (PHASES.includes(r.phase)) row[r.phase] += r.tokens;
    row.total += r.tokens;
  }
  return row;
}

/** Put the task's token total into its progress.md row when the Tokens (last) cell is "-", empty or an older number. */
export function fillTokens(root, id, total) {
  const file = path.join(root, "memory-bank", "progress.md");
  const text = read(file);
  if (text === null) return false;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let changed = false;
  const lines = text.split(/\r?\n/).map((l) => {
    const cells = l.split("|");
    if (cells.length < 4 || cells[1].trim() !== id) return l;
    const last = cells.length - 2; // the cell before the closing "|"
    const cell = cells[last].trim();
    if (cells.at(-1).trim() !== "" || !(cell === "-" || cell === "" || /^\d+$/.test(cell)) || cell === String(total)) return l;
    cells[last] = ` ${total} `;
    changed = true;
    return cells.join("|");
  });
  if (changed) fs.writeFileSync(file, lines.join(eol));
  return changed;
}

const git = (root, args) => run("git", args, { cwd: root });
const out = (r) => [r.stdout, r.stderr].map((s) => (s ?? "").trim()).filter(Boolean).join("\n");

/**
 * Close a task: token total into progress.md, commit memory-bank/, memory lint, gate, merge, ledger row.
 * Stops at the first failure with that step's output; a re-run continues where it stopped.
 */
export function finishTask(root, id, { title } = {}) {
  if (typeof id !== "string" || !ID_RE.test(id)) return fail(`invalid id "${id ?? ""}": use letters and digits only`);
  if (typeof title !== "string" || !title.trim()) return fail("a non-empty --title is required");
  // Only on this task's own branch while it is active: never commit memory-bank/ onto the base or another task.
  const branch = git(root, ["branch", "--show-current"]).stdout.trim();
  if (!branch.startsWith(`task/${id}-`) || branch.length === `task/${id}-`.length) {
    return fail(`refused: not on a task/${id}-* branch (current: ${branch || "detached HEAD"}); nothing was changed`);
  }
  if (readState(root).task !== id) return fail(`refused: task ${id} is not the active task (.darkforge/state.json); run task begin ${id} first`);
  const done = [];

  // The gate already passed on this exact commit (a re-run after a merge refusal or a merge queue):
  // change nothing and go straight to the merge, so the gated commit stays the one that merges.
  if (gateFresh(root)) return merge(root, id, title, ["gate: already passed on this commit"]);

  if (fillTokens(root, id, taskTokens(root, id).total)) done.push("tokens: progress.md row filled");
  const changes = git(root, ["status", "--porcelain", "--", "memory-bank"]);
  if (changes.code !== 0) return fail(`git status failed:\n${out(changes)}`);
  if (changes.stdout.trim()) {
    const add = git(root, ["add", "--", "memory-bank"]);
    if (add.code !== 0) return fail(`git add memory-bank failed:\n${out(add)}`);
    // Pathspec: commit memory-bank/ only, even if something else is staged.
    const commit = git(root, ["commit", "-q", "-m", `docs: task ${id} memory bank`, "--", "memory-bank"]);
    if (commit.code !== 0) return fail(`memory-bank commit failed:\n${out(commit)}`);
    done.push("memory bank: committed");
  }
  const lint = lintMemory(root);
  if (!lint.ok) return fail([...done, "memory lint failed (fix memory-bank/, then re-run task finish):", ...lint.problems].join("\n"));
  done.push("memory: ok");

  const gate = runGate(root);
  if (!gate.ok) return fail([...done, gate.output, "next: fix round (send these lines to the implementer), then re-run task finish"].join("\n"));
  done.push(gate.output);
  return merge(root, id, title, done);
}

function merge(root, id, title, done) {
  writeState(root, { phase: "orchestrator" });
  const merged = mergeTask(root, id, { title });
  if (!merged.ok) return fail([...done, merged.message].join("\n"));
  done.push(merged.message);
  const t = taskTokens(root, id);
  done.push(`tokens ${id}: implement ${t.implement} · review ${t.review} · fix ${t.fix} · orchestrator ${t.orchestrator} · total ${t.total} (this turn's orchestrator tokens are added when it ends)`);
  return { ok: true, message: done.join("\n") };
}
