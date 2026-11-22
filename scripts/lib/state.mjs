// .darkforge/state.json: current task, current phase, and per-transcript line offsets for the Stop hook.
import fs from "node:fs";
import path from "node:path";

export const PHASES = ["implement", "review", "fix", "orchestrator"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const stateFile = (root) => path.join(root, ".darkforge", "state.json");
const defaults = () => ({ task: null, phase: null, offsets: {} });

export function readState(root) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile(root), "utf8").replace(/^﻿/, ""));
  } catch {
    return defaults();
  }
  if (!isObj(parsed)) return defaults();
  const state = { ...parsed, ...defaults() };
  if (typeof parsed.task === "string") state.task = parsed.task;
  if (PHASES.includes(parsed.phase)) state.phase = parsed.phase;
  if (isObj(parsed.offsets)) {
    for (const [k, v] of Object.entries(parsed.offsets)) if (Number.isInteger(v) && v >= 0) state.offsets[k] = v;
  }
  return state;
}

/** Merge `patch` into the stored state (offsets merge key by key) and write it atomically. */
export function writeState(root, patch) {
  const current = readState(root);
  const next = { ...current, ...patch, offsets: { ...current.offsets, ...(isObj(patch.offsets) ? patch.offsets : {}) } };
  const file = stateFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return next;
}
