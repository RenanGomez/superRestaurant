import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLineChange,
  buildSelectionPlan,
  groupProductsByCategory,
  validateModifierSelection,
  type SelectionPlanLineDraft,
} from "./capture-selection.js";
import type { MenuCatalogV1, MenuModifierGroupV1 } from "@super-restaurant/shared-types";

const catalogVersion = "11111111-1111-4111-8111-111111111111";
const productA = "22222222-2222-4222-8222-222222222222";
const productB = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";
const optionId = "55555555-5555-4555-8555-555555555555";
const optionId2 = "66666666-6666-4666-8666-666666666666";
const lineId1 = "77777777-7777-4777-8777-777777777777";
const lineId2 = "88888888-8888-4888-8888-888888888888";
const lineId3 = "99999999-9999-4999-8999-999999999999";

test("buildSelectionPlan projects draft lines with a null note and null variantId", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, quantity: 2,
      modifierGroups: [{ groupId, selections: [{ optionId, quantity: 1 }] }] },
  ];
  const plan = buildSelectionPlan(lines, catalogVersion);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.catalogVersion, catalogVersion);
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0]?.variantId, null);
  assert.equal(plan.lines[0]?.note, null);
  assert.deepEqual(plan.lines[0]?.modifierGroups, [{ groupId, selections: [{ optionId, quantity: 1 }] }]);
});

test("buildSelectionPlan on an empty set clears the plan", () => {
  assert.deepEqual(buildSelectionPlan([], catalogVersion).lines, []);
});

test("applyLineChange add without modifiers merges into the existing line by incrementing", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, quantity: 1, modifierGroups: [] },
  ];
  const next = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, quantity: 1, modifierGroups: [] });
  assert.equal(next.length, 1);
  assert.equal(next[0]?.quantity, 2);
  assert.equal(next[0]?.lineId, lineId1);
});

test("applyLineChange add with a distinct modifier selection creates a new line", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, quantity: 1, modifierGroups: [{ groupId, selections: [{ optionId, quantity: 1 }] }] },
  ];
  const next = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, quantity: 1,
    modifierGroups: [{ groupId, selections: [{ optionId: optionId2, quantity: 1 }] }] });
  assert.equal(next.length, 2);
});

test("applyLineChange add with the same modifier selection (different order) merges", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, quantity: 1,
      modifierGroups: [{ groupId, selections: [{ optionId, quantity: 1 }, { optionId: optionId2, quantity: 2 }] }] },
  ];
  const next = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, quantity: 3,
    modifierGroups: [{ groupId, selections: [{ optionId: optionId2, quantity: 2 }, { optionId, quantity: 1 }] }] });
  assert.equal(next.length, 1);
  assert.equal(next[0]?.quantity, 4);
});

test("applyLineChange increment/decrement/remove", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, quantity: 1, modifierGroups: [] },
    { lineId: lineId2, productId: productB, quantity: 1, modifierGroups: [] },
  ];
  const incremented = applyLineChange(lines, { type: "increment", lineId: lineId1 });
  assert.equal(incremented.find((l) => l.lineId === lineId1)?.quantity, 2);
  const decremented = applyLineChange(incremented, { type: "decrement", lineId: lineId1 });
  assert.equal(decremented.find((l) => l.lineId === lineId1)?.quantity, 1);
  const zeroed = applyLineChange(decremented, { type: "decrement", lineId: lineId1 });
  assert.equal(zeroed.some((l) => l.lineId === lineId1), false);
  assert.equal(zeroed.length, 1);
  const removed = applyLineChange(lines, { type: "remove", lineId: lineId2 });
  assert.deepEqual(removed.map((l) => l.lineId), [lineId1]);
});

test("applyLineChange clamps quantity to [0, 1000] and setQuantity 0 removes", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId3, productId: productA, quantity: 999, modifierGroups: [] },
  ];
  const clamped = applyLineChange(lines, { type: "add", lineId: lineId1, productId: productA, quantity: 50, modifierGroups: [] });
  assert.equal(clamped[0]?.quantity, 1000);
  const cleared = applyLineChange(lines, { type: "setQuantity", lineId: lineId3, quantity: 0 });
  assert.deepEqual(cleared, []);
});

test("groupProductsByCategory returns only active categories sorted by displayOrder, with their products", () => {
  const catalog = {
    catalogVersion, currency: "MXN", replayed: false, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "u1", version: 1,
    categories: [
      { categoryId: "c2", name: "Bebidas", active: true, displayOrder: 2 },
      { categoryId: "c1", name: "Pizzas", active: true, displayOrder: 1 },
      { categoryId: "c3", name: "Oculta", active: false, displayOrder: 0 },
    ],
    products: [
      { productId: "p1", categoryId: "c1", name: "Pizza", active: true, displayOrder: 1, unit: "pieza",
        unitPriceMinor: 1000, sku: null, stationId: "s1", tax: null },
      { productId: "p2", categoryId: "c2", name: "Refresco", active: false, displayOrder: 1, unit: "pieza",
        unitPriceMinor: 500, sku: null, stationId: "s1", tax: null },
    ],
    modifierGroups: [],
  } satisfies MenuCatalogV1;
  const grouped = groupProductsByCategory(catalog);
  assert.deepEqual(grouped.map((g) => g.category.categoryId), ["c1", "c2"]);
  assert.equal(grouped[1]?.products[0]?.active, false);
});

test("groupProductsByCategory on a null catalog returns an empty list", () => {
  assert.deepEqual(groupProductsByCategory(null), []);
});

test("validateModifierSelection enforces group min/max and per-option max", () => {
  const group: MenuModifierGroupV1 = { groupId, productId: "p1", name: "Salsa", active: true, displayOrder: 1,
    minimumQuantity: 1, maximumQuantity: 2,
    options: [
      { optionId, name: "BBQ", active: true, unitPriceMinor: 0, maximumQuantity: 1 },
      { optionId: optionId2, name: "Búfalo", active: true, unitPriceMinor: 0, maximumQuantity: null },
    ] };
  assert.equal(validateModifierSelection(group, []).valid, false);
  assert.equal(validateModifierSelection(group, []).reason, "min");
  assert.equal(validateModifierSelection(group, [{ optionId, quantity: 1 }]).valid, true);
  assert.equal(validateModifierSelection(group, [{ optionId, quantity: 2 }]).reason, "option_max");
  assert.equal(validateModifierSelection(group, [{ optionId, quantity: 1 }, { optionId: optionId2, quantity: 2 }]).reason, "max");
});
