import assert from "node:assert/strict";
import test from "node:test";

import {
  REALTIME_NOTIFICATION_EVENT,
  parseBranchScope,
  parseKdsEventV1,
  parseRealtimeSubscriptionAckV1,
} from "@super-restaurant/shared-types";
import type { Server, Socket } from "socket.io";

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
