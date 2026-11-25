import test from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_MOVEMENT_KINDS,
  INVENTORY_UNITS,
  parseInventoryBalanceV1,
  parseInventoryItemV1,
  parseInventoryMovementRequestV1,
  parseInventoryMovementV1,
  parseInventoryWarehouseV1,
  parsePurchaseOrderV1,
  parseRecipeVersionV1,
} from "./index.js";

const RESTAURANT = "1e37ae13-8507-484c-969f-2176f77b7000";
const BRANCH = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const ITEM = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const WAREHOUSE = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const ACTOR = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const MOVEMENT = "e74df54b-30a7-449b-a23f-c4ca6f93bda4";
const SUPPLIER = "5e90fa33-b7bc-4a91-a2b1-a4cb12457711";
const RECIPE = "9544c299-d25b-44ce-98ed-d30116610887";
const PRODUCT = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";
const PURCHASE_ORDER = "01J8Z9X2Y3ABCDEFGHJKMNPQRS";
const TS = "2026-11-25T12:00:00.000Z";

function validItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITEM,
    restaurantId: RESTAURANT,
    sku: "SKU-MASA",
    name: "Masa",
    unitCode: "g",
    purchaseUnitFactor: 1000,
    minQuantity: 5000,
    active: true,
    ...overrides,
  };
}

function validWarehouse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: WAREHOUSE,
    restaurantId: RESTAURANT,
    branchId: BRANCH,
    name: "Almacén principal",
    active: true,
    ...overrides,
  };
}

function validMovement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MOVEMENT,
    restaurantId: RESTAURANT,
    branchId: BRANCH,
    warehouseId: WAREHOUSE,
    itemId: ITEM,
    kind: "sale_consumption",
    quantityDelta: -25,
    unitCode: "g",
    occurredAt: TS,
    actorId: ACTOR,
    reason: null,
    idempotencyKey: "sale-1-item-1",
    compensatesMovementId: null,
    transferPairId: null,
    unitCostMinor: 12,
    currency: "MXN",
    recipeVersionId: null,
    roundingRemainder: 0,
    ...overrides,
  };
}

function validBalance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    restaurantId: RESTAURANT,
    branchId: BRANCH,
    warehouseId: WAREHOUSE,
    itemId: ITEM,
    quantity: 4975,
    updatedAt: TS,
    ...overrides,
  };
}

function validRecipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    restaurantId: RESTAURANT,
    recipeId: RECIPE,
    productId: PRODUCT,
    version: 1,
    lines: [{ itemId: ITEM, quantity: 250, unitCode: "g" }],
    ...overrides,
  };
}

function validMovementRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const request = validMovement();
  delete request.id;
  delete request.occurredAt;
  delete request.recipeVersionId;
  delete request.roundingRemainder;
  return { ...request, ...overrides };
}

function validPurchaseOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PURCHASE_ORDER,
    restaurantId: RESTAURANT,
    branchId: BRANCH,
    supplierId: SUPPLIER,
    status: "draft",
    lines: [{ itemId: ITEM, quantity: 25, unitCode: "g", unitCostMinor: 12, currency: "MXN" }],
    ...overrides,
  };
}

test("INVENTORY_MOVEMENT_KINDS exposes the eight ADR-013 kinds", () => {
  assert.deepEqual([...INVENTORY_MOVEMENT_KINDS], [
    "receipt",
    "sale_consumption",
    "sale_reversal",
    "waste",
    "adjustment",
    "transfer_out",
    "transfer_in",
    "count_adjustment",
  ]);
  assert.deepEqual([...INVENTORY_UNITS], ["g", "ml", "piece"]);
  assert.ok(Object.isFrozen(INVENTORY_MOVEMENT_KINDS));
  assert.ok(Object.isFrozen(INVENTORY_UNITS));
});

test("parseInventoryItemV1 accepts a valid item", () => {
  assert.ok(parseInventoryItemV1(validItem()));
});

test("parseInventoryItemV1 rejects an extra key", () => {
  assert.equal(parseInventoryItemV1(validItem({ extra: true })), undefined);
});

test("parseInventoryWarehouseV1 accepts a valid warehouse", () => {
  assert.ok(parseInventoryWarehouseV1(validWarehouse()));
});

