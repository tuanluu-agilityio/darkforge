// darkforge dashboard: a read-only, single-file HTML view of the project, built from the files darkforge
// already keeps (config, state, memory bank, phase plans, ledger). No server, no network, no repo writes.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findProjectRoot, loadConfig } from "./config.mjs";
import { blockingQuestions } from "./flow.mjs";
import { readRecords } from "./ledger.mjs";
import { PHASES, readState } from "./state.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  } catch {
    return null;
  }
};

/** Lines of the `## <heading>` section (exact heading), without the heading; [] when missing. */
export function section(text, heading) {
  if (text === null) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end);
}

/** Markdown table rows in `lines` as objects keyed by lowercase header text; the separator row is skipped. */
export function tableRows(lines) {
  const rows = lines.map((l) => l.trim()).filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (rows.length < 2) return [];
  const cells = (l) => l.slice(1, -1).split("|").map((c) => c.trim());
  const head = cells(rows[0]).map((h) => h.toLowerCase());
  return rows
    .slice(1)
    .filter((l) => !/^\|[\s:|-]+\|$/.test(l))
    .map((l) => Object.fromEntries(cells(l).map((c, i) => [head[i] ?? `c${i}`, c])));
}

const text = (lines) =>
  lines
    .filter((l) => !/^\s*<!--.*-->\s*$/.test(l))
    .join("\n")
    .trim();

function phasePlans(root) {
  const dir = path.join(root, "docs", "plans");
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => n.match(/^phase-(\d+)-(.+)\.md$/))
    .filter(Boolean)
    .map((m) => {
      const body = read(path.join(dir, m[0])) ?? "";
      const title = (body.split(/\r?\n/).find((l) => l.startsWith("# ")) ?? "").replace(/^# /, "").replace(/^Phase \d+:\s*/i, "");
      const tasks = tableRows(section(body, "## Tasks")).map((r) => ({
        id: r.task ?? "",
        title: r.title ?? "",
        deps: (r.depends ?? "")
          .split(/[,\s]+/)
          .filter((d) => d && !/^(none|-|—)$/i.test(d)),
        risk: (r.risk ?? "").toLowerCase(),
        implementer: r["implementer/model"] ?? "",
        reviewer: r["reviewer/model"] ?? "",
        acceptance: r.acceptance ?? "",
        tests: r.tests ?? "",
      }));
      return { n: Number(m[1]), slug: m[2], title: title || m[2], file: `docs/plans/${m[0]}`, tasks };
    })
    .sort((a, b) => a.n - b.n);
}

function ledgerSummary(root) {
  const recs = readRecords(root);
  const byTask = {};
  const byModel = {};
  const kinds = { orchestrator: 0, subagent: 0 };
  let total = 0;
  let cacheRead = 0;
  const sessions = new Map(); // session -> task ids, in order of first orchestrator record
  for (const r of recs) {
    const t = typeof r.task === "string" && r.task !== "" ? r.task : "(no task)";
    byTask[t] ??= { implement: 0, review: 0, fix: 0, orchestrator: 0, total: 0, session: null };
    if (PHASES.includes(r.phase)) byTask[t][r.phase] += r.tokens;
    byTask[t].total += r.tokens;
    const m = typeof r.model === "string" && r.model !== "" ? r.model : "(unknown)";
    byModel[m] = (byModel[m] ?? 0) + r.tokens;
    kinds[r.kind === "orchestrator" ? "orchestrator" : "subagent"] += r.tokens;
    total += r.tokens;
    if (Number.isFinite(r.usage?.cacheRead)) cacheRead += r.usage.cacheRead;
    if (r.kind === "orchestrator" && typeof r.session === "string" && t !== "(no task)") {
      byTask[t].session = r.session;
      if (!sessions.has(r.session)) sessions.set(r.session, []);
      if (!sessions.get(r.session).includes(t)) sessions.get(r.session).push(t);
    }
  }
  return {
    records: recs.length,
    byTask,
    byModel,
    kinds,
    total,
    cacheRead,
    sessions: [...sessions].map(([id, tasks]) => ({ id: id.slice(0, 8), tasks })),
  };
}

