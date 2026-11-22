// Token ledger: transcript usage parsing, record append, report, and the `ledger` CLI command.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProjectRoot, loadConfig } from "./config.mjs";
import { PHASES, readState, writeState } from "./state.mjs";

const USAGE_KEYS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
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
 * `lines` is the number of complete lines (an unterminated last line that is not valid JSON
 * is still being written and is left for the next call). Lines sharing a `message.id` are one
 * API response logged per content block, so only the last of them counts. `model` is the
 * `message.model` of the last counted line that has one (ignoring "<synthetic>"), else null.
 */
export function sumUsage(jsonlText, fromLine = 0) {
  const parts = String(jsonlText).split("\n");
  const last = parts.pop();
  if (last.trim() !== "" && parseLine(last)) parts.push(last);
  const lines = parts.length;

  const byId = new Map();
  let anon = 0;
  let model = null;
  for (let i = Math.max(0, fromLine); i < lines; i++) {
    const msg = parseLine(parts[i])?.message;
    if (!isObj(msg)) continue;
    if (typeof msg.model === "string" && msg.model !== "" && msg.model !== "<synthetic>") model = msg.model;
    if (!isObj(msg.usage)) continue;
    let n = 0;
    for (const k of USAGE_KEYS) if (Number.isFinite(msg.usage[k]) && msg.usage[k] > 0) n += msg.usage[k];
    if (typeof msg.id === "string" && msg.id !== "") byId.set(msg.id, n);
    else anon += n;
  }
  let tokens = anon;
  for (const n of byId.values()) tokens += n;
  return { tokens, lines, model };
}

/** Append one record as one JSON line. Never rewrites the file (concurrent subagents append). */
export function appendRecord(root, { at, task, phase, kind, agent, model, tokens }) {
  fs.mkdirSync(path.join(root, ".darkforge"), { recursive: true });
  const rec = { at, task: task ?? null, phase: phase ?? null, kind, agent: agent ?? null, model: model ?? null, tokens };
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
  return all.map((r) => r.map((v, c) => (c === 0 ? String(v).padEnd(widths[c]) : String(v).padStart(widths[c]))).join("  ")).join("\n");
}

/** Plain-text report: per task by phase, per model, orchestrator vs subagents, grand total. */
export function report(root) {
  const recs = readRecords(root);
  if (recs.length === 0) return "no ledger records";

  const tasks = new Map();
  const models = new Map();
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

/** SubagentStop: record the whole subagent transcript. */
export function recordSubagentStop(root, input, now = new Date()) {
  const text = readTranscript(input.agent_transcript_path);
  if (text === null) return null;
  const { tokens, model } = sumUsage(text, 0);
  if (tokens === 0) return null;
  const state = readState(root);
  const agent = typeof input.agent_type === "string" && input.agent_type !== "" ? input.agent_type : null;
  const rec = { at: now.toISOString(), task: state.task, phase: state.phase, kind: "subagent", agent, model, tokens };
  appendRecord(root, rec);
  return rec;
}

/** Stop: record the main transcript lines added since the stored offset, then store the new offset. */
export function recordStop(root, input, now = new Date()) {
  const key = input.transcript_path;
  const text = readTranscript(key);
  if (text === null) return null;
  const state = readState(root);
  let r = sumUsage(text, state.offsets[key] ?? 0);
  if (r.lines < (state.offsets[key] ?? 0)) r = sumUsage(text, 0); // rotated or compacted
  writeState(root, { offsets: { [key]: r.lines } });
  if (r.tokens === 0) return null;
  const rec = { at: now.toISOString(), task: state.task, phase: "orchestrator", kind: "orchestrator", agent: null, model: r.model, tokens: r.tokens };
  appendRecord(root, rec);
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
