import assert from "node:assert/strict";
import test from "node:test";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import {
  clampFreeIngredientCount,
  pizzaProductIssue,
  setPizzaCustomizeAtOrder,
  setPizzaMode,
  togglePizzaBaseGroup,
  togglePizzaExtraOption,
  togglePizzaRecipeOption,
} from "./menu-pizza.js";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [G1, G2, G3, O1, O2, O3, O4] = [id(1), id(2), id(3), id(4), id(5), id(6), id(7)];
const option = (optionId: string) => ({ active: true, displayOrder: 0, imagePath: null, maximumQuantity: 1, name: "o", optionId, unitPriceMinor: 0 });
const group = (groupId: string, options: readonly string[]) => ({ active: true, displayOrder: 0, groupId, maximumQuantity: 1, minimumQuantity: 0, name: "g", options: options.map(option) });
const groups = [group(G1, [O1, O2]), group(G2, [O3]), group(G3, [O4])] as unknown as MenuModifierGroupV1[];
const legacy = { active: true, modifierGroupIds: [G1, G2], name: "Pizza", productId: id(9) } as unknown as MenuProductV1;

test("setPizzaMode uses the canonical lists and strips every V2 field when cleared", () => {
  const pizza = setPizzaMode(legacy, "custom");
  assert.equal(pizza.pizzaMode, "custom");
  assert.deepEqual(pizza.baseGroupIds, []);
  assert.deepEqual(pizza.extraOptionIds, []);
  assert.equal(pizza.customizeAtOrder, true);
  assert.equal(pizza.freeIngredientCount, 0);
  assert.equal(setPizzaMode(pizza, "custom"), pizza);
  const fromLegacy = setPizzaMode({ ...legacy, baseGroupId: G1, extraGroupIds: [G2] } as unknown as MenuProductV1, "specialty");
  assert.deepEqual(fromLegacy.baseGroupIds, [G1]);
  assert.equal(Object.hasOwn(fromLegacy, "baseGroupId"), false);
  assert.equal(Object.hasOwn(fromLegacy, "extraGroupIds"), false);
  const back = setPizzaMode(pizza, null);
  for (const key of ["pizzaMode", "freeIngredientCount", "baseGroupIds", "baseGroupId", "defaultIngredientOptionIds", "customizeAtOrder", "extraOptionIds", "extraGroupIds"]) {
    assert.equal(Object.hasOwn(back, key), false, key);
  }
});

test("setPizzaCustomizeAtOrder unifies the mode and clears the recipe", () => {
  const specialty = { ...setPizzaMode(legacy, "specialty"), baseGroupIds: [G1], defaultIngredientOptionIds: [O1] } as MenuProductV1;
  const custom = setPizzaCustomizeAtOrder(specialty, true);
  assert.equal(custom.pizzaMode, "custom");
  assert.equal(custom.customizeAtOrder, true);
  assert.deepEqual(custom.defaultIngredientOptionIds, []);
  const withFree = { ...custom, freeIngredientCount: 3 } as MenuProductV1;
  const backToSpecialty = setPizzaCustomizeAtOrder(withFree, false);
  assert.equal(backToSpecialty.pizzaMode, "specialty");
  assert.equal(backToSpecialty.customizeAtOrder, false);
  assert.equal(backToSpecialty.freeIngredientCount, 0);
  assert.equal(setPizzaCustomizeAtOrder(legacy, true), legacy);
});

test("togglePizzaBaseGroup adds and removes base groups, pruning only their recipe", () => {
  const pizza = { ...setPizzaMode(legacy, "specialty"), baseGroupIds: [G1], defaultIngredientOptionIds: [O1, O3], extraOptionIds: [O2] } as MenuProductV1;
  const added = togglePizzaBaseGroup(pizza, groups[1]!);
  assert.deepEqual(added.baseGroupIds, [G1, G2]);
  const removed = togglePizzaBaseGroup(added, groups[0]!);
  assert.deepEqual(removed.baseGroupIds, [G2]);
  assert.deepEqual(removed.defaultIngredientOptionIds, [O3]);
  assert.deepEqual(removed.extraOptionIds, [O2]);
  assert.equal(togglePizzaBaseGroup(legacy, groups[0]!), legacy);
});

test("togglePizzaRecipeOption marks a recipe option and removes it from extras", () => {
  const pizza = { ...setPizzaMode(legacy, "specialty"), baseGroupIds: [G1], extraOptionIds: [O3] } as MenuProductV1;
  const added = togglePizzaRecipeOption(pizza, O3);
  assert.deepEqual(added.defaultIngredientOptionIds, [O3]);
  assert.deepEqual(added.extraOptionIds, []);
  const removed = togglePizzaRecipeOption(added, O3);
  assert.deepEqual(removed.defaultIngredientOptionIds, []);
  assert.deepEqual(removed.extraOptionIds, []);
});

test("togglePizzaExtraOption marks a loose extra and removes it from the recipe", () => {
  const pizza = { ...setPizzaMode(legacy, "specialty"), baseGroupIds: [G1], defaultIngredientOptionIds: [O1, O2] } as MenuProductV1;
  const added = togglePizzaExtraOption(pizza, O2);
  assert.deepEqual(added.extraOptionIds, [O2]);
  assert.deepEqual(added.defaultIngredientOptionIds, [O1]);
  const removed = togglePizzaExtraOption(added, O2);
  assert.deepEqual(removed.extraOptionIds, []);
  assert.deepEqual(removed.defaultIngredientOptionIds, [O1]);
});

test("clampFreeIngredientCount stays in range", () => {
  assert.equal(clampFreeIngredientCount(Number.NaN), 0);
  assert.equal(clampFreeIngredientCount(-3), 0);
  assert.equal(clampFreeIngredientCount(2.9), 2);
  assert.ok(clampFreeIngredientCount(10_000) < 10_000);
});

test("pizzaProductIssue reports what blocks publishing", () => {
  assert.equal(pizzaProductIssue(legacy, groups), null);
  const custom = setPizzaMode(legacy, "custom");
  assert.match(pizzaProductIssue(custom, groups) ?? "", /grupo base/u);
  const withBase = { ...custom, baseGroupIds: [G1] } as MenuProductV1;
  assert.equal(pizzaProductIssue(withBase, groups), null);
  assert.match(pizzaProductIssue({ ...withBase, baseGroupIds: [G3] } as MenuProductV1, groups) ?? "", /ya no está asignado/u);
  assert.match(pizzaProductIssue({ ...withBase, defaultIngredientOptionIds: [O3] } as MenuProductV1, groups) ?? "", /ya no existe/u);
  assert.match(pizzaProductIssue({ ...withBase, extraOptionIds: [O4] } as MenuProductV1, groups) ?? "", /no pertenece/u);
  assert.match(pizzaProductIssue({ ...withBase, defaultIngredientOptionIds: [O1], extraOptionIds: [O1] } as MenuProductV1, groups) ?? "", /receta y extra/u);
  assert.match(pizzaProductIssue({ ...withBase, freeIngredientCount: 41 } as MenuProductV1, groups) ?? "", /entero de 0/u);
  const specialty = { ...setPizzaMode(legacy, "specialty"), baseGroupIds: [G1] } as MenuProductV1;
  assert.match(pizzaProductIssue(specialty, groups) ?? "", /receta/u);
  assert.equal(pizzaProductIssue({ ...specialty, defaultIngredientOptionIds: [O1] } as MenuProductV1, groups), null);
});