test("parseInventoryWarehouseV1 rejects a missing key", () => {
  const warehouse = validWarehouse();
  delete warehouse.active;
  assert.equal(parseInventoryWarehouseV1(warehouse), undefined);
});

test("parseInventoryMovementV1 accepts a valid movement", () => {
  assert.ok(parseInventoryMovementV1(validMovement()));
});

test("parseInventoryMovementV1 rejects a decimal quantity", () => {
  assert.equal(parseInventoryMovementV1(validMovement({ quantityDelta: -2.5 })), undefined);
});

test("parseInventoryMovementV1 rejects an invalid currency", () => {
  assert.equal(parseInventoryMovementV1(validMovement({ currency: "mxn" })), undefined);
});

test("parseInventoryBalanceV1 accepts a valid balance", () => {
  assert.ok(parseInventoryBalanceV1(validBalance()));
});

test("parseInventoryBalanceV1 rejects a non-ISO timestamp", () => {
  assert.equal(parseInventoryBalanceV1(validBalance({ updatedAt: "2026-11-25 12:00:00" })), undefined);
});

test("parseRecipeVersionV1 accepts a valid recipe", () => {
  assert.ok(parseRecipeVersionV1(validRecipe()));
});

test("parseRecipeVersionV1 rejects a decimal line quantity", () => {
  assert.equal(
    parseRecipeVersionV1(validRecipe({ lines: [{ itemId: ITEM, quantity: 2.5, unitCode: "g" }] })),
    undefined,
  );
});

test("parseRecipeVersionV1 rejects an unknown line unit", () => {
  assert.equal(
    parseRecipeVersionV1(validRecipe({ lines: [{ itemId: ITEM, quantity: 2, unitCode: "kg" }] })),
    undefined,
  );
});

test("parseInventoryMovementRequestV1 accepts a valid request", () => {
  assert.ok(parseInventoryMovementRequestV1(validMovementRequest()));
});

test("parseInventoryMovementRequestV1 rejects an unknown kind", () => {
  assert.equal(parseInventoryMovementRequestV1(validMovementRequest({ kind: "explode" })), undefined);
});

test("parseInventoryMovementRequestV1 rejects a decimal unit cost", () => {
  assert.equal(parseInventoryMovementRequestV1(validMovementRequest({ unitCostMinor: 1.5 })), undefined);
});

test("parsePurchaseOrderV1 accepts a valid purchase order", () => {
  assert.ok(parsePurchaseOrderV1(validPurchaseOrder()));
});

test("parsePurchaseOrderV1 rejects a decimal line cost", () => {
  assert.equal(
    parsePurchaseOrderV1(validPurchaseOrder({ lines: [{ itemId: ITEM, quantity: 2, unitCode: "g", unitCostMinor: 1.5, currency: "MXN" }] })),
    undefined,
  );
});

test("parsePurchaseOrderV1 rejects an unknown status", () => {
  assert.equal(parsePurchaseOrderV1(validPurchaseOrder({ status: "received_all" })), undefined);
});

// ---- P1: money is an indivisible pair ------------------------------------------------------

test("parseInventoryMovementV1 rejects a half money pair", () => {
  assert.equal(parseInventoryMovementV1(validMovement({ unitCostMinor: 12, currency: null })), undefined);
  assert.equal(parseInventoryMovementV1(validMovement({ unitCostMinor: null, currency: "MXN" })), undefined);
});

test("parseInventoryMovementV1 accepts a complete or absent money pair", () => {
  assert.ok(parseInventoryMovementV1(validMovement({ unitCostMinor: 12, currency: "MXN" })));
  assert.ok(parseInventoryMovementV1(validMovement({ unitCostMinor: null, currency: null })));
});

test("parseInventoryMovementRequestV1 rejects a half money pair", () => {
  assert.equal(parseInventoryMovementRequestV1(validMovementRequest({ unitCostMinor: 12, currency: null })), undefined);
  assert.equal(parseInventoryMovementRequestV1(validMovementRequest({ unitCostMinor: null, currency: "MXN" })), undefined);
});

test("parsePurchaseOrderV1 rejects a half money pair on a line", () => {
  assert.equal(
    parsePurchaseOrderV1(validPurchaseOrder({ lines: [{ itemId: ITEM, quantity: 2, unitCode: "g", unitCostMinor: 12, currency: null }] })),
    undefined,
  );
  assert.equal(
    parsePurchaseOrderV1(validPurchaseOrder({ lines: [{ itemId: ITEM, quantity: 2, unitCode: "g", unitCostMinor: null, currency: "MXN" }] })),
    undefined,
  );
});

