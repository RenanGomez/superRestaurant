import assert from "node:assert/strict";
import test from "node:test";
import type { FractionHalfProjectionV1, MenuCatalogV1, MenuModifierGroupV1, MenuVariantFractionV1, OrderDetailFractionHalfV1 } from "@super-restaurant/shared-types";
import {
  buildLineFraction,
  draftLinesFromProjection,
  splitLostMessage,
  emptyHalvesDraft,
  estimateHalvesUnitMinor,
  halfLabel,
  halfTicketLines,
  halvesDraftFromFraction,
  pickHalfFlavor,
  restoreLineFraction,
  toggleHalfEntry,
  validateHalvesDraft,
  variantAllowsHalves,
} from "./line-halves.js";
import { applyLineChange, buildSelectionPlan, sameLineFraction } from "./capture-selection.js";
import { variantValidationError } from "./menu-variants.js";

const flavorGroupId = "11111111-1111-4111-8111-111111111111";
const extraGroupId = "22222222-2222-4222-8222-222222222222";
const margarita = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pepperoni = "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const queso = "ccccccc3-cccc-4ccc-8ccc-cccccccccccc";
const piña = "ddddddd4-dddd-4ddd-8ddd-dddddddddddd";

const option = (optionId: string, name: string, unitPriceMinor: number) =>
  ({ active: true, imagePath: null, maximumQuantity: null, name, optionId, unitPriceMinor });
const flavors: MenuModifierGroupV1 = { active: true, displayOrder: 0, groupId: flavorGroupId, maximumQuantity: 1, minimumQuantity: 0,
  name: "Sabores", options: [option(margarita, "Margarita", 0), option(pepperoni, "Pepperoni", 18_000)], productId: "p" };
const extras: MenuModifierGroupV1 = { active: true, displayOrder: 1, groupId: extraGroupId, maximumQuantity: 5, minimumQuantity: 0,
  name: "Extras", options: [option(queso, "Queso extra", 3_001), option(piña, "Piña", 2_000)], productId: "p" };
const setup: MenuVariantFractionV1 = { enabled: true, excludableIngredientIds: ["cebolla"], extraGroupId, flavorGroupId, lockedIngredientOptionIds: [] };

test("two flavors are required before a half-and-half line can be added", () => {
  assert.deepEqual(validateHalvesDraft(emptyHalvesDraft()), { valid: false, message: "Elige los dos sabores" });
  const one = pickHalfFlavor(emptyHalvesDraft(), "half-a", margarita);
  assert.equal(validateHalvesDraft(one).valid, false);
  assert.equal(buildLineFraction(one), null);
  const both = pickHalfFlavor(one, "half-b", pepperoni);
  assert.deepEqual(validateHalvesDraft(both), { valid: true, message: null });
  assert.equal(pickHalfFlavor(both, "half-a", margarita).a.flavorOptionId, null, "tapping again clears");
});

test("the estimate takes the greater flavor, zero-priced flavors use the size price, extras cost half rounded up", () => {
  let draft = pickHalfFlavor(pickHalfFlavor(emptyHalvesDraft(), "half-a", margarita), "half-b", pepperoni);
  const estimate = (value: typeof draft, other = 0) => estimateHalvesUnitMinor({
    variantPriceMinor: 15_000, flavorGroup: flavors, extraGroup: extras, draft: value, otherModifiersMinor: other });
  assert.equal(estimate(draft), 18_000);
  draft = toggleHalfEntry(draft, "half-a", "extraOptionIds", queso);
  assert.equal(estimate(draft), 18_000 + 1_501, "3001 / 2 rounds up to 1501");
  draft = toggleHalfEntry(draft, "half-b", "extraOptionIds", piña);
  assert.equal(estimate(draft, 500), 18_000 + 1_501 + 1_000 + 500);
  const cheap = pickHalfFlavor(pickHalfFlavor(emptyHalvesDraft(), "half-a", margarita), "half-b", margarita);
  assert.equal(estimate(cheap), 15_000, "zero price takes the size price");
  assert.equal(estimate(emptyHalvesDraft()), null);
  assert.ok(Number.isInteger(estimate(draft)));
});

