import fs from "node:fs";
import path from "node:path";
import { findProjectRoot, loadConfig } from "./config.mjs";
import { run, runShell } from "./exec.mjs";

const FAIL_RE = /FAIL|error|CHECK FAILED/i;
const NOT_CONFIGURED = "gate command not configured; run /darkforge:init";

function gateFile(root) {
  return path.join(root, ".darkforge", "gate.json");
}

function currentHead(root) {
  const r = run("git", ["rev-parse", "HEAD"], { cwd: root });
  const head = r.stdout.trim();
  return r.code === 0 && head ? head : null;
}

function lines(text) {
  return text.split(/\r?\n/).filter((l) => l.trim() !== "");
}

function quietFailure(stdout, stderr, marker) {
  const all = [...lines(stdout), ...lines(stderr)];
  const hits = all.filter((l) => FAIL_RE.test(l) || (marker && l.includes(marker)));
  const shown = hits.length ? hits : all.slice(-20);
  return shown.join("\n");
}

/** Run the project's gate command. Returns { ok, output, code }. Writes .darkforge/gate.json. */
export function runGate(root, opts = {}) {
  const loaded = loadConfig(root);
  if (!loaded.ok) return { ok: false, output: loaded.error, code: 1 };
  const { gate } = loaded.config;
  const command = process.platform === "win32" ? gate.command.windows : gate.command.unix;
  if (!command || !command.trim()) return { ok: false, output: NOT_CONFIGURED, code: 1 };

  const r = runShell(command, { cwd: root });
  const marker = gate.successMarker;
  const markerLine = lines(r.stdout).find((l) => l.includes(marker));
  const ok = r.code === 0 && markerLine !== undefined;

  let output;
  if (opts.full) {
    output = [r.stdout, r.stderr].filter(Boolean).join("\n").replace(/\n+$/, "");
    if (!ok) output += `${output ? "\n" : ""}gate: FAILED (exit ${r.code})`;
  } else if (ok) {
    output = markerLine;
  } else {
    const body = gate.quiet === false ? [r.stdout, r.stderr].join("\n").trim() : quietFailure(r.stdout, r.stderr, marker);
    const why = r.code === 0 ? `gate: FAILED (exit 0, marker "${marker}" not found)` : `gate: FAILED (exit ${r.code})`;
    output = body ? `${body}\n${why}` : why;
  }

  fs.mkdirSync(path.join(root, ".darkforge"), { recursive: true });
  fs.writeFileSync(gateFile(root), JSON.stringify({ head: currentHead(root), ok, at: new Date().toISOString() }, null, 2) + "\n");
  return { ok, output, code: r.code };
}

/** True when the last gate run passed on the current HEAD. */
export function gateFresh(root) {
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(gateFile(root), "utf8"));
  } catch {
    return false;
  }
  if (!rec || rec.ok !== true || !rec.head) return false;
  const head = currentHead(root);
  return head !== null && head === rec.head;
}

/** CLI handler: darkforge gate [--full] */
export async function gateCommand(args, ctx) {
  const root = findProjectRoot(ctx.cwd);
  if (!root) {
    ctx.stderr("error: no .darkforge/config.json found; run /darkforge:init\n");
    return 1;
  }
  const r = runGate(root, { full: args.includes("--full") });
  (r.ok ? ctx.stdout : ctx.stderr)(r.output + "\n");
  return r.ok ? 0 : 1;
}

