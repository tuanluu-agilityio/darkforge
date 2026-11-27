// API list prices (USD per million tokens) and the estimated-cost function.
// Prices are copied from the public price list on PRICES_AS_OF. Estimates only.

export const PRICES_AS_OF = "2026-11-27";

const p = (input, output, cacheWrite5m, cacheWrite1h, cacheRead) => ({ input, output, cacheWrite5m, cacheWrite1h, cacheRead });

export const PRICES = {
  "fable-5-2": p(8, 40, 10, 16, 0.2),
  "fable-5-1": p(10, 50, 12.5, 20, 0.25),
  "fable-5": p(10, 50, 12.5, 20, 1),
  "opus-5-5": p(4, 20, 5, 8, 0.2),
  "opus-5": p(5, 25, 6.25, 10, 0.5),
  "sonnet-5-5": p(2, 10, 2.5, 4, 0.1),
  "sonnet-5": p(2, 10, 2.5, 4, 0.2),
  // Prompts up to 100k tokens; the higher long-prompt price is not modelled.
  "haiku-5-5": p(0.1, 0.5, 0.125, 0.2, 0.01),
  "haiku-4-5": p(1, 5, 1.25, 2, 0.1),
};

const FIELDS = ["input", "output", "cacheWrite5m", "cacheWrite1h", "cacheRead"];

export function modelKey(model) {
  if (typeof model !== "string") return null;
  let s = model.trim().toLowerCase();
  if (s.startsWith("claude-")) s = s.slice(7);
  s = s.replace(/-\d{8}$/, "");
  const m = /^([a-z]+)-(\d+)(?:-(\d+))?$/.exec(s);
  if (!m) return null;
  return m[3] === undefined ? `${m[1]}-${m[2]}` : `${m[1]}-${m[2]}-${m[3]}`;
}

function validPrice(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const out = {};
  for (const f of FIELDS) {
    const n = Object.hasOwn(v, f) ? v[f] : undefined;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    out[f] = n;
  }
  return out;
}

export function resolvePrices(overrides) {
  const table = Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [k, { ...v }]));
  const overridden = [];
  const warnings = [];
  if (overrides === undefined) return { table, overridden, warnings };
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    warnings.push("config prices must be an object; ignored");
    return { table, overridden, warnings };
  }
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = modelKey(rawKey);
    if (!key) {
      warnings.push(`price override "${rawKey}" ignored: not a model id`);
      continue;
    }
    const price = validPrice(value);
    if (!price) {
      warnings.push(`price override "${rawKey}" ignored: needs non-negative numbers for ${FIELDS.join(", ")}`);
      continue;
    }
    table[key] = price;
    if (!overridden.includes(key)) overridden.push(key);
  }
  return { table, overridden, warnings };
}

export function priceFor(model, table) {
  const key = modelKey(model);
  if (!key || !table || !Object.hasOwn(table, key)) return null;
  return table[key] ?? null;
}

const tok = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function costOf(usage, price) {
  const u = usage && typeof usage === "object" ? usage : {};
  const input = tok(u.input);
  const output = tok(u.output);
  const w5 = tok(u.cacheWrite5m);
  const w1 = tok(u.cacheWrite1h);
  const unknown = Math.max(0, tok(u.cacheWrite) - w5 - w1);
  const read = tok(u.cacheRead);
  const c = {
    input: (input * price.input) / 1e6,
    output: (output * price.output) / 1e6,
    cacheWrite: (w5 * price.cacheWrite5m + (w1 + unknown) * price.cacheWrite1h) / 1e6,
    cacheRead: (read * price.cacheRead) / 1e6,
  };
  return { total: c.input + c.output + c.cacheWrite + c.cacheRead, ...c, assumed1h: unknown };
}