test("the line fraction lists half-a then half-b and round-trips into a draft", () => {
  let draft = pickHalfFlavor(pickHalfFlavor(emptyHalvesDraft(), "half-b", pepperoni), "half-a", margarita);
  draft = toggleHalfEntry(draft, "half-b", "excludedIngredientIds", "cebolla");
  draft = toggleHalfEntry(draft, "half-a", "extraOptionIds", queso);
  const fraction = buildLineFraction(draft);
  assert.deepEqual(fraction, { geometry: "halves", slots: [
    { excludedIngredientIds: [], extraOptionIds: [queso], flavorOptionId: margarita, fraction: "half-a" },
    { excludedIngredientIds: ["cebolla"], extraOptionIds: [], flavorOptionId: pepperoni, fraction: "half-b" },
  ] });
  assert.deepEqual(halvesDraftFromFraction(fraction ?? undefined), draft);
  assert.deepEqual(halvesDraftFromFraction(undefined), emptyHalvesDraft());
  assert.equal(toggleHalfEntry(draft, "half-a", "extraOptionIds", queso).a.extraOptionIds.length, 0);
});

test("labels read Mitad A / Mitad B with extras and exclusions underneath", () => {
  assert.equal(halfLabel("half-a"), "Mitad A");
  const half: OrderDetailFractionHalfV1 = { amountMinor: 18_000, exclusions: ["cebolla"], extras: ["Queso extra"], flavorName: "Pepperoni", fraction: "half-b" };
  assert.deepEqual(halfTicketLines(half), { title: "Mitad B: Pepperoni", details: ["+ Queso extra", "Sin cebolla"] });
});

test("sizes allow halves only when enabled with a flavor group", () => {
  assert.equal(variantAllowsHalves(setup), true);
  assert.equal(variantAllowsHalves({ ...setup, enabled: false }), false);
  assert.equal(variantAllowsHalves({ ...setup, flavorGroupId: null }), false);
  assert.equal(variantAllowsHalves(null), false);
  assert.equal(variantAllowsHalves(undefined), false);
});

test("a saved projection is turned back into ids so re-sending the plan keeps the halves", () => {
  const halves: OrderDetailFractionHalfV1[] = [
    { amountMinor: 15_000, exclusions: [], extras: ["Queso extra"], flavorName: "Margarita", fraction: "half-a" },
    { amountMinor: 18_000, exclusions: ["cebolla"], extras: [], flavorName: "Pepperoni", fraction: "half-b" },
  ];
  const restored = restoreLineFraction(halves, setup, [flavors, extras]);
  assert.ok(restored.ok);
  assert.deepEqual(restored.ok ? restored.fraction.slots.map((slot) => [slot.fraction, slot.flavorOptionId, slot.extraOptionIds, slot.excludedIngredientIds]) : [],
    [["half-a", margarita, [queso], []], ["half-b", pepperoni, [], ["cebolla"]]]);
  assert.deepEqual(restoreLineFraction(halves, setup, [extras]), { ok: false, reason: "flavor" }, "flavor group gone");
  assert.equal(restoreLineFraction(undefined, setup, [flavors, extras]).ok, false);
  assert.equal(restoreLineFraction(halves, null, [flavors, extras]).ok, false);
  const renamed = halves.map((half) => ({ ...half, flavorName: "Hawaiana" }));
  assert.deepEqual(restoreLineFraction(renamed, setup, [flavors, extras]), { ok: false, reason: "flavor" }, "name absent");
  const duplicated = { ...flavors, options: [...flavors.options, option("eeeeeee5-eeee-4eee-8eee-eeeeeeeeeeee", "Margarita", 0)] };
  assert.deepEqual(restoreLineFraction(halves, setup, [duplicated, extras]), { ok: false, reason: "flavor" }, "duplicate name");
  const inactive = { ...flavors, options: flavors.options.map((entry) => ({ ...entry, active: false })) };
  assert.equal(restoreLineFraction(halves, setup, [inactive, extras]).ok, false, "inactive options");
  const extraMissing = { ...extras, options: [] };
  assert.deepEqual(restoreLineFraction(halves, setup, [flavors, extraMissing]), { ok: false, reason: "extra" });
});

