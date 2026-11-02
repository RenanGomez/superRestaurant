import assert from "node:assert/strict";
import test from "node:test";

import {
  FRACTION_CUSTOM_FLAVOR_ID,
  Money,
  type OrderItemPriceSnapshot,
} from "@super-restaurant/domain";
import { parseFractionHalfProjectionV1, type LineFractionV1 } from "@super-restaurant/shared-types";

import { describeHalves, describeHalvesFromSnapshot, describeHalvesWithIds } from "./fraction-halves.js";

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
