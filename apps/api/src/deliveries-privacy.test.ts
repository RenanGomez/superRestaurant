import assert from "node:assert/strict";
import test from "node:test";

import { Money, addOrderItem, createOrder } from "@super-restaurant/domain";
import { parseBranchScope } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DeliveryService, type DeliveryPort } from "./deliveries.js";
import type { OrderDeliveryContextPort } from "./order-delivery-context.js";
import type { FinancialService } from "./payments.js";
import { OrderService } from "./orders.js";
import { encodeOrderRecord } from "./persistence/order-persistence-codec.js";

const restaurantId = "f4b3c0aa-1111-4111-8111-aaaaaaaaaaaa";
const branchId = "f4b3c0aa-2222-4222-8222-bbbbbbbbbbbb";
const orderId = "2ee5f057-7971-468d-b197-f946911743eb";
const captureId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const customerId = "5b25f2b9-6c1e-4d3d-9c3d-1f2a3b4c5d6e";
const actorId = "a1a1a1a1-3333-4333-8333-cccccccccccc";
const otherCourier = "b2b2b2b2-4444-4444-8444-dddddddddddd";
const principal: AuthenticatedPrincipal = Object.freeze({ actorId });
const scope = parseBranchScope({ restaurantId, branchId });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const audit = { eventId: "event-1", idempotencyKey: "idem-1", actorId, deviceId: "device-1", occurredAt: "2026-10-06T12:00:00.000Z" };

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
    schemaVersion: 2, orderId, captureDraftId: captureId, captureVersion: 1, fulfillmentChannel: "delivery",
    tableId: null, deliveryInstructions: "Tocar timbre", frozenAt: "2026-10-06T12:00:00.000Z",
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

function deliveryView(courierUserId: string) {
  return {
    assignedAt: "2026-10-06T12:00:00.000Z", attemptCount: 0, courierUserId, deliveredAt: null, dispatchedAt: null,
    failedReason: null, orderId, schemaVersion: 1, scope: validScope, settledAt: null, settledPaymentId: null,
    state: "assigned", version: 1,
  };
}

function listRow(courierUserId: string) {
  return {
    capturedMinor: 4_000, courierName: null, delivery: deliveryView(courierUserId), order: encodeOrderRecord(deliveryOrder()),
    orderStatus: "open", snapshot: snapshot(),
  };
}

function deliveryService(roles: readonly string[], row: unknown): DeliveryService {
  const port = {
    list: async () => ({ deliveries: [row], schemaVersion: 1, scope: validScope }),
  } as unknown as DeliveryPort;
  const memberships = { findActiveMembership: async () => ({ roles: roles as never, scope: validScope }) };
  return new DeliveryService(
    new MembershipAuthorizationService(memberships), port, {} as OrderDeliveryContextPort, {} as FinancialService,
  );
}

test("list without customers.read hides customer, address and instructions from a courier who is not assigned", async () => {
  const list = await deliveryService(["courier"], listRow(otherCourier)).list(principal, { schemaVersion: 1, scope: validScope });
  const item = list.items[0];
  assert.equal(item?.customerLabel, null);
  assert.equal(item?.addressLabel, null);
  assert.equal(item?.deliveryInstructions, null);
});

test("list gives the assigned courier name, phone, full address and instructions, and the server balance", async () => {
  const list = await deliveryService(["courier"], listRow(actorId)).list(principal, { schemaVersion: 1, scope: validScope });
  const item = list.items[0];
  assert.equal(item?.customerLabel, "Ana Pérez · 55 1234 5678");
  assert.equal(item?.addressLabel, "Casa · Av. Obregón 123, Centro, Hermosillo");
  assert.equal(item?.deliveryInstructions, "Tocar timbre");
  assert.equal(item?.totalMinor, 13_000);
  assert.equal(item?.capturedMinor, 4_000);
  assert.equal(item?.remainingMinor, 9_000);
});

test("list for customers.read roles keeps the masked projection and rejects an impossible captured amount", async () => {
  const list = await deliveryService(["cashier"], listRow(otherCourier)).list(principal, { schemaVersion: 1, scope: validScope });
  assert.equal(list.items[0]?.customerLabel, "Ana Pérez · ****78");
  assert.equal(list.items[0]?.addressLabel, "Casa · Av. Obregón 123");
  assert.equal(list.items[0]?.deliveryInstructions, "Tocar timbre");
  await assert.rejects(
    deliveryService(["cashier"], { ...listRow(actorId), capturedMinor: 99_999 }).list(principal, { schemaVersion: 1, scope: validScope }),
  );
});

test("order detail without customers.read nulls the labels and instructions; with it they appear", async () => {
  const detailFor = async (roles: readonly string[]) => {
    const memberships = { findActiveMembership: async () => ({ roles: roles as never, scope: validScope }) };
    const orders = { read: async () => ({ order: deliveryOrder(), version: 1 }) };
    const context: OrderDeliveryContextPort = {
      read: async () => ({ delivery: null, snapshot: snapshot() as never }),
    };
    const service = new OrderService(
      new MembershipAuthorizationService(memberships), orders as never, {} as never, {} as never, context,
    );
    return service.detail(principal, { orderId, schemaVersion: 1, scope: validScope });
  };
  const kitchen = await detailFor(["kitchen"]);
  assert.equal(kitchen.fulfillment.customerLabel, null);
  assert.equal(kitchen.fulfillment.addressLabel, null);
  assert.equal(kitchen.fulfillment.deliveryInstructions ?? null, null);
  assert.deepEqual(kitchen.fulfillment.paymentIntent, { method: "cash", tenderedAmountMinor: 20_000, tipMinor: 1_000 });
  const cashier = await detailFor(["cashier"]);
  assert.equal(cashier.fulfillment.customerLabel, "Ana Pérez · ****78");
  assert.equal(cashier.fulfillment.addressLabel, "Casa · Av. Obregón 123");
  await assert.rejects(detailFor(["courier"]));
});
