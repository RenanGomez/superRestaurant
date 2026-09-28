import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope, type OrderDetailItemV1, type OrderDetailV1 } from "@super-restaurant/shared-types";
import { actionLabel, groupItemsByStatus, hasAction } from "./order-detail.js";

const parsedScope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (parsedScope === undefined) throw new Error("Invalid test scope.");
const scope = parsedScope;

function item(overrides: Partial<OrderDetailItemV1> = {}): OrderDetailItemV1 {
  return {
    lineTotalMinor: 10_000, modifiers: [], name: "Tacos", note: null,
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

test("actionLabel covers every action the server can send", () => {
  for (const action of ["open", "sendToKitchen", "markReady", "markDelivered", "cancelItem", "checkout"] as const) {
    assert.equal(typeof actionLabel(action), "string");
    assert.ok(actionLabel(action).length > 0);
  }
});
