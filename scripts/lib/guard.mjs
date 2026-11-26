import { isBelowFloor } from "./models.mjs";

const PREFIX = "darkforge:";
const ALLOW = Object.freeze({ allow: true });

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const own = (obj, key) => isObj(obj) && Object.hasOwn(obj, key);

// Lower-case alphanumeric segments: "claude-fable-5-2[1m]" -> ["claude", "fable", "5", "2", "1m"].
const segments = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function containsRun(hay, needle) {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((n, j) => hay[i + j] === n)) return true;
  }
  return false;
}

// Banned if the model equals an entry (case-insensitive) or contains the entry's segments as a run of its own segments.
function bannedEntry(model, config) {
  const banned = Array.isArray(config.models?.banned) ? config.models.banned : [];
  const lower = model.toLowerCase();
  const modelSegs = segments(model);
  for (const entry of banned) {
    if (typeof entry !== "string" || entry.trim() === "") continue;
    if (entry.trim().toLowerCase() === lower) return entry;
    const entrySegs = segments(entry);
    if (entrySegs.length && containsRun(modelSegs, entrySegs)) return entry;
  }
  return null;
}

// Map a model alias or full ID to a configured tier name; null if none or ambiguous.
function tierOf(model, config) {
  const tiers = Array.isArray(config.models?.tiers) ? config.models.tiers : [];
  const lower = model.toLowerCase();
  const exact = tiers.find((t) => typeof t === "string" && t.toLowerCase() === lower);
  if (exact) return exact;
  const segs = segments(model);
  const hits = tiers.filter((t) => typeof t === "string" && segs.includes(t.toLowerCase()));
  return hits.length === 1 ? hits[0] : null;
}

// Models the routing table assigns to a darkforge agent, in table order, without duplicates.
function routingModels(shortName, config) {
  const routing = isObj(config.routing) ? config.routing : {};
  const found = [];
  for (const risk of Object.keys(routing)) {
    const roles = routing[risk];
    if (!isObj(roles)) continue;
    for (const role of Object.keys(roles)) {
      const r = roles[role];
      if (own(r, "agent") && r.agent === shortName && own(r, "model") && typeof r.model === "string" && !found.includes(r.model)) {
        found.push(r.model);
      }
    }
  }
  return found;
}

const deny = (reason) => ({ allow: false, reason });

export function decide(toolInput, config) {
  const input = isObj(toolInput) ? toolInput : {};
  const type = typeof input.subagent_type === "string" ? input.subagent_type : "";
  const label = type || "general-purpose";
  const model = typeof input.model === "string" && input.model.trim() !== "" ? input.model.trim() : null;
  const isDarkforge = type.startsWith(PREFIX);
  const shortName = isDarkforge ? type.slice(PREFIX.length) : "";

  if (model) {
    const entry = bannedEntry(model, config);
    if (entry !== null) {
      return deny(
        `darkforge model-guard: model "${model}" is banned in this project (models.banned contains "${entry}"). ` +
          `Retry the Agent call for "${label}" with a model that is not banned.`,
      );
    }
  }

  if (type === "fork") return ALLOW;

  const requireExplicit = config.models?.requireExplicit;
  if (!model && (requireExplicit === "all" || (requireExplicit === "darkforge" && isDarkforge))) {
    const routed = isDarkforge ? routingModels(shortName, config) : [];
    const hint = routed.length
      ? `The routing table uses ${routed.map((m) => `"${m}"`).join(" or ")} for ${shortName}.`
      : `The routing table names no model for "${label}"; choose one from models.tiers that is not banned.`;
    return deny(
      `darkforge model-guard: the Agent call for "${label}" has no model (models.requireExplicit is "${requireExplicit}"). ` +
        `${hint} Pass \`model\` explicitly and retry.`,
    );
  }

  if (isDarkforge && model) {
    const floors = config.models?.floors;
    if (own(floors, shortName)) {
      const tier = tierOf(model, config);
      if (tier && isBelowFloor(shortName, tier, config)) {
        return deny(
          `darkforge model-guard: model "${model}" is below the floor "${floors[shortName]}" for ${type} (models.floors). ` +
            `Retry with "${floors[shortName]}" or a higher tier.`,
        );
      }
    }
  }

  return ALLOW;
}

const PHASE_OF = { builder: "implement", specialist: "implement", scaffolder: "implement", reviewer: "review", "security-reviewer": "review" };

/** Ledger phase an allowed dispatch starts: implementer agents -> implement, reviewer agents -> review, others -> null. */
export function dispatchPhase(toolInput) {
  const type = isObj(toolInput) && typeof toolInput.subagent_type === "string" ? toolInput.subagent_type : "";
  if (!type.startsWith(PREFIX)) return null;
  const name = type.slice(PREFIX.length);
  return Object.hasOwn(PHASE_OF, name) ? PHASE_OF[name] : null;
}
