// .darkforge/state.json (current task and phase) and per-transcript read offsets for the token ledger.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PHASES = ["implement", "review", "fix", "orchestrator"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const stateFile = (root) => path.join(root, ".darkforge", "state.json");
const defaults = () => ({ task: null, phase: null });

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Missing or corrupt file gives `{task:null, phase:null}`. A legacy `offsets` key is ignored.
 * `lastTask` (the task merged most recently, until the next Stop records it) is present only when set.
 */
export function readState(root) {
  const parsed = readJson(stateFile(root));
  if (!parsed) return defaults();
  const { offsets: _legacy, lastTask: _last, ...rest } = parsed;
  const state = { ...rest, ...defaults() };
  if (typeof parsed.task === "string") state.task = parsed.task;
  if (PHASES.includes(parsed.phase)) state.phase = parsed.phase;
  if (typeof parsed.lastTask === "string" && parsed.lastTask !== "") state.lastTask = parsed.lastTask;
  return state;
}

/** Shallow-merge `patch` into the stored state and write it atomically; creates `.darkforge/`. */
export function writeState(root, patch) {
  const next = { ...readState(root), ...patch };
  delete next.offsets;
  if (next.lastTask == null) delete next.lastTask;
  writeAtomic(stateFile(root), next);
  return next;
}

// One small file per transcript, so parallel SubagentStop hooks never rewrite each other's offsets.
const offsetFile = (root, transcriptPath) =>
  path.join(
    root,
    ".darkforge",
    "offsets",
    crypto.createHash("sha256").update(transcriptPath).digest("hex").slice(0, 16) + ".json",
  );

/** `{line, lastId}` already counted for a transcript; `{line:0, lastId:null}` when unknown. */
export function readOffset(root, transcriptPath) {
  const v = readJson(offsetFile(root, transcriptPath));
  if (!v || v.path !== transcriptPath || !Number.isInteger(v.line) || v.line < 0) return { line: 0, lastId: null };
  return { line: v.line, lastId: typeof v.lastId === "string" ? v.lastId : null };
}

export function writeOffset(root, transcriptPath, { line, lastId }) {
  writeAtomic(offsetFile(root, transcriptPath), { path: transcriptPath, line, lastId: lastId ?? null });
}
