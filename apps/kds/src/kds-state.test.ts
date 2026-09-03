import assert from "node:assert/strict";
import test from "node:test";

import type { KdsTicketV1 } from "@super-restaurant/shared-types";

import { nextKdsAction, orderTicketsForDisplay } from "./kds-state.js";

const base = {
  schemaVersion: 1,
  scope: { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" },
  stationId: "kitchen",
  orderId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  orderItemId: "9544c299-d25b-44ce-98ed-d30116610887",
  orderVersion: 3,
  channel: "counter",
  tableId: null,
  quantity: 1,
  productName: "Taco",
  modifiers: [],
  queuedAt: "2026-09-03T10:00:00.000Z",
} as const;

test("maps only valid kitchen-forward actions", () => {
  assert.equal(nextKdsAction("sent"), "preparing");
  assert.equal(nextKdsAction("preparing"), "ready");
  assert.equal(nextKdsAction("ready"), undefined);
});

test("orders active work before ready pickup without mutating input", () => {
  const input = [
    { ...base, status: "ready" },
    { ...base, status: "sent", orderItemId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83" },
    { ...base, status: "preparing", orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02" },
  ] as unknown as readonly KdsTicketV1[];
  assert.deepEqual(orderTicketsForDisplay(input).map(({ status }) => status), ["preparing", "sent", "ready"]);
  assert.equal(input[0]?.status, "ready");
});