/** Everything the page shows, read from the project's files. Pure data: strings and numbers only. */
export function collect(root, now = new Date()) {
  const loaded = loadConfig(root);
  if (!loaded.ok) throw new Error(loaded.error);
  const config = loaded.config;
  const mb = (f) => read(path.join(root, "memory-bank", f));
  const active = mb("activeContext.md");
  const state = readState(root);

  const progress = {};
  for (const r of tableRows((mb("progress.md") ?? "").split(/\r?\n/))) {
    if (r.task) progress[r.task] = { status: (r.status ?? "").toLowerCase(), tokens: r.tokens ?? "", model: r.model ?? "" };
  }
  const plans = phasePlans(root);
  for (const p of plans) {
    for (const t of p.tasks) {
      const row = progress[t.id];
      const blocked = blockingQuestions(root, t.id);
      t.status =
        state.task === t.id ? "run" : row?.status === "done" ? "done" : row?.status?.includes("pending") ? "pending" : blocked.length ? "blocked" : "todo";
      t.blockedBy = blocked;
    }
    const reviewDone = Object.entries(progress).some(([id, r]) => new RegExp(`^P${p.n}R\\d*$`).test(id) && r.status === "done");
    const done = p.tasks.filter((t) => t.status === "done").length;
    p.status = p.tasks.length && done === p.tasks.length && reviewDone ? "done" : done || p.tasks.some((t) => t.status === "run") ? "active" : "planned";
    p.reviewed = reviewDone;
  }
  const current = plans.find((p) => p.status !== "done") ?? plans.at(-1) ?? null;

  const questions = tableRows(section(active, "## Waiting on owner"))
    .map((r) => ({ id: r.id ?? "", question: r.question ?? "", blocks: r.blocks ?? "" }))
    .filter((q) => /^Q-\d+$/.test(q.id));
  const decisions = tableRows((mb("decisions.md") ?? "").split(/\r?\n/))
    .filter((r) => r.id)
    .map((r) => ({ id: r.id, date: r.date ?? "", text: r.decision ?? "" }))
    .slice(-6)
    .reverse();
  const backlog = (mb("backlog.md") ?? "")
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*] /.test(l))
    .map((l) => l.replace(/^\s*[-*] /, "").trim())
    .slice(-8);
  let version = "";
  try {
    version = JSON.parse(read(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json")) ?? "{}").version ?? "";
  } catch {
    version = "";
  }

  return {
    project: config.project.name || path.basename(root),
    ownerLanguage: config.project.ownerLanguage === "vi" ? "vi" : "en",
    generatedAt: now.toISOString(),
    plugin: version,
    state: { task: state.task, phase: state.phase },
    where: text(section(active, "## Where we are")),
    next: text(section(active, "## Next")),
    questions,
    phases: plans,
    current: current ? current.n : null,
    ledger: ledgerSummary(root),
    decisions,
    backlog,
  };
}

/** The page: the template with the data embedded as JSON that cannot close the script element. */
export function render(data) {
  const template = fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "dashboard.html"), "utf8");
  // "<" is written as an escape, so no "</script>" in the data can end the element; U+2028/2029 likewise.
  const bs = String.fromCharCode(92); // a backslash, spelled out
  const json = JSON.stringify(data)
    .replaceAll("<", bs + "u003c")
    .replaceAll(String.fromCharCode(0x2028), bs + "u2028")
    .replaceAll(String.fromCharCode(0x2029), bs + "u2029");
  if (!template.includes("/*DARKFORGE_DATA*/null")) throw new Error("dashboard template has no data placeholder");
  return template.replace("/*DARKFORGE_DATA*/null", () => json);
}

/** Default output: the OS temp dir, one file per project, so the repository's working tree never changes. */
export function defaultOut(root) {
  const id = crypto.createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 8);
  return path.join(os.tmpdir(), `darkforge-dashboard-${id}.html`);
}

function openFile(file) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", file]] : process.platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  } catch {
    return false;
  }
}

const USAGE = "usage: darkforge dashboard [--out <file.html>] [--open]\n";

export async function dashboardCommand(args, ctx) {
  let out = null;
  let open = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--open") open = true;
    else if (args[i] === "--out" && args[i + 1]) out = args[++i];
    else {
      ctx.stderr(USAGE);
      return 1;
    }
  }
  const root = findProjectRoot(ctx.cwd);
  if (!root) {
    ctx.stderr("darkforge: no .darkforge/config.json found in this directory or its parents\n");
    return 1;
  }
  let html;
  try {
    html = render(collect(root));
  } catch (e) {
    ctx.stderr(`darkforge: ${e.message}\n`);
    return 1;
  }
  const file = path.resolve(ctx.cwd, out ?? defaultOut(root));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  ctx.stdout(`dashboard: ${file}\n`);
  if (open && !openFile(file)) ctx.stdout("could not open a browser; open the file above\n");
  return 0;
}
