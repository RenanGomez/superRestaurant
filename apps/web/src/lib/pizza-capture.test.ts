import assert from "node:assert/strict";
import test from "node:test";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import {
  buildPizzaLine,
  emptyPizzaHalf,
  matchingVariantId,
  parsePizzaLineV2,
  pizzaDraftFromLine,
  pizzaHalfIssue,
  samePizzaLine,
  splitPlanPizza,
  splitQuotePizza,
  togglePizzaOption,
  withPlanPizza,
  type PizzaLineV2,
} from "./pizza-capture.js";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [P1, P2, V_M, V_L, V2_M, G_BASE, G_EXTRA, O1, O2, O3, X1] = [id(1), id(2), id(3), id(4), id(5), id(6), id(7), id(8), id(9), id(10), id(11)];

const option = (optionId: string, name: string, unitPriceMinor = 0) => ({ active: true, displayOrder: 0, maximumQuantity: 1, name, optionId, unitPriceMinor });
const baseGroup = { active: true, displayOrder: 0, groupId: G_BASE, maximumQuantity: 2, minimumQuantity: 1, name: "Ingredientes", options: [option(O1, "Jamon"), option(O2, "Queso"), option(O3, "Piña")] } as unknown as MenuModifierGroupV1;
const extraGroup = { active: true, displayOrder: 1, groupId: G_EXTRA, maximumQuantity: 1, minimumQuantity: 0, name: "Extras", options: [option(X1, "Orilla", 1500)] } as unknown as MenuModifierGroupV1;
const groups = [baseGroup, extraGroup];

const custom = { active: true, baseGroupId: G_BASE, customizeAtOrder: false, defaultIngredientOptionIds: [], extraGroupIds: [G_EXTRA], freeIngredientCount: 1, name: "Armable", pizzaMode: "custom", productId: P1, variants: [{ active: true, name: "Mediana", variantId: V_M }, { active: true, name: "Grande", variantId: V_L }] } as unknown as MenuProductV1;
const specialty = { active: true, baseGroupId: G_BASE, customizeAtOrder: true, defaultIngredientOptionIds: [O1, O2], extraGroupIds: [G_EXTRA], freeIngredientCount: 0, name: "Hawaiana", pizzaMode: "specialty", productId: P2, variants: [{ active: true, name: "mediana", variantId: V2_M }] } as unknown as MenuProductV1;
const productsById = new Map([[P1, custom], [P2, specialty]]);

test("matchingVariantId matches the size by name, case-insensitively", () => {
  assert.equal(matchingVariantId(specialty, "Mediana"), V2_M);
  assert.equal(matchingVariantId(specialty, "Grande"), undefined);
  assert.equal(matchingVariantId({ ...custom, variants: [] } as MenuProductV1, null), null);
  assert.equal(matchingVariantId(custom, null), undefined);
});

test("pizzaHalfIssue enforces ingredient bounds, removals and extras", () => {
  assert.match(pizzaHalfIssue(custom, groups, emptyPizzaHalf(P1)) ?? "", /al menos 1/u);
  assert.match(pizzaHalfIssue(custom, groups, { ...emptyPizzaHalf(P1), ingredientOptionIds: [O1, O2, O3] }) ?? "", /máximo 2/u);
  assert.equal(pizzaHalfIssue(custom, groups, { ...emptyPizzaHalf(P1), extraOptionIds: [X1], ingredientOptionIds: [O1] }), null);
  assert.match(pizzaHalfIssue(specialty, groups, { ...emptyPizzaHalf(P2), ingredientOptionIds: [O1] }) ?? "", /no lleva ingredientes/u);
  assert.equal(pizzaHalfIssue(specialty, groups, { ...emptyPizzaHalf(P2), removedIngredientOptionIds: [O1] }), null);
  assert.match(pizzaHalfIssue({ ...specialty, customizeAtOrder: false } as MenuProductV1, groups, { ...emptyPizzaHalf(P2), removedIngredientOptionIds: [O1] }) ?? "", /no se pueden quitar/u);
  assert.match(pizzaHalfIssue({ ...custom, baseGroupId: null } as unknown as MenuProductV1, groups, emptyPizzaHalf(P1)) ?? "", /grupo de ingredientes/u);
});

test("buildPizzaLine mirrors half A for a whole pizza", () => {
  const draft = { a: { ...emptyPizzaHalf(P1), ingredientOptionIds: [O1] }, b: null, split: false };
  const built = buildPizzaLine(draft, { catalogGroups: groups, productsById, sizeName: "Mediana", variantIdA: V_M });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.pizza.ruleVersion, "pizza-halves-v2");
  assert.deepEqual(built.pizza.halves.map((half) => half.fraction), ["half-a", "half-b"]);
  assert.deepEqual(built.pizza.halves[1], { ...built.pizza.halves[0], fraction: "half-b" });
});

test("buildPizzaLine resolves the other half's variant by size and refuses incomplete drafts", () => {
  const draft = { a: { ...emptyPizzaHalf(P1), ingredientOptionIds: [O1] }, b: emptyPizzaHalf(P2), split: true };
  const built = buildPizzaLine(draft, { catalogGroups: groups, productsById, sizeName: "Mediana", variantIdA: V_M });
  assert.equal(built.ok && built.pizza.halves[1].variantId, V2_M);
  const wrongSize = buildPizzaLine(draft, { catalogGroups: groups, productsById, sizeName: "Grande", variantIdA: V_L });
  assert.equal(wrongSize.ok, false);
  const noB = buildPizzaLine({ ...draft, b: null }, { catalogGroups: groups, productsById, sizeName: "Mediana", variantIdA: V_M });
  assert.equal(noB.ok, false);
  const invalidA = buildPizzaLine({ ...draft, a: emptyPizzaHalf(P1) }, { catalogGroups: groups, productsById, sizeName: "Mediana", variantIdA: V_M });
  assert.equal(invalidA.ok, false);
});

