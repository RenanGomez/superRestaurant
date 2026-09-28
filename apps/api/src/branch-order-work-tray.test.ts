import assert from "node:assert/strict";
import test from "node:test";

import { Money, addOrderItem, createOrder } from "@super-restaurant/domain";
import { parseBranchScope } from "@super-restaurant/shared-types";

import { encodeOrderRecord } from "./persistence/order-persistence-codec.js";
import {
  BranchOrderWorkTrayError,
  BranchOrderWorkTrayService,
  PostgresBranchOrderWorkTray,
  type BranchOrderWorkTrayPort,
} from "./branch-order-work-tray.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const scope = parseBranchScope({ restaurantId, branchId });
if (scope === undefined) throw new Error("Invalid test scope.");
const actorId = "aa9a25b7-3c6a-4c0e-8f2e-9e4c5a6b7c8d";
const orderId = "2ee5f057-7971-468d-b197-f946911743eb";
const capturedId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const customerId = "5b25f2b9-6c1e-4d3d-9c3d-1f2a3b4c5d6e";

const audit = { eventId: "event-1", idempotencyKey: "idem-1", actorId, deviceId: "device-1", occurredAt: "2026-09-26T12:00:00.000Z" };

function deliveryOrder() {
  const created = createOrder({
    orderId, restaurantId, branchId, channel: "delivery", currency: "MXN", timeZone: "America/Hermosillo",
    deliveryCharge: { amount: new Money(3000, "MXN"), quoteId: "quote-1" },
  }, audit);
  const withItem = addOrderItem(created.order, {
    orderItemId: "item-1", quantity: 2, note: "sin cebolla",
    snapshot: {
      catalogVersion: "catalog-v1", productId: "product-1", name: "Tacos", stationId: "station-1", unit: "piece",
      unitPrice: new Money(5_000, "MXN"), modifiers: [],
    },
  }, audit);
  return withItem.order;
}

function deliveryOrderWithTip() {
  const created = createOrder({
    orderId, restaurantId, branchId, channel: "delivery", currency: "MXN", timeZone: "America/Hermosillo",
    deliveryCharge: { amount: new Money(3000, "MXN"), quoteId: "quote-1" }, tip: new Money(1_500, "MXN"),
  }, audit);
  const withItem = addOrderItem(created.order, {
    orderItemId: "item-1", quantity: 2,
    snapshot: {
      catalogVersion: "catalog-v1", productId: "product-1", name: "Tacos", stationId: "station-1", unit: "piece",
      unitPrice: new Money(5_000, "MXN"), modifiers: [],
    },
  }, audit);
  return withItem.order;
}

function tableOrder() {
  const created = createOrder({
    orderId, restaurantId, branchId, channel: "table", tableId: "table-1", currency: "MXN", timeZone: "America/Hermosillo",
  }, audit);
  return created.order;
}

function counterOrder() {
  const created = createOrder({
    orderId, restaurantId, branchId, channel: "counter", currency: "MXN", timeZone: "America/Hermosillo",
  }, audit);
  return created.order;
}

function deliverySnapshot() {
  return {
    schemaVersion: 2, orderId, captureDraftId: capturedId, captureVersion: 1, fulfillmentChannel: "delivery",
    tableId: null, deliveryInstructions: "Tocar timbre", frozenAt: "2026-09-26T12:00:00.000Z",
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
      unit: null, validatedAt: "2026-09-26T11:00:00.000Z",
    },
    deliveryQuote: null,
    paymentIntent: { method: "cash", schemaVersion: 1, tenderedAmountMinor: 20_000, tipMinor: 1_000 },
  };
}

function port(result: unknown): BranchOrderWorkTrayPort {
  return { list: async () => result };
}

function service(result: unknown, roles: readonly string[] = ["owner"]): BranchOrderWorkTrayService {
  const authorization = { authorizeBranch: async () => ({ principal: { actorId }, roles }) } as never;
  return new BranchOrderWorkTrayService(authorization, port(result));
}

