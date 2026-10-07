import assert from "node:assert/strict";
import test from "node:test";

import { ConflictException, ForbiddenException } from "@nestjs/common";
import {
  parseBranchScope,
  parseCancelOrderResultV1,
  parseKdsEventV1,
  parseMenuCatalogStateV1,
  type CancelOrderCommandV1,
  type KdsEventV1,
} from "@super-restaurant/shared-types";
import {
  addOrderItem,
  cancelOrder as cancelWholeOrder,
  createOrder,
  Money,
  transitionOrderItemStatus,
  transitionOrderStatus,
  type Order,
} from "@super-restaurant/domain";

import { SupabaseAuthGuard, type AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import { CancelledWorkTrayService, PostgresCancelledWorkTray, type CancelledWorkTrayPort } from "./cancelled-work-tray.js";
import type { DatabaseClientPort } from "./database.js";
import type { MenuCatalogPort } from "./menu-catalog.js";
import { OrdersController } from "./orders.controller.js";
import {
  OrderApplicationError,
  OrderDeliveryActiveError,
  OrderService,
  PostgresOrderPersistenceAdapter,
  type CancelWholeOrderResult,
  type OrderPersistencePort,
} from "./orders.js";
import { encodeOrderRecord } from "./persistence/order-persistence-codec.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const parsedScope = parseBranchScope({
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
});
if (parsedScope === undefined) throw new Error("TEST_SCOPE_INVALID");
const scope = parsedScope;
const orderId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const sentItemId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const pendingItemId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const deviceId = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";
const eventId = "e74df54b-30a7-449b-a23f-c4ca6f93bda4";
const occurredAt = "2026-10-06T22:00:00.000Z";
const audit = { actorId: principal.actorId, deviceId, eventId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "setup", occurredAt };

function snapshot(name: string) {
  return {
    catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name,
    productId: "9544c299-d25b-44ce-98ed-d30116610887", stationId: "kitchen", unit: "piece",
    unitPrice: new Money(12_500, "MXN"),
  };
}

/** A paid order with one line already sent to the kitchen and one still pending. */
function paidOrder(): Order {
  let order = createOrder({
    branchId: scope.branchId, channel: "counter", currency: "MXN", orderId, restaurantId: scope.restaurantId,
    timeZone: "America/Mexico_City",
  }, audit).order;
  order = addOrderItem(order, { orderItemId: sentItemId, quantity: 1, snapshot: snapshot("Hamburguesa") }, audit).order;
  order = addOrderItem(order, { orderItemId: pendingItemId, quantity: 1, snapshot: snapshot("Refresco") }, audit).order;
  order = transitionOrderStatus(order, "open", audit).order;
  order = transitionOrderItemStatus(order, sentItemId, "sent", audit).order;
  return transitionOrderStatus(order, "paid", audit).order;
}

const command: CancelOrderCommandV1 = Object.freeze({
  deviceId, eventId, expectedVersion: 5, idempotencyKey: "cancel-key-1", occurredAt, orderId,
  reason: "Pedido duplicado", schemaVersion: 1, scope,
});

function kds(itemId: string): KdsEventV1 {
  const parsed = parseKdsEventV1({
    cursor: "v1:9", eventId: "22222222-2222-4222-8222-222222222222", occurredAt, operation: "order_item.status_changed",
    orderId, orderItemId: itemId, receivedAt: "2026-10-06T22:00:00.100Z", schemaVersion: 1, scope, stationId: "kitchen",
    status: "cancelled",
  });
  if (parsed === undefined) throw new Error("TEST_KDS_INVALID");
  return parsed;
}

const obligation = Object.freeze({ capturedMinor: 15_500, capturedTipMinor: 0, currency: "MXN", status: "pending" as const });

interface Recorder { calls: { actorId: string; command: CancelOrderCommandV1; steps: number }[]; notified: KdsEventV1[] }

function fakePort(stored: Order, version: number, result: (steps: number) => CancelWholeOrderResult, recorder: Recorder): OrderPersistencePort {
  return {
    cancelWholeOrder: async (actorId, receivedCommand, steps) => {
      recorder.calls.push({ actorId, command: receivedCommand, steps: steps.length });
      return result(steps.length);
    },
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => ({ order: stored, version }),
    readAssignedToCourier: async () => "missing" as const,
    recoverKds: async () => "forbidden",
    sendOrderToKitchen: async () => { throw new Error("not used"); },
  };
}