test("projected ids preserve both halves after flavor and extra names change", () => {
  const halves: FractionHalfProjectionV1[] = [
    { amountMinor: 15_000, exclusions: [], extras: ["Queso extra"], flavorName: "Margarita",
      fraction: "half-a", flavorOptionId: margarita, extraOptionIds: [queso], excludedIngredientIds: [] },
    { amountMinor: 18_000, exclusions: ["cebolla"], extras: [], flavorName: "Pepperoni",
      fraction: "half-b", flavorOptionId: pepperoni, extraOptionIds: [], excludedIngredientIds: ["cebolla"] },
  ];
  const renamedFlavors = { ...flavors, options: flavors.options.map((entry) => ({ ...entry, name: "Nuevo sabor" })) };
  const renamedExtras = { ...extras, options: extras.options.map((entry) => ({ ...entry, name: "Nuevo extra" })) };
  const restored = restoreLineFraction(halves, setup, [renamedFlavors, renamedExtras]);
  assert.ok(restored.ok);
  assert.deepEqual(restored.ok ? restored.fraction.slots : [], [
    { fraction: "half-a", flavorOptionId: margarita, extraOptionIds: [queso], excludedIngredientIds: [] },
    { fraction: "half-b", flavorOptionId: pepperoni, extraOptionIds: [], excludedIngredientIds: ["cebolla"] },
  ]);
  assert.deepEqual(restoreLineFraction(halves, setup, [renamedExtras]), { ok: false, reason: "flavor" });
  assert.deepEqual(restoreLineFraction(halves, setup, [renamedFlavors]), { ok: false, reason: "extra" });
  assert.deepEqual(restoreLineFraction([{ ...halves[0]!, flavorOptionId: pepperoni }, halves[1]!], setup,
    [{ ...renamedFlavors, options: renamedFlavors.options.filter((entry) => entry.optionId !== pepperoni) }, renamedExtras]),
    { ok: false, reason: "flavor" });
  assert.deepEqual(restoreLineFraction(halves, { ...setup, excludableIngredientIds: [] }, [renamedFlavors, renamedExtras]),
    { ok: false, reason: "extra" });
});

test("restoreLineFraction allows excluding options from extraGroup unless locked", () => {
  const halvesWithOption: FractionHalfProjectionV1[] = [
    { amountMinor: 0, exclusions: [], extras: [], excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: margarita, flavorName: "Margarita", fraction: "half-a" },
    { amountMinor: 18_000, exclusions: [], extras: [], excludedIngredientIds: [queso], extraOptionIds: [], flavorOptionId: pepperoni, flavorName: "Pepperoni", fraction: "half-b" },
  ];
  const allowed = restoreLineFraction(halvesWithOption, { ...setup, excludableIngredientIds: [], lockedIngredientOptionIds: [] }, [flavors, extras]);
  assert.equal(allowed.ok, true);

  const rejected = restoreLineFraction(halvesWithOption, { ...setup, excludableIngredientIds: [], lockedIngredientOptionIds: [queso] }, [flavors, extras]);
  assert.deepEqual(rejected, { ok: false, reason: "extra" });
});

test("a split line that cannot be restored never becomes a whole line in the rebuilt plan", () => {
  const halves: OrderDetailFractionHalfV1[] = [
    { amountMinor: 15_000, exclusions: [], extras: [], flavorName: "Margarita", fraction: "half-a" },
    { amountMinor: 18_000, exclusions: [], extras: [], flavorName: "Pepperoni", fraction: "half-b" },
  ];
  const line = (lineId: string, withHalves: boolean) => ({ lineId, productId: "p", variantId: "v1", productName: "Pizza", quantity: 1,
    unitPriceMinor: 18_000, lineTotalMinor: 18_000, note: null, modifiers: [], ...(withHalves ? { halves } : {}) });
  const variant = { active: true, displayOrder: 0, fraction: setup, name: "Grande", sku: null, unitPriceMinor: 15_000, variantId: "v1" };
  const catalog = (groups: MenuModifierGroupV1[]) => ({ modifierGroups: groups,
    products: [{ productId: "p", variants: [variant] }] as unknown as MenuCatalogV1["products"] });
  const ok = draftLinesFromProjection([line("l1", true), line("l2", false)], catalog([flavors, extras]));
  assert.ok(ok.ok);
  assert.equal(ok.ok ? ok.lines[0]?.fraction?.slots.length : 0, 2);
  assert.equal(ok.ok ? ok.lines[1]?.fraction : "x", undefined);
  const noCatalog = draftLinesFromProjection([line("l1", true), line("l2", false)], null);
  assert.deepEqual(noCatalog, { ok: false, lineName: "Pizza" });
  assert.deepEqual(draftLinesFromProjection([line("l1", true)], catalog([extras])), { ok: false, lineName: "Pizza" });
  assert.equal(splitLostMessage("Pizza"), 'No se pudo conservar la división de "Pizza"; recarga el menú');
});

