import assert from "node:assert/strict";
import test from "node:test";

import type { BranchScope, KdsTicketV1 } from "@super-restaurant/shared-types";

import {
  InMemoryKdsCache,
  buildCacheRecord,
  formatLastReceived,
  mergeStationTickets,
  overlayPendingTransitions,
  sameStationScope,
  stationSelectionLocked,
  ticketsForStation,
} from "./kds-local.js";

const scope = { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" } as unknown as BranchScope;
const otherScope = { restaurantId: scope.restaurantId, branchId: scope.restaurantId } as unknown as BranchScope;
const station = "kitchen";

function ticket(overrides: Partial<KdsTicketV1> = {}): KdsTicketV1 {
  return {
    schemaVersion: 1,
    scope,
    stationId: station,
    channel: "counter",
    modifiers: [],
    note: null,
    orderId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
    orderItemId: "9544c299-d25b-44ce-98ed-d30116610887",
    orderVersion: 3,
    productName: "Taco",
    quantity: 1,
    queuedAt: "2026-11-23T10:00:00.000Z",
    status: "sent",
    tableId: null,
    ...overrides,
  } as KdsTicketV1;
}

const expected = { restaurantId: scope.restaurantId, branchId: scope.branchId, stationId: station };

test("drops tickets from another branch or station instead of leaking them", () => {
  const keeper = ticket();
  const crossStation = ticket({ orderItemId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83", stationId: "bar" });
  const crossBranch = ticket({ orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", scope: otherScope });
  const result = ticketsForStation([keeper, crossStation, crossBranch], expected);
  assert.deepEqual(result.map((item) => item.orderItemId), [keeper.orderItemId]);
});

test("deduplicates by orderItemId keeping the first occurrence", () => {
  const first = ticket({ productName: "First" });
  const duplicate = ticket({ productName: "Second" });
  assert.deepEqual(ticketsForStation([first, duplicate], expected).map((item) => item.productName), ["First"]);
});

test("server tickets win over cached ones without creating duplicates", () => {
  const cached = ticket({ status: "sent" });
  const server = ticket({ status: "preparing" });
  const dropped = ticket({ orderItemId: "b72573ec-6224-4857-bc4a-f3d1d07b6d83" });
  const merged = mergeStationTickets([cached, dropped], [server], expected);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.orderItemId === server.orderItemId)?.status, "preparing");
});

test("overlays only local transitions for tickets already received on the station", () => {
  const known = ticket({ status: "sent" });
  const pending = [{ orderItemId: known.orderItemId, to: "preparing" as const }, { orderItemId: "not-received", to: "ready" as const }];
  const display = overlayPendingTransitions([known], pending);
  assert.equal(display.length, 1, "a queued transition never creates a ticket that was not received");
  assert.equal(display[0]?.status, "preparing");
  assert.equal(display[0]?.localPending, true);
  assert.equal(known.status, "sent", "the input ticket is not mutated");
});

test("marks tickets without a queued transition as not pending", () => {
  const display = overlayPendingTransitions([ticket()], []);
  assert.equal(display.length, 1);
  assert.equal(display[0]?.localPending, false);
});

test("builds a scoped cache record and rejects foreign tickets", () => {
  const record = buildCacheRecord({
    scope: expected,
    tickets: [ticket(), ticket({ orderItemId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83", stationId: "bar" })],
    cursor: "v1:8",
    receivedAt: new Date("2026-11-23T10:05:00.000Z"),
  });
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.tickets.length, 1);
  assert.equal(record.cursor, "v1:8");
  assert.equal(record.lastReceivedAt, "2026-11-23T10:05:00.000Z");
  assert.ok(Object.isFrozen(record));
});

test("in-memory cache round-trips a record per station", async () => {
  const cache = new InMemoryKdsCache();
  assert.equal(await cache.load(expected), null);
  const record = buildCacheRecord({ scope: expected, tickets: [ticket()], cursor: null, receivedAt: new Date() });
  await cache.save(record);
  const reloaded = await cache.load(expected);
  assert.equal(reloaded?.tickets.length, 1);
  assert.equal(await cache.load({ ...expected, stationId: "bar" }), null);
});

test("station and branch selection lock while offline and unlock online", () => {
  assert.equal(stationSelectionLocked("offline"), true);
  assert.equal(stationSelectionLocked("reconnecting"), true);
  assert.equal(stationSelectionLocked("sync_blocked"), true);
  assert.equal(stationSelectionLocked("degraded"), false);
  assert.equal(stationSelectionLocked("online"), false);
});

test("compares scopes exactly and formats the last reception", () => {
  assert.equal(sameStationScope(expected, { ...expected }), true);
  assert.equal(sameStationScope(expected, { ...expected, stationId: "bar" }), false);
  assert.equal(formatLastReceived(null), "Sin recepción registrada");
  const record = buildCacheRecord({ scope: expected, tickets: [], cursor: null, receivedAt: new Date("2026-11-23T10:05:00.000Z") });
  assert.match(formatLastReceived(record), /^Última recepción /u);
});
