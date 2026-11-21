import assert from "node:assert/strict";
import test from "node:test";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { clampFreeIngredientCount, pizzaProductIssue, setPizzaBaseGroup, setPizzaMode, toggleListedId } from "./menu-pizza.js";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [G1, G2, O1, O2] = [id(1), id(2), id(3), id(4)];
const option = (optionId: string) => ({ active: true, displayOrder: 0, maximumQuantity: 1, name: "o", optionId, unitPriceMinor: 0 });
const groups = [
  { active: true, groupId: G1, name: "Base", options: [option(O1), option(O2)] },
  { active: true, groupId: G2, name: "Extras", options: [option(id(5))] },
] as unknown as MenuModifierGroupV1[];
const legacy = { active: true, modifierGroupIds: [G1, G2], name: "Pizza", productId: id(9) } as unknown as MenuProductV1;

test("setPizzaMode adds empty V2 defaults and removes every V2 field when cleared", () => {
  const pizza = setPizzaMode(legacy, "custom");
  assert.equal(pizza.pizzaMode, "custom");
  assert.equal(pizza.baseGroupId, null);
  assert.deepEqual(pizza.extraGroupIds, []);
  assert.equal(pizza.freeIngredientCount, 0);
  assert.equal(setPizzaMode(pizza, "custom"), pizza);
  const back = setPizzaMode(pizza, null);
  for (const key of ["pizzaMode", "freeIngredientCount", "baseGroupId", "defaultIngredientOptionIds", "customizeAtOrder", "extraGroupIds"]) {
    assert.equal(Object.hasOwn(back, key), false, key);
  }
});

test("setPizzaBaseGroup drops the recipe and the base group from extras", () => {
  const pizza = { ...setPizzaMode(legacy, "specialty"), baseGroupId: G1, defaultIngredientOptionIds: [O1], extraGroupIds: [G2] } as MenuProductV1;
  const next = setPizzaBaseGroup(pizza, G2);
  assert.equal(next.baseGroupId, G2);
  assert.deepEqual(next.defaultIngredientOptionIds, []);
  assert.deepEqual(next.extraGroupIds, []);
  assert.equal(setPizzaBaseGroup(legacy, G1), legacy);
});

test("toggleListedId and clampFreeIngredientCount stay in range", () => {
  assert.deepEqual(toggleListedId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleListedId(["a", "b"], "a"), ["b"]);
  assert.equal(clampFreeIngredientCount(Number.NaN), 0);
  assert.equal(clampFreeIngredientCount(-3), 0);
  assert.equal(clampFreeIngredientCount(2.9), 2);
  assert.ok(clampFreeIngredientCount(10_000) < 10_000);
});

test("pizzaProductIssue reports what blocks publishing", () => {
  assert.equal(pizzaProductIssue(legacy, groups), null);
  const custom = setPizzaMode(legacy, "custom");
  assert.match(pizzaProductIssue(custom, groups) ?? "", /grupo de ingredientes/u);
  const withBase = { ...custom, baseGroupId: G1 } as MenuProductV1;
  assert.equal(pizzaProductIssue(withBase, groups), null);
  assert.match(pizzaProductIssue({ ...withBase, extraGroupIds: [G1] } as MenuProductV1, groups) ?? "", /ingredientes y extras/u);
  assert.match(pizzaProductIssue({ ...withBase, baseGroupId: id(77) } as MenuProductV1, groups) ?? "", /ya no está asignado/u);
  const specialty = { ...setPizzaMode(legacy, "specialty"), baseGroupId: G1 } as MenuProductV1;
  assert.match(pizzaProductIssue(specialty, groups) ?? "", /receta/u);
  assert.equal(pizzaProductIssue({ ...specialty, defaultIngredientOptionIds: [O1] } as MenuProductV1, groups), null);
  assert.match(pizzaProductIssue({ ...specialty, defaultIngredientOptionIds: [id(88)] } as MenuProductV1, groups) ?? "", /ya no existe/u);
});
