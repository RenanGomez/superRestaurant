import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainError,
  PIZZA_HALVES_RULE_V1,
  PIZZA_HALVES_RULE_V2,
  PIZZA_HALVES_SNAPSHOT_SCHEMA_VERSION,
  readPizzaHalvesPriceSnapshot,
  resolveFractionPricing,
  resolvePizzaHalvesPricing,
} from "./index.js";
import type {
  PizzaHalfInputV2,
  PizzaHalfKind,
  PizzaHalfOptionPrice,
  PizzaHalvesPriceSnapshotV2,
  PizzaHalvesPricingIssue,
} from "./index.js";

const CURRENCY = "MXN";
const GROUP = "group-ingredients";
const UUID_LOW = "00000000-0000-4000-8000-000000000001";
const UUID_HIGH = "ffffffff-0000-4000-8000-000000000002";

const A = opt("A", 100);
const B = opt("B", 200);
const C = opt("C", 300);
const D = opt("D", 401);

function opt(optionId: string, priceMinor: number, groupId = GROUP): PizzaHalfOptionPrice {
  return { groupId, name: `Opcion ${optionId}`, optionId, priceMinor };
}

function half(fraction: "half-a" | "half-b", kind: PizzaHalfKind, overrides: Partial<PizzaHalfInputV2> = {}): PizzaHalfInputV2 {
  return {
    basePriceMinor: 1000,
    extras: [],
    fraction,
    freeIngredientCount: 0,
    ingredients: [],
    kind,
    productId: fraction === "half-a" ? UUID_LOW : UUID_HIGH,
    productName: `Pizza ${fraction}`,
    removedIngredientOptionIds: [],
    sizeId: "size-large",
    sizeName: "Grande",
    stationId: fraction === "half-a" ? "station-oven" : "station-cold",
    ...overrides,
  };
}

function snapshotOf(halves: readonly PizzaHalfInputV2[]): PizzaHalvesPriceSnapshotV2 {
  const result = price(halves);
  assert.equal(Array.isArray(result), false);
  return result as PizzaHalvesPriceSnapshotV2;
}

