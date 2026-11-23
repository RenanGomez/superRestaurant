import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  REALTIME_KITCHEN_READY_EVENT,
  REALTIME_KITCHEN_READY_SUBSCRIBE_EVENT,
  REALTIME_NAMESPACE,
  REALTIME_NOTIFICATION_EVENT,
  decodeKitchenReadyWireFrame,
  encodeKitchenReadySubscribeFrame,
  encodeRealtimeConnectFrame,
  parseBranchScope,
  parseKdsEventV1,
  parseKitchenReadyNotificationV1,
  parseKitchenReadySubscriptionAckV1,
  parseKitchenReadySubscriptionV1,
  parseRealtimeSubscriptionAckV1,
  realtimeWebSocketUrl,
} from "@super-restaurant/shared-types";
import { Server as SocketIoServer, type Server, type Socket } from "socket.io";
import { io as ioClient } from "socket.io-client";

import type { AuthPrincipalVerifierPort } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import { RealtimeGateway } from "./realtime.gateway.js";

const principal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const parsedScope = parseBranchScope({
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
});
if (parsedScope === undefined) throw new Error("TEST_SCOPE_INVALID");
const scope = parsedScope;
const event = parseKdsEventV1({
  cursor: "v1:9",
  eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  occurredAt: "2026-09-02T22:00:00.000Z",
  operation: "order_item.status_changed",
  orderId: "72371a5f-2056-448d-9ddb-14ab6664a4e8",
  orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  receivedAt: "2026-09-02T22:00:01.000Z",
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
  status: "ready",
});
if (event === undefined) throw new Error("TEST_EVENT_INVALID");

test("gateway authenticates from handshake auth, authorizes a single subscription, and emits notification-only payloads", async () => {
  const verified: string[] = [];
  const verifier: AuthPrincipalVerifierPort = {
    verifyAccessToken: async (token) => { verified.push(token); return principal; },
  };
  let revoked = false;
  const memberships: MembershipLookupPort = {
    findActiveMembership: async () => revoked ? undefined : { roles: ["kitchen"], scope },
  };
  const gateway = new RealtimeGateway(verifier, new MembershipAuthorizationService(memberships));
  const middleware = captureMiddleware(gateway);
  const fake = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(middleware, fake.socket);
  assert.deepEqual(verified, ["valid-access-token-value"]);

  const ack = await gateway.subscribe(fake.socket, { schemaVersion: 1, scope, stationId: "kitchen" });
  assert.notEqual(parseRealtimeSubscriptionAckV1(ack), undefined);
  assert.deepEqual(fake.joined, [`kds:v1:${scope.restaurantId}:${scope.branchId}:kitchen`]);

  await gateway.notify(event);
  assert.equal(fake.emitted.length, 1);
  assert.equal(fake.emitted[0]?.name, REALTIME_NOTIFICATION_EVENT);
  assert.deepEqual(Object.keys(fake.emitted[0]?.payload as object).sort(), ["cursor", "eventId", "eventType", "schemaVersion", "scope", "stationId"].sort());

  revoked = true;
  await gateway.notify(event);
  assert.equal(fake.emitted.length, 1);
  assert.equal(fake.disconnected, true);
  assert.deepEqual(fake.left, fake.joined);
});

test("gateway rejects invalid credentials, hostile subscriptions, and duplicate subscription attempts", async () => {
  const verifier: AuthPrincipalVerifierPort = { verifyAccessToken: async () => principal };
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles: ["kitchen"], scope }) };
  const gateway = new RealtimeGateway(verifier, new MembershipAuthorizationService(memberships));
  const middleware = captureMiddleware(gateway);

  for (const auth of [{}, { accessToken: "short" }, { accessToken: "valid-access-token-value", extra: true }]) {
    const fake = socketFixture(auth);
    const error = await runMiddlewareForError(middleware, fake.socket);
    assert.equal(error?.message, "AUTHENTICATION_REQUIRED");
    assert.equal(error?.message.includes(String(Reflect.get(auth, "accessToken"))), false);
  }

  const hostile = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(middleware, hostile.socket);
  assert.equal(await gateway.subscribe(hostile.socket, { schemaVersion: 1, scope, stationId: " kitchen" }), undefined);
  assert.equal(hostile.disconnected, true);

  const duplicate = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(middleware, duplicate.socket);
  assert.notEqual(await gateway.subscribe(duplicate.socket, { schemaVersion: 1, scope, stationId: "kitchen" }), undefined);
  assert.equal(await gateway.subscribe(duplicate.socket, { schemaVersion: 1, scope, stationId: "kitchen" }), undefined);
  assert.equal(duplicate.disconnected, true);
});

