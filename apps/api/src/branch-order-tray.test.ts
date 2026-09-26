import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";

import { parseBranchOrderPage, PostgresBranchOrderTray } from "./branch-order-tray.js";

const actorId = randomUUID();
const scope = parseBranchScope({ restaurantId: randomUUID(), branchId: randomUUID() });
if (scope === undefined) throw new Error("Invalid test scope.");
const firstId = randomUUID();
const secondId = randomUUID();
const timestamp = "2026-09-26T18:00:00.000Z";
const order = {
  orderId: firstId, tableId: null, channel: "delivery", shiftId: null,
  status: "open", version: 2, updatedAt: timestamp, itemStatuses: ["sent", "ready"],
};
const page = { schemaVersion: 1, scope, orders: [order], next: null };

test("branch reader binds actor and Branch scope, and parses a bounded page", async () => {
  const calls: unknown[][] = [];
  const adapter = new PostgresBranchOrderTray({ query: async (_sql, parameters) => {
    calls.push([...parameters]);
    return { rows: [{ result: page }] };
  } });
  assert.deepEqual(await adapter.listActive(actorId, scope, 25, null), parseBranchOrderPage(page));
  assert.deepEqual(JSON.parse(calls[0]?.[1] as string), { schemaVersion: 1, scope, limit: 25, after: null });
  assert.equal(calls[0]?.[0], actorId);
});

test("branch reader rejects wrong scope, malformed cursors and corrupt pages", async () => {
  const adapter = (result: unknown) => new PostgresBranchOrderTray({ query: async () => ({ rows: [{ result }] }) });
  assert.equal(await adapter({ status: "denied" }).listActive(actorId, scope, 10, null), "denied");
  await assert.rejects(adapter(page).listActive(actorId, scope, 10, { orderId: firstId, updatedAt: "yesterday" }));
  for (const raw of [
    { ...page, scope: { ...scope, branchId: randomUUID() } },
    { ...page, orders: [{ ...order, orderId: "bad" }] },
    { ...page, orders: [{ ...order, channel: "table" }] },
    { ...page, orders: [{ ...order, itemStatuses: ["unknown"] }] },
    { ...page, orders: [order], next: { orderId: secondId, updatedAt: timestamp } },
    { ...page, orders: [order, order] },
    { ...page, orders: [{ ...order, updatedAt: "2026-09-25T18:00:00.000Z" }, order] },
  ]) await assert.rejects(adapter(raw).listActive(actorId, scope, 10, null));
});

test("branch reader accepts a stable keyset continuation", () => {
  const result = parseBranchOrderPage({ ...page, next: { orderId: firstId, updatedAt: "2026-09-26T18:00:00.000000Z" } });
  assert.deepEqual(result?.next, { orderId: firstId, updatedAt: "2026-09-26T18:00:00.000000Z" });
  assert.equal(Object.isFrozen(result?.orders), true);
});