// ---- P1: corrections carry a reference and a reason ----------------------------------------

test("parseInventoryMovementV1 requires a reason for correction kinds", () => {
  for (const kind of ["waste", "adjustment", "count_adjustment"] as const) {
    const quantityDelta = kind === "waste" ? -5 : 5;
    assert.equal(
      parseInventoryMovementV1(validMovement({ kind, quantityDelta, reason: null })),
      undefined,
      `kind ${kind} must reject a null reason`,
    );
    assert.equal(
      parseInventoryMovementV1(validMovement({ kind, quantityDelta, reason: "  " })),
      undefined,
      `kind ${kind} must reject a blank reason`,
    );
    assert.ok(
      parseInventoryMovementV1(validMovement({ kind, quantityDelta, reason: "conteo físico" })),
      `kind ${kind} must accept a reason`,
    );
  }
});

test("parseInventoryMovementV1 requires a reference and reason for sale_reversal", () => {
  const base = { kind: "sale_reversal", quantityDelta: 25, reason: "devolución" };
  assert.equal(parseInventoryMovementV1(validMovement({ ...base, compensatesMovementId: null })), undefined);
  assert.equal(
    parseInventoryMovementV1(validMovement({ ...base, reason: null, compensatesMovementId: MOVEMENT })),
    undefined,
  );
  assert.ok(parseInventoryMovementV1(validMovement({ ...base, compensatesMovementId: MOVEMENT })));
});

test("parseInventoryMovementRequestV1 requires a reason for correction kinds", () => {
  assert.equal(parseInventoryMovementRequestV1(validMovementRequest({ kind: "waste", quantityDelta: -5, reason: null })), undefined);
  assert.equal(
    parseInventoryMovementRequestV1(validMovementRequest({ kind: "sale_reversal", quantityDelta: 5, reason: "x", compensatesMovementId: null })),
    undefined,
  );
});

// ---- P1: hostile inputs never throw -------------------------------------------------------

test("parsers return undefined instead of throwing on a throwing getter", () => {
  const hostileItem = { ...validItem(), get name(): string { throw new Error("boom"); } };
  const hostileMovement = { ...validMovement(), get kind(): string { throw new Error("boom"); } };
  assert.equal(parseInventoryItemV1(hostileItem), undefined);
  assert.equal(parseInventoryMovementV1(hostileMovement), undefined);
  assert.equal(parseInventoryMovementRequestV1(hostileMovement), undefined);
});

test("parsers return undefined instead of throwing on a symbol key", () => {
  const hostileItem = { ...validItem(), [Symbol("extra")]: true };
  const hostileMovement = { ...validMovement(), [Symbol("extra")]: true };
  assert.equal(parseInventoryItemV1(hostileItem), undefined);
  assert.equal(parseInventoryMovementV1(hostileMovement), undefined);
  assert.equal(parseInventoryBalanceV1({ ...validBalance(), [Symbol("extra")]: true }), undefined);
});

// ---- P2: signs and transfers --------------------------------------------------------------

test("parseInventoryMovementV1 enforces the sign of each kind", () => {
  const positives = ["receipt", "transfer_in"] as const;
  const negatives = ["sale_consumption", "transfer_out", "waste"] as const;

  for (const kind of positives) {
    const base = kind === "transfer_in" ? { transferPairId: MOVEMENT } : {};
    assert.ok(parseInventoryMovementV1(validMovement({ kind, quantityDelta: 5, ...base })), `${kind} accepts +`);
    assert.equal(parseInventoryMovementV1(validMovement({ kind, quantityDelta: -5, ...base })), undefined, `${kind} rejects -`);
    assert.equal(parseInventoryMovementV1(validMovement({ kind, quantityDelta: 0, ...base })), undefined, `${kind} rejects 0`);
  }

  for (const kind of negatives) {
    const base = kind === "transfer_out"
      ? { transferPairId: MOVEMENT }
      : kind === "waste"
        ? { reason: "merma" }
        : {};
    assert.ok(parseInventoryMovementV1(validMovement({ kind, quantityDelta: -5, ...base })), `${kind} accepts -`);
    assert.equal(parseInventoryMovementV1(validMovement({ kind, quantityDelta: 5, ...base })), undefined, `${kind} rejects +`);
    assert.equal(parseInventoryMovementV1(validMovement({ kind, quantityDelta: 0, ...base })), undefined, `${kind} rejects 0`);
  }

  for (const kind of ["adjustment", "count_adjustment"] as const) {
    const base = { reason: "ajuste" };
    assert.ok(parseInventoryMovementV1(validMovement({ kind, quantityDelta: 5, ...base })), `${kind} accepts +`);
    assert.ok(parseInventoryMovementV1(validMovement({ kind, quantityDelta: -5, ...base })), `${kind} accepts -`);
    assert.equal(parseInventoryMovementV1(validMovement({ kind, quantityDelta: 0, ...base })), undefined, `${kind} rejects 0`);
  }

  assert.ok(parseInventoryMovementV1(validMovement({
    kind: "sale_reversal",
    quantityDelta: 25,
    reason: "devolución",
    compensatesMovementId: MOVEMENT,
  })));
});