test("gateway filters by exact restaurant, branch, and station before reauthorization", async () => {
  let authorizationLookups = 0;
  const verifier: AuthPrincipalVerifierPort = { verifyAccessToken: async () => principal };
  const memberships: MembershipLookupPort = {
    findActiveMembership: async () => { authorizationLookups += 1; return { roles: ["kitchen"], scope }; },
  };
  const gateway = new RealtimeGateway(verifier, new MembershipAuthorizationService(memberships));
  const middleware = captureMiddleware(gateway);
  const fake = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(middleware, fake.socket);
  await gateway.subscribe(fake.socket, { schemaVersion: 1, scope, stationId: "bar" });
  assert.equal(authorizationLookups, 1);
  await gateway.notify(event);
  assert.equal(authorizationLookups, 1);
  assert.equal(fake.emitted.length, 0);
});

test("kitchen-ready channel authorizes orders.read, emits only on ready status, and disconnects on revocation", async () => {
  const verifier: AuthPrincipalVerifierPort = { verifyAccessToken: async () => principal };
  let revoked = false;
  const memberships: MembershipLookupPort = {
    findActiveMembership: async () => revoked ? undefined : { roles: ["cashier"], scope },
  };
  const gateway = new RealtimeGateway(verifier, new MembershipAuthorizationService(memberships));
  const middleware = captureMiddleware(gateway);
  const fake = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(middleware, fake.socket);

  const ack = await gateway.subscribeKitchenReady(fake.socket, { schemaVersion: 1, scope, stationId: "kitchen" });
  const parsedAck = parseKitchenReadySubscriptionAckV1(ack);
  assert.notEqual(parsedAck, undefined);
  assert.equal(parsedAck?.stationId, "kitchen");
  assert.deepEqual(fake.joined, [`kitchen-ready:v1:${scope.restaurantId}:${scope.branchId}:kitchen`]);

  for (const status of ["sent", "preparing", "delivered", "cancelled"] as const) {
    const nonReady = parseKdsEventV1({ ...event, status });
    if (nonReady === undefined) throw new Error("TEST_EVENT_INVALID");
    await gateway.notify(nonReady);
  }
  assert.equal(fake.emitted.length, 0);

  await gateway.notify(event);
  assert.equal(fake.emitted.length, 1);
  assert.equal(fake.emitted[0]?.name, REALTIME_KITCHEN_READY_EVENT);
  const parsed = parseKitchenReadyNotificationV1(fake.emitted[0]?.payload);
  assert.notEqual(parsed, undefined);
  assert.equal(parsed?.orderId, event.orderId);
  assert.equal(parsed?.orderItemId, event.orderItemId);
  assert.equal(parsed?.stationId, "kitchen");

  revoked = true;
  await gateway.notify(event);
  assert.equal(fake.emitted.length, 1);
  assert.equal(fake.disconnected, true);
  assert.deepEqual(fake.left, fake.joined);
});