test("snapshot carries schemaVersion plus station and size per half, and reads back after a JSON round trip", () => {
  const snapshot = snapshotOf([
    half("half-a", "custom", { freeIngredientCount: 1, ingredients: [A, B] }),
    half("half-b", "specialty", { sizeId: "size-med", sizeName: "Mediana" }),
  ]);
  assert.equal(snapshot.schemaVersion, PIZZA_HALVES_SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(snapshot.halves.map((entry) => [entry.stationId, entry.sizeId, entry.sizeName]), [
    ["station-oven", "size-large", "Grande"],
    ["station-cold", "size-med", "Mediana"],
  ]);
  const read = readPizzaHalvesPriceSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(JSON.parse(JSON.stringify(read)), JSON.parse(JSON.stringify(snapshot)));
  assert.equal(read.total.amountMinor, snapshot.total.amountMinor);
});

test("snapshot reader fails closed on unknown schemaVersion, ruleVersion, missing station/size or tampered total", () => {
  const good = JSON.parse(JSON.stringify(snapshotOf([half("half-a", "specialty"), half("half-b", "specialty")])));
  type Mutable = { schemaVersion?: number; ruleVersion: string; total: { amountMinor: number }; halves: { stationId?: string; sizeId?: string; sizeName: string }[] };
  const mutate = (change: (copy: Mutable) => void) => {
    const copy = JSON.parse(JSON.stringify(good));
    change(copy);
    return copy;
  };
  const bad = [
    mutate((copy) => { copy.schemaVersion = 2; }),
    mutate((copy) => { delete copy.schemaVersion; }),
    mutate((copy) => { copy.ruleVersion = "pizza-halves-v1"; }),
    mutate((copy) => { delete copy.halves[0]!.stationId; }),
    mutate((copy) => { delete copy.halves[1]!.sizeId; }),
    mutate((copy) => { copy.halves[0]!.sizeName = ""; }),
    mutate((copy) => { copy.total.amountMinor += 1; }),
    null,
    "snapshot",
  ];
  for (const value of bad) {
    assert.throws(() => readPizzaHalvesPriceSnapshot(value), DomainError, JSON.stringify(value)?.slice(0, 60));
  }
});

function price(halves: readonly PizzaHalfInputV2[], ruleVersion: string = PIZZA_HALVES_RULE_V2) {
  return resolvePizzaHalvesPricing({ currency: CURRENCY, halves, ruleVersion });
}

function totalOf(halves: readonly PizzaHalfInputV2[]): number {
  const result = price(halves);
  assert.equal(Array.isArray(result), false, `expected a snapshot, got ${JSON.stringify(result)}`);
  return (result as PizzaHalvesPriceSnapshotV2).total.amountMinor;
}

function codesOf(halves: readonly PizzaHalfInputV2[], ruleVersion: string = PIZZA_HALVES_RULE_V2): readonly string[] {
  const result = price(halves, ruleVersion);
  assert.equal(Array.isArray(result), true, "expected issues");
  return (result as readonly PizzaHalvesPricingIssue[]).map((issue) => issue.code);
}

test("vector 1: specialties 1500/1800 are priced at the larger whole-pizza price", () => {
  const result = price([
    half("half-a", "specialty", { basePriceMinor: 1500 }),
    half("half-b", "specialty", { basePriceMinor: 1800 }),
  ]) as PizzaHalvesPriceSnapshotV2;
  assert.equal(result.total.amountMinor, 1800);
  assert.equal(result.baseFraction, "half-b");
  assert.equal(result.freeIngredientCountFraction, null);
});

test("vector 2: N=0, A:101 left and B:103 right charge ceil per ingredient (51 + 52)", () => {
  assert.equal(totalOf([
    half("half-a", "custom", { ingredients: [opt("A", 101)] }),
    half("half-b", "custom", { ingredients: [opt("B", 103)] }),
  ]), 1103);
});

test("vector 3: N=4 makes both unique ingredients free", () => {
  assert.equal(totalOf([
    half("half-a", "custom", { freeIngredientCount: 4, ingredients: [A] }),
    half("half-b", "custom", { freeIngredientCount: 4, ingredients: [B] }),
  ]), 1000);
});

test("vector 4: a repeated ingredient counts once before N (A,B free; C right half costs ceil(300/2))", () => {
  assert.equal(totalOf([
    half("half-a", "custom", { freeIngredientCount: 2, ingredients: [A, B] }),
    half("half-b", "custom", { freeIngredientCount: 2, ingredients: [A, C] }),
  ]), 1150);
});

test("vector 5: A and B in both halves are free, D in one half costs ceil(401/2)=201", () => {
  assert.equal(totalOf([
    half("half-a", "custom", { freeIngredientCount: 2, ingredients: [A, B, D] }),
    half("half-b", "custom", { freeIngredientCount: 2, ingredients: [A, B] }),
  ]), 1201);
});

test("vector 6: the N of the more expensive custom half applies; a charged ingredient in both halves is full price", () => {
  const result = price([
    half("half-a", "custom", { basePriceMinor: 1000, freeIngredientCount: 1, ingredients: [A, B, C] }),
    half("half-b", "custom", { basePriceMinor: 1200, freeIngredientCount: 2, ingredients: [A, B, C] }),
  ]) as PizzaHalvesPriceSnapshotV2;
  assert.equal(result.total.amountMinor, 1500);
  assert.equal(result.freeIngredientCount, 2);
  assert.equal(result.freeIngredientCountFraction, "half-b");
  assert.deepEqual(result.freeAssignmentOrder, ["A", "B"]);
});

test("vector 7: equal prices tie-break by the smaller productId (N=1 here)", () => {
  const halves = [
    half("half-a", "custom", { freeIngredientCount: 1, ingredients: [A, B], productId: UUID_LOW }),
    half("half-b", "custom", { freeIngredientCount: 2, ingredients: [A, B], productId: UUID_HIGH }),
  ];
  const result = price(halves) as PizzaHalvesPriceSnapshotV2;
  assert.equal(result.total.amountMinor, 1200);
  assert.equal(result.freeIngredientCount, 1);
  // The outcome does not depend on which side the smaller UUID sits.
  const swapped = price([
    half("half-a", "custom", { freeIngredientCount: 2, ingredients: [A, B], productId: UUID_HIGH }),
    half("half-b", "custom", { freeIngredientCount: 1, ingredients: [A, B], productId: UUID_LOW }),
  ]) as PizzaHalvesPriceSnapshotV2;
  assert.equal(swapped.total.amountMinor, 1200);
  assert.equal(swapped.freeIngredientCountFraction, "half-b");
});

test("vector 8: mixed selection takes the specialty price and applies the custom half's N only to its ingredients", () => {
  assert.equal(totalOf([
    half("half-a", "specialty", { basePriceMinor: 1500 }),
    half("half-b", "custom", { basePriceMinor: 1000, freeIngredientCount: 1, ingredients: [A, opt("B", 201)] }),
  ]), 1601);
});

test("vector 9: an ingredient and an extra in both halves are charged in full once; extras never consume N", () => {
  const result = price([
    half("half-a", "custom", { extras: [opt("E", 75, "group-extras")], ingredients: [opt("A", 101)] }),
    half("half-b", "custom", { extras: [opt("E", 75, "group-extras")], ingredients: [opt("A", 101)] }),
  ]) as PizzaHalvesPriceSnapshotV2;
  assert.equal(result.total.amountMinor, 1176);
  assert.equal(result.charges.length, 2);
  // With N=1 the extra is still charged: it does not take the free slot.
  assert.equal(totalOf([
    half("half-a", "custom", { extras: [opt("E", 75, "group-extras")], freeIngredientCount: 1, ingredients: [opt("A", 101)] }),
    half("half-b", "custom", { extras: [opt("E", 75, "group-extras")], freeIngredientCount: 1, ingredients: [opt("A", 101)] }),
  ]), 1075);
});

test("vector 10: the same optionId with different prices in both halves is a named error", () => {
  assert.deepEqual(codesOf([
    half("half-a", "custom", { freeIngredientCount: 1, ingredients: [opt("A", 100)] }),
    half("half-b", "custom", { freeIngredientCount: 1, ingredients: [opt("A", 101)] }),
  ]), ["pizza_ingredient_price_conflict"]);
  assert.deepEqual(codesOf([
    half("half-a", "custom", { extras: [opt("E", 75)] }),
    half("half-b", "custom", { extras: [opt("E", 76)] }),
  ]), ["pizza_extra_price_conflict"]);
});

test("free ingredients are assigned by price ascending, then groupId, then optionId", () => {
  const result = price([
    half("half-a", "custom", { freeIngredientCount: 2, ingredients: [opt("Z", 100, "g-b"), opt("Y", 100, "g-a"), opt("X", 100, "g-a")] }),
    half("half-b", "custom", { freeIngredientCount: 2 }),
  ]) as PizzaHalvesPriceSnapshotV2;
  assert.deepEqual(result.freeAssignmentOrder, ["X", "Y"]);
  assert.equal(result.total.amountMinor, 1050);
});

test("a specialty's removed ingredients give no discount and are frozen in the snapshot", () => {
  const result = price([
    half("half-a", "specialty", { removedIngredientOptionIds: ["cheese"] }),
    half("half-b", "specialty"),
  ]) as PizzaHalvesPriceSnapshotV2;
  assert.equal(result.total.amountMinor, 1000);
  assert.deepEqual(result.halves[0]?.removedIngredientOptionIds, ["cheese"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.charges), true);
});

test("rule violations: roles, duplicates, kinds and halves", () => {
  assert.deepEqual(codesOf([
    half("half-a", "custom", { ingredients: [opt("A", 100)] }),
    half("half-b", "custom", { extras: [opt("A", 100)] }),
  ]), ["option_role_conflict"]);
  assert.deepEqual(codesOf([
    half("half-a", "custom", { ingredients: [A, A] }),
    half("half-b", "custom"),
  ]), ["option_duplicate"]);
  assert.deepEqual(codesOf([
    half("half-a", "specialty", { ingredients: [A] }),
    half("half-b", "specialty"),
  ]), ["specialty_ingredients_not_allowed"]);
  assert.deepEqual(codesOf([
    half("half-a", "custom", { removedIngredientOptionIds: ["x"] }),
    half("half-b", "custom"),
  ]), ["removal_not_allowed"]);
  assert.deepEqual(codesOf([half("half-a", "custom"), half("half-a", "custom")]), ["halves_mismatch"]);
});

test("a lagging client on the legacy version with two custom halves gets an explicit error, not a wrong charge", () => {
  const bothCustom = [half("half-a", "custom", { freeIngredientCount: 2, ingredients: [A] }), half("half-b", "custom", { freeIngredientCount: 2 })];
  assert.deepEqual(codesOf(bothCustom, PIZZA_HALVES_RULE_V1), ["fraction_both_custom"]);
  assert.deepEqual(codesOf([half("half-a", "specialty"), half("half-b", "custom")], PIZZA_HALVES_RULE_V1), ["rule_version_legacy"]);
});

test("unknown rule versions fail closed", () => {
  assert.deepEqual(codesOf([half("half-a", "custom"), half("half-b", "custom")], "pizza-halves-v3"), ["rule_version_unknown"]);
});

test("the legacy resolver still rejects two custom halves with fraction_both_custom", () => {
  const variant = {
    active: true, catalogVersion: "c1", comboSlots: [], currency: CURRENCY, customHalfPriceMinor: 1000, extras: [],
    flavors: [{ active: true, name: "Margherita", optionId: "f1", priceMinor: 1000 }], includedIngredients: [],
    name: "Pizza", productId: "p1", restaurantId: "r1", stationId: "s1", unit: "unit", variantId: "v1",
  };
  const result = resolveFractionPricing(variant, {
    catalogVersion: "c1", comboSubstitutions: [], geometry: "halves", restaurantId: "r1", variantId: "v1",
    slots: [
      { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: null, fraction: "half-a" },
      { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: null, fraction: "half-b" },
    ],
  }, { actorId: "a1", actorRole: "staff" });
  assert.equal(Array.isArray(result) && (result as readonly { code: string }[])[0]?.code, "fraction_both_custom");
});

test("malformed money fails at the boundary instead of rounding", () => {
  assert.throws(() => price([half("half-a", "custom", { basePriceMinor: 10.5 }), half("half-b", "custom")]), DomainError);
  assert.throws(() => price([half("half-a", "custom", { ingredients: [opt("A", -1)] }), half("half-b", "custom")]), DomainError);
  assert.throws(() => price([half("half-a", "custom", { freeIngredientCount: -1 }), half("half-b", "custom")]), DomainError);
});
