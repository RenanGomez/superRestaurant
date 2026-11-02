import assert from "node:assert/strict";
import test from "node:test";
import type { FractionHalfProjectionV1, MenuModifierGroupV1, MenuVariantFractionV1 } from "@super-restaurant/shared-types";
import {
  HALVES_BOTH_BUILT_MESSAGE,
  HALVES_BUILT_EMPTY_MESSAGE,
  buildLineFraction,
  builtHalfIngredientLimit,
  effectiveHalvesSetup,
  emptyHalvesDraft,
  estimateHalvesUnitMinor,
  halfTicketLines,
  halvesDraftFromFraction,
  pickHalfFlavor,
  restoreLineFraction,
  setHalfBuilt,
  toggleHalfEntry,
  validateHalvesDraft,
} from "./line-halves.js";

const flavorGroupId = "11111111-1111-4111-8111-111111111111";
const ingredientGroupId = "22222222-2222-4222-8222-222222222222";
const hawaiana = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const queso = "ccccccc3-cccc-4ccc-8ccc-cccccccccccc";
const piña = "ddddddd4-dddd-4ddd-8ddd-dddddddddddd";
const option = (optionId: string, name: string, unitPriceMinor: number) =>
  ({ active: true, imagePath: null, maximumQuantity: null, name, optionId, unitPriceMinor });
const flavors: MenuModifierGroupV1 = { active: true, displayOrder: 0, groupId: flavorGroupId, maximumQuantity: 1, minimumQuantity: 0,
  name: "Sabores", options: [option(hawaiana, "Hawaiana", 17_000)], productId: "p" };
const ingredients: MenuModifierGroupV1 = { active: true, displayOrder: 1, groupId: ingredientGroupId, maximumQuantity: 3, minimumQuantity: 0,
  name: "Ingredientes", options: [option(queso, "Queso", 3_000), option(piña, "Piña", 2_001)], productId: "p" };
const setup: MenuVariantFractionV1 = { enabled: true, excludableIngredientIds: [], extraGroupId: ingredientGroupId, flavorGroupId, lockedIngredientOptionIds: [] };

test("a half can be built from ingredients, but not both, and it needs ingredients", () => {
  let draft = pickHalfFlavor(emptyHalvesDraft(), "half-b", hawaiana);
  draft = setHalfBuilt(draft, "half-a", true);
  assert.deepEqual(validateHalvesDraft(draft), { valid: false, message: HALVES_BUILT_EMPTY_MESSAGE });
  assert.equal(buildLineFraction(draft), null);
  draft = toggleHalfEntry(draft, "half-a", "extraOptionIds", queso);
  assert.deepEqual(validateHalvesDraft(draft), { valid: true, message: null });
  assert.deepEqual(buildLineFraction(draft)?.slots[0], {
    excludedIngredientIds: [], extraOptionIds: [queso], flavorOptionId: null, fraction: "half-a" });
  assert.equal(buildLineFraction(draft)?.slots[1]?.flavorOptionId, hawaiana);
  assert.equal(setHalfBuilt(draft, "half-b", true), draft, "the other half cannot also be built");
  const both = { a: { ...draft.a }, b: { ...draft.a } };
  assert.deepEqual(validateHalvesDraft(both), { valid: false, message: HALVES_BOTH_BUILT_MESSAGE });
});

test("picking a flavor replaces a built half; building clears flavor and exclusions", () => {
  let draft = toggleHalfEntry(pickHalfFlavor(emptyHalvesDraft(), "half-a", hawaiana), "half-a", "excludedIngredientIds", "cebolla");
  draft = setHalfBuilt(draft, "half-a", true);
  assert.deepEqual(draft.a, { built: true, excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: null });
  assert.equal(toggleHalfEntry(draft, "half-a", "excludedIngredientIds", "cebolla"), draft, "no exclusions on a built half");
  draft = pickHalfFlavor(toggleHalfEntry(draft, "half-a", "extraOptionIds", queso), "half-a", hawaiana);
  assert.deepEqual(draft.a, { built: false, excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: hawaiana });
});

