export const TIERS = ["haiku", "sonnet", "opus", "fable"];

export function tierIndex(model, config) {
  return config.models.tiers.indexOf(model);
}

export function isBelowFloor(agentShortName, model, config) {
  const floors = config.models.floors;
  const floor = floors && Object.hasOwn(floors, agentShortName) ? floors[agentShortName] : undefined;
  if (!floor) return false;
  const floorIdx = tierIndex(floor, config);
  if (floorIdx < 0) return false;
  const idx = tierIndex(model, config);
  if (idx < 0) return false;
  return idx < floorIdx;
}

export function route(risk, config) {
  const r = Object.hasOwn(config.routing, risk) ? config.routing[risk] : undefined;
  if (!r) throw new Error(`unknown risk level: ${risk}`);
  return { implementer: { ...r.implementer }, reviewer: { ...r.reviewer } };
}

export function raiseTier(model, config) {
  const tiers = config.models.tiers;
  const i = tierIndex(model, config);
  if (i < 0) return model;
  for (let j = i + 1; j < tiers.length; j++) {
    if (!config.models.banned.includes(tiers[j])) return tiers[j];
  }
  return model;
}
