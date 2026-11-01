import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLineChange,
  buildSelectionPlan,
  countModifierSelections,
  estimateSelectionMinor,
  expandModifierSelections,
  groupProductsByCategory,
  toggleOrStepOption,
  validateModifierSelection,
  type SelectionPlanLineDraft,
} from "./capture-selection.js";
import type { MenuCatalogV1, MenuModifierGroupV1 } from "@super-restaurant/shared-types";
import { menuProductPriceLabel, variantNameFor, variantValidationError } from "./menu-variants.js";

const catalogVersion = "11111111-1111-4111-8111-111111111111";
const productA = "22222222-2222-4222-8222-222222222222";
const productB = "33333333-3333-4333-8333-333333333333";
const groupId = "44444444-4444-4444-8444-444444444444";
const optionId = "55555555-5555-4555-8555-555555555555";
const optionId2 = "66666666-6666-4666-8666-666666666666";
const lineId1 = "77777777-7777-4777-8777-777777777777";
const lineId2 = "88888888-8888-4888-8888-888888888888";
const lineId3 = "99999999-9999-4999-8999-999999999999";
const variantA = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const variantB = "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("sizes validate names and count, and the card shows the lowest active price", () => {
  const product = { productId: productA, categoryId: "c1", name: "Pizza", active: true, displayOrder: 1,
    unit: "pieza", unitPriceMinor: 10_000, sku: null, stationId: "s1", tax: null, imagePath: null,
    variants: [
      { variantId: variantA, name: "Chica", active: true, displayOrder: 0, unitPriceMinor: 12_000, sku: null },
      { variantId: variantB, name: "Grande", active: true, displayOrder: 1, unitPriceMinor: 20_000, sku: null },
    ] };
  assert.equal(variantValidationError(productA, product.variants), null);
  assert.equal(variantNameFor({ products: [product] }, productA, variantB), "Grande");
  assert.equal(variantNameFor({ products: [product] }, productA, lineId3), "Tamaño seleccionado");
  assert.equal(variantNameFor({ products: [product] }, productA, null), null);
  assert.equal(variantNameFor(null, productA, variantA), "Tamaño seleccionado");
  const formatPrice = (minor: number) => `$${(minor / 100).toFixed(2)}`;
  assert.equal(menuProductPriceLabel(product, formatPrice), "desde $120.00");
  assert.equal(menuProductPriceLabel({ ...product, variants: product.variants.map((v) => ({ ...v, active: false })) }, formatPrice), "$100.00");
  const repeated = variantValidationError(productA, [...product.variants, { ...product.variants[0]!, variantId: lineId3, name: "chica" }]);
  assert.equal(repeated?.productId, productA);
  assert.match(repeated?.message ?? "", /distinto/);
  assert.match(variantValidationError(productA, [{ ...product.variants[0]!, name: " " }])?.message ?? "", /nombre/);
  assert.match(variantValidationError(productA, Array.from({ length: 13 }, (_, index) => ({ ...product.variants[0]!, variantId: String(index), name: String(index) })))?.message ?? "", /12/);
  assert.equal(estimateSelectionMinor(product, [], {}, 2, variantB), 40_000);
  assert.equal(estimateSelectionMinor(product, [], {}, 1, null), null);
  assert.equal(estimateSelectionMinor(product, [], {}, 1, "missing"), null);
});

test("capture plan keeps each size separate and forwards its variantId", () => {
  const base: SelectionPlanLineDraft = { lineId: lineId1, productId: productA, variantId: variantA, quantity: 1, modifierGroups: [], note: null };
  const changed = applyLineChange([base], { type: "add", lineId: lineId2, productId: productA, variantId: variantB,
    quantity: 1, modifierGroups: [], note: null });
  assert.equal(changed.length, 2);
  assert.deepEqual(buildSelectionPlan(changed, catalogVersion).lines.map((line) => line.variantId), [variantA, variantB]);
});


test("sheet selections preserve quantities without duplicate option IDs", () => {
  assert.deepEqual(countModifierSelections([optionId, optionId2, optionId]), [
    { optionId, quantity: 2 }, { optionId: optionId2, quantity: 1 },
  ]);
});