test("branch order work tray adapter binds actor and forwards the cursor as 'after'", async () => {
  const calls: unknown[][] = [];
  const adapter = new PostgresBranchOrderWorkTray({ query: async (_sql, parameters) => {
    calls.push([...parameters]);
    return { rows: [{ result: { schemaVersion: 1, scope, orders: [], next: null } }] };
  } });
  await adapter.list(actorId, { channel: "delivery", cursor: { orderId, updatedAt: "2026-09-26T12:00:00.000000Z" }, limit: 10, schemaVersion: 1, scope });
  assert.equal(calls[0]?.[0], actorId);
  assert.deepEqual(JSON.parse(calls[0]?.[1] as string), {
    after: { orderId, updatedAt: "2026-09-26T12:00:00.000000Z" }, channel: "delivery", limit: 10, schemaVersion: 1, scope,
  });
});

test("service projects a delivery order's totals, masked customer, address and payment intent", async () => {
  const envelope = {
    schemaVersion: 1, scope, next: null,
    orders: [{
      orderId, channel: "delivery", status: "draft", version: 1, createdAt: "2026-09-26T11:55:00.000Z",
      updatedAt: "2026-09-26T12:05:00.000Z",
      confirmedAt: "2026-09-26T12:00:00.000Z", order: encodeOrderRecord(deliveryOrder()), snapshot: deliverySnapshot(),
    }],
  };
  const result = await service(envelope).list({ actorId } as never, { channel: null, cursor: null, limit: 25, schemaVersion: 1, scope });
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item?.orderId, orderId);
  assert.equal(item?.channel, "delivery");
  assert.equal(item?.timeZone, "America/Hermosillo");
  assert.equal(item?.fulfillmentChannel, "delivery");
  assert.equal(item?.createdAt, "2026-09-26T12:00:00.000Z");
  assert.equal(item?.customerLabel, "Ana Pérez · ****78");
  assert.equal(item?.addressLabel, "Casa · Av. Obregón 123");
  assert.equal(item?.hasNotes, true);
  assert.equal(item?.lineCount, 1);
  assert.deepEqual(item?.paymentIntent, { method: "cash", tenderedAmountMinor: 20_000, tipMinor: 1_000 });
  assert.deepEqual(item?.totals, { currency: "MXN", deliveryChargeMinor: 3_000, itemsTotalMinor: 10_000, tipMinor: 0, totalMinor: 13_000 });
});

test("service nulls customer/address labels for a role with orders.read but no customers.read", async () => {
  const envelope = {
    schemaVersion: 1, scope, next: null,
    orders: [{
      orderId, channel: "delivery", status: "draft", version: 1, createdAt: "2026-09-26T11:55:00.000Z",
      updatedAt: "2026-09-26T12:05:00.000Z",
      confirmedAt: "2026-09-26T12:00:00.000Z", order: encodeOrderRecord(deliveryOrder()), snapshot: deliverySnapshot(),
    }],
  };
  const result = await service(envelope, ["kitchen"]).list({ actorId } as never, { channel: null, cursor: null, limit: 25, schemaVersion: 1, scope });
  const item = result.items[0];
  assert.equal(item?.customerLabel, null);
  assert.equal(item?.addressLabel, null);
  // Everything else -- totals, payment intent, preparation -- is still authorized under orders.read.
  assert.deepEqual(item?.paymentIntent, { method: "cash", tenderedAmountMinor: 20_000, tipMinor: 1_000 });
  assert.deepEqual(item?.totals, { currency: "MXN", deliveryChargeMinor: 3_000, itemsTotalMinor: 10_000, tipMinor: 0, totalMinor: 13_000 });
});

test("service reports itemsTotalMinor without the tip, and totalMinor as items + delivery + tip", async () => {
  const envelope = {
    schemaVersion: 1, scope, next: null,
    orders: [{
      orderId, channel: "delivery", status: "draft", version: 1, createdAt: "2026-09-26T11:55:00.000Z",
      updatedAt: "2026-09-26T12:05:00.000Z",
      confirmedAt: null, order: encodeOrderRecord(deliveryOrderWithTip()), snapshot: null,
    }],
  };
  const result = await service(envelope).list({ actorId } as never, { channel: null, cursor: null, limit: 25, schemaVersion: 1, scope });
  const item = result.items[0];
  // 2 x 5_000 items + 3_000 delivery + 1_500 tip = 14_500; itemsTotalMinor must stay 10_000, not 11_500.
  assert.deepEqual(item?.totals, { currency: "MXN", deliveryChargeMinor: 3_000, itemsTotalMinor: 10_000, tipMinor: 1_500, totalMinor: 14_500 });
});

