import assert from "node:assert/strict";
import test from "node:test";
import { parseAddOrderItemCommandV1, parseBranchScope, type OrderDetailItemV1, type OrderDetailV1 } from "@super-restaurant/shared-types";
import {
  actionLabel,
  buildAddOrderItemCommand,
  canAddItems,
  chunkOrderItemIds,
  groupItemsByStatus,
  hasAction,
  hasItemAction,
  nextFocusIndex,
  parseAttemptIds,
  parseOccurredAt,
  parseOrderItemIds,
  pendingOrderItemIds,
  resolvePendingAdd,
} from "./order-detail.js";

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

test("canAddItems trusts only the server's addItem action, including an open order with no pending lines", () => {
  assert.equal(canAddItems(detail({ status: "open", items: [], availableActions: ["addItem"] })), true);
  assert.equal(canAddItems(detail({ status: "partially_paid", availableActions: ["addItem"] })), true);
  assert.equal(canAddItems(detail({ status: "open", availableActions: ["sendToKitchen", "open", "markReady"] })), false);
  assert.equal(canAddItems(detail({ status: "paid", availableActions: [] })), false);
});

test("buildAddOrderItemCommand carries the exact attempt and counted modifier selection", () => {
  const command = buildAddOrderItemCommand({
    scope, orderId: detail().orderId, expectedVersion: 4,
    orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", productId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
    quantity: 2, note: "Sin cebolla", variantId: "1e37ae13-8507-484c-969f-2176f77b7000",
    modifierGroups: [{ groupId: "1e37ae13-8507-484c-969f-2176f77b7000",
      selections: [{ optionId: "23723e10-c0bf-49fd-9363-4f0e2c60e955", quantity: 2 }] }],
    eventId: "1e37ae13-8507-484c-969f-2176f77b7000", idempotencyKey: "attempt-1",
    occurredAt: "2026-10-04T00:00:00.000Z", deviceId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  });
  assert.equal(command.expectedVersion, 4);
  assert.equal(command.quantity, 2);
  assert.deepEqual(command.modifierGroups[0]?.selections, [{ optionId: "23723e10-c0bf-49fd-9363-4f0e2c60e955", quantity: 2 }]);
  assert.equal(command.idempotencyKey, "attempt-1");
  assert.deepEqual(parseAddOrderItemCommandV1(command), { ...command, fraction: null });
  assert.equal(command.note, "Sin cebolla");
  assert.equal(command.variantId, "1e37ae13-8507-484c-969f-2176f77b7000");
});

test("resolvePendingAdd waits for an exact detail read before releasing the line ID", () => {
  const attempt = buildAddOrderItemCommand({
    scope, orderId: detail().orderId, expectedVersion: 3,
    orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", productId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
    quantity: 1, note: null, variantId: null, modifierGroups: [],
    eventId: "1e37ae13-8507-484c-969f-2176f77b7000", idempotencyKey: "attempt-1",
    occurredAt: "2026-10-04T00:00:00.000Z", deviceId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  });
  assert.equal(resolvePendingAdd(undefined, attempt), "confirming");
  assert.equal(resolvePendingAdd(detail({ orderId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" }), attempt), "confirming");
  assert.equal(resolvePendingAdd(detail(), attempt), "applied");
  assert.equal(resolvePendingAdd(detail({ items: [] }), attempt), "retry");
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

test("parseOccurredAt accepts a well-formed ISO timestamp within tolerance of the given clock", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  assert.equal(parseOccurredAt("2026-10-01T12:00:00.000Z", now), "2026-10-01T12:00:00.000Z");
  assert.equal(parseOccurredAt("2026-10-01T11:59:00.000Z", now), "2026-10-01T11:59:00.000Z"); // 1 min in the past
  assert.equal(parseOccurredAt("2026-10-01T12:04:59.000Z", now), "2026-10-01T12:04:59.000Z"); // just under 5 min ahead
  assert.equal(parseOccurredAt("2026-10-01T12:06:00.000Z", now), undefined); // more than 5 min ahead
  assert.equal(parseOccurredAt("2026-09-30T11:59:59.000Z", now), undefined); // more than 24h old
  assert.equal(parseOccurredAt("not-a-timestamp", now), undefined);
  assert.equal(parseOccurredAt(undefined, now), undefined);
});

test("chunkOrderItemIds splits into bounded chunks and leaves a short list whole", () => {
  const ids = Array.from({ length: 450 }, (_, index) => `id-${String(index)}`);
  const chunks = chunkOrderItemIds(ids, 200);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]?.length, 200);
  assert.equal(chunks[1]?.length, 200);
  assert.equal(chunks[2]?.length, 50);
  assert.deepEqual(chunkOrderItemIds(["a", "b"], 200), [["a", "b"]]);
  assert.deepEqual(chunkOrderItemIds([], 200), []);
});

test("nextFocusIndex wraps a Tab/Shift+Tab cycle at both ends of a fixed-size focusable list", () => {
  assert.equal(nextFocusIndex(3, 0, false), 1);
  assert.equal(nextFocusIndex(3, 1, false), 2);
  assert.equal(nextFocusIndex(3, 2, false), 0); // Tab from the last wraps to the first
  assert.equal(nextFocusIndex(3, 0, true), 2); // Shift+Tab from the first wraps to the last
  assert.equal(nextFocusIndex(3, 2, true), 1);
  assert.equal(nextFocusIndex(1, 0, false), 0); // a single focusable element stays on itself
  assert.equal(nextFocusIndex(0, 0, false), 0); // nothing to move to
});

test("actionLabel covers every action the server can send", () => {
  for (const action of ["open", "sendToKitchen", "markReady", "markDelivered", "cancelItem", "checkout"] as const) {
    assert.equal(typeof actionLabel(action), "string");
    assert.ok(actionLabel(action).length > 0);
  }
});
