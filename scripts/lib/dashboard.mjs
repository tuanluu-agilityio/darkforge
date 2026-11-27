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
  // Maps: a task or model named "__proto__" is just a key, never the prototype.
  const byTask = new Map();
  const byModel = new Map();
  const kinds = { orchestrator: 0, subagent: 0 };
  let total = 0;
  let cacheRead = 0;
  const sessions = new Map(); // session -> task ids, in order of first orchestrator record
  for (const r of recs) {
    const t = typeof r.task === "string" && r.task !== "" ? r.task : "(no task)";
    if (!byTask.has(t)) byTask.set(t, { implement: 0, review: 0, fix: 0, orchestrator: 0, total: 0, session: null });
    const row = byTask.get(t);
    if (PHASES.includes(r.phase)) row[r.phase] += r.tokens;
    row.total += r.tokens;
    const m = typeof r.model === "string" && r.model !== "" ? r.model : "(unknown)";
    byModel.set(m, (byModel.get(m) ?? 0) + r.tokens);
    kinds[r.kind === "orchestrator" ? "orchestrator" : "subagent"] += r.tokens;
    total += r.tokens;
    if (Number.isFinite(r.usage?.cacheRead)) cacheRead += r.usage.cacheRead;
    if (r.kind === "orchestrator" && typeof r.session === "string" && t !== "(no task)") {
      row.session = r.session;
      if (!sessions.has(r.session)) sessions.set(r.session, []);
      if (!sessions.get(r.session).includes(t)) sessions.get(r.session).push(t);
    }
  }
  return {
    records: recs.length,
    // fromEntries defines own properties, so a "__proto__" key stays a plain key.
    byTask: Object.fromEntries(byTask),
    byModel: Object.fromEntries(byModel),
    kinds,
    total,
    cacheRead,
    sessions: [...sessions].map(([id, tasks]) => ({ id: id.slice(0, 8), tasks })),
  };
}

const str = (v) => (typeof v === "string" && v !== "" ? v : null);
const role = (v) => (v && typeof v === "object" && !Array.isArray(v) ? { agent: str(v.agent), model: str(v.model) } : null);

/** The running step from state.json; the file is untrusted, so every field is reduced to a string, integer or null. */
function runningStep(state) {
  const w = state.waiting;
  return {
    task: str(state.task),
    phase: str(state.phase),
    since: str(state.since),
    round: Number.isInteger(state.round) && state.round >= 0 ? state.round : 0,
    implementer: role(state.implementer),
    reviewer: role(state.reviewer),
    waiting:
      w && typeof w === "object" && !Array.isArray(w)
        ? { since: str(w.since), questions: Array.isArray(w.questions) ? w.questions.filter((q) => typeof q === "string" && q !== "") : [] }
        : null,
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

  const progress = new Map();
  for (const r of tableRows((mb("progress.md") ?? "").split(/\r?\n/))) {
    if (r.task) progress.set(r.task, { status: (r.status ?? "").toLowerCase(), tokens: r.tokens ?? "", model: r.model ?? "" });
  }
  const plans = phasePlans(root);
  for (const p of plans) {
    for (const t of p.tasks) {
      const row = progress.get(t.id);
      const blocked = blockingQuestions(root, t.id);
      t.status =
        state.task === t.id ? "run" : row?.status === "done" ? "done" : row?.status?.includes("pending") ? "pending" : blocked.length ? "blocked" : "todo";
      t.blockedBy = blocked;
    }
    const reviewDone = [...progress].some(([id, r]) => new RegExp(`^P${p.n}R\\d*$`).test(id) && r.status === "done");
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
    state: runningStep(state),
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

/** JSON for embedding in a script element or an SSE line: "<" and U+2028/2029 are written as escapes, so it stays one line and cannot close the element. */
export function embedJson(data) {
  const bs = String.fromCharCode(92); // a backslash, spelled out
  return JSON.stringify(data)
    .replaceAll("<", bs + "u003c")
    .replaceAll(String.fromCharCode(0x2028), bs + "u2028")
    .replaceAll(String.fromCharCode(0x2029), bs + "u2029");
}

const META_STATIC = "img-src data:\">";
const META_LIVE = "connect-src 'self'; img-src data:\">";

/** The page: the template with the data embedded as JSON that cannot close the script element. */
export function render(data, { live = false } = {}) {
  const template = fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "dashboard.html"), "utf8");
  const json = embedJson(data);
  if (!template.includes("/*DARKFORGE_DATA*/null")) throw new Error("dashboard template has no data placeholder");
  if (!template.includes("/*DARKFORGE_LIVE*/false")) throw new Error("dashboard template has no live placeholder");
  // The flag first: the data is project text and could itself contain the flag's placeholder.
  let page = template.replace("/*DARKFORGE_LIVE*/false", live ? "true" : "false");
  if (live) {
    // The static page's meta CSP says connect-src none (file:// stays offline); the live page must also be allowed to open its event stream.
    if (!page.includes(META_STATIC)) throw new Error("dashboard template has no meta CSP to relax");
    page = page.replace(META_STATIC, () => META_LIVE);
  }
  return page.replace("/*DARKFORGE_DATA*/null", () => json);
}

/**
 * Default output: a per-user directory in the OS temp dir (0700), one file per project, so the working
 * tree never changes and, on a shared /tmp, no other user can read the page or plant a file in its place.
 */
export function defaultOut(root) {
  const id = crypto.createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 8);
  let user = "";
  try {
    user = typeof process.getuid === "function" ? String(process.getuid()) : os.userInfo().username;
  } catch {
    user = "user";
  }
  const safe = user.replace(/[^A-Za-z0-9_.-]/g, "_") || "user";
  return path.join(os.tmpdir(), `darkforge-${safe}`, `dashboard-${id}.html`);
}

