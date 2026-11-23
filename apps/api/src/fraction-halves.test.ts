import assert from "node:assert/strict";
import test from "node:test";

import {
  FRACTION_CUSTOM_FLAVOR_ID,
  Money,
  type OrderItemPriceSnapshot,
} from "@super-restaurant/domain";
import { parseFractionHalfProjectionV1, type LineFractionV1 } from "@super-restaurant/shared-types";

import {
  describeHalves,
  describeHalvesFromSnapshot,
  describeHalvesWithIds,
  isFractionModifier,
  readStoredPizzaHalves,
} from "./fraction-halves.js";

const FLAVOR = "9d405f61-7283-4d94-9ea5-c6d7e8f90a11";
const CHEESE = "9d405f61-7283-4d94-9ea5-c6d7e8f90a13";

const snapshot = {
  catalogVersion: "v1",
  fractionBreakdown: [
    { amountMinor: 12_000, flavorName: "Armada", flavorOptionId: FRACTION_CUSTOM_FLAVOR_ID, fraction: "half-a" },
    { amountMinor: 17_000, flavorName: "Hawaiana", flavorOptionId: FLAVOR, fraction: "half-b" },
  ],
  geometry: "halves",
  modifiers: [{
    groupCatalogVersion: "v1", groupId: "fraction-extra", groupName: "extra:half-a",
    modifierId: `extra:half-a:${CHEESE}`, name: "Queso", quantity: 1, unitPrice: new Money(1_251, "MXN"),
  }],
  name: "Pizza",
  productId: "pizza",
  stationId: "kitchen",
  unit: "piece",
  unitPrice: new Money(17_000, "MXN"),
} as unknown as OrderItemPriceSnapshot;

test("a half built ingredient by ingredient is shown as Armada and its id is null in the projection", () => {
  const halves = describeHalves(snapshot);
  assert.deepEqual(halves.map((half) => [half.fraction, half.flavorName, half.amountMinor]), [
    ["half-a", "Armada", 12_000], ["half-b", "Hawaiana", 17_000],
  ]);
  assert.deepEqual(halves[0]?.extras, ["Queso"]);
  const projected = describeHalvesFromSnapshot(snapshot);
  assert.equal(projected[0]?.flavorOptionId, null);
  assert.deepEqual(projected[0]?.extraOptionIds, [CHEESE]);
  assert.equal(projected[1]?.flavorOptionId, FLAVOR);
  // The projection parses with the shared strict parser, ids included.
  for (const half of projected) assert.ok(parseFractionHalfProjectionV1(half) !== undefined);
});

test("the plan projection copies the stored slot ids, null flavor included", () => {
  const fraction: LineFractionV1 = {
    geometry: "halves",
    slots: [
      { excludedIngredientIds: [], extraOptionIds: [CHEESE], flavorOptionId: null, fraction: "half-a" },
      { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: FLAVOR, fraction: "half-b" },
    ],
  };
  const projected = describeHalvesWithIds(snapshot, fraction);
  assert.equal(projected[0]?.flavorOptionId, null);
  assert.deepEqual(projected[0]?.extraOptionIds, [CHEESE]);
  assert.equal(projected[1]?.flavorOptionId, FLAVOR);
});

test("exclusions strip 'Sin ' prefix for display and recover option IDs from modifierId", () => {
  const ONION_ID = "8a506172-7283-4d94-9ea5-c6d7e8f90a99";
  const snapWithExclusion = {
    ...snapshot,
    modifiers: [
      ...snapshot.modifiers,
      {
        groupCatalogVersion: "v1",
        groupId: "fraction-exclusion",
        groupName: "exclude:half-a",
        modifierId: `exclude:half-a:${ONION_ID}`,
        name: "Sin Cebolla",
        quantity: 1,
        unitPrice: new Money(0, "MXN"),
      },
    ],
  } as unknown as OrderItemPriceSnapshot;

  const halves = describeHalves(snapWithExclusion);
  assert.deepEqual(halves[0]?.exclusions, ["Cebolla"]);

  const projected = describeHalvesFromSnapshot(snapWithExclusion);
  assert.deepEqual(projected[0]?.excludedIngredientIds, [ONION_ID]);

  // Legacy fallback: name without "Sin " prefix and legacy label in modifierId
  const legacySnap = {
    ...snapshot,
    modifiers: [
      ...snapshot.modifiers,
      {
        groupCatalogVersion: "v1",
        groupId: "fraction-exclusion",
        groupName: "exclude:half-a",
        modifierId: "exclude:half-a:cebolla",
        name: "cebolla",
        quantity: 1,
        unitPrice: new Money(0, "MXN"),
      },
    ],
  } as unknown as OrderItemPriceSnapshot;

  const legacyHalves = describeHalves(legacySnap);
  assert.deepEqual(legacyHalves[0]?.exclusions, ["cebolla"]);

  const legacyProjected = describeHalvesFromSnapshot(legacySnap);
  assert.deepEqual(legacyProjected[0]?.excludedIngredientIds, ["cebolla"]);
});