function serviceFor(roles: readonly ("manager" | "supervisor" | "waiter" | "cashier")[], port: OrderPersistencePort, recorder: Recorder): OrderService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope }) };
  const catalogs: MenuCatalogPort = { read: async () => { throw new Error("not used"); }, save: async () => ({ status: "conflict" }) };
  return new OrderService(new MembershipAuthorizationService(memberships), port, catalogs, {
    notify: async (event) => { recorder.notified.push(event); },
  });
}

test("cancelOrder runs the domain steps with a server-made supervisor approval and notifies each kitchen correction", async () => {
  const recorder: Recorder = { calls: [], notified: [] };
  const stored = paidOrder();
  const final = cancelWholeOrder(stored, {
    auditContext: { ...audit, authorization: { actorId: principal.actorId, approved: true }, eventId, idempotencyKey: command.idempotencyKey, reason: command.reason },
    lineContexts: { [sentItemId]: { eventId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "line-key" } },
    refundObligation: "pending",
  }).at(-1)!.order;
  const service = serviceFor(["manager"], fakePort(stored, 5, () => ({
    kdsEvents: [kds(sentItemId)], order: final, refundObligation: obligation, status: "saved", version: 7,
  }), recorder), recorder);
  const result = await service.cancelOrder(principal, command);
  assert.equal(result.orderStatus, "cancelled");
  assert.equal(result.replayed, false);
  assert.equal(result.version, 7);
  assert.equal(result.refundObligation.status, "pending");
  assert.equal(result.kdsEvents.length, 1);
  assert.notEqual(parseCancelOrderResultV1(result), undefined);
  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0]!.steps, 2, "one kitchen line plus the order step");
  assert.equal(recorder.calls[0]!.actorId, principal.actorId);
  assert.equal(recorder.notified.length, 1);
});

test("cancelOrder is refused to roles without orders.cancel.order and never reaches SQL", async () => {
  for (const role of ["waiter", "cashier"] as const) {
    const recorder: Recorder = { calls: [], notified: [] };
    const service = serviceFor([role], fakePort(paidOrder(), 5, () => ({ status: "conflict" }), recorder), recorder);
    await assert.rejects(service.cancelOrder(principal, command), (e: unknown) => e instanceof OrderApplicationError && e.code === "authorization");
    assert.equal(recorder.calls.length, 0);
  }
});

test("cancelOrder rejects hostile commands, a client-sent approval and a missing order", async () => {
  const recorder: Recorder = { calls: [], notified: [] };
  const service = serviceFor(["manager"], fakePort(paidOrder(), 5, () => ({ status: "conflict" }), recorder), recorder);
  for (const bad of [{ ...command, authorization: { approved: true } }, { ...command, reason: "" }, { ...command, extra: 1 }, null]) {
    await assert.rejects(service.cancelOrder(principal, bad), (e: unknown) => e instanceof OrderApplicationError && e.code === "request");
  }
  assert.equal(recorder.calls.length, 0);
});

test("cancelOrder maps SQL outcomes: DELIVERY_ACTIVE, forbidden and conflict, and replays a stale-version retry", async () => {
  const recorder: Recorder = { calls: [], notified: [] };
  const run = (result: CancelWholeOrderResult, version = 5) =>
    serviceFor(["supervisor"], fakePort(paidOrder(), version, () => result, recorder), recorder).cancelOrder(principal, command);
  await assert.rejects(run({ status: "delivery_active" }), (e: unknown) => e instanceof OrderDeliveryActiveError);
  await assert.rejects(run({ status: "forbidden" }), (e: unknown) => e instanceof OrderApplicationError && e.code === "authorization");
  await assert.rejects(run({ status: "conflict" }), (e: unknown) => e instanceof OrderApplicationError && e.code === "conflict");
  // Stale version: no steps are built, SQL decides (replay or conflict).
  const before = recorder.calls.length;
  await assert.rejects(run({ status: "conflict" }, 6), (e: unknown) => e instanceof OrderApplicationError && e.code === "conflict");
  assert.equal(recorder.calls[before]!.steps, 0);
  const replayedOrder = cancelWholeOrder(paidOrder(), {
    auditContext: { ...audit, authorization: { actorId: principal.actorId, approved: true }, eventId, idempotencyKey: command.idempotencyKey, reason: command.reason },
    lineContexts: { [sentItemId]: { eventId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "line-key" } },
    refundObligation: "pending",
  }).at(-1)!.order;
  const replay = await run({ kdsEvents: [kds(sentItemId)], order: replayedOrder, refundObligation: obligation, status: "replayed", version: 7 }, 7);
  assert.equal(replay.replayed, true);
  assert.equal(recorder.notified.length, 0, "a replay never re-notifies KDS");
});