test("buildPizzaLine allows the same product on both halves with different picks", () => {
  const draft = { a: { ...emptyPizzaHalf(P1), ingredientOptionIds: [O1] }, b: { ...emptyPizzaHalf(P1), ingredientOptionIds: [O2, O3] }, split: true };
  const built = buildPizzaLine(draft, { catalogGroups: groups, productsById, sizeName: "Mediana", variantIdA: V_M });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.pizza.halves[0].ingredientOptionIds, [O1]);
  assert.deepEqual(built.pizza.halves[1].ingredientOptionIds, [O2, O3]);
  assert.equal(built.pizza.halves[1].variantId, V_M);
  assert.equal(pizzaDraftFromLine(built.pizza, P1).split, true);
});

test("togglePizzaOption adds and removes without duplicates", () => {
  const once = togglePizzaOption(emptyPizzaHalf(P1), "ingredientOptionIds", O1);
  assert.deepEqual(once.ingredientOptionIds, [O1]);
  assert.deepEqual(togglePizzaOption(once, "ingredientOptionIds", O1).ingredientOptionIds, []);
});

function sampleLine(): PizzaLineV2 {
  const built = buildPizzaLine({ a: { ...emptyPizzaHalf(P1), ingredientOptionIds: [O1, O2] }, b: null, split: false }, { catalogGroups: groups, productsById, sizeName: "Mediana", variantIdA: V_M });
  if (!built.ok) throw new Error(built.message);
  return built.pizza;
}

test("samePizzaLine ignores id order and detects differences", () => {
  const line = sampleLine();
  const reordered: PizzaLineV2 = { ...line, halves: [{ ...line.halves[0], ingredientOptionIds: [O2, O1] }, line.halves[1]] };
  assert.equal(samePizzaLine(line, reordered), true);
  assert.equal(samePizzaLine(line, { ...line, halves: [{ ...line.halves[0], ingredientOptionIds: [O1] }, line.halves[1]] }), false);
  assert.equal(samePizzaLine(undefined, undefined), true);
  assert.equal(samePizzaLine(line, undefined), false);
});

test("pizzaDraftFromLine round-trips whole and split lines", () => {
  assert.equal(pizzaDraftFromLine(sampleLine(), P1).split, false);
  assert.deepEqual(pizzaDraftFromLine(undefined, P1), { a: emptyPizzaHalf(P1), b: null, split: false });
  const line = sampleLine();
  const split: PizzaLineV2 = { ...line, halves: [line.halves[0], { ...line.halves[1], productId: P2, variantId: V2_M }] };
  const draft = pizzaDraftFromLine(split, P1);
  assert.equal(draft.split, true);
  assert.equal(draft.b?.productId, P2);
});

test("parsePizzaLineV2 accepts a valid line and rejects malformed ones", () => {
  const line = sampleLine();
  assert.deepEqual(parsePizzaLineV2(JSON.parse(JSON.stringify(line))), line);
  assert.equal(parsePizzaLineV2({ ...line, ruleVersion: "x" }), undefined);
  assert.equal(parsePizzaLineV2({ ...line, halves: [line.halves[0]] }), undefined);
  assert.equal(parsePizzaLineV2({ ...line, halves: [line.halves[1], line.halves[0]] }), undefined);
  assert.equal(parsePizzaLineV2({ ...line, halves: [{ ...line.halves[0], productId: "nope" }, line.halves[1]] }), undefined);
  assert.equal(parsePizzaLineV2(null), undefined);
});

test("splitQuotePizza separates a valid pizza and fails closed on a malformed one", () => {
  const line = sampleLine();
  assert.deepEqual(splitQuotePizza({ a: 1 }), { pizza: null, rest: { a: 1 } });
  const split = splitQuotePizza({ a: 1, pizza: line });
  assert.deepEqual(split, { pizza: line, rest: { a: 1 } });
  assert.equal(splitQuotePizza({ a: 1, pizza: { nope: true } }), undefined);
});

test("splitPlanPizza and withPlanPizza round-trip a schemaVersion 2 plan", () => {
  const line = sampleLine();
  const command = { plan: { catalogVersion: "v", lines: [{ lineId: "l1", pizza: line, productId: P1 }, { lineId: "l2", productId: P2 }], schemaVersion: 2 } };
  const split = splitPlanPizza(command);
  assert.ok(split !== undefined);
  assert.equal(split.schemaVersion, 2);
  const v1 = split.v1Input as typeof command;
  assert.equal(v1.plan.schemaVersion as number, 1);
  assert.ok(v1.plan.lines.every((entry) => !("pizza" in entry)));
  assert.deepEqual(split.pizzaByLineId.get("l1"), line);
  assert.deepEqual(withPlanPizza(v1 as never, split.pizzaByLineId), command);
});

test("splitPlanPizza passes version 1 through and rejects fraction mixed with pizza or bad pizza", () => {
  const v1 = { plan: { lines: [], schemaVersion: 1 } };
  assert.deepEqual(splitPlanPizza(v1), { pizzaByLineId: new Map(), schemaVersion: 1, v1Input: v1 });
  const line = sampleLine();
  assert.equal(splitPlanPizza({ plan: { lines: [{ fraction: {}, lineId: "a", pizza: line }], schemaVersion: 2 } }), undefined);
  assert.equal(splitPlanPizza({ plan: { lines: [{ lineId: "a", pizza: { bad: 1 } }], schemaVersion: 2 } }), undefined);
  assert.equal(splitPlanPizza({ plan: { lines: "x", schemaVersion: 2 } }), undefined);
});