test("changing another line's quantity keeps projected half ids in the replacement plan", () => {
  const halves: FractionHalfProjectionV1[] = [
    { amountMinor: 15_000, exclusions: [], extras: ["Queso extra"], flavorName: "Margarita",
      fraction: "half-a", flavorOptionId: margarita, extraOptionIds: [queso], excludedIngredientIds: [] },
    { amountMinor: 18_000, exclusions: ["cebolla"], extras: [], flavorName: "Pepperoni",
      fraction: "half-b", flavorOptionId: pepperoni, extraOptionIds: [], excludedIngredientIds: ["cebolla"] },
  ];
  const variant = { active: true, displayOrder: 0, fraction: setup, name: "Grande", sku: null, unitPriceMinor: 15_000, variantId: "v1" };
  const catalog = { modifierGroups: [
    { ...flavors, options: flavors.options.map((entry) => ({ ...entry, name: "Renombrado" })) },
    { ...extras, options: extras.options.map((entry) => ({ ...entry, name: "Extra renombrado" })) },
  ], products: [{ productId: "p", variants: [variant] }] as unknown as MenuCatalogV1["products"] };
  const line = (lineId: string, withHalves: boolean) => ({ lineId, productId: "p", variantId: "v1", productName: "Pizza",
    quantity: 1, unitPriceMinor: 18_000, lineTotalMinor: 18_000, note: null, modifiers: [],
    ...(withHalves ? { halves } : {}) });
  const restored = draftLinesFromProjection([line("split", true), line("other", false)], catalog);
  assert.ok(restored.ok);
  if (!restored.ok) return;
  const updated = applyLineChange(restored.lines, { type: "increment", lineId: "other" });
  const plan = buildSelectionPlan(updated, flavorGroupId);
  assert.equal(plan.lines.find((entry) => entry.lineId === "other")?.quantity, 2);
  assert.deepEqual(plan.lines.find((entry) => entry.lineId === "split")?.fraction?.slots, [
    { fraction: "half-a", flavorOptionId: margarita, extraOptionIds: [queso], excludedIngredientIds: [] },
    { fraction: "half-b", flavorOptionId: pepperoni, extraOptionIds: [], excludedIngredientIds: ["cebolla"] },
  ]);
});

test("selection plan lines carry fraction and only merge when the split is identical", () => {
  const fractionA = buildLineFraction(pickHalfFlavor(pickHalfFlavor(emptyHalvesDraft(), "half-a", margarita), "half-b", pepperoni));
  const fractionB = buildLineFraction(pickHalfFlavor(pickHalfFlavor(emptyHalvesDraft(), "half-a", pepperoni), "half-b", margarita));
  assert.ok(fractionA !== null && fractionB !== null);
  const add = (lineId: string, fraction?: typeof fractionA) => ({ type: "add" as const, lineId, productId: "p", quantity: 1,
    variantId: "v", modifierGroups: [], note: null, ...(fraction === undefined || fraction === null ? {} : { fraction }) });
  let lines = applyLineChange([], add("l1", fractionA));
  lines = applyLineChange(lines, add("l2", fractionA));
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.quantity, 2);
  lines = applyLineChange(lines, add("l3", fractionB));
  lines = applyLineChange(lines, add("l4"));
  assert.equal(lines.length, 3);
  const plan = buildSelectionPlan(lines, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(plan.lines[0]?.fraction, fractionA);
  assert.equal(Object.hasOwn(plan.lines[2] ?? {}, "fraction"), false);
  assert.equal(sameLineFraction(fractionA ?? undefined, fractionA ?? undefined), true);
  assert.equal(sameLineFraction(fractionA ?? undefined, fractionB ?? undefined), false);
  assert.equal(sameLineFraction(undefined, undefined), true);
});

test("publishing guidance rejects half setups without a usable flavor group", () => {
  const variant = (fraction: MenuVariantFractionV1 | null) => ({ active: true, displayOrder: 0, fraction, name: "Grande", sku: null, unitPriceMinor: 15_000, variantId: "v1" });
  const groupIds = new Set([flavorGroupId, extraGroupId]);
  assert.equal(variantValidationError("p", [variant(setup)], groupIds), null);
  assert.equal(variantValidationError("p", [variant(null)], groupIds), null);
  assert.equal(variantValidationError("p", [variant({ ...setup, enabled: false, flavorGroupId: null })], groupIds), null);
  assert.match(variantValidationError("p", [variant({ ...setup, flavorGroupId: null })], groupIds)?.message ?? "", /grupo de sabores/);
  assert.match(variantValidationError("p", [variant({ ...setup, extraGroupId: flavorGroupId })], groupIds)?.message ?? "", /distintos/);
  assert.match(variantValidationError("p", [variant(setup)], new Set([extraGroupId]))?.message ?? "", /ya no existe/);
});