test("cancelOrder answers conflict for closed and cancelled orders without calling SQL", async () => {
  const recorder: Recorder = { calls: [], notified: [] };
  const sentThenDelivered = ["preparing", "ready", "delivered"].reduce(
    (order, to) => transitionOrderItemStatus(order, sentItemId, to as "preparing", audit).order, paidOrder());
  const service = serviceFor(["manager"], fakePort(sentThenDelivered, 5, () => ({ status: "conflict" }), recorder), recorder);
  await assert.rejects(service.cancelOrder(principal, command), (e: unknown) => e instanceof OrderApplicationError && e.code === "conflict");
  assert.equal(recorder.calls.length, 0);
});

test("controller answers 409 DELIVERY_ACTIVE, 403 and 409 ORDER_CONFLICT for cancel", async () => {
  const failing = (error: unknown) => new OrdersController(
    { cancelOrder: async () => { throw error; } } as unknown as OrderService,
    { list: async () => { throw error; } } as unknown as CancelledWorkTrayService,
  );
  const request: Record<string, unknown> = { headers: { authorization: "Bearer test-token-0123456789abcdef" } };
  const guard = new SupabaseAuthGuard({ verifyAccessToken: async () => principal }, { getAllAndOverride: () => false } as never);
  await guard.canActivate({ getClass: () => Object, getHandler: () => Object, switchToHttp: () => ({ getRequest: () => request }) } as never);
  const call = (error: unknown) => failing(error).cancelOrder(request, command);
  await assert.rejects(call(new OrderDeliveryActiveError()), (e: unknown) => e instanceof ConflictException
    && JSON.stringify(e.getResponse()).includes("DELIVERY_ACTIVE"));
  await assert.rejects(call(new OrderApplicationError("authorization")), (e: unknown) => e instanceof ForbiddenException);
  await assert.rejects(call(new OrderApplicationError("conflict")), (e: unknown) => e instanceof ConflictException
    && JSON.stringify(e.getResponse()).includes("ORDER_CONFLICT"));
});

test("PostgreSQL adapter binds app_private.cancel_order and decodes the real { result } row", async () => {
  const stored = paidOrder();
  const final = cancelWholeOrder(stored, {
    auditContext: { ...audit, authorization: { actorId: principal.actorId, approved: true }, eventId, idempotencyKey: command.idempotencyKey, reason: command.reason },
    lineContexts: { [sentItemId]: { eventId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "line-key" } },
    refundObligation: "pending",
  }).at(-1)!.order;
  const calls: { parameters: readonly unknown[]; sql: string }[] = [];
  let next: unknown = {
    kdsEvents: [kds(sentItemId)], order: encodeOrderRecord(final), refundObligation: obligation, schemaVersion: 1, scope,
    status: "saved", version: 7,
  };
  const database: DatabaseClientPort = { query: async (sql, parameters) => { calls.push({ parameters, sql }); return { rows: [{ result: next }] }; } };
  const adapter = new PostgresOrderPersistenceAdapter(database);
  const saved = await adapter.cancelWholeOrder(principal.actorId, command, []);
  assert.equal(saved.status, "saved");
  assert.match(calls[0]!.sql, /app_private\.cancel_order\(\$1::uuid, \$2::jsonb, \$3::jsonb\)/u);
  assert.equal(calls[0]!.parameters.length, 3);
  assert.equal(JSON.parse(calls[0]!.parameters[1] as string).reason, "Pedido duplicado");
  for (const status of ["conflict", "forbidden", "delivery_active"] as const) {
    next = { status };
    assert.deepEqual(await adapter.cancelWholeOrder(principal.actorId, command, []), { status });
  }
  for (const malformed of [{ status: "weird" }, { status: "saved" }, { schemaVersion: 1, extra: 1 }, null]) {
    next = malformed;
    await assert.rejects(adapter.cancelWholeOrder(principal.actorId, command, []), (e: unknown) => e instanceof OrderApplicationError);
  }
  next = { kdsEvents: [], order: encodeOrderRecord(final), refundObligation: obligation, schemaVersion: 1, scope, status: "saved", version: 7 };
  const mismatched = new PostgresOrderPersistenceAdapter(database);
  await assert.rejects(mismatched.cancelWholeOrder(principal.actorId, { ...command, reason: "Otro motivo" }, []),
    (e: unknown) => e instanceof OrderApplicationError);
});