test("parseInventoryMovementV1 requires a transfer pair id on transfers", () => {
  assert.equal(parseInventoryMovementV1(validMovement({ kind: "transfer_out", quantityDelta: -5, transferPairId: null })), undefined);
  assert.equal(parseInventoryMovementV1(validMovement({ kind: "transfer_in", quantityDelta: 5, transferPairId: null })), undefined);
  assert.ok(parseInventoryMovementV1(validMovement({ kind: "transfer_out", quantityDelta: -5, transferPairId: MOVEMENT })));
  assert.ok(parseInventoryMovementV1(validMovement({ kind: "transfer_in", quantityDelta: 5, transferPairId: MOVEMENT })));
});

// ---- P2: recipe fields and balance scope --------------------------------------------------

test("parseInventoryMovementV1 accepts the recipe defaults", () => {
  const movement = parseInventoryMovementV1(validMovement({ recipeVersionId: null, roundingRemainder: 0 }));
  assert.ok(movement);
  assert.equal(movement.recipeVersionId, null);
  assert.equal(movement.roundingRemainder, 0);
});

test("parseInventoryMovementV1 accepts a recipe version and a positive remainder", () => {
  assert.ok(parseInventoryMovementV1(validMovement({ recipeVersionId: RECIPE, roundingRemainder: 7 })));
});

test("parseInventoryMovementV1 rejects an invalid recipe field", () => {
  assert.equal(parseInventoryMovementV1(validMovement({ recipeVersionId: "not-an-id" })), undefined);
  assert.equal(parseInventoryMovementV1(validMovement({ roundingRemainder: -1 })), undefined);
  assert.equal(parseInventoryMovementV1(validMovement({ roundingRemainder: 1.5 })), undefined);
});

test("parseInventoryBalanceV1 requires restaurant and branch scope", () => {
  const withoutRestaurant = validBalance();
  delete withoutRestaurant.restaurantId;
  assert.equal(parseInventoryBalanceV1(withoutRestaurant), undefined);

  const withoutBranch = validBalance();
  delete withoutBranch.branchId;
  assert.equal(parseInventoryBalanceV1(withoutBranch), undefined);

  assert.equal(parseInventoryBalanceV1(validBalance({ branchId: "not-a-uuid" })), undefined);
});

// ---- P2: purchase order line integrity ---------------------------------------------------

test("parsePurchaseOrderV1 rejects an empty line list", () => {
  assert.equal(parsePurchaseOrderV1(validPurchaseOrder({ lines: [] })), undefined);
});

test("parsePurchaseOrderV1 rejects duplicate item/unit lines", () => {
  const line = { itemId: ITEM, quantity: 2, unitCode: "g", unitCostMinor: 12, currency: "MXN" };
  assert.equal(parsePurchaseOrderV1(validPurchaseOrder({ lines: [line, { ...line }] })), undefined);
});

test("parsePurchaseOrderV1 accepts the same item in different units", () => {
  const lines = [
    { itemId: ITEM, quantity: 2, unitCode: "g", unitCostMinor: 12, currency: "MXN" },
    { itemId: ITEM, quantity: 3, unitCode: "ml", unitCostMinor: 12, currency: "MXN" },
  ];
  assert.ok(parsePurchaseOrderV1(validPurchaseOrder({ lines })));
});
