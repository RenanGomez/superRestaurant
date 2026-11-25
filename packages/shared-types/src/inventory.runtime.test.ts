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
    unitCostMinor: 12,
    currency: "MXN",
    ...overrides,
  };
}

function validBalance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
  return { ...request, ...overrides };
}

function validPurchaseOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PURCHASE_ORDER,
    restaurantId: RESTAURANT,
    branchId: BRANCH,
    supplierId: SUPPLIER,
    status: "draft",
    lines: [{ itemId: ITEM, quantity: 25, unitCode: "g", unitCostMinor: 12 }],
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
    parsePurchaseOrderV1(validPurchaseOrder({ lines: [{ itemId: ITEM, quantity: 2, unitCode: "g", unitCostMinor: 1.5 }] })),
    undefined,
  );
});

test("parsePurchaseOrderV1 rejects an unknown status", () => {
  assert.equal(parsePurchaseOrderV1(validPurchaseOrder({ status: "received_all" })), undefined);
});