/** Create the private output directory, or refuse one that is a symlink or belongs to someone else. */
function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`${dir} is not a plain directory; refusing to write the dashboard there`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
    throw new Error(`${dir} belongs to another user; refusing to write the dashboard there (use --out)`);
  }
}

const escHtml = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * --open for the live page: the URL holds a secret token and process arguments are readable by other local users,
 * so the browser is given a 0600 file in the private per-user directory that only redirects to the URL.
 */
export function writeLiveLauncher(root, url) {
  const stat = defaultOut(root);
  const dir = path.dirname(stat);
  privateDir(dir);
  const file = stat.replace(/.html$/, "-live.html");
  const u = escHtml(url);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><meta http-equiv="refresh" content="0;url=${u}"><title>darkforge dashboard</title></head>
<body><p><a href="${u}">Open the live dashboard</a></p></body></html>
`;
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, html, { mode: 0o600 });
  return file;
}

/** Open the page in the default browser. No shell: the path is one argument (no &, | or %VAR% on Windows). */
export function openFile(file, ctx) {
  const [cmd, args] =
    process.platform === "win32" ? ["explorer.exe", [file]] : process.platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
  const say = () => ctx.stdout("could not open a browser; open the file above\n");
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", say); // a missing opener (no xdg-open) is reported here, not thrown
    child.unref();
  } catch {
    say();
  }
}

const USAGE = "usage: darkforge dashboard [--out <file.html>] [--open] | darkforge dashboard --watch [--open] [--port <n>]\n";

export async function dashboardCommand(args, ctx) {
  let out = null;
  let open = false;
  let watch = false;
  let port = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--open") open = true;
    else if (args[i] === "--watch") watch = true;
    else if (args[i] === "--out" && args[i + 1]) out = args[++i];
    else if (args[i] === "--port" && /^\d{1,5}$/.test(args[i + 1] ?? "") && Number(args[i + 1]) <= 65535) port = Number(args[++i]);
    else {
      ctx.stderr(USAGE);
      return 1;
    }
  }
  if ((watch && out !== null) || (port !== null && !watch)) {
    ctx.stderr(USAGE);
    return 1;
  }
  const root = findProjectRoot(ctx.cwd);
  if (!root) {
    ctx.stderr("darkforge: no .darkforge/config.json found in this directory or its parents\n");
    return 1;
  }
  if (watch) return watchCommand(root, { open, port: port ?? 0 }, ctx);
  let html;
  try {
    html = render(collect(root));
  } catch (e) {
    ctx.stderr(`darkforge: ${e.message}\n`);
    return 1;
  }
  const file = path.resolve(ctx.cwd, out ?? defaultOut(root));
  try {
    if (out) fs.mkdirSync(path.dirname(file), { recursive: true });
    else privateDir(path.dirname(file));
    fs.writeFileSync(file, html, { mode: 0o600 });
  } catch (e) {
    ctx.stderr(`darkforge: ${e.message}\n`);
    return 1;
  }
  ctx.stdout(`dashboard: ${file}\n`);
  if (open) openFile(file, ctx);
  return 0;
}

async function watchCommand(root, { open, port }, ctx) {
  const { startLiveServer } = await import("./dashboard-server.mjs");
  let server;
  try {
    server = await startLiveServer(root, { port });
  } catch (e) {
    ctx.stderr(`darkforge: ${e.message}\n`);
    return 1;
  }
  ctx.stdout(`dashboard: ${server.url}\n`);
  let launcher = null;
  if (open) {
    try {
      launcher = writeLiveLauncher(root, server.url);
      (ctx.opener ?? openFile)(launcher, ctx);
    } catch (e) {
      ctx.stderr(`darkforge: could not prepare the browser launch, ${e.message}
`);
    }
  }
  await new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await server.close();
  if (launcher) fs.rmSync(launcher, { force: true });
  return 0;
}