test("ingredients of a half stop at the limit and the group maximum tightens it", () => {
  assert.equal(builtHalfIngredientLimit(ingredients), 3);
  assert.equal(builtHalfIngredientLimit({ ...ingredients, maximumQuantity: 9 }), 5);
  assert.equal(builtHalfIngredientLimit(undefined), 5);
  let draft = setHalfBuilt(emptyHalvesDraft(), "half-a", true);
  for (const id of ["1", "2", "3", "4"]) draft = toggleHalfEntry(draft, "half-a", "extraOptionIds", id, 3);
  assert.deepEqual(draft.a.extraOptionIds, ["1", "2", "3"]);
  assert.deepEqual(toggleHalfEntry(draft, "half-a", "extraOptionIds", "2", 3).a.extraOptionIds, ["1", "3"], "can still remove at the limit");
});

test("the estimate starts a built half from the base price and halves its ingredients", () => {
  let draft = setHalfBuilt(pickHalfFlavor(emptyHalvesDraft(), "half-b", hawaiana), "half-a", true);
  draft = toggleHalfEntry(toggleHalfEntry(draft, "half-a", "extraOptionIds", queso), "half-a", "extraOptionIds", piña);
  const estimate = estimateHalvesUnitMinor({ variantPriceMinor: 12_000, flavorGroup: flavors, extraGroup: ingredients, draft, otherModifiersMinor: 0 });
  assert.equal(estimate, 17_000 + 1_500 + 1_001);
});

test("a saved built half is restored (by id and by the frozen name) and re-sent as built", () => {
  const frozen = (id: boolean): FractionHalfProjectionV1[] => [
    { amountMinor: 12_000, exclusions: [], extras: ["Queso"], flavorName: "Armada", fraction: "half-a",
      ...(id ? { excludedIngredientIds: [], extraOptionIds: [queso], flavorOptionId: null } : {}) },
    { amountMinor: 17_000, exclusions: [], extras: [], flavorName: "Hawaiana", fraction: "half-b",
      ...(id ? { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: hawaiana } : {}) },
  ];
  for (const withIds of [true, false]) {
    const restored = restoreLineFraction(frozen(withIds), setup, [flavors, ingredients]);
    assert.ok(restored.ok, `ids=${String(withIds)}`);
    if (restored.ok) {
      assert.equal(restored.fraction.slots[0]?.flavorOptionId, null);
      assert.deepEqual(restored.fraction.slots[0]?.extraOptionIds, [queso]);
      assert.equal(halvesDraftFromFraction(restored.fraction).a.built, true);
    }
  }
  assert.deepEqual(restoreLineFraction(frozen(true), { ...setup, extraGroupId: null }, [flavors, ingredients]), { ok: false, reason: "flavor" });
  const bothBuilt = frozen(true).map((half) => ({ ...half, flavorName: "Armada", flavorOptionId: null }));
  assert.deepEqual(restoreLineFraction(bothBuilt, setup, [flavors, ingredients]), { ok: false, reason: "flavor" });
});

test("the product's setup wins over a legacy size setup, and halves work without sizes", () => {
  const legacy = { ...setup, flavorGroupId: ingredientGroupId, extraGroupId: flavorGroupId };
  assert.equal(effectiveHalvesSetup({ fraction: setup }, { fraction: legacy }), setup);
  assert.equal(effectiveHalvesSetup({ fraction: null }, { fraction: legacy }), legacy);
  assert.equal(effectiveHalvesSetup({ fraction: setup }, undefined), setup);
  assert.equal(effectiveHalvesSetup({ fraction: { ...setup, enabled: false } }, { fraction: legacy }), undefined);
  assert.equal(effectiveHalvesSetup({}, undefined), undefined);
});

test("tickets show a built half as Armada with its ingredients", () => {
  assert.deepEqual(halfTicketLines({ amountMinor: 1, exclusions: [], extras: ["Queso", "Piña"], flavorName: "Armada", fraction: "half-a" }),
    { details: [], title: "Mitad A: Armada (Queso, Piña)" });
  assert.deepEqual(halfTicketLines({ amountMinor: 1, exclusions: ["Cebolla"], extras: ["Queso"], flavorName: "Hawaiana", fraction: "half-b" }),
    { details: ["+ Queso", "Sin Cebolla"], title: "Mitad B: Hawaiana" });
});
