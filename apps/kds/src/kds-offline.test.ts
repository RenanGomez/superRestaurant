import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySyncStorage,
  SyncTransportError,
  type PullOutcome,
  type PushOutcome,
  type SyncPullRequest,
  type SyncPushRequest,
  type SyncTransportPort,
} from "@super-restaurant/sync-engine";
import type { BranchScope, KdsTicketV1, SyncConnectivityStateV1 } from "@super-restaurant/shared-types";

import { createKdsOfflineController, createKdsSyncHttpTransport } from "./kds-offline.js";

const scope = { restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" } as unknown as BranchScope;
const deviceId = "0f0e0d0c-0b0a-4a09-8807-060504030201";
const actorId = "9544c299-d25b-44ce-98ed-d30116610887";
const stationId = "kitchen";

function ticket(overrides: Partial<KdsTicketV1> = {}): KdsTicketV1 {
  return {
    schemaVersion: 1,
    scope,
    stationId,
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

class FakeSyncServer implements SyncTransportPort {
  public readonly pushes: SyncPushRequest[] = [];
  public readonly pulls: SyncPullRequest[] = [];
  public pushStatus: "accepted" | "rejected" = "accepted";

  public push(request: SyncPushRequest): Promise<unknown> {
    this.pushes.push(request);
    return Promise.resolve({
      protocolVersion: 1,
      scope: request.scope,
      results: request.events.map((event) => ({
        auditId: null,
        canonicalVersion: 4,
        code: this.pushStatus === "accepted" ? null : "STALE_VERSION",
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        status: this.pushStatus,
      })),
    });
  }

  public pull(request: SyncPullRequest): Promise<unknown> {
    this.pulls.push(request);
    return Promise.resolve({
      protocolVersion: 1,
      scope: request.scope,
      changes: [],
      nextCursor: "pull:1",
      hasMore: false,
    });
  }
}

function sequentialUuid(): () => string {
  let counter = 0;
  return (): string => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}

function rig(connectivity: { readonly value: SyncConnectivityStateV1 } = { value: "offline" }): {
  readonly controller: ReturnType<typeof createKdsOfflineController>;
  readonly server: FakeSyncServer;
} {
  const server = new FakeSyncServer();
  const controller = createKdsOfflineController({
    actorId,
    connectivity: () => connectivity.value,
    deviceId,
    now: () => Date.parse("2026-11-23T10:00:00.000Z"),
    scope,
    stationId,
    storage: new InMemorySyncStorage(),
    transport: server,
    uuid: sequentialUuid(),
  });
  return { controller, server };
}

test("queues a preparing transition for a received ticket while offline", async () => {
  const { controller, server } = rig();
  await controller.init();
  const item = ticket();

  assert.deepEqual(await controller.canAdvance(item, "preparing", { ticketReceivedOnStation: true }), {
    allowed: true,
    reasonCode: null,
  });
  const result = await controller.advance(item, "preparing", { ticketReceivedOnStation: true });
  assert.equal(result.queued, true);
  assert.equal(server.pushes.length, 0, "offline advance is never sent directly");

  assert.deepEqual(await controller.pendingTransitions(), [{ orderItemId: item.orderItemId, to: "preparing" }]);
  assert.equal(await controller.pendingCount(), 1);
});

test("blocks advancing a ticket that was not received on this station while offline", async () => {
  const { controller } = rig();
  await controller.init();
  const item = ticket();

  assert.deepEqual(await controller.canAdvance(item, "ready", { ticketReceivedOnStation: false }), {
    allowed: false,
    reasonCode: "TICKET_NOT_RECEIVED_ON_STATION",
  });
  const result = await controller.advance(item, "ready", { ticketReceivedOnStation: false });
  assert.deepEqual(result, { queued: false, reasonCode: "TICKET_NOT_RECEIVED_ON_STATION" });
  assert.equal(await controller.pendingCount(), 0);
});

test("reconnecting pushes the outbox then pulls the cursor without duplicating events", async () => {
  const connectivity = { value: "offline" as SyncConnectivityStateV1 };
  const { controller, server } = rig(connectivity);
  await controller.init();
  const item = ticket();
  await controller.advance(item, "preparing", { ticketReceivedOnStation: true });

  connectivity.value = "online";
  const result: { readonly push: PushOutcome; readonly pull: PullOutcome } = await controller.reconcile();

  assert.equal(result.push.sent, 1);
  assert.equal(result.push.events[0]?.state, "accepted");
  assert.equal(server.pushes.length, 1);
  assert.equal(server.pulls.length, 1, "push is followed by an incremental pull");
  assert.equal(server.pushes[0]?.events[0]?.payload["stationId"], stationId);
  assert.equal(server.pushes[0]?.events[0]?.operation, "transition");
  assert.equal(result.pull.status, "complete");
  assert.equal(await controller.pendingCount(), 0, "an accepted transition leaves no pending events");
  assert.deepEqual(await controller.pendingTransitions(), []);
});

test("a rejected transition is not reported as still pending after reconcile", async () => {
  const connectivity = { value: "online" as SyncConnectivityStateV1 };
  const { controller, server } = rig(connectivity);
  server.pushStatus = "rejected";
  await controller.init();
  await controller.advance(ticket(), "preparing", { ticketReceivedOnStation: true });

  const result = await controller.reconcile();
  assert.equal(result.push.events[0]?.state, "rejected");
  assert.deepEqual(await controller.pendingTransitions(), [], "a rejected event is not shown as still pending");
});

test("reconcile pulls from the previous cursor and never resends an accepted transition", async () => {
  const connectivity = { value: "online" as SyncConnectivityStateV1 };
  const { controller, server } = rig(connectivity);
  await controller.init();
  await controller.advance(ticket(), "preparing", { ticketReceivedOnStation: true });

  await controller.reconcile();
  await controller.reconcile();

  assert.equal(server.pulls[0]?.cursor, null, "the first pull starts without a cursor");
  assert.equal(server.pulls[1]?.cursor, "pull:1", "the next pull resumes from the cursor returned by the server");
  const pushed = server.pushes.reduce((total, request) => total + request.events.length, 0);
  assert.equal(pushed, 1, "an accepted transition is not pushed again on the next reconcile");
  assert.equal(await controller.pendingCount(), 0);
});

test("devices sharing durable storage keep independent outboxes", async () => {
  const storage = new InMemorySyncStorage();
  const connectivity = { value: "offline" as SyncConnectivityStateV1 };
  const otherDeviceId = "11111111-2222-4333-8444-555555555555";
  const first = createKdsOfflineController({
    actorId, connectivity: () => connectivity.value, deviceId, scope, stationId, storage, transport: new FakeSyncServer(),
  });
  const second = createKdsOfflineController({
    actorId, connectivity: () => connectivity.value, deviceId: otherDeviceId, scope, stationId, storage, transport: new FakeSyncServer(),
  });
  await Promise.all([first.init(), second.init()]);
  await first.advance(ticket(), "preparing", { ticketReceivedOnStation: true });

  assert.equal(await first.pendingCount(), 1);
  assert.equal(await second.pendingCount(), 0, "another device never inherits this device's queued transition");
});

test("online KDS still resolves the capability for a received ticket", async () => {
  const { controller } = rig({ value: "online" });
  await controller.init();
  const decision = await controller.canAdvance(ticket(), "ready", { ticketReceivedOnStation: false });
  assert.equal(decision.allowed, true);
});

test("HTTP transport posts to the versioned sync endpoints with the bearer token", async () => {
  const calls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
  const fetcher = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ init, url: String(url) });
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" }, status: 200 }));
  };
  const transport = createKdsSyncHttpTransport({ accessToken: "token-123", apiBaseUrl: "https://api.example.test", fetcher });

  await transport.push({ deviceId, events: [], protocolVersion: 1, scope });
  await transport.pull({ cursor: null, limit: 10, protocolVersion: 1, scope });

  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.example.test/api/v1/sync/push",
    "https://api.example.test/api/v1/sync/pull",
  ]);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer token-123");
});

test("HTTP transport maps a missing sync service to a retryable transport error", async () => {
  const fetcher = (): Promise<Response> => Promise.resolve(new Response("not found", { status: 404 }));
  const transport = createKdsSyncHttpTransport({ accessToken: "t", apiBaseUrl: "https://api.example.test", fetcher });
  await assert.rejects(
    transport.push({ deviceId, events: [], protocolVersion: 1, scope }),
    (error: unknown) => error instanceof SyncTransportError && error.code === "SYNC_UNAVAILABLE" && error.retryable,
  );
});

test("HTTP transport maps a network failure to a retryable transport error", async () => {
  const fetcher = (): Promise<Response> => Promise.reject(new Error("ECONNREFUSED"));
  const transport = createKdsSyncHttpTransport({ accessToken: "t", apiBaseUrl: "https://api.example.test", fetcher });
  await assert.rejects(
    transport.pull({ cursor: null, limit: 10, protocolVersion: 1, scope }),
    (error: unknown) => error instanceof SyncTransportError && error.code === "TRANSPORT_ERROR" && error.retryable,
  );
});
