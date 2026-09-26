import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBranchScope,
  type ActiveTableOrderSummaryV2,
  type CaptureDraftSummaryV1,
} from "@super-restaurant/shared-types";

import {
  projectActiveTableOrderOperationalWorkItem,
  projectCaptureOperationalWorkItem,
} from "./operational-work-tray.js";

const ids = {
  branch: "00000000-0000-4000-8000-000000000001",
  capture: "00000000-0000-4000-8000-000000000002",
  item: "00000000-0000-4000-8000-000000000003",
  order: "00000000-0000-4000-8000-000000000004",
  product: "00000000-0000-4000-8000-000000000005",
  restaurant: "00000000-0000-4000-8000-000000000006",
  shift: "00000000-0000-4000-8000-000000000007",
  table: "00000000-0000-4000-8000-000000000008",
} as const;

const scope = (() => {
  const parsed = parseBranchScope({ branchId: ids.branch, restaurantId: ids.restaurant });
  if (parsed === undefined) throw new Error("Expected valid Branch scope fixture.");
  return parsed;
})();

function capture(overrides: Partial<CaptureDraftSummaryV1> = {}): CaptureDraftSummaryV1 {
  return {
    attentionStatus: "held",
    captureDraftId: ids.capture,
    folio: "CAP-1042",
    fulfillmentChannel: "delivery",
    ownerMembershipId: null,
    schemaVersion: 1,
    scope,
    sourceChannel: "phone",
    status: "draft",
    updatedAt: "2026-09-26T18:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

function order(overrides: Partial<ActiveTableOrderSummaryV2> = {}): ActiveTableOrderSummaryV2 {
  return {
    currency: "MXN",
    itemCount: 1,
    items: [{
      modifiers: [],
      orderItemId: ids.item,
      productId: ids.product,
      productName: "Taco",
      quantity: 2,
      status: "preparing",
      unit: "piece",
      unitPrice: { amountMinor: 3_500, currency: "MXN" },
    }],
    orderId: ids.order,
    shiftId: ids.shift,
    status: "partially_paid",
    tableId: ids.table,
    updatedAt: "2026-09-26T18:05:00.000Z",
    version: 4,
    ...overrides,
  };
}

test("projects Capture identity and attention without inventing unavailable facts", () => {
  const item = projectCaptureOperationalWorkItem(capture());

  assert.equal(item.itemType, "capture");
  assert.equal(item.workItemId, ids.capture);
  assert.equal(item.humanFolio, "CAP-1042");
  assert.deepEqual(item.needsAttention, ["held"]);
  assert.deepEqual(item.availableActions, ["open_capture"]);
  assert.equal(item.orderStatus, null);
  assert.equal(item.paymentStatus, null);
  assert.equal(item.customerLabel, null);
  assert.equal(Object.isFrozen(item), true);
});

test("projects a dine-in Capture without inventing its future confirmation table", () => {
  const item = projectCaptureOperationalWorkItem(capture({ fulfillmentChannel: "dine_in" }));

  assert.equal(item.fulfillmentChannel, "dine_in");
  assert.equal(item.tableId, null);
});

test("projects table Order axes only from authoritative legacy facts", () => {
  const item = projectActiveTableOrderOperationalWorkItem(order());

  assert.equal(item.itemType, "order");
  assert.equal(item.orderStatus, "confirmed");
  assert.equal(item.preparationStatus, "preparing");
  assert.equal(item.paymentStatus, "partially_paid");
  assert.equal(item.fulfillmentChannel, "dine_in");
  assert.equal(item.fulfillmentStatus, null);
  assert.equal(item.sourceChannel, null);
  assert.deepEqual(item.availableActions, ["open_order"]);
});

test("does not infer unpaid from draft/open and derives preparation from item snapshots", () => {
  const item = projectActiveTableOrderOperationalWorkItem(order({
    items: [{ ...order().items[0]!, status: "ready" }],
    status: "open",
  }));

  assert.equal(item.orderStatus, "confirmed");
  assert.equal(item.paymentStatus, null);
  assert.equal(item.preparationStatus, "ready");
});

test("fails closed when a typed source carries noncanonical transport facts", () => {
  assert.throws(() => projectCaptureOperationalWorkItem(capture({ updatedAt: "yesterday" })));
  assert.throws(() => projectCaptureOperationalWorkItem(capture({ status: "no_sale" })));
  assert.throws(() => projectActiveTableOrderOperationalWorkItem(order({ orderId: "not-a-uuid" })));
  assert.throws(() => projectActiveTableOrderOperationalWorkItem(order({ itemCount: 99 })));
});
