import assert from "node:assert/strict";
import test from "node:test";

import { Test } from "@nestjs/testing";
import { Money, addOrderItem, createOrder } from "@super-restaurant/domain";
import { parseBranchScope } from "@super-restaurant/shared-types";

import { AppModule } from "./app.module.js";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { AUTH_PRINCIPAL_VERIFIER } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT } from "./database.js";
import { DeliveryApplicationError, DeliveryService } from "./deliveries.js";
import type { OrderDeliveryContextPort } from "./order-delivery-context.js";
import { PostgresOrderDeliveryContextAdapter } from "./order-delivery-context.js";
import { OrderService, PostgresOrderPersistenceAdapter, type OrderPersistencePort } from "./orders.js";
import { encodeOrderRecord } from "./persistence/order-persistence-codec.js";

const restaurantId = "f4b3c0aa-1111-4111-8111-aaaaaaaaaaaa";
const branchId = "f4b3c0aa-2222-4222-8222-bbbbbbbbbbbb";
const orderId = "2ee5f057-7971-468d-b197-f946911743eb";
const customerId = "5b25f2b9-6c1e-4d3d-9c3d-1f2a3b4c5d6e";
const actorId = "a1a1a1a1-3333-4333-8333-cccccccccccc";
const otherCourier = "b2b2b2b2-4444-4444-8444-dddddddddddd";
const principal: AuthenticatedPrincipal = Object.freeze({ actorId });
const scope = parseBranchScope({ restaurantId, branchId });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const audit = { eventId: "event-1", idempotencyKey: "idem-1", actorId, deviceId: "device-1", occurredAt: "2026-10-06T12:00:00.000Z" };
const request = { orderId, schemaVersion: 1 as const, scope: validScope };

function deliveryOrder() {
  const created = createOrder({
    orderId, restaurantId, branchId, channel: "delivery", currency: "MXN", timeZone: "America/Hermosillo",
    deliveryCharge: { amount: new Money(3000, "MXN"), quoteId: "quote-1" },
  }, audit);
  return addOrderItem(created.order, {
    orderItemId: "c3c3c3c3-5555-4555-8555-eeeeeeeeeeee", quantity: 2, note: "sin cebolla",
    snapshot: {
      catalogVersion: "catalog-v1", productId: "product-1", name: "Tacos", stationId: "station-1", unit: "piece",
      unitPrice: new Money(5_000, "MXN"), modifiers: [],
    },
  }, audit).order;
}

function snapshot() {
  return {
    schemaVersion: 2, orderId, captureDraftId: "72371a5f-2056-448d-9ddb-14ab6664a4e8", captureVersion: 1,
    fulfillmentChannel: "delivery", tableId: null, deliveryInstructions: "Tocar timbre", frozenAt: "2026-10-06T12:00:00.000Z",
    partySnapshot: {
      contactId: "11111111-1111-4111-8111-111111111111", customerId, displayName: "Ana Pérez",
      phoneDisplayValue: "55 1234 5678", phoneNormalizedValue: "+525512345678", schemaVersion: 1,
      snapshotRef: "22222222-2222-4222-8222-222222222222",
    },
    fulfillmentSnapshot: {
      addressId: "8f2a4b6c-1234-4a11-8a11-1a2b3c4d5e6f", countryCode: "MX", customerId,
      customerSnapshotRef: "22222222-2222-4222-8222-222222222222",
      legacyAddressInstructions: null, label: "Casa", latitudeE6: null, locality: "Hermosillo",
      longitudeE6: null, neighborhood: "Centro", postalCode: null, referencesText: null, region: null,
      schemaVersion: 1, snapshotRef: "33333333-3333-4333-8333-333333333333", streetLine: "Av. Obregón 123",
      unit: null, validatedAt: "2026-10-06T11:00:00.000Z",
    },
    deliveryQuote: null,
    paymentIntent: { method: "cash", schemaVersion: 1, tenderedAmountMinor: 20_000, tipMinor: 1_000 },
  };
}

function deliveryView(courierUserId: string, state = "assigned") {
  return {
    assignedAt: "2026-10-06T12:00:00.000Z", attemptCount: 0, courierUserId, deliveredAt: null, dispatchedAt: null,
    failedReason: null, orderId, schemaVersion: 1, scope: validScope, settledAt: null, settledPaymentId: null,
    state, version: 1,
  };
}