test("kitchen-ready channel never leaks across restaurants, branches, or stations", async () => {
  const otherBranchScope = parseBranchScope({
    branchId: "99723e10-c0bf-49fd-9363-4f0e2c60e955",
    restaurantId: scope.restaurantId,
  });
  const otherRestaurantScope = parseBranchScope({
    branchId: "88723e10-c0bf-49fd-9363-4f0e2c60e955",
    restaurantId: "7737ae13-8507-484c-969f-2176f77b7000",
  });
  if (otherBranchScope === undefined || otherRestaurantScope === undefined) throw new Error("TEST_SCOPE_INVALID");

  let lookups = 0;
  const verifier: AuthPrincipalVerifierPort = { verifyAccessToken: async () => principal };
  const memberships: MembershipLookupPort = {
    findActiveMembership: async (_principal, requestedScope) => {
      lookups += 1;
      return { roles: ["waiter"], scope: requestedScope };
    },
  };
  const gateway = new RealtimeGateway(verifier, new MembershipAuthorizationService(memberships));
  const middleware = captureMiddleware(gateway);

  const sameKitchen = socketFixture({ accessToken: "valid-access-token-value" });
  const sameBranchAllStations = socketFixture({ accessToken: "valid-access-token-value" });
  const sameBranchBar = socketFixture({ accessToken: "valid-access-token-value" });
  const otherBranch = socketFixture({ accessToken: "valid-access-token-value" });
  const otherRestaurant = socketFixture({ accessToken: "valid-access-token-value" });
  for (const fixture of [sameKitchen, sameBranchAllStations, sameBranchBar, otherBranch, otherRestaurant]) {
    await runMiddleware(middleware, fixture.socket);
  }

  assert.notEqual(await gateway.subscribeKitchenReady(sameKitchen.socket, { schemaVersion: 1, scope, stationId: "kitchen" }), undefined);
  assert.notEqual(await gateway.subscribeKitchenReady(sameBranchAllStations.socket, { schemaVersion: 1, scope, stationId: null }), undefined);
  assert.notEqual(await gateway.subscribeKitchenReady(sameBranchBar.socket, { schemaVersion: 1, scope, stationId: "bar" }), undefined);
  assert.notEqual(await gateway.subscribeKitchenReady(otherBranch.socket, { schemaVersion: 1, scope: otherBranchScope, stationId: "kitchen" }), undefined);
  assert.notEqual(await gateway.subscribeKitchenReady(otherRestaurant.socket, { schemaVersion: 1, scope: otherRestaurantScope, stationId: null }), undefined);
  assert.equal(lookups, 5);

  await gateway.notify(event);
  // Only the two matching sockets (sameKitchen + sameBranchAllStations) trigger re-auth and receive the event.
  assert.equal(lookups, 7);
  assert.equal(sameKitchen.emitted.length, 1);
  assert.equal(sameBranchAllStations.emitted.length, 1);
  assert.equal(sameBranchBar.emitted.length, 0);
  assert.equal(otherBranch.emitted.length, 0);
  assert.equal(otherRestaurant.emitted.length, 0);

  const barReady = parseKdsEventV1({ ...event, eventId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83", stationId: "bar" });
  if (barReady === undefined) throw new Error("TEST_EVENT_INVALID");
  await gateway.notify(barReady);
  assert.equal(sameKitchen.emitted.length, 1);
  assert.equal(sameBranchAllStations.emitted.length, 2);
  assert.equal(sameBranchBar.emitted.length, 1);
  assert.equal(otherBranch.emitted.length, 0);
  assert.equal(otherRestaurant.emitted.length, 0);
});

test("kitchen-ready channel rejects unauthorized roles, hostile payloads, duplicate subscriptions, and cross-scope mixing", async () => {
  const otherBranchScope = parseBranchScope({
    branchId: "99723e10-c0bf-49fd-9363-4f0e2c60e955",
    restaurantId: scope.restaurantId,
  });
  if (otherBranchScope === undefined) throw new Error("TEST_SCOPE_INVALID");

  const verifier: AuthPrincipalVerifierPort = { verifyAccessToken: async () => principal };
  const courierGateway = new RealtimeGateway(
    verifier,
    new MembershipAuthorizationService({ findActiveMembership: async () => ({ roles: ["courier"], scope }) }),
  );
  const courierMiddleware = captureMiddleware(courierGateway);
  const courierSocket = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(courierMiddleware, courierSocket.socket);
  assert.equal(await courierGateway.subscribeKitchenReady(courierSocket.socket, { schemaVersion: 1, scope, stationId: null }), undefined);
  assert.equal(courierSocket.disconnected, true);

  const waiterGateway = new RealtimeGateway(
    verifier,
    new MembershipAuthorizationService({ findActiveMembership: async (_p, s) => ({ roles: ["waiter"], scope: s }) }),
  );
  const waiterMiddleware = captureMiddleware(waiterGateway);

  for (const hostile of [
    { schemaVersion: 1, scope, stationId: "" },
    { schemaVersion: 1, scope, stationId: " kitchen" },
    { schemaVersion: 1, scope, stationId: null, extra: true },
  ]) {
    const socket = socketFixture({ accessToken: "valid-access-token-value" });
    await runMiddleware(waiterMiddleware, socket.socket);
    assert.equal(await waiterGateway.subscribeKitchenReady(socket.socket, hostile), undefined);
    assert.equal(socket.disconnected, true);
  }

  const duplicate = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(waiterMiddleware, duplicate.socket);
  assert.notEqual(await waiterGateway.subscribeKitchenReady(duplicate.socket, { schemaVersion: 1, scope, stationId: null }), undefined);
  assert.equal(await waiterGateway.subscribeKitchenReady(duplicate.socket, { schemaVersion: 1, scope, stationId: null }), undefined);
  assert.equal(duplicate.disconnected, true);

  const mixedScope = socketFixture({ accessToken: "valid-access-token-value" });
  await runMiddleware(waiterMiddleware, mixedScope.socket);
  assert.notEqual(await waiterGateway.subscribe(mixedScope.socket, { schemaVersion: 1, scope, stationId: "kitchen" }), undefined);
  assert.equal(await waiterGateway.subscribeKitchenReady(mixedScope.socket, { schemaVersion: 1, scope: otherBranchScope, stationId: "kitchen" }), undefined);
  assert.equal(mixedScope.disconnected, true);
});

test("kitchen-ready channel delivers over a real loopback Socket.IO connection without leaking to foreign stations", async () => {
  const verifier: AuthPrincipalVerifierPort = { verifyAccessToken: async () => principal };
  const memberships: MembershipLookupPort = { findActiveMembership: async (_p, s) => ({ roles: ["waiter"], scope: s }) };
  const gateway = new RealtimeGateway(verifier, new MembershipAuthorizationService(memberships));

  const httpServer = createServer();
  const ioServer = new SocketIoServer(httpServer, { transports: ["websocket"] });
  const namespace = ioServer.of(REALTIME_NAMESPACE);
  gateway.afterInit(namespace as unknown as Server);
  namespace.on("connection", (socket) => {
    socket.on(REALTIME_KITCHEN_READY_SUBSCRIBE_EVENT, (payload: unknown, ack?: (value: unknown) => void) => {
      void gateway.subscribeKitchenReady(socket, payload).then((result) => {
        if (result !== undefined && typeof ack === "function") ack(result);
      });
    });
    socket.on("disconnect", () => { gateway.handleDisconnect(socket); });
  });

  await new Promise<void>((resolve) => { httpServer.listen(0, "127.0.0.1", () => { resolve(); }); });
  const address = httpServer.address();
  if (address === null || typeof address === "string") throw new Error("TEST_PORT_MISSING");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const kitchenClient = ioClient(`${baseUrl}${REALTIME_NAMESPACE}`, {
    auth: { accessToken: "valid-access-token-value" },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });
  const barClient = ioClient(`${baseUrl}${REALTIME_NAMESPACE}`, {
    auth: { accessToken: "valid-access-token-value" },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });

  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => { kitchenClient.once("connect", resolve); kitchenClient.once("connect_error", reject); }),
      new Promise<void>((resolve, reject) => { barClient.once("connect", resolve); barClient.once("connect_error", reject); }),
    ]);

    const [kitchenAck, barAck] = await Promise.all([
      kitchenClient.timeout(2_000).emitWithAck(REALTIME_KITCHEN_READY_SUBSCRIBE_EVENT, { schemaVersion: 1, scope, stationId: "kitchen" }),
      barClient.timeout(2_000).emitWithAck(REALTIME_KITCHEN_READY_SUBSCRIBE_EVENT, { schemaVersion: 1, scope, stationId: "bar" }),
    ]);
    assert.notEqual(parseKitchenReadySubscriptionAckV1(kitchenAck), undefined);
    assert.notEqual(parseKitchenReadySubscriptionAckV1(barAck), undefined);

    const barReceived: unknown[] = [];
    barClient.on(REALTIME_KITCHEN_READY_EVENT, (payload: unknown) => { barReceived.push(payload); });
    const receivedPromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("READY_NOTIFICATION_TIMEOUT")); }, 2_000);
      kitchenClient.once(REALTIME_KITCHEN_READY_EVENT, (payload: unknown) => { clearTimeout(timer); resolve(payload); });
    });

    await gateway.notify(event);
    const received = parseKitchenReadyNotificationV1(await receivedPromise);
    assert.notEqual(received, undefined);
    assert.equal(received?.orderItemId, event.orderItemId);
    assert.equal(received?.stationId, "kitchen");
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    assert.equal(barReceived.length, 0);

    // Also verify native WebSocket wire frames used by web SSE bridge and mobile ActiveOrdersPanel.
    const rawSub = parseKitchenReadySubscriptionV1({ schemaVersion: 1, scope, stationId: null });
    if (rawSub === undefined) throw new Error("TEST_SUB_INVALID");
    const rawReady = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("RAW_WS_TIMEOUT")); }, 2_000);
      const ws = new WebSocket(realtimeWebSocketUrl(baseUrl));
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("RAW_WS_ERROR")); });
      ws.addEventListener("message", (message) => {
        if (typeof message.data !== "string") return;
        const decoded = decodeKitchenReadyWireFrame(message.data);
        if (decoded.kind === "open") ws.send(encodeRealtimeConnectFrame("valid-access-token-value"));
        else if (decoded.kind === "ping") ws.send("3");
        else if (decoded.kind === "connected") ws.send(encodeKitchenReadySubscribeFrame(rawSub));
        else if (decoded.kind === "ack") {
          if (decoded.ack === undefined) { clearTimeout(timer); ws.close(); reject(new Error("RAW_ACK_INVALID")); return; }
          void gateway.notify(event);
        } else if (decoded.kind === "ready") {
          clearTimeout(timer);
          ws.close();
          resolve(decoded.notification);
        }
      });
    });
    const parsedRaw = parseKitchenReadyNotificationV1(rawReady);
    assert.notEqual(parsedRaw, undefined);
    assert.equal(parsedRaw?.orderItemId, event.orderItemId);
  } finally {
    kitchenClient.disconnect();
    barClient.disconnect();
    await ioServer.close();
    httpServer.close();
  }
});

