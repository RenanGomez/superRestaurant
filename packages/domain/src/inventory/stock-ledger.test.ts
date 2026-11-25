import assert from "node:assert/strict";
import test from "node:test";

import { InvalidInventoryUnitError, type InventoryUnit } from "./units.js";
import {
  applyMovement,
  InvalidMovementQuantityError,
  InvalidTransferDirectionError,
  MovementActorRequiredError,
  MovementReasonRequiredError,
  reconcileBalances,
  SaleConsumptionIdempotencyKeyRequiredError,
  SaleReversalCompensationRequiredError,
  sumBalances,
  TransferPairMismatchError,
  TransferPairRequiredError,
  validateMovement,
  validateTransferPair,
  ZeroMovementQuantityError,
  type InventoryMovement,
} from "./stock-ledger.js";

function baseMovement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: "m-1",
    warehouseId: "w1",
    itemId: "i1",
    kind: "receipt",
    quantityDelta: 10,
    unit: "g",
    occurredAt: "2026-11-25T00:00:00.000Z",
    actorId: "actor-1",
    reason: null,
    idempotencyKey: "key-1",
    ...overrides,
  };
}

function transferPair(): { out: InventoryMovement; incoming: InventoryMovement } {
  return {
    out: baseMovement({
      id: "t-out",
      kind: "transfer_out",
      warehouseId: "w1",
      quantityDelta: -10,
      reason: "branch transfer",
      actorId: "actor-1",
      idempotencyKey: "t-out",
      compensatesMovementId: "t-in",
    }),
    incoming: baseMovement({
      id: "t-in",
      kind: "transfer_in",
      warehouseId: "w2",
      quantityDelta: 10,
      reason: "branch transfer",
      actorId: "actor-1",
      idempotencyKey: "t-in",
      compensatesMovementId: "t-out",
    }),
  };
}

test("sumBalances adds signed deltas per warehouse and item", () => {
  const movements = [
    baseMovement({ id: "a", quantityDelta: 100 }),
    baseMovement({ id: "b", kind: "waste", quantityDelta: -30, reason: "spoiled", actorId: "actor-1" }),
    baseMovement({ id: "c", kind: "adjustment", quantityDelta: -20, reason: "recount", actorId: "actor-1" }),
    baseMovement({ id: "d", warehouseId: "w2", quantityDelta: 7 }),
  ];

  assert.deepEqual(sumBalances(movements), { "w1:i1": 50, "w2:i1": 7 });
});

test("receipts and outgoing movements cancel out", () => {
  const movements = [
    baseMovement({ id: "in", quantityDelta: 100 }),
    baseMovement({
      id: "out",
      kind: "sale_consumption",
      quantityDelta: -100,
      idempotencyKey: "sale-1",
    }),
  ];

  assert.deepEqual(sumBalances(movements), { "w1:i1": 0 });
});

test("applyMovement returns a new balance map without mutating its inputs", () => {
  const balances = { "w1:i1": 5 };
  const movement = baseMovement({ quantityDelta: 7 });
  const movementSnapshot = JSON.stringify(movement);

  const next = applyMovement(balances, movement);

  assert.deepEqual(next, { "w1:i1": 12 });
  assert.deepEqual(balances, { "w1:i1": 5 });
  assert.equal(JSON.stringify(movement), movementSnapshot);
});

test("validateMovement rejects zero and non-integer quantities", () => {
  assert.throws(
    () => validateMovement(baseMovement({ quantityDelta: 0 })),
    (error: unknown) =>
      error instanceof ZeroMovementQuantityError && error.code === "INVENTORY_MOVEMENT_QUANTITY_ZERO",
  );
  assert.throws(
    () => validateMovement(baseMovement({ quantityDelta: 1.5 })),
    (error: unknown) =>
      error instanceof InvalidMovementQuantityError &&
      error.code === "INVALID_INVENTORY_MOVEMENT_QUANTITY",
  );
  assert.throws(
    () => validateMovement(baseMovement({ quantityDelta: Number.NaN })),
    InvalidMovementQuantityError,
  );
});

test("validateMovement rejects an unknown inventory unit", () => {
  assert.throws(
    () => validateMovement(baseMovement({ unit: "kg" as InventoryUnit })),
    (error: unknown) =>
      error instanceof InvalidInventoryUnitError && error.code === "INVALID_INVENTORY_UNIT",
  );
});

test("waste without a reason fails with its code", () => {
  assert.throws(
    () =>
      validateMovement(
        baseMovement({ kind: "waste", quantityDelta: -5, reason: null, actorId: "actor-1" }),
      ),
    (error: unknown) =>
      error instanceof MovementReasonRequiredError &&
      error.code === "INVENTORY_MOVEMENT_REASON_REQUIRED",
  );
});

