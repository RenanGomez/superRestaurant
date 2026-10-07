import assert from "node:assert/strict";
import test from "node:test";

import type { KdsTicketV1 } from "@super-restaurant/shared-types";

import { BatchTransitionError, ageBucket, groupTicketsByOrder, nextKdsAction, orderTicketsForDisplay, planBatchTransition, runBatchTransition } from "./kds-state.js";

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
  note: null,
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

test("age thresholds switch at 10 and after 20 minutes", () => {
  const queuedAt = "2026-09-03T10:00:00.000Z";
  assert.equal(ageBucket(queuedAt, Date.parse(queuedAt) + 9 * 60_000), "green");
  assert.equal(ageBucket(queuedAt, Date.parse(queuedAt) + 10 * 60_000), "amber");
  assert.equal(ageBucket(queuedAt, Date.parse(queuedAt) + 20 * 60_000), "amber");
  assert.equal(ageBucket(queuedAt, Date.parse(queuedAt) + 20 * 60_000 + 1), "red");
});

test("groups lines by order with oldest active orders first and ready orders last", () => {
  const input = [
    { ...base, orderId: "ready", orderItemId: "r", status: "ready", queuedAt: "2026-09-03T09:00:00.000Z" },
    { ...base, orderId: "new", orderItemId: "n", status: "preparing", queuedAt: "2026-09-03T10:10:00.000Z" },
    { ...base, orderId: "old", orderItemId: "o1", status: "sent", queuedAt: "2026-09-03T10:00:00.000Z" },
    { ...base, orderId: "old", orderItemId: "o2", status: "preparing", queuedAt: "2026-09-03T10:01:00.000Z" },
  ] as unknown as readonly KdsTicketV1[];
  const groups = groupTicketsByOrder(input);
  assert.deepEqual(groups.map((group) => group.orderId), ["old", "new", "ready"]);
  assert.deepEqual(groups[0]?.tickets.map((ticket) => ticket.orderItemId), ["o2", "o1"]);
  assert.deepEqual(planBatchTransition(groups[0]!, "preparing").map((ticket) => ticket.orderItemId), ["o1"]);
  assert.deepEqual(planBatchTransition(groups[0]!, "ready").map((ticket) => ticket.orderItemId), ["o2"]);
});

test("uses pending line age for mixed orders and oldest line for all-ready orders", () => {
  const input = [
    { ...base, orderId: "mixed", orderItemId: "ready-old", status: "ready", queuedAt: "2026-09-03T09:00:00.000Z" },
    { ...base, orderId: "mixed", orderItemId: "pending-new", status: "sent", queuedAt: "2026-09-03T10:10:00.000Z" },
    { ...base, orderId: "pending-older", orderItemId: "pending-old", status: "preparing", queuedAt: "2026-09-03T10:05:00.000Z" },
    { ...base, orderId: "all-ready", orderItemId: "ready-new", status: "ready", queuedAt: "2026-09-03T10:20:00.000Z" },
    { ...base, orderId: "all-ready", orderItemId: "ready-earlier", status: "ready", queuedAt: "2026-09-03T09:30:00.000Z" },
  ] as unknown as readonly KdsTicketV1[];
  const groups = groupTicketsByOrder(input);
  assert.deepEqual(groups.map((group) => group.orderId), ["pending-older", "mixed", "all-ready"]);
  assert.equal(groups[1]?.queuedAt, "2026-09-03T10:10:00.000Z");
  assert.equal(groups[2]?.queuedAt, "2026-09-03T09:30:00.000Z");
});

test("chains three batch versions sequentially", async () => {
  const lines = ["one", "two", "three"].map((orderItemId) => ({ ...base, orderItemId, status: "preparing" })) as unknown as KdsTicketV1[];
  const seen: Array<[string, number]> = [];
  const completed = await runBatchTransition(lines, async (ticket) => {
    seen.push([ticket.orderItemId, ticket.orderVersion]);
    return { version: ticket.orderVersion + 1 };
  });
  assert.equal(completed, 3);
  assert.deepEqual(seen, [["one", 3], ["two", 4], ["three", 5]]);
});

test("stops batch on intermediate conflict", async () => {
  const lines = ["one", "two", "three"].map((orderItemId) => ({ ...base, orderItemId, status: "preparing" })) as unknown as KdsTicketV1[];
  const seen: string[] = [];
  await assert.rejects(runBatchTransition(lines, async (ticket) => {
    seen.push(ticket.orderItemId);
    if (ticket.orderItemId === "two") throw new Error("409");
    return { version: 4 };
  }), (error: unknown) => error instanceof BatchTransitionError && error.completed === 1);
  assert.deepEqual(seen, ["one", "two"]);
});