test("repeatable modifier steps up, down to zero, and respects its option maximum", () => {
  const one = toggleOrStepOption([], optionId, 1, 2);
  const two = toggleOrStepOption(one, optionId, 1, 2);
  assert.deepEqual(two, [optionId, optionId]);
  assert.equal(toggleOrStepOption(two, optionId, 1, 2), two);
  assert.deepEqual(toggleOrStepOption(two, optionId, -1, 2), [optionId]);
  assert.deepEqual(toggleOrStepOption([optionId], optionId, -1, 2), []);
  assert.deepEqual(toggleOrStepOption([], optionId, -1, null), []);
  assert.deepEqual(toggleOrStepOption([optionId], optionId, 1, 1), []);
});

test("editing initializes repeated modifier counts from the saved line", () => {
  const initialLine: SelectionPlanLineDraft = { lineId: lineId1, productId: productA, variantId: null, quantity: 1,
    modifierGroups: [{ groupId, selections: [{ optionId, quantity: 3 }, { optionId: optionId2, quantity: 1 }] }], note: null };
  const expanded = expandModifierSelections(initialLine.modifierGroups[0]?.selections ?? []);
  assert.deepEqual(countModifierSelections(expanded), initialLine.modifierGroups[0]?.selections);
  const edited = toggleOrStepOption(expanded, optionId, -1, null);
  assert.deepEqual(countModifierSelections(edited), [{ optionId, quantity: 2 }, { optionId: optionId2, quantity: 1 }]);
});

test("buildSelectionPlan projects draft lines with a null variantId and forwards the note", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, variantId: null, quantity: 2,
      modifierGroups: [{ groupId, selections: [{ optionId, quantity: 1 }] }], note: "Sin cebolla" },
  ];
  const plan = buildSelectionPlan(lines, catalogVersion);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.catalogVersion, catalogVersion);
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0]?.variantId, null);
  assert.equal(plan.lines[0]?.note, "Sin cebolla");
  assert.deepEqual(plan.lines[0]?.modifierGroups, [{ groupId, selections: [{ optionId, quantity: 1 }] }]);
});

test("buildSelectionPlan on an empty set clears the plan", () => {
  assert.deepEqual(buildSelectionPlan([], catalogVersion).lines, []);
});

test("applyLineChange add without modifiers merges into the existing line by incrementing", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, variantId: null, quantity: 1, modifierGroups: [], note: null },
  ];
  const next = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, variantId: null, quantity: 1, modifierGroups: [], note: null });
  assert.equal(next.length, 1);
  assert.equal(next[0]?.quantity, 2);
  assert.equal(next[0]?.lineId, lineId1);
});

test("applyLineChange add with a distinct modifier selection creates a new line", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, variantId: null, quantity: 1, modifierGroups: [{ groupId, selections: [{ optionId, quantity: 1 }] }], note: null },
  ];
  const next = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, variantId: null, quantity: 1,
    modifierGroups: [{ groupId, selections: [{ optionId: optionId2, quantity: 1 }] }], note: null });
  assert.equal(next.length, 2);
});

test("applyLineChange add with the same modifier selection (different order) merges", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, variantId: null, quantity: 1,
      modifierGroups: [{ groupId, selections: [{ optionId, quantity: 1 }, { optionId: optionId2, quantity: 2 }] }], note: null },
  ];
  const next = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, variantId: null, quantity: 3,
    modifierGroups: [{ groupId, selections: [{ optionId: optionId2, quantity: 2 }, { optionId, quantity: 1 }] }], note: null });
  assert.equal(next.length, 1);
  assert.equal(next[0]?.quantity, 4);
});

test("applyLineChange increment/decrement/remove", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, variantId: null, quantity: 1, modifierGroups: [], note: null },
    { lineId: lineId2, productId: productB, variantId: null, quantity: 1, modifierGroups: [], note: null },
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
    { lineId: lineId3, productId: productA, variantId: null, quantity: 999, modifierGroups: [], note: null },
  ];
  const clamped = applyLineChange(lines, { type: "add", lineId: lineId1, productId: productA, variantId: null, quantity: 50, modifierGroups: [], note: null });
  assert.equal(clamped[0]?.quantity, 1000);
  const cleared = applyLineChange(lines, { type: "setQuantity", lineId: lineId3, quantity: 0 });
  assert.deepEqual(cleared, []);
});

