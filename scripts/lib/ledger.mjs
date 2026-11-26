// Token ledger: transcript usage parsing, record append, report, and the `ledger` CLI command.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProjectRoot, loadConfig } from "./config.mjs";
import { PHASES, readOffset, readState, writeOffset, writeState } from "./state.mjs";

const USAGE_KEYS = {
  input: "input_tokens",
  output: "output_tokens",
  cacheWrite: "cache_creation_input_tokens",
  cacheRead: "cache_read_input_tokens",
};
const zeroUsage = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ledgerFile = (root) => path.join(root, ".darkforge", "ledger.jsonl");

function parseLine(line) {
  try {
    const v = JSON.parse(line);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Sum token usage of the transcript lines after the first `fromLine` lines.
 * - `lines` is the number of complete lines (an unterminated last line that is not valid JSON
 *   is still being written and is left for the next call).
 * - Lines sharing a `message.id` are one API response logged per content block: only the last
 *   of them counts. Lines whose id is `skipId` (the last message of the previous window, already
 *   counted) are skipped. Sidechain lines count: a subagent transcript marks every line
 *   `isSidechain: true`, and a main transcript has none.
 * - `model` is the `message.model` of the last counted line that has one (ignoring
 *   "<synthetic>"), else null. `lastId` is the id of the last line that has one (`skipId` when
 *   the window has none).
 */
export function sumUsage(jsonlText, fromLine = 0, skipId = null) {
  const parts = String(jsonlText).split("\n");
  const last = parts.pop();
  if (last.trim() !== "" && parseLine(last)) parts.push(last);
  const lines = parts.length;

  const usage = zeroUsage();
  const add = (u) => {
    for (const k of Object.keys(usage)) usage[k] += u[k];
  };
  const byId = new Map();
  let model = null;
  let lastId = skipId;
  for (let i = Math.max(0, fromLine); i < lines; i++) {
    const entry = parseLine(parts[i]);
    if (!entry) continue;
    const msg = entry.message;
    if (!isObj(msg)) continue;
    const id = typeof msg.id === "string" && msg.id !== "" ? msg.id : null;
    if (id !== null) lastId = id;
    if (id !== null && id === skipId) continue;
    if (typeof msg.model === "string" && msg.model !== "" && msg.model !== "<synthetic>") model = msg.model;
    if (!isObj(msg.usage)) continue;
    const u = zeroUsage();
    for (const [k, key] of Object.entries(USAGE_KEYS)) {
      if (Number.isFinite(msg.usage[key]) && msg.usage[key] > 0) u[k] = msg.usage[key];
    }
    if (id !== null) byId.set(id, u);
    else add(u);
  }
  for (const u of byId.values()) add(u);
  const tokens = usage.input + usage.output + usage.cacheWrite + usage.cacheRead;
  return { tokens, lines, model, lastId, usage };
}

/** Append one record as one JSON line. Never rewrites the file (concurrent subagents append). */
export function appendRecord(root, { at, task, phase, kind, agent, model, tokens, usage, session }) {
  fs.mkdirSync(path.join(root, ".darkforge"), { recursive: true });
  const rec = { at, task: task ?? null, phase: phase ?? null, kind, agent: agent ?? null, model: model ?? null, tokens };
  if (isObj(usage)) rec.usage = usage;
  // The Claude Code session the tokens came from, so a report can tell tasks run in one session apart.
  if (typeof session === "string" && session !== "") rec.session = session;
  fs.appendFileSync(ledgerFile(root), JSON.stringify(rec) + "\n");
}

export function readRecords(root) {
  let text;
  try {
    text = fs.readFileSync(ledgerFile(root), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map(parseLine)
    .filter((r) => r && Number.isFinite(r.tokens));
}

function table(header, rows) {
  const all = header ? [header, ...rows] : rows;
  const widths = all[0].map((_, c) => Math.max(...all.map((r) => String(r[c]).length)));
  return all
    .map((r) => r.map((v, c) => (c === 0 ? String(v).padEnd(widths[c]) : String(v).padStart(widths[c]))).join("  "))
    .join("\n");
}

/** Plain-text report: per task by phase, per model, orchestrator vs subagents, grand total. */
export function report(root) {
  const recs = readRecords(root);
  if (recs.length === 0) return "no ledger records";

  const tasks = new Map();
  const models = new Map();
  const usage = zeroUsage();
  let orchestrator = 0;
  let subagents = 0;
  let total = 0;
  for (const r of recs) {
    const t = typeof r.task === "string" && r.task !== "" ? r.task : "(no task)";
    if (!tasks.has(t)) tasks.set(t, { implement: 0, review: 0, fix: 0, orchestrator: 0, total: 0 });
    const row = tasks.get(t);
    if (PHASES.includes(r.phase)) row[r.phase] += r.tokens;
    row.total += r.tokens;
    const m = typeof r.model === "string" && r.model !== "" ? r.model : "(unknown)";
    models.set(m, (models.get(m) ?? 0) + r.tokens);
    if (r.kind === "orchestrator") orchestrator += r.tokens;
    else subagents += r.tokens;
    total += r.tokens;
    if (isObj(r.usage)) for (const k of Object.keys(usage)) if (Number.isFinite(r.usage[k])) usage[k] += r.usage[k];
  }

  const taskRows = [...tasks].map(([t, v]) => [t, v.implement, v.review, v.fix, v.orchestrator, v.total]);
  const modelRows = [...models].sort((a, b) => b[1] - a[1]);
  return [
    "tokens by task",
    table(["task", "implement", "review", "fix", "orchestrator", "total"], taskRows),
    "",
    "tokens by model",
    table(null, modelRows),
    "",
    table(null, [
      ["orchestrator", orchestrator],
      ["subagents", subagents],
      ["total", total],
    ]),
    `total breakdown: input ${usage.input}, output ${usage.output}, cache write ${usage.cacheWrite}, cache read ${usage.cacheRead}`,
  ].join("\n");
}

function expandHome(p) {
  return p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p;
}

function readTranscript(p) {
  if (typeof p !== "string" || p === "") return null;
  try {
    return fs.readFileSync(expandHome(p), "utf8");
  } catch {
    return null;
  }
}

/** Count the transcript lines added since its stored offset, then store the new offset. */
function countNew(root, transcriptPath) {
  const text = readTranscript(transcriptPath);
  if (text === null) return null;
  const prev = readOffset(root, transcriptPath);
  let r = sumUsage(text, prev.line, prev.lastId);
  if (r.lines < prev.line) r = sumUsage(text, 0, null); // rotated or compacted
  writeOffset(root, transcriptPath, { line: r.lines, lastId: r.lastId });
  return r;
}

function record(root, now, fields, r, input) {
  const session = typeof input?.session_id === "string" && input.session_id !== "" ? input.session_id : undefined;
  const rec = { at: now.toISOString(), ...fields, model: r.model, tokens: r.tokens, usage: r.usage, ...(session ? { session } : {}) };
  appendRecord(root, rec);
  return rec;
}

/** SubagentStop: record the subagent transcript lines added since its last SubagentStop (resumes). */
export function recordSubagentStop(root, input, now = new Date()) {
  const r = countNew(root, input.agent_transcript_path);
  if (!r || r.tokens === 0) return null;
  const state = readState(root);
  const agent = typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : null;
  return record(root, now, { task: state.task, phase: state.phase, kind: "subagent", agent }, r, input);
}

/**
 * Stop: record the main transcript lines added since the last Stop. With no active task, the first
 * recorded Stop after a merge goes to the merged task (`lastTask`), which is then cleared.
 */
export function recordStop(root, input, now = new Date()) {
  const r = countNew(root, input.transcript_path);
  if (!r || r.tokens === 0) return null;
  const state = readState(root);
  const task = state.task ?? state.lastTask ?? null;
  const rec = record(root, now, { task, phase: "orchestrator", kind: "orchestrator", agent: null }, r, input);
  if (state.lastTask) writeState(root, { lastTask: null });
  return rec;
}

const USAGE = `usage: darkforge ledger phase <${PHASES.join("|")}>\n       darkforge ledger report\n`;

/** CLI: `ledger phase <name>`, `ledger report`. Fails closed (exit 1) without a valid project config. */
export async function ledgerCommand(args, ctx) {
  const [sub, name] = args;
  if (sub !== "phase" && sub !== "report") {
    ctx.stderr(USAGE);
    return 1;
  }
  if (sub === "phase" && !PHASES.includes(name)) {
    ctx.stderr(`darkforge: unknown phase ${JSON.stringify(name ?? "")}; use one of ${PHASES.join("|")}\n`);
    return 1;
  }
  const root = findProjectRoot(ctx.cwd);
  if (!root) {
    ctx.stderr("darkforge: no .darkforge/config.json found in this directory or its parents\n");
    return 1;
  }
  const loaded = loadConfig(root);
  if (!loaded.ok) {
    ctx.stderr(`darkforge: ${loaded.error}\n`);
    return 1;
  }
  if (sub === "phase") {
    writeState(root, { phase: name });
    ctx.stdout(`phase: ${name}\n`);
  } else {
    ctx.stdout(report(root) + "\n");
  }
  return 0;
}