test("service projects a table order without a fulfillment snapshot as dine_in with no PII", async () => {
  const envelope = {
    schemaVersion: 1, scope, next: null,
    orders: [{
      orderId, channel: "table", status: "draft", version: 1, createdAt: "2026-09-26T11:50:00.000Z",
      updatedAt: "2026-09-26T12:05:00.000Z",
      confirmedAt: null, order: encodeOrderRecord(tableOrder()), snapshot: null,
    }],
  };
  const result = await service(envelope).list({ actorId } as never, { channel: null, cursor: null, limit: 25, schemaVersion: 1, scope });
  const item = result.items[0];
  assert.equal(item?.fulfillmentChannel, "dine_in");
  assert.equal(item?.customerLabel, null);
  assert.equal(item?.addressLabel, null);
  assert.equal(item?.paymentIntent, null);
  assert.equal(item?.createdAt, "2026-09-26T11:50:00.000Z");
  assert.deepEqual(item?.totals, { currency: "MXN", deliveryChargeMinor: 0, itemsTotalMinor: 0, tipMinor: 0, totalMinor: 0 });
});

test("service projects a counter order with no fulfillment snapshot at all (not table, not delivery)", async () => {
  const envelope = {
    schemaVersion: 1, scope, next: null,
    orders: [{
      orderId, channel: "counter", status: "draft", version: 1, createdAt: "2026-09-26T11:50:00.000Z",
      updatedAt: "2026-09-26T12:05:00.000Z",
      confirmedAt: null, order: encodeOrderRecord(counterOrder()), snapshot: null,
    }],
  };
  const result = await service(envelope).list({ actorId } as never, { channel: null, cursor: null, limit: 25, schemaVersion: 1, scope });
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item?.channel, "counter");
  assert.equal(item?.fulfillmentChannel, null);
  assert.equal(item?.customerLabel, null);
  assert.equal(item?.addressLabel, null);
  assert.equal(item?.paymentIntent, null);
  assert.equal(item?.createdAt, "2026-09-26T11:50:00.000Z");
});

test("service fails closed on a denied/rejected outcome, cross-scope envelopes and a scope-mismatched order", async () => {
  await assert.rejects(service({ status: "denied" }).list({ actorId } as never, { channel: null, cursor: null, limit: 5, schemaVersion: 1, scope }),
    (error: unknown) => error instanceof BranchOrderWorkTrayError && error.code === "authorization");
  await assert.rejects(service({ status: "rejected" }).list({ actorId } as never, { channel: null, cursor: null, limit: 5, schemaVersion: 1, scope }),
    (error: unknown) => error instanceof BranchOrderWorkTrayError && error.code === "request");
  await assert.rejects(service(undefined).list({ actorId } as never, "not-an-object"),
    (error: unknown) => error instanceof BranchOrderWorkTrayError && error.code === "request");
  const foreignScope = { restaurantId, branchId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4" };
  await assert.rejects(service({ schemaVersion: 1, scope: foreignScope, orders: [], next: null })
    .list({ actorId } as never, { channel: null, cursor: null, limit: 5, schemaVersion: 1, scope }));
  const mismatched = {
    schemaVersion: 1, scope, next: null,
    orders: [{
      orderId, channel: "delivery", status: "draft", version: 1, createdAt: "2026-09-26T11:55:00.000Z",
      updatedAt: "2026-09-26T12:05:00.000Z",
      confirmedAt: null, order: encodeOrderRecord(deliveryOrder()), snapshot: { ...deliverySnapshot(), orderId: capturedId },
    }],
  };
  await assert.rejects(service(mismatched).list({ actorId } as never, { channel: null, cursor: null, limit: 5, schemaVersion: 1, scope }));
});

test("service fails closed when Branch authorization is denied", async () => {
  const authorization = { authorizeBranch: async () => { throw new Error("denied"); } } as never;
  const tray = new BranchOrderWorkTrayService(authorization, port({ schemaVersion: 1, scope, orders: [], next: null }));
  await assert.rejects(tray.list({ actorId } as never, { channel: null, cursor: null, limit: 5, schemaVersion: 1, scope }),
    (error: unknown) => error instanceof BranchOrderWorkTrayError && error.code === "authorization");
});