test("applyLineChange add with a distinct note never merges into an otherwise-identical line", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, variantId: null, quantity: 1, modifierGroups: [], note: "Sin cebolla" },
  ];
  const next = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, variantId: null, quantity: 1, modifierGroups: [], note: null });
  assert.equal(next.length, 2);
  const merged = applyLineChange(lines, { type: "add", lineId: lineId2, productId: productA, variantId: null, quantity: 1, modifierGroups: [], note: "Sin cebolla" });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.quantity, 2);
});

test("applyLineChange setNote updates only the targeted line", () => {
  const lines: readonly SelectionPlanLineDraft[] = [
    { lineId: lineId1, productId: productA, variantId: null, quantity: 1, modifierGroups: [], note: null },
    { lineId: lineId2, productId: productB, variantId: null, quantity: 1, modifierGroups: [], note: null },
  ];
  const next = applyLineChange(lines, { type: "setNote", lineId: lineId1, note: "Bien cocida" });
  assert.equal(next.find((l) => l.lineId === lineId1)?.note, "Bien cocida");
  assert.equal(next.find((l) => l.lineId === lineId2)?.note, null);
});

test("groupProductsByCategory returns only active categories sorted by displayOrder, with their products", () => {
  const catalog = {
    catalogVersion, currency: "MXN", replayed: false, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "u1", version: 1,
    categories: [
      { categoryId: "c2", name: "Bebidas", active: true, color: null, displayOrder: 2, imagePath: null },
      { categoryId: "c1", name: "Pizzas", active: true, color: null, displayOrder: 1, imagePath: null },
      { categoryId: "c3", name: "Oculta", active: false, color: null, displayOrder: 0, imagePath: null },
    ],
    products: [
      { productId: "p1", categoryId: "c1", name: "Pizza", active: true, displayOrder: 1, unit: "pieza",
        unitPriceMinor: 1000, sku: null, stationId: "s1", tax: null, imagePath: null },
      { productId: "p2", categoryId: "c2", name: "Refresco", active: false, displayOrder: 1, unit: "pieza",
        unitPriceMinor: 500, sku: null, stationId: "s1", tax: null, imagePath: null },
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
      { optionId, name: "BBQ", active: true, unitPriceMinor: 0, maximumQuantity: 1, imagePath: null },
      { optionId: optionId2, name: "Búfalo", active: true, unitPriceMinor: 0, maximumQuantity: null, imagePath: null },
    ] };
  assert.equal(validateModifierSelection(group, []).valid, false);
  assert.equal(validateModifierSelection(group, []).reason, "min");
  assert.equal(validateModifierSelection(group, [{ optionId, quantity: 1 }]).valid, true);
  assert.equal(validateModifierSelection(group, [{ optionId, quantity: 2 }]).reason, "option_max");
  assert.equal(validateModifierSelection(group, [{ optionId, quantity: 1 }, { optionId: optionId2, quantity: 2 }]).reason, "max");
});

test("estimateSelectionMinor adds catalog modifier prices in integer minor units", () => {
  const product = { productId: productA, categoryId: "c1", name: "Pizza", active: true, displayOrder: 1,
    unit: "pieza", unitPriceMinor: 12550, sku: null, stationId: "s1", tax: null, imagePath: null };
  const group: MenuModifierGroupV1 = { groupId, productId: productA, name: "Tamaño", active: true,
    displayOrder: 1, minimumQuantity: 0, maximumQuantity: 1,
    options: [{ optionId, name: "Grande", active: true, unitPriceMinor: 2500, maximumQuantity: 1, imagePath: null }] };
  assert.equal(estimateSelectionMinor(product, [group], { [groupId]: [optionId] }, 2), 30100);
  assert.equal(estimateSelectionMinor(product, [group], {}, 1), 12550);
  assert.equal(estimateSelectionMinor(product, [group], { [groupId]: ["missing"] }, 1), null);
  const withoutModifierPrice = { ...group, options: [{ ...group.options[0], unitPriceMinor: undefined }] } as unknown as MenuModifierGroupV1;
  assert.equal(estimateSelectionMinor(product, [withoutModifierPrice], { [groupId]: [optionId] }, 1), null);
});