const receiptData = {
  createdAt: "2026-10-06T12:00:00.000Z",
  payments: [{
    amountMinor: 13_000, capturedAt: "2026-10-06T12:30:00.000Z", changeMinor: 7_000, method: "cash",
    paymentId: "5d1c2c3e-4f50-4a61-8b72-93a4b5c6d7e8", tenderedAmountMinor: 20_000, tipMinor: 0, transferReference: null,
  }],
  schemaVersion: 1,
  shortFolio: "11111111",
};

interface Harness {
  readonly service: DeliveryService;
  readonly calls: string[];
}

/** `owner` is the courier the SQL reader treats as owner of the delivery; `view` is the frozen delivery context. */
function harness(roles: readonly string[], owner: string | null, view: unknown = deliveryView(actorId)): Harness {
  const calls: string[] = [];
  const memberships = { findActiveMembership: async () => ({ roles: roles as never, scope: validScope }) };
  const authorization = new MembershipAuthorizationService(memberships);
  const orders: OrderPersistencePort = {
    read: async () => { calls.push("read"); return { order: deliveryOrder(), version: 4 }; },
    readAssignedToCourier: async (id: string) => {
      calls.push("readAssignedToCourier");
      return owner === id ? { order: deliveryOrder(), version: 4 } : "missing";
    },
    // The SQL receipt reader applies the same ownership: only the assigned courier gets the ticket facts.
    readReceiptData: async (id: string) => {
      calls.push("readReceiptData");
      return owner === id ? receiptData : "missing";
    },
  } as unknown as OrderPersistencePort;
  const context: OrderDeliveryContextPort = { read: async () => ({ delivery: view as never, snapshot: snapshot() as never }) };
  const orderService = new OrderService(authorization, orders, {} as never, {} as never, context);
  return { calls, service: new DeliveryService(authorization, {} as never, context, {} as never, orderService) };
}

async function code(promise: Promise<unknown>, expected: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof DeliveryApplicationError && error.code === expected);
}

test("courier with the assigned delivery reads lines, total, intent, address and instructions, with no actions", async () => {
  const { service, calls } = harness(["courier"], actorId);
  const detail = await service.orderDetail(principal, request);
  assert.deepEqual(calls, ["readAssignedToCourier", "readReceiptData"], "the courier never goes through the orders.read reader");
  assert.equal(detail.createdAt, "2026-10-06T12:00:00.000Z");
  assert.equal(detail.shortFolio, "11111111");
  assert.deepEqual(detail.payments.map((payment) => [payment.method, payment.amountMinor, payment.changeMinor]), [["cash", 13_000, 7_000]]);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0]?.name, "Tacos");
  assert.equal(detail.items[0]?.quantity, 2);
  assert.equal(detail.items[0]?.note, "sin cebolla");
  assert.equal(detail.totals.totalMinor, 13_000);
  assert.deepEqual(detail.availableActions, []);
  assert.deepEqual(detail.items[0]?.availableActions, []);
  assert.deepEqual(detail.fulfillment.paymentIntent, { method: "cash", tenderedAmountMinor: 20_000, tipMinor: 1_000 });
  assert.equal(detail.fulfillment.customerLabel, "Ana Pérez · 55 1234 5678");
  assert.equal(detail.fulfillment.addressLabel, "Casa · Av. Obregón 123, Centro, Hermosillo");
  assert.equal(detail.fulfillment.deliveryInstructions, "Tocar timbre");
});

test("courier without that delivery gets authorization (403), never not_found, whatever the reason", async () => {
  // SQL says someone else's / unassigned / missing Order: the same "missing" -> authorization.
  await code(harness(["courier"], otherCourier).service.orderDetail(principal, request), "authorization");
  await code(harness(["courier"], null).service.orderDetail(principal, request), "authorization");
  // Defense in depth: even if the SQL reader allowed it, a frozen delivery of another courier is refused.
  await code(harness(["courier"], actorId, deliveryView(otherCourier)).service.orderDetail(principal, request), "authorization");
  // No delivery row at all (virtual pending delivery has no courier).
  await code(harness(["courier"], actorId, { ...deliveryView(actorId), courierUserId: null, state: "pending" }).service.orderDetail(principal, request), "authorization");
  await code(harness(["courier"], actorId, null).service.orderDetail(principal, request), "authorization");
  // A role without deliveries.read or orders.read is refused before anything is read.
  await code(harness(["viewer"], actorId).service.orderDetail(principal, request), "authorization");
  await code(harness([], actorId).service.orderDetail(principal, request), "authorization");
});

