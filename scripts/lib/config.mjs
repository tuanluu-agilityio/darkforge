import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CONFIG = {
  schemaVersion: 1,
  project: { name: "", ownerLanguage: "en" },
  gate: { command: { windows: "", unix: "" }, successMarker: "ALL CHECKS PASSED", quiet: true },
  constraintsPath: "docs/plans/constraints.md",
  riskAreas: [],
  routing: {
    low: { implementer: { agent: "builder", model: "sonnet" }, reviewer: { agent: "reviewer", model: "sonnet" } },
    medium: { implementer: { agent: "builder", model: "sonnet" }, reviewer: { agent: "reviewer", model: "opus" } },
    high: { implementer: { agent: "specialist", model: "sonnet" }, reviewer: { agent: "security-reviewer", model: "opus" } },
  },
  models: {
    tiers: ["haiku", "sonnet", "opus", "fable"],
    banned: [],
    requireExplicit: "darkforge",
    floors: { specialist: "sonnet", "security-reviewer": "sonnet" },
  },
  escalation: { raiseAfterFixRounds: 2, askOwnerAfterFixRounds: 3 },
  git: { baseBranch: "main", remote: "origin", prFlow: true, requiredChecks: [], mergeMethod: "merge", autoMerge: false },
  superpowers: "auto",
};

const ENUMS = {
  "models.requireExplicit": ["darkforge", "all", "off"],
  "git.mergeMethod": ["merge", "squash", "rebase"],
  superpowers: ["auto", "off"],
};
const NULLABLE = new Set(["git.remote"]);
const STRING_ARRAYS = ["models.tiers", "models.banned", "riskAreas", "git.requiredChecks"];
const STRING_MAPS = ["models.floors"];
// JSON.parse makes "__proto__" an own key; copying it with plain assignment would set the prototype.
const SKIP_KEYS = new Set(["__proto__"]);

const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isObj = (v) => kind(v) === "object";
const clone = (v) => structuredClone(v);

function merge(defaults, file, prefix, errors) {
  const out = {};
  for (const key of Object.keys(defaults)) {
    const p = prefix ? `${prefix}.${key}` : key;
    const d = defaults[key];
    if (!Object.hasOwn(file, key)) {
      out[key] = clone(d);
      continue;
    }
    const f = file[key];
    if (ENUMS[p]) {
      if (!ENUMS[p].includes(f)) errors.push(`${p} must be one of ${ENUMS[p].map((x) => JSON.stringify(x)).join(", ")}`);
      out[key] = clone(f);
    } else if (NULLABLE.has(p) && (f === null || typeof f === "string")) {
      out[key] = f;
    } else if (kind(f) !== kind(d)) {
      errors.push(`${p} must be ${NULLABLE.has(p) ? "a string or null" : "of type " + kind(d)} (got ${kind(f)})`);
      out[key] = clone(d);
    } else if (isObj(d)) {
      out[key] = merge(d, f, p, errors);
      for (const extra of Object.keys(f)) if (!Object.hasOwn(d, extra) && !SKIP_KEYS.has(extra)) out[key][extra] = clone(f[extra]);
    } else {
      out[key] = clone(f);
    }
  }
  return out;
}

export function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".darkforge", "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadConfig(root) {
  const file = path.join(root, ".darkforge", "config.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, error: `cannot read ${file}: ${e.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (e) {
    return { ok: false, error: `invalid JSON in ${file}: ${e.message}` };
  }
  if (!isObj(parsed)) return { ok: false, error: `${file} must contain a JSON object` };
  return validateConfig(parsed);
}

const at = (obj, dotted) => dotted.split(".").reduce((o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined), obj);

/** Elements of string lists and values of string maps must be strings (the merge checks only the container type). */
function checkElements(config, errors) {
  for (const p of STRING_ARRAYS) {
    const v = at(config, p);
    if (Array.isArray(v)) v.forEach((x, i) => typeof x !== "string" && errors.push(`${p}[${i}] must be a string (got ${kind(x)})`));
  }
  for (const p of STRING_MAPS) {
    const v = at(config, p);
    if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x !== "string") errors.push(`${p}.${k} must be a string (got ${kind(x)})`);
  }
}

/** Validate a parsed config object. Returns { ok, config } or { ok: false, error }. */
export function validateConfig(parsed) {
  if (!isObj(parsed)) return { ok: false, error: "config must be a JSON object" };
  if (parsed.schemaVersion !== 1) {
    return { ok: false, error: `unsupported schemaVersion ${JSON.stringify(parsed.schemaVersion)} (expected 1)` };
  }
  const errors = [];
  const config = merge(DEFAULT_CONFIG, parsed, "", errors);
  for (const extra of Object.keys(parsed)) if (!Object.hasOwn(DEFAULT_CONFIG, extra) && !SKIP_KEYS.has(extra)) config[extra] = clone(parsed[extra]);
  checkElements(config, errors);
  if (errors.length) return { ok: false, error: `invalid config: ${errors.join("; ")}` };
  return { ok: true, config };
}
