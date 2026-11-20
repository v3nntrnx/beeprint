import test from "node:test";
import assert from "node:assert/strict";
import { consumeGoalMaterials, goalProgress, makePlan, remaining, totalCraftingMinutes } from "./core.js";

const data = {
  items: { swirled_waxes: {}, hard_waxes: {}, soft_waxes: {} },
  recipes: {
    swirled_waxes: { hard_waxes: 3, soft_waxes: 9 },
  },
  goals: {
    planter: { cost: { swirled_waxes: 2 } },
  },
  order: ["swirled_waxes"],
  rawItems: ["hard_waxes", "soft_waxes"],
};

test("gather-only recipes stop expanding ingredients and contribute no Blender time", () => {
  const gatherOnly = new Set(["swirled_waxes"]);
  const plan = makePlan(data, {}, ["planter"], { gatherOnly });

  assert.equal(plan.demand.swirled_waxes, 2);
  assert.equal(plan.demand.hard_waxes, undefined);
  assert.equal(plan.demand.soft_waxes, undefined);
  assert.equal(plan.craft.swirled_waxes, 0);
  assert.equal(remaining(data, plan, {}, "swirled_waxes"), 2);
  assert.equal(totalCraftingMinutes(data, plan), 0);
});

test("gather-only recipe inventory contributes to goal progress", () => {
  const gatherOnly = new Set(["swirled_waxes"]);
  const basePlan = makePlan(data, {}, ["planter"], { gatherOnly });

  assert.equal(goalProgress(data, { swirled_waxes: 1 }, "planter", basePlan, { gatherOnly }), 50);
});

test("normal recipe planning and Blender time remain unchanged", () => {
  const plan = makePlan(data, {}, ["planter"]);

  assert.equal(plan.craft.swirled_waxes, 2);
  assert.equal(plan.demand.hard_waxes, 6);
  assert.equal(plan.demand.soft_waxes, 18);
  assert.equal(totalCraftingMinutes(data, plan), 10);
});

test("purchasing a ready goal consumes available intermediates and required raw ingredients", () => {
  const inventory = { swirled_waxes: 1, hard_waxes: 3, soft_waxes: 9 };
  const result = consumeGoalMaterials(data, inventory, "planter");

  assert.deepEqual(result, { swirled_waxes: 0, hard_waxes: 0, soft_waxes: 0 });
  assert.deepEqual(inventory, { swirled_waxes: 1, hard_waxes: 3, soft_waxes: 9 });
});

test("purchasing a goal requires all gather materials and respects gather-only recipes", () => {
  assert.equal(consumeGoalMaterials(data, { hard_waxes: 5, soft_waxes: 18 }, "planter"), null);

  const gatherOnly = new Set(["swirled_waxes"]);
  const notReady = consumeGoalMaterials(data, { swirled_waxes: 1 }, "planter", { gatherOnly });
  const ready = consumeGoalMaterials(data, { swirled_waxes: 2, hard_waxes: 20 }, "planter", { gatherOnly });

  assert.equal(notReady, null);
  assert.deepEqual(ready, { swirled_waxes: 0, hard_waxes: 20 });
});
