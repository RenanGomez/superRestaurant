import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateOrderItemTotals,
  InvalidSnapshotError,
  Money,
  type OrderItemPricingInput,
} from "./index.js";

const mxn = (amountMinor: number): Money => new Money(amountMinor, "MXN");
const plain = (amountMinor: number) => ({ amountMinor, currency: "MXN" });

function pizzaHalves(total = 11_251) {
  return {
    basePrice: plain(10_000),
    baseFraction: "half-a",
    charges: [
      { amount: plain(0), fractions: ["half-a", "half-b"], free: true, groupId: "g-base", name: "Jamon", optionId: "o-ham", role: "ingredient" },
      { amount: plain(1_251), fractions: ["half-b"], free: false, groupId: "g-extra", name: "Queso extra", optionId: "o-cheese", role: "extra" },
    ],
    currency: "MXN",
    freeAssignmentOrder: ["o-ham"],
    freeIngredientCount: 1,
    freeIngredientCountFraction: "half-a",
    halves: [
      { basePriceMinor: 10_000, fraction: "half-a", freeIngredientCount: 1, kind: "custom", productId: "p-a", productName: "Personalizada", removedIngredientOptionIds: [], sizeId: "s", sizeName: "Grande", stationId: "kitchen" },
      { basePriceMinor: 9_000, fraction: "half-b", freeIngredientCount: 0, kind: "specialty", productId: "p-b", productName: "Hawaiana", removedIngredientOptionIds: [], sizeId: "s", sizeName: "Grande", stationId: "kitchen" },
    ],
    ruleVersion: "pizza-halves-v2",
    schemaVersion: 1,
    total: plain(total),
  };
}

function input(over: Record<string, unknown> = {}, pizza: unknown = pizzaHalves()): OrderItemPricingInput {
  return {
    orderItemId: "item-1",
    quantity: 1,
    snapshot: {
      catalogVersion: "menu-v9",
      productId: "p-a",
      name: "Pizza",
      stationId: "kitchen",
      unit: "each",
      unitPrice: mxn(10_000),
      modifiers: [{ modifierId: "pizza-extra:half-b:o-cheese", groupId: "pizza-extra", groupName: "extra:half-b", groupCatalogVersion: "menu-v9", name: "Queso extra", unitPrice: mxn(1_251), quantity: 1 }],
      geometry: "halves",
      pizzaHalves: pizza,
      ...over,
    },
  } as unknown as OrderItemPricingInput;
}

test("a pizza V2 snapshot survives calculation, frozen, and the totals use unitPrice plus modifiers", () => {
  const result = calculateOrderItemTotals(input());
  const stored = result.input.snapshot.pizzaHalves;
  assert.equal(stored?.ruleVersion, "pizza-halves-v2");
  assert.equal(stored?.total.amountMinor, 11_251);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(result.input.snapshot.unitPrice.amountMinor + result.input.snapshot.modifiers.reduce((sum, modifier) => sum + modifier.unitPrice.amountMinor * modifier.quantity, 0), stored?.total.amountMinor);
});

test("the resolved snapshot (Money instances) can be calculated again: round trip is stable", () => {
  const first = calculateOrderItemTotals(input());
  const second = calculateOrderItemTotals({ ...first.input, snapshot: first.input.snapshot });
  assert.deepEqual(second.input.snapshot.pizzaHalves, first.input.snapshot.pizzaHalves);
});

test("a legacy snapshot without pizzaHalves is untouched", () => {
  const legacy = input({ pizzaHalves: undefined, modifiers: [] });
  delete (legacy.snapshot as unknown as Record<string, unknown>).pizzaHalves;
  const result = calculateOrderItemTotals(legacy);
  assert.equal(result.input.snapshot.pizzaHalves, undefined);
});

test("a pizza snapshot that disagrees with its item fails closed", () => {
  // total does not equal unitPrice + modifiers
  assert.throws(() => calculateOrderItemTotals(input({}, pizzaHalves(11_000))), InvalidSnapshotError);
  // unknown rule version
  assert.throws(() => calculateOrderItemTotals(input({}, { ...pizzaHalves(), ruleVersion: "pizza-halves-v9" })), InvalidSnapshotError);
  // not a halves line
  assert.throws(() => calculateOrderItemTotals(input({ geometry: "whole" })), InvalidSnapshotError);
  // currency mismatch
  assert.throws(() => calculateOrderItemTotals(input({}, { ...pizzaHalves(), currency: "USD" })), InvalidSnapshotError);
});

test("a regular priced modifier of the product does not count toward the halves total", () => {
  const snapshot = input().snapshot as unknown as { modifiers: unknown[] };
  const withPackaging = input({
    modifiers: [
      ...snapshot.modifiers,
      { modifierId: "o-box", groupId: "g-box", groupName: "Empaque", groupCatalogVersion: "menu-v9", name: "Caja", unitPrice: mxn(500), quantity: 1 },
    ],
  });
  const result = calculateOrderItemTotals(withPackaging);
  assert.equal(result.input.snapshot.pizzaHalves?.total.amountMinor, 11_251);
  assert.equal(result.subtotalBeforeTax.amountMinor, 11_751);
});