type Middleware = (socket: Socket, next: (error?: Error) => void) => void;

function captureMiddleware(gateway: RealtimeGateway): Middleware {
  let captured: Middleware | undefined;
  gateway.afterInit({ use: (middleware: Middleware) => { captured = middleware; } } as unknown as Server);
  if (captured === undefined) throw new Error("TEST_MIDDLEWARE_MISSING");
  return captured;
}

async function runMiddleware(middleware: Middleware, socket: Socket): Promise<void> {
  const error = await runMiddlewareForError(middleware, socket);
  if (error !== undefined) throw error;
}

function runMiddlewareForError(middleware: Middleware, socket: Socket): Promise<Error | undefined> {
  return new Promise((resolve) => middleware(socket, (error) => resolve(error)));
}

function socketFixture(auth: unknown): {
  readonly emitted: { readonly name: string; readonly payload: unknown }[];
  readonly joined: string[];
  readonly left: string[];
  readonly socket: Socket;
  readonly disconnected: boolean;
} {
  const emitted: { readonly name: string; readonly payload: unknown }[] = [];
  const joined: string[] = [];
  const left: string[] = [];
  const state = { disconnected: false };
  const raw = {
    connected: true,
    disconnect: () => { state.disconnected = true; raw.connected = false; },
    handshake: { auth },
    join: async (room: string) => { joined.push(room); },
    leave: async (room: string) => { left.push(room); },
    volatile: { emit: (name: string, payload: unknown) => { emitted.push({ name, payload }); } },
  };
  return {
    emitted,
    get disconnected() { return state.disconnected; },
    joined,
    left,
    socket: raw as unknown as Socket,
  };
}
