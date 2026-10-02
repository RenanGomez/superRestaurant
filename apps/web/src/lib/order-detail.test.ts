import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope, type OrderDetailItemV1, type OrderDetailV1 } from "@super-restaurant/shared-types";
import { actionLabel, groupItemsByStatus, hasAction, hasItemAction, parseAttemptIds, parseOrderItemIds, pendingOrderItemIds } from "./order-detail.js";

const parsedScope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (parsedScope === undefined) throw new Error("Invalid test scope.");
const scope = parsedScope;

function item(overrides: Partial<OrderDetailItemV1> = {}): OrderDetailItemV1 {
  return {
    availableActions: [], lineTotalMinor: 10_000, modifiers: [], name: "Tacos", note: null,
    orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", quantity: 1, status: "pending", unitPriceMinor: 10_000,
    ...overrides,
  };
}

function detail(overrides: Partial<OrderDetailV1> = {}): OrderDetailV1 {
  return {
    availableActions: ["sendToKitchen"], channel: "table", createdAt: null,
    currency: "MXN", fulfillment: { addressLabel: null, channel: "table", customerLabel: null, paymentIntent: null, tableId: null },
    items: [item()], orderId: "72371a5f-2056-448d-9ddb-14ab6664a4e8", schemaVersion: 1,
    scope, status: "open", tableId: null, timeZone: "America/Mexico_City",
    totals: { currency: "MXN", deliveryChargeMinor: 0, itemsTotalMinor: 10_000, tipMinor: 0, totalMinor: 10_000 },
    updatedAt: null, version: 1, ...overrides,
  };
}

test("groupItemsByStatus buckets every forward and terminal status, always in the same order", () => {
  const groups = groupItemsByStatus([
    item({ orderItemId: "1e37ae13-8507-484c-969f-2176f77b7000", status: "ready" }),
    item({ orderItemId: "23723e10-c0bf-49fd-9363-4f0e2c60e955", status: "pending" }),
  ]);
  assert.deepEqual([...groups.keys()], ["pending", "sent", "preparing", "ready", "delivered", "cancelled"]);
  assert.equal(groups.get("pending")?.length, 1);
  assert.equal(groups.get("ready")?.length, 1);
  assert.equal(groups.get("sent")?.length, 0);
});

test("hasAction only trusts the server's own availableActions list", () => {
  const value = detail({ availableActions: ["markReady", "cancelItem"] });
  assert.equal(hasAction(value, "markReady"), true);
  assert.equal(hasAction(value, "open"), false);
  assert.equal(hasAction(value, "checkout"), false);
});

test("hasItemAction gates per-line actions from the line's own list, never the order-level one", () => {
  const sentLine = item({ availableActions: ["markReady"], status: "sent" });
  const pendingLine = item({ availableActions: ["cancelItem"], status: "pending" });
  assert.equal(hasItemAction(sentLine, "markReady"), true);
  assert.equal(hasItemAction(sentLine, "cancelItem"), false);
  assert.equal(hasItemAction(pendingLine, "cancelItem"), true);
  assert.equal(hasItemAction(pendingLine, "markReady"), false);
});

test("parseAttemptIds only accepts a well-formed UUID eventId and a bounded, trimmed idempotencyKey", () => {
  const eventId = "1e37ae13-8507-484c-969f-2176f77b7000";
  assert.deepEqual(parseAttemptIds(eventId, "send-line-1"), { eventId, idempotencyKey: "send-line-1" });
  assert.equal(parseAttemptIds("not-a-uuid", "send-line-1"), undefined);
  assert.equal(parseAttemptIds(eventId, ""), undefined);
  assert.equal(parseAttemptIds(eventId, " padded "), undefined);
  assert.equal(parseAttemptIds(eventId, "x".repeat(201)), undefined);
  assert.equal(parseAttemptIds(undefined, "send-line-1"), undefined);
});

test("pendingOrderItemIds only returns the lines the operator is seeing as pending", () => {
  const value = detail({
    items: [
      item({ orderItemId: "1e37ae13-8507-484c-969f-2176f77b7000", status: "pending" }),
      item({ orderItemId: "23723e10-c0bf-49fd-9363-4f0e2c60e955", status: "sent" }),
      item({ orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", status: "pending" }),
    ],
  });
  assert.deepEqual(pendingOrderItemIds(value), ["1e37ae13-8507-484c-969f-2176f77b7000", "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02"]);
});

test("parseOrderItemIds requires a non-empty array of distinct UUIDs", () => {
  const id1 = "1e37ae13-8507-484c-969f-2176f77b7000";
  const id2 = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
  assert.deepEqual(parseOrderItemIds([id1, id2]), [id1, id2]);
  assert.equal(parseOrderItemIds([]), undefined);
  assert.equal(parseOrderItemIds([id1, id1]), undefined);
  assert.equal(parseOrderItemIds([id1, "not-a-uuid"]), undefined);
  assert.equal(parseOrderItemIds(undefined), undefined);
  assert.equal(parseOrderItemIds("not-an-array"), undefined);
});

test("actionLabel covers every action the server can send", () => {
  for (const action of ["open", "sendToKitchen", "markReady", "markDelivered", "cancelItem", "checkout"] as const) {
    assert.equal(typeof actionLabel(action), "string");
    assert.ok(actionLabel(action).length > 0);
  }
});
