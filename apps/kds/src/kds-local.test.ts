import assert from "node:assert/strict";
import test from "node:test";

import type { BranchScope, KdsTicketV1 } from "@super-restaurant/shared-types";

import {
  InMemoryKdsCache,
  applyServerList,
  buildCacheRecord,
  formatLastReceived,
  overlayPendingTransitions,
  parseCacheRecord,
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

test("a successful server list replaces cached state so an absent ticket disappears", () => {
  const kept = ticket({ orderItemId: "b72573ec-6224-4857-bc4a-f3d1d07b6d83", status: "preparing" });
  const removed = ticket({ orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", status: "sent" });
  const cached = [ticket(), removed];
  const server = [kept];
  const next = ticketsForStation(server, expected);
  assert.deepEqual(next.map((item) => item.orderItemId), [kept.orderItemId]);
  assert.equal(next.length < cached.length, true, "the merge is not a union: server truth wins");
});

test("applyServerList replaces the cached board {A,B} with the server list {A} and persists it", async () => {
  const cache = new InMemoryKdsCache();
  const kept = ticket({ orderItemId: "b72573ec-6224-4857-bc4a-f3d1d07b6d83", status: "preparing" });
  const removed = ticket({ orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", status: "sent" });
  await cache.save(buildCacheRecord({ scope: expected, tickets: [kept, removed], cursor: "v1:5", receivedAt: new Date("2026-11-23T10:05:00.000Z") }));

  const board = applyServerList([kept], expected);
  assert.deepEqual(board.map((item) => item.orderItemId), [kept.orderItemId], "the absent ticket is not unioned back");
  assert.equal("localPending" in (board[0] ?? {}), false, "a server list never marks tickets as locally pending");

  await cache.save(buildCacheRecord({ scope: expected, tickets: board, cursor: "v1:6", receivedAt: new Date("2026-11-23T10:06:00.000Z") }));
  const reloaded = await cache.load(expected);
  assert.deepEqual(reloaded?.tickets.map((item) => item.orderItemId), [kept.orderItemId]);
  assert.equal(reloaded?.cursor, "v1:6");
});

test("applyServerList drops foreign tenants, branches and stations and de-duplicates", () => {
  const keeper = ticket();
  const duplicate = ticket({ productName: "Otra" });
  const crossStation = ticket({ orderItemId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83", stationId: "bar" });
  const crossRestaurant = ticket({
    orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
    scope: { restaurantId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", branchId: scope.branchId } as unknown as BranchScope,
  });
  const board = applyServerList([keeper, duplicate, crossStation, crossRestaurant], expected);
  assert.deepEqual(board.map((item) => item.orderItemId), [keeper.orderItemId]);
  assert.equal(board[0]?.productName, "Taco");
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
  assert.match(formatLastReceived(record.lastReceivedAt), /^Última recepción /u);
});

test("drops corrupted or cross-scope cache records instead of rendering them", async () => {
  const cache = new InMemoryKdsCache();
  cache.seedRaw(expected, { schemaVersion: 1, scope: { ...expected, stationId: "bar" }, tickets: [], cursor: null, lastReceivedAt: "2026-11-23T10:05:00.000Z" });
  assert.equal(await cache.load(expected), null);
  cache.seedRaw(expected, { schemaVersion: 1, scope: { ...expected, restaurantId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02" }, tickets: [], cursor: null, lastReceivedAt: "2026-11-23T10:05:00.000Z" });
  assert.equal(await cache.load(expected), null, "a cache record from another restaurant is never rendered");
  cache.seedRaw(expected, { schemaVersion: 1, scope: expected, tickets: [{ bogus: true }], cursor: null, lastReceivedAt: "2026-11-23T10:05:00.000Z" });
  assert.equal(await cache.load(expected), null);
  cache.seedRaw(expected, { schemaVersion: 1, scope: expected, tickets: [{ ...ticket() }], cursor: null, lastReceivedAt: "not-a-date" });
  assert.equal(await cache.load(expected), null);

  const valid = buildCacheRecord({ scope: expected, tickets: [ticket()], cursor: "v1:3", receivedAt: new Date("2026-11-23T10:05:00.000Z") });
  const parsed = parseCacheRecord(JSON.parse(JSON.stringify(valid)) as unknown, expected);
  assert.equal(parsed?.tickets.length, 1);
  assert.equal(parsed?.cursor, "v1:3");
});