test("a settled delivery stays readable by its own courier (documented decision: history of the day)", async () => {
  const settled = { ...deliveryView(actorId, "settled"), settledAt: "2026-10-06T13:00:00.000Z", settledPaymentId: "9a9a9a9a-6666-4666-8666-ffffffffffff" };
  const detail = await harness(["courier"], actorId, settled).service.orderDetail(principal, request);
  assert.equal(detail.totals.totalMinor, 13_000);
  assert.equal(detail.delivery?.state, "settled");
});

test("a manager delegates to the normal detail (orders.read path), unchanged", async () => {
  const { service, calls } = harness(["manager"], null);
  const detail = await service.orderDetail(principal, request);
  assert.deepEqual(calls, ["read", "readReceiptData"]);
  assert.ok(detail.availableActions.length > 0);
  assert.equal(detail.fulfillment.customerLabel, "Ana Pérez · ****78");
  assert.equal(detail.fulfillment.deliveryInstructions ?? null, null);
});

test("a hostile body is a request error", async () => {
  await code(harness(["courier"], actorId).service.orderDetail(principal, { ...request, orderId: "not-a-uuid" }), "request");
});

test("the Postgres reader parses a real { result } row and treats anything else as missing/unavailable", async () => {
  const sqls: string[] = [];
  const row = { order: encodeOrderRecord(deliveryOrder()), schemaVersion: 1, scope: validScope, updatedAt: "2026-10-06T12:00:00.000Z", version: 4 };
  const adapter = new PostgresOrderPersistenceAdapter({
    query: async (sql: string) => { sqls.push(sql); return { rows: [{ result: row }] }; },
  } as never);
  const stored = await adapter.readAssignedToCourier(actorId, validScope, orderId);
  assert.notEqual(stored, "missing");
  assert.match(sqls[0] ?? "", /app_private\.read_courier_delivery_order/u);
  const none = new PostgresOrderPersistenceAdapter({ query: async () => ({ rows: [{ result: null }] }) } as never);
  assert.equal(await none.readAssignedToCourier(actorId, validScope, orderId), "missing");
  const bare = new PostgresOrderPersistenceAdapter({ query: async () => ({ rows: [row] }) } as never);
  await assert.rejects(bare.readAssignedToCourier(actorId, validScope, orderId));
  void PostgresOrderDeliveryContextAdapter;
});

test("POST /deliveries/order-detail: HTTP contract (401, 400, 201 no-store, 403, 503 sanitized)", async () => {
  let roles: readonly string[] = ["courier"];
  let owner: string | null = actorId;
  let broken = false;
  const memberships = { findActiveMembership: async () => ({ roles: roles as never, scope: validScope }) };
  const orders = {
    read: async () => ({ order: deliveryOrder(), version: 4 }),
    readAssignedToCourier: async (id: string) => {
      if (broken) throw new Error("secret connection string");
      return owner === id ? { order: deliveryOrder(), version: 4 } : "missing";
    },
    readReceiptData: async () => receiptData,
  };
  const context = { read: async () => ({ delivery: deliveryView(actorId), snapshot: snapshot() }) };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CLIENT).useValue({ query: async () => { throw new Error("unexpected database call"); } })
    .overrideProvider(MembershipAuthorizationService).useValue(new MembershipAuthorizationService(memberships))
    .overrideProvider(PostgresOrderPersistenceAdapter).useValue(orders)
    .overrideProvider(PostgresOrderDeliveryContextAdapter).useValue(context)
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER).useValue({ verifyAccessToken: async () => principal })
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/deliveries/order-detail`;
  const send = (body: unknown, authenticated = true) => fetch(url, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer courier-detail-fixture-token" } : {}) },
  });
  try {
    assert.equal((await send(request, false)).status, 401);
    assert.equal((await send({})).status, 400);
    const ok = await send(request);
    assert.equal(ok.status, 201, await ok.clone().text()); // same default as /orders/detail and /deliveries/list
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    const json = await ok.json() as { availableActions: unknown[]; totals: { totalMinor: number } };
    assert.equal(json.totals.totalMinor, 13_000);
    assert.deepEqual(json.availableActions, []);
    owner = otherCourier;
    const denied = await send(request);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { code: "ACTION_NOT_AUTHORIZED" });
    owner = actorId;
    broken = true;
    const down = await send(request);
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { code: "DELIVERY_UNAVAILABLE" });
    roles = ["kitchen"];
    assert.equal((await send(request)).status, 403);
  } finally {
    await app.close();
  }
});