test("manual movements without an actor fail with its code", () => {
  assert.throws(
    () =>
      validateMovement(
        baseMovement({ kind: "adjustment", quantityDelta: 5, reason: "fix", actorId: "  " }),
      ),
    (error: unknown) =>
      error instanceof MovementActorRequiredError &&
      error.code === "INVENTORY_MOVEMENT_ACTOR_REQUIRED",
  );
});

test("sale_consumption without an idempotency key fails", () => {
  assert.throws(
    () =>
      validateMovement(
        baseMovement({ kind: "sale_consumption", quantityDelta: -2, idempotencyKey: "" }),
      ),
    (error: unknown) =>
      error instanceof SaleConsumptionIdempotencyKeyRequiredError &&
      error.code === "INVENTORY_SALE_CONSUMPTION_KEY_REQUIRED",
  );
});

test("sale_reversal without compensatesMovementId fails", () => {
  assert.throws(
    () =>
      validateMovement(
        baseMovement({
          kind: "sale_reversal",
          quantityDelta: 2,
          idempotencyKey: "reverse-1",
          compensatesMovementId: null,
        }),
      ),
    (error: unknown) =>
      error instanceof SaleReversalCompensationRequiredError &&
      error.code === "INVENTORY_SALE_REVERSAL_COMPENSATION_REQUIRED",
  );
});

test("a transfer without its pair reference fails", () => {
  assert.throws(
    () =>
      validateMovement(
        baseMovement({
          kind: "transfer_out",
          quantityDelta: -10,
          reason: "branch transfer",
          actorId: "actor-1",
        }),
      ),
    (error: unknown) =>
      error instanceof TransferPairRequiredError &&
      error.code === "INVENTORY_TRANSFER_PAIR_REQUIRED",
  );
});

test("transfer direction must follow its kind", () => {
  assert.throws(
    () =>
      validateMovement(
        baseMovement({
          kind: "transfer_out",
          quantityDelta: 10,
          reason: "branch transfer",
          actorId: "actor-1",
          compensatesMovementId: "t-in",
        }),
      ),
    (error: unknown) =>
      error instanceof InvalidTransferDirectionError &&
      error.code === "INVALID_INVENTORY_TRANSFER_DIRECTION",
  );
});

test("transfer out plus transfer in conserves the global total across warehouses", () => {
  const { out, incoming } = transferPair();

  validateTransferPair(out, incoming);

  const balances = applyMovement(applyMovement({}, out), incoming);
  const total = Object.values(balances).reduce((sum, quantity) => sum + quantity, 0);

  assert.deepEqual(balances, { "w1:i1": -10, "w2:i1": 10 });
  assert.equal(total, 0);
});

test("validateTransferPair rejects mismatched pairs", () => {
  const { out, incoming } = transferPair();

  assert.throws(
    () => validateTransferPair(out, { ...incoming, quantityDelta: 9 }),
    (error: unknown) =>
      error instanceof TransferPairMismatchError && error.code === "INVENTORY_TRANSFER_PAIR_MISMATCH",
  );
  assert.throws(
    () => validateTransferPair(out, { ...incoming, warehouseId: "w1" }),
    TransferPairMismatchError,
  );
});

test("reconcileBalances reports a difference", () => {
  const movements = [
    baseMovement({ id: "a", quantityDelta: 100 }),
    baseMovement({ id: "b", kind: "waste", quantityDelta: -30, reason: "spoiled", actorId: "actor-1" }),
    baseMovement({ id: "c", kind: "waste", quantityDelta: -20, reason: "spoiled", actorId: "actor-1" }),
  ];

  const report = reconcileBalances({ "w1:i1": 49 }, movements);

  assert.equal(report.ok, false);
  assert.deepEqual(report.diffs, [{ key: "w1:i1", stored: 49, expected: 50 }]);
});

test("reconcileBalances is ok when stored matches the ledger sum", () => {
  const movements = [
    baseMovement({ id: "a", quantityDelta: 100 }),
    baseMovement({ id: "b", kind: "waste", quantityDelta: -30, reason: "spoiled", actorId: "actor-1" }),
    baseMovement({ id: "c", kind: "waste", quantityDelta: -20, reason: "spoiled", actorId: "actor-1" }),
  ];

  assert.deepEqual(reconcileBalances({ "w1:i1": 50 }, movements), { ok: true, diffs: [] });
});

test("reconcileBalances treats a missing stored balance as zero", () => {
  assert.deepEqual(reconcileBalances({}, [baseMovement({ quantityDelta: 12 })]).diffs, [
    { key: "w1:i1", stored: 0, expected: 12 },
  ]);
});
