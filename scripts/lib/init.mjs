// Writes the project layer from interview answers; never overwrites user files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "./config.mjs";

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");
const BEGIN = "<!-- darkforge:begin -->";
const END = "<!-- darkforge:end -->";
const MEMORY_FILES = ["activeContext", "progress", "backlog", "decisions", "systemPatterns", "techContext", "projectbrief"];
const GITIGNORE_LINES = [".darkforge/state.json", ".darkforge/gate.json", ".darkforge/offsets/"];
const GATE_CMD = {
  windows: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check.ps1",
  unix: "bash scripts/check.sh",
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => structuredClone(v);

function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return clone(over);
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
  return out;
}

/** Replace {{name}} placeholders; an unknown placeholder is an error. */
export function render(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`unknown template placeholder {{${name}}}`);
    return String(values[name]);
  });
}

const template = (...p) => fs.readFileSync(path.join(TEMPLATES, ...p), "utf8");
const exists = (f) => fs.existsSync(f);
const today = () => new Date().toISOString().slice(0, 10);
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function questionsTable(qs) {
  if (!qs.length) return "None.";
  return ["| ID | Question | Blocks |", "|---|---|---|", ...qs.map((q) => `| ${cell(q.id)} | ${cell(q.question)} | ${cell(q.blocks)} |`)].join("\n");
}

function constraintsList(items) {
  if (!items.length) return "None yet.";
  return items.map((c, i) => `GC-${String(i + 1).padStart(2, "0")} ${c}`).join("\n");
}

function readConfigFile(root) {
  const file = path.join(root, ".darkforge", "config.json");
  if (!exists(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    return isObj(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeBlock(existing, block) {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const body = block.replace(/\r?\n$/, "").split(/\r?\n/).join(eol);
  const full = `${BEGIN}${eol}${body}${eol}${END}`;
  const b = existing.indexOf(BEGIN);
  const e = b >= 0 ? existing.indexOf(END, b + BEGIN.length) : -1;
  if (b >= 0 && e >= 0) return existing.slice(0, b) + full + existing.slice(e + END.length);
  const sep = existing === "" ? "" : existing.endsWith("\n") ? eol : eol + eol;
  return existing + sep + full + eol;
}

export function applyInit(root, answers = {}) {
  const written = [];
  const skipped = [];
  const rel = (f) => path.relative(root, f).split(path.sep).join("/");
  const put = (file, content, { overwrite = false } = {}) => {
    if (exists(file) && !overwrite) {
      skipped.push(rel(file));
      return false;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    written.push(rel(file));
    return true;
  };

  const base = readConfigFile(root) ?? clone(DEFAULT_CONFIG);
  const config = deepMerge(base, answers.config ?? {});
  const createGate = answers.createGate === true;
  if (createGate) {
    if (!config.gate.command.windows) config.gate.command.windows = GATE_CMD.windows;
    if (!config.gate.command.unix) config.gate.command.unix = GATE_CMD.unix;
  }
  put(path.join(root, ".darkforge", "config.json"), JSON.stringify(config, null, 2) + "\n", { overwrite: true });

  const banned = config.models.banned;
  const values = {
    projectName: config.project.name,
    ownerLanguage: config.project.ownerLanguage,
    constraintsPath: config.constraintsPath,
    gateWindows: config.gate.command.windows,
    gateUnix: config.gate.command.unix,
    successMarker: config.gate.successMarker,
    bannedModels: banned.length ? banned.join(", ") : "none",
    date: today(),
    openQuestions: questionsTable(answers.openQuestions ?? []),
    constraints: constraintsList(answers.constraints ?? []),
  };

  for (const name of MEMORY_FILES) {
    put(path.join(root, "memory-bank", `${name}.md`), render(template("memory-bank", `${name}.md`), values));
  }
  put(path.join(root, config.constraintsPath), render(template("constraints.md"), values));

  const claude = path.join(root, "CLAUDE.md");
  const block = render(template("claude-md-block.md"), values);
  const existing = exists(claude) ? fs.readFileSync(claude, "utf8") : "";
  const merged = mergeBlock(existing, block);
  if (merged !== existing) put(claude, merged, { overwrite: true });

  if (createGate) {
    put(path.join(root, "scripts", "check.ps1"), render(template("gate", "check.ps1"), values));
    put(path.join(root, "scripts", "check.sh"), render(template("gate", "check.sh"), values));
  }

  const ignore = path.join(root, ".gitignore");
  const cur = exists(ignore) ? fs.readFileSync(ignore, "utf8") : "";
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length) {
    const eol = cur.includes("\r\n") ? "\r\n" : "\n";
    const lead = cur === "" || cur.endsWith("\n") ? "" : eol;
    put(ignore, cur + lead + missing.join(eol) + eol, { overwrite: true });
  }
  return { written, skipped };
}

const defaultsFile = () => path.join(process.env.DARKFORGE_HOME || os.homedir(), ".darkforge", "defaults.json");

export function saveDefaults(answers) {
  const c = answers?.config ?? {};
  const out = {};
  if (c.models !== undefined) out.models = c.models;
  if (c.routing !== undefined) out.routing = c.routing;
  if (c.project?.ownerLanguage !== undefined) out.project = { ownerLanguage: c.project.ownerLanguage };
  const file = defaultsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ config: out }, null, 2) + "\n");
  return file;
}

export function loadDefaults() {
  try {
    return JSON.parse(fs.readFileSync(defaultsFile(), "utf8"));
  } catch {
    return null;
  }
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function readAnswers(file, ctx) {
  return JSON.parse(fs.readFileSync(path.resolve(ctx.cwd, file), "utf8").replace(/^﻿/, ""));
}

export async function initCommand(args, ctx) {
  const [sub, ...rest] = args;
  if (sub === "apply") {
    const file = flag(rest, "--answers");
    if (!file) {
      ctx.stderr("usage: darkforge init apply --answers <file.json>\n");
      return 1;
    }
    const r = applyInit(ctx.cwd, readAnswers(file, ctx));
    for (const f of r.written) ctx.stdout(`written ${f}\n`);
    for (const f of r.skipped) ctx.stdout(`skipped ${f}\n`);
    return 0;
  }
  if (sub === "defaults") {
    if (rest.includes("--save")) {
      const file = flag(rest, "--save");
      if (!file) {
        ctx.stderr("usage: darkforge init defaults [--save <answers.json>]\n");
        return 1;
      }
      ctx.stdout(`saved ${saveDefaults(readAnswers(file, ctx))}\n`);
      return 0;
    }
    const d = loadDefaults();
    ctx.stdout(d ? JSON.stringify(d, null, 2) + "\n" : "no defaults\n");
    return 0;
  }
  ctx.stderr("usage: darkforge init apply --answers <file.json> | darkforge init defaults [--save <file.json>]\n");
  return 1;
}
