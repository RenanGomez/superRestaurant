import assert from "node:assert/strict";
import test from "node:test";

import { CurrencyMismatchError } from "../errors.js";
import {
  applyAdjustment,
  applyConsumption,
  applyReceipt,
  emptyCostState,
  InventoryInsufficientStockError,
  marginBps,
  MarginRevenueZeroError,
  recomputeFromLedger,
} from "./costing.js";
import type { InventoryMovement } from "./stock-ledger.js";

function movement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: "m-1",
    restaurantId: "r1",
    branchId: "b1",
    warehouseId: "w1",
    itemId: "i1",
    kind: "receipt",
    quantityDelta: 10,
    unit: "piece",
    occurredAt: "2026-11-25T00:00:00.000Z",
    actorId: "actor-1",
    reason: null,
    idempotencyKey: "key-1",
    unitCostMinor: null,
    currency: "MXN",
    ...overrides,
  };
}

test("receipts accumulate quantity and value with a weighted average unit cost", () => {
  let state = emptyCostState("MXN");
  state = applyReceipt(state, { quantity: 10, totalCostMinor: 10_000 });
  assert.deepEqual(state, { quantityOnHand: 10, valueMinor: 10_000, currency: "MXN" });

  state = applyReceipt(state, { quantity: 10, totalCostMinor: 20_000 });
  assert.deepEqual(state, { quantityOnHand: 20, valueMinor: 30_000, currency: "MXN" });
  assert.equal(state.valueMinor / state.quantityOnHand, 1500);
});

test("consumption values stock at the current average and keeps integer minor units", () => {
  let state = applyReceipt(emptyCostState("MXN"), { quantity: 10, totalCostMinor: 10_000 });
  state = applyReceipt(state, { quantity: 10, totalCostMinor: 20_000 });

  const consumed = applyConsumption(state, 5);
  assert.equal(consumed.costMinor, 7500);
  assert.deepEqual(consumed.state, { quantityOnHand: 15, valueMinor: 22500, currency: "MXN" });
});

test("consumption above the quantity on hand fails closed", () => {
  const state = applyReceipt(emptyCostState("MXN"), { quantity: 3, totalCostMinor: 1000 });
  assert.throws(() => applyConsumption(state, 4), InventoryInsufficientStockError);
});

test("consumption rounds half up with integer arithmetic and keeps value consistent", () => {
  // Regla: costMinor = round-half-up(valueMinor * quantity / quantityOnHand) usando cociente y
  // resto enteros. Nunca se redondea un float de dinero.
  const state = applyReceipt(emptyCostState("MXN"), { quantity: 3, totalCostMinor: 1000 });

  const first = applyConsumption(state, 1);
  assert.equal(first.costMinor, 333);
  assert.deepEqual(first.state, { quantityOnHand: 2, valueMinor: 667, currency: "MXN" });

  const second = applyConsumption(first.state, 1);
  // 667 / 2 = 333.5 y el medio va hacia arriba: 334.
  assert.equal(second.costMinor, 334);
  assert.deepEqual(second.state, { quantityOnHand: 1, valueMinor: 333, currency: "MXN" });

  assert.equal(first.costMinor + second.costMinor + second.state.valueMinor, 1000);
});

test("recomputeFromLedger replays receipts, waste and adjustments", () => {
  const movements: readonly InventoryMovement[] = [
    movement({ id: "r1", kind: "receipt", quantityDelta: 10, unitCostMinor: 1000 }),
    movement({ id: "w1", kind: "waste", quantityDelta: -2, reason: "spoilage" }),
    movement({ id: "a1", kind: "adjustment", quantityDelta: 3, reason: "count fix" }),
  ];

  assert.deepEqual(recomputeFromLedger(movements, "MXN"), {
    quantityOnHand: 11,
    valueMinor: 8000,
    currency: "MXN",
  });
});

test("adjustment keeps value unless the quantity reaches zero", () => {
  const state = applyReceipt(emptyCostState("MXN"), { quantity: 2, totalCostMinor: 1000 });

  assert.deepEqual(applyAdjustment(state, 1), {
    quantityOnHand: 3,
    valueMinor: 1000,
    currency: "MXN",
  });
  assert.deepEqual(applyAdjustment(state, -2), {
    quantityOnHand: 0,
    valueMinor: 0,
    currency: "MXN",
  });
});

test("recomputeFromLedger rejects movements in another currency", () => {
  const movements: readonly InventoryMovement[] = [
    movement({ id: "r1", currency: "USD", unitCostMinor: 1000 }),
  ];

  assert.throws(() => recomputeFromLedger(movements, "MXN"), CurrencyMismatchError);
});

test("marginBps returns integer basis points and rejects zero revenue", () => {
  assert.equal(marginBps(10000, 4000), 6000);
  assert.throws(() => marginBps(0, 0), MarginRevenueZeroError);
});
