// Pure planning and formatting helpers. Kept free of DOM access so they can be
// unit tested with `node --test` and reused by other views later.

export const MAX_INVENTORY_COUNT = 1e13;
export const BLENDER_CRAFT_MINUTES = 5;

const COMPACT_UNITS = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
];

const PARSE_UNITS = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

export function isValidCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_INVENTORY_COUNT;
}

export function createEmptyInventory(itemKeys) {
  return Object.fromEntries(itemKeys.map((key) => [key, 0]));
}

export function normalizeInventory(itemKeys, source) {
  const result = createEmptyInventory(itemKeys);
  if (!source || typeof source !== "object" || Array.isArray(source)) return result;
  for (const key of itemKeys) {
    if (Object.hasOwn(source, key) && isValidCount(source[key])) result[key] = source[key];
  }
  return result;
}

export function validateInventory(itemKeys, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { ok: false, error: "Inventory must be a JSON object." };
  }
  for (const key of itemKeys) {
    if (Object.hasOwn(source, key) && !isValidCount(source[key])) {
      return { ok: false, error: "Invalid count for " + key + "." };
    }
  }
  return { ok: true, error: "" };
}

export function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

export function compactNumber(value) {
  for (const [size, suffix] of COMPACT_UNITS) {
    if (value >= size) return (value / size).toFixed(2).replace(/\.?0+$/, "") + suffix;
  }
  return formatNumber(value);
}

export function parseAmount(value) {
  const match = String(value).trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([kmbt])?$/i);
  if (!match) return null;
  const multiplier = PARSE_UNITS[(match[2] || "").toLowerCase()] || 1;
  const parsed = Math.round(parseFloat(match[1]) * multiplier);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatCraftingTime(totalMinutes) {
  const total = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  return [
    days ? days + "d" : "",
    hours ? hours + "h" : "",
    minutes || (!days && !hours) ? minutes + "m" : "",
  ].filter(Boolean).join(" ");
}

// Net requirements: owning intermediates reduces what must be crafted, which
// in turn reduces the raw materials still needed. `order` must list crafted
// items before their ingredients.
export function makePlan(data, have = {}, goals = []) {
  const demand = {};
  const craft = {};
  for (const goal of goals) {
    const definition = data.goals[goal];
    if (!definition) continue;
    for (const [key, quantity] of Object.entries(definition.cost)) {
      demand[key] = (demand[key] || 0) + quantity;
    }
  }
  for (const key of data.order) {
    craft[key] = Math.max(0, (demand[key] || 0) - (have[key] || 0));
    for (const [ingredient, quantity] of Object.entries(data.recipes[key])) {
      demand[ingredient] = (demand[ingredient] || 0) + craft[key] * quantity;
    }
  }
  return { demand, craft };
}

export function remaining(data, plan, inventory, key) {
  return data.recipes[key]
    ? plan.craft[key] || 0
    : Math.max(0, (plan.demand[key] || 0) - (inventory[key] || 0));
}

export function percentComplete(grossDemand, data, plan, inventory, key) {
  const gross = grossDemand[key] || 0;
  if (!gross) return 100;
  return 100 * (1 - remaining(data, plan, inventory, key) / gross);
}

export function totalCraftingMinutes(data, plan) {
  return data.order.reduce((total, key) => total + (plan.craft[key] || 0) * BLENDER_CRAFT_MINUTES, 0);
}

export function goalProgress(data, inventory, goal, basePlan = makePlan(data, {}, [goal])) {
  const rawKeys = data.rawItems || Object.keys(data.items).filter((key) => !data.recipes[key]);
  const keys = rawKeys.filter((key) => (basePlan.demand[key] || 0) > 0);
  if (!keys.length) return 100;
  const plan = makePlan(data, inventory, [goal]);
  return keys.reduce((total, key) => {
    const owned = inventory[key] || 0;
    const left = Math.max(0, (plan.demand[key] || 0) - owned);
    return total + 100 * (1 - left / basePlan.demand[key]);
  }, 0) / keys.length;
}