const ONION = "8a506172-7283-4d94-9ea5-c6d7e8f90a99";
const HAM = "8a506172-7283-4d94-9ea5-c6d7e8f90a01";
const EXTRA = "8a506172-7283-4d94-9ea5-c6d7e8f90a02";
const money = (amountMinor: number) => ({ amountMinor, currency: "MXN" });

const pizzaHalves = {
  basePrice: money(10_000),
  baseFraction: "half-a",
  charges: [
    { amount: money(0), fractions: ["half-a", "half-b"], free: true, groupId: "g-base", name: "Jamon", optionId: HAM, role: "ingredient" },
    { amount: money(1_251), fractions: ["half-b"], free: false, groupId: "g-extra", name: "Queso extra", optionId: EXTRA, role: "extra" },
  ],
  currency: "MXN",
  freeAssignmentOrder: [HAM],
  freeIngredientCount: 1,
  freeIngredientCountFraction: "half-a",
  halves: [
    { basePriceMinor: 10_000, fraction: "half-a", freeIngredientCount: 1, kind: "custom", productId: "p-a", productName: "Pizza personalizada", removedIngredientOptionIds: [], sizeId: "s", sizeName: "Grande", stationId: "kitchen" },
    { basePriceMinor: 9_000, fraction: "half-b", freeIngredientCount: 0, kind: "specialty", productId: "p-b", productName: "Hawaiana", removedIngredientOptionIds: [ONION], sizeId: "s", sizeName: "Grande", stationId: "kitchen" },
  ],
  ruleVersion: "pizza-halves-v2",
  schemaVersion: 1,
  total: money(11_251),
};

const v2Snapshot = {
  catalogVersion: "v1",
  geometry: "halves",
  modifiers: [{
    groupCatalogVersion: "v1", groupId: "fraction-exclusion", groupName: "exclude:half-b",
    modifierId: `exclude:half-b:${ONION}`, name: "Sin Cebolla", quantity: 1, unitPrice: new Money(0, "MXN"),
  }],
  name: "Pizza",
  pizzaHalves,
  productId: "p-a",
  stationId: "kitchen",
  unit: "piece",
  unitPrice: new Money(10_000, "MXN"),
} as unknown as OrderItemPriceSnapshot;

test("a V2 snapshot is described per half from pizzaHalves: charges by half, 'both' on both, removals", () => {
  const halves = describeHalves(v2Snapshot);
  assert.deepEqual(halves.map((half) => [half.fraction, half.flavorName, half.amountMinor]), [
    ["half-a", "Pizza personalizada", 10_000], ["half-b", "Hawaiana", 9_000],
  ]);
  assert.deepEqual(halves[0]?.extras, ["Jamon"]);
  assert.deepEqual(halves[1]?.extras, ["Jamon", "Queso extra"]);
  assert.deepEqual(halves[0]?.exclusions, []);
  assert.deepEqual(halves[1]?.exclusions, ["Cebolla"]);
});

test("pizza V2 charge modifiers are fraction modifiers and legacy catalog modifiers are not", () => {
  assert.equal(isFractionModifier({ groupId: "pizza-ingredient" }), true);
  assert.equal(isFractionModifier({ groupId: "pizza-extra" }), true);
  assert.equal(isFractionModifier({ groupId: "fraction-extra" }), true);
  assert.equal(isFractionModifier({ groupId: "salsas" }), false);
});

test("a corrupt V2 snapshot fails closed instead of falling back to the legacy reader", () => {
  const broken = { ...v2Snapshot, pizzaHalves: { ...pizzaHalves, total: money(1) } } as unknown as OrderItemPriceSnapshot;
  assert.throws(() => describeHalves(broken));
  const unknownRule = { ...v2Snapshot, pizzaHalves: { ...pizzaHalves, ruleVersion: "pizza-halves-v9" } } as unknown as OrderItemPriceSnapshot;
  assert.throws(() => describeHalves(unknownRule));
});

test("the historical legacy snapshot still reads through fractionBreakdown when pizzaHalves is absent", () => {
  assert.equal(readStoredPizzaHalves(snapshot), undefined);
  assert.equal(describeHalves(snapshot).length, 2);
});

test("a V2 snapshot has no recoverable ids: the id readers return the plain per-half view and never guess", () => {
  const plain = describeHalves(v2Snapshot);
  assert.deepEqual(describeHalvesFromSnapshot(v2Snapshot), plain);
  assert.deepEqual(describeHalvesWithIds(v2Snapshot, null), plain);
});
