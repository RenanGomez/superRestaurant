import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBranchScope,
  parseKdsCursorV1,
  parseKdsTicketListV1,
  parseRealtimeSubscriptionV1,
} from "@super-restaurant/shared-types";

import type { KdsConfig } from "./config.js";
import {
  KdsRequestError,
  listKdsTickets,
  listMemberships,
  recoverKdsEvents,
  transitionKdsTicket,
} from "./kds-client.js";

const config: KdsConfig = Object.freeze({
  apiBaseUrl: "http://127.0.0.1:4174",
  supabasePublishableKey: "sb_publishable_test",
  supabaseUrl: "https://example.supabase.co",
});
const scope = parseBranchScope({
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
});
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const subscription = parseRealtimeSubscriptionV1({ schemaVersion: 1, scope, stationId: "kitchen" });
const initialCursor = parseKdsCursorV1("v1:0");
if (subscription === undefined || initialCursor === undefined) throw new Error("TEST_SUBSCRIPTION_INVALID");
const rawTicket = {
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
  orderId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  orderItemId: "9544c299-d25b-44ce-98ed-d30116610887",
  orderVersion: 3,
  channel: "counter",
  tableId: null,
  quantity: 2,
  productName: "Hamburguesa",
  modifiers: [{ name: "Queso", quantity: 1 }],
  status: "preparing",
  queuedAt: "2026-09-03T10:00:00.000Z",
};
const tickets = parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [rawTicket], truncated: false });
if (tickets === undefined) throw new Error("TEST_TICKETS_INVALID");

test("loads memberships, tickets, and durable events with bearer and no-store", async () => {
  const calls: { init?: RequestInit; url: string }[] = [];
  const bodies = [
    { schemaVersion: 1, memberships: [{ scope, restaurantName: "Demo", branchName: "Centro", roles: ["kitchen"] }] },
    tickets,
    { schemaVersion: 1, scope, stationId: "kitchen", events: [], nextCursor: "v1:0", hasMore: false },
  ];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return Response.json(bodies.shift());
  };
  assert.equal((await listMemberships(config, "token", fetcher)).memberships.length, 1);
  assert.equal((await listKdsTickets(config, "token", subscription, fetcher)).tickets.length, 1);
  assert.equal((await recoverKdsEvents(config, "token", subscription, initialCursor, fetcher)).nextCursor, "v1:0");
  assert.match(calls[1]?.url ?? "", /\/api\/v1\/kds\/tickets\?/u);
  assert.match(calls[2]?.url ?? "", /after=v1%3A0&limit=200/u);
  assert.equal((calls[0]?.init?.headers as Record<string, string> | undefined)?.authorization, "Bearer token");
  assert.equal(calls[0]?.init?.cache, "no-store");
});

test("posts an optimistic KDS transition and parses the exact summary", async () => {
  let captured: RequestInit | undefined;
  const fetcher: typeof fetch = async (_input, init) => {
    captured = init;
    return Response.json({
      schemaVersion: 1,
      scope,
      orderId: rawTicket.orderId,
      orderStatus: "open",
      version: 4,
      replayed: false,
      kdsEvent: {
        schemaVersion: 1,
        scope,
        cursor: "v1:4",
        eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
        orderId: rawTicket.orderId,
        orderItemId: rawTicket.orderItemId,
        stationId: "kitchen",
        operation: "order_item.status_changed",
        status: "ready",
        occurredAt: "2026-09-03T10:01:00.000Z",
        receivedAt: "2026-09-03T10:01:00.100Z",
      },
    });
  };
  const result = await transitionKdsTicket(
    config,
    "token",
    tickets.tickets[0]!,
    "ready",
    "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
    () => "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
    fetcher,
  );
  assert.equal(result.version, 4);
  const body = JSON.parse(String(captured?.body)) as Record<string, unknown>;
  assert.equal(body.expectedVersion, 3);
  assert.equal(body.to, "ready");
  assert.equal(body.idempotencyKey, body.eventId);
});

test("fails closed for HTTP, network, and malformed responses", async () => {
  const cases: readonly [typeof fetch, KdsRequestError["status"]][] = [
    [async () => new Response(null, { status: 409 }), 409],
    [async () => { throw new Error("provider details"); }, "network"],
    [async () => Response.json({ extra: true }), "protocol"],
  ];
  for (const [fetcher, expected] of cases) {
    await assert.rejects(
      listKdsTickets(config, "token", subscription, fetcher),
      (error: unknown) => error instanceof KdsRequestError && error.status === expected && error.message === "KDS_REQUEST_FAILED",
    );
  }
});