test("detail offers cancelOrder only to roles with the permission and only in cancellable states", async () => {
  const offered = async (roles: readonly ("manager" | "waiter")[], order: Order) => {
    const recorder: Recorder = { calls: [], notified: [] };
    const detail = await serviceFor(roles, fakePort(order, 5, () => ({ status: "conflict" }), recorder), recorder)
      .detail(principal, { orderId, schemaVersion: 1, scope });
    return detail.availableActions.includes("cancelOrder");
  };
  assert.equal(await offered(["manager"], paidOrder()), true);
  assert.equal(await offered(["waiter"], paidOrder()), false);
  const cancelledOrder = cancelWholeOrder(paidOrder(), {
    auditContext: { ...audit, authorization: { actorId: principal.actorId, approved: true }, eventId, idempotencyKey: "k", reason: "x" },
    lineContexts: { [sentItemId]: { eventId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "line-key" } },
    refundObligation: "pending",
  }).at(-1)!.order;
  assert.equal(await offered(["manager"], cancelledOrder), false);
});

test("cancelled tray projects orders and captures, masks the customer without customers.read, and fails closed", async () => {
  const stored = paidOrder();
  const cancelled = cancelWholeOrder(stored, {
    auditContext: { ...audit, authorization: { actorId: principal.actorId, approved: true }, eventId, idempotencyKey: command.idempotencyKey, reason: command.reason },
    lineContexts: { [sentItemId]: { eventId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "line-key" } },
    refundObligation: "pending",
  }).at(-1)!.order;
  const orderRow = {
    actorId: principal.actorId, at: "2026-10-06T22:00:01.000Z", capturedMinor: 15_500, capturedTipMinor: 0, channel: "counter",
    currency: "MXN", folio: null, fromStatus: "paid", fulfillmentChannel: null, id: orderId, kind: "order",
    occurredAt, order: encodeOrderRecord(cancelled), reason: command.reason, refundObligationStatus: "pending",
    snapshot: null, sourceChannel: null, version: 7,
  };
  const captureRow = {
    actorId: principal.actorId, at: "2026-10-06T21:00:00.000Z", capturedMinor: null, capturedTipMinor: null, channel: null,
    currency: null, folio: "C-0001", fromStatus: null, fulfillmentChannel: null, id: "99999999-9999-4999-8999-999999999999",
    kind: "capture", occurredAt, order: null, reason: "Cliente colgo", refundObligationStatus: null, snapshot: null,
    sourceChannel: "phone", version: null,
  };
  let payload: unknown = {
    items: [orderRow, captureRow], next: { at: "2026-10-06T21:00:00.123456Z", id: orderId }, schemaVersion: 1, scope,
  };
  const port: CancelledWorkTrayPort = { list: async () => payload };
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles: ["viewer"], scope }) };
  const service = new CancelledWorkTrayService(new MembershipAuthorizationService(memberships), port);
  const tray = await service.list(principal, { cursor: null, limit: 20, schemaVersion: 1, scope });
  assert.equal(tray.items.length, 2);
  const first = tray.items[0]!;
  assert.equal(first.kind === "order" && first.totalMinor, 25_000);
  assert.equal(first.kind === "order" && first.refundObligation.capturedMinor, 15_500);
  assert.equal(first.kind === "order" && first.customerLabel, null);
  assert.deepEqual(tray.nextCursor, { at: "2026-10-06T21:00:00.123456Z", id: orderId });
  for (const bad of [
    { status: "denied" }, { status: "rejected" },
    { items: [{ ...orderRow, id: "99999999-9999-4999-8999-999999999999" }], next: null, schemaVersion: 1, scope },
    { items: [{ ...orderRow, extra: 1 }], next: null, schemaVersion: 1, scope },
    { items: [], next: null, schemaVersion: 1, scope: { ...scope, branchId: orderId } },
  ]) {
    payload = bad;
    await assert.rejects(service.list(principal, { cursor: null, limit: 20, schemaVersion: 1, scope }), (e: unknown) => e instanceof OrderApplicationError);
  }
  await assert.rejects(service.list(principal, { cursor: null, limit: 0, schemaVersion: 1, scope }),
    (e: unknown) => e instanceof OrderApplicationError && e.code === "request");
  const calls: unknown[][] = [];
  const adapter = new PostgresCancelledWorkTray({ query: async (_sql, parameters) => { calls.push([...parameters]); return { rows: [{ result: { status: "denied" } }] }; } });
  assert.deepEqual(await adapter.list(principal.actorId, { cursor: null, limit: 5, schemaVersion: 1, scope }), { status: "denied" });
  assert.deepEqual(JSON.parse(calls[0]![1] as string), { after: null, limit: 5, schemaVersion: 1, scope });
});

void parseMenuCatalogStateV1;
