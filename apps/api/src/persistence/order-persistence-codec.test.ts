import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope } from "@super-restaurant/shared-types";
import { CapturePersistenceCodecError, decodeCaptureRecord, encodeCaptureRecord } from "./capture-persistence-codec.js";

test("capture persistence codec detaches storage records and rejects cross-scope and hostile envelopes", () => {
  const scope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
  assert.ok(scope);
  const detail = {
    schemaVersion: 1, scope, captureDraftId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", folio: "CAP-42",
    sourceChannel: "phone", fulfillmentChannel: null, status: "draft", attentionStatus: "held",
    ownerMembershipId: null, version: 1, updatedAt: "2026-09-16T12:00:00.000Z",
    attentionLeaseId: null, attentionLeaseExpiresAt: null, confirmedOrderId: null,
    customerSnapshotRef: null, fulfillmentSnapshotRef: null,
  };
  const input = { schemaVersion: 1, detail, recoveryPolicy: { schemaVersion: 1, autoRenewSelected: false, recoveryExpiresAt: "2026-10-16T12:00:00.000Z" } };
  const decoded = decodeCaptureRecord(input, scope);
  assert.ok(Object.isFrozen(decoded));
  assert.ok(Object.isFrozen(decoded.detail.scope));
  assert.ok(Object.isFrozen(decoded.recoveryPolicy));
  detail.folio = "changed";
  assert.equal(decoded.detail.folio, "CAP-42");
  assert.deepEqual(encodeCaptureRecord(decoded, scope), decoded);
  const foreign = parseBranchScope({ ...scope, branchId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4" });
  assert.ok(foreign);
  assert.throws(() => decodeCaptureRecord(input, foreign), CapturePersistenceCodecError);
  const foreignRestaurant = parseBranchScope({ ...scope, restaurantId: foreign.branchId });
  assert.ok(foreignRestaurant);
  assert.throws(() => decodeCaptureRecord(input, foreignRestaurant), CapturePersistenceCodecError);
  for (const invalid of [{ ...input, schemaVersion: 2 }, { ...input, extra: true }, { ...input, recoveryPolicy: null }, new Proxy(input, {})]) {
    assert.throws(() => decodeCaptureRecord(invalid, scope), CapturePersistenceCodecError);
  }
  const hostile = { ...input };
  Object.defineProperty(hostile, "detail", { enumerable: true, get: () => { throw new Error("do not execute"); } });
  assert.throws(() => decodeCaptureRecord(hostile, scope), CapturePersistenceCodecError);
});

import {
  Money,
  addOrderItem,
  createOrder,
  transitionOrderStatus,
  type OrderMutation,
} from "@super-restaurant/domain";

import {
  OrderPersistenceCodecError,
  decodeOrderMutationRecord,
  decodeOrderRecord,
  encodeOrderMutationRecord,
  encodeOrderRecord,
} from "./order-persistence-codec.js";

const audit = (suffix: string, sensitive = false) => ({
  eventId: `event-${suffix}`,
  idempotencyKey: `idempotency-${suffix}`,
  actorId: "actor-1",
  deviceId: "device-1",
  occurredAt: `2026-08-30T12:00:0${suffix}.000Z`,
  ...(sensitive
    ? { reason: "customer request", authorization: { approved: true as const, actorId: "supervisor-1" } }
    : {}),
});

function richOrderMutation(): OrderMutation {
  const created = createOrder({
    orderId: "order-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "table",
    tableId: "table-1",
    currency: "MXN",
    timeZone: "America/Hermosillo",
    tip: new Money(250, "MXN"),
  }, audit("1"));

  return addOrderItem(created.order, {
    orderItemId: "item-1",
    quantity: 2,
    snapshot: {
      catalogVersion: "catalog-v3",
      productId: "product-1",
      name: "Tacos",
      sku: "TACO-1",
      stationId: "station-1",
      unit: "piece",
      unitPrice: new Money(3_500, "MXN"),
      modifiers: [{
        modifierId: "modifier-1",
        name: "Extra queso",
        groupId: "group-1",
        groupName: "Extras",
        groupCatalogVersion: "group-v2",
        unitPrice: new Money(500, "MXN"),
        quantity: 1,
      }],
      tax: {
        taxId: "tax-iva",
        name: "IVA",
        taxRuleVersion: "iva-v1",
        rate: { numerator: 16n, denominator: 100n },
        inclusion: "excluded",
      },
    },
    lineDiscount: {
      discountId: "discount-1",
      discountRuleVersion: "discount-v1",
      amount: new Money(100, "MXN"),
    },
    note: "Sin cebolla",
  }, audit("2"));
}

test("round-trips a null and a text order item note", () => {
  const created = createOrder({
    orderId: "order-2",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter",
    currency: "MXN",
    timeZone: "America/Hermosillo",
  }, audit("5"));
  const withNullNote = addOrderItem(created.order, {
    orderItemId: "item-2",
    quantity: 1,
    snapshot: {
      catalogVersion: "catalog-v3",
      productId: "product-2",
      name: "Agua",
      stationId: "bar",
      unit: "piece",
      unitPrice: new Money(2_000, "MXN"),
      modifiers: [],
    },
    note: null,
  }, audit("6"));
  assert.deepEqual(
    decodeOrderMutationRecord(JSON.parse(JSON.stringify(encodeOrderMutationRecord(withNullNote))) as unknown),
    withNullNote,
  );
});

test("round-trips an order mutation through a JSON-safe versioned representation", () => {
  const mutation = richOrderMutation();
  const persisted = encodeOrderMutationRecord(mutation);
  const transported = JSON.parse(JSON.stringify(persisted)) as unknown;
  const decoded = decodeOrderMutationRecord(transported);

  assert.deepEqual(decoded, mutation);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.order.items[0]?.snapshot.tax?.rate), true);
  assert.deepEqual(persisted.order.items[0]?.snapshot.tax?.rate, {
    numerator: "16",
    denominator: "100",
  });
});

test("H13: round-trips a frozen delivery charge, and a record persisted before H13 decodes it as null", () => {
  const created = createOrder({
    orderId: "order-delivery-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "delivery",
    currency: "MXN",
    timeZone: "America/Hermosillo",
    deliveryCharge: { amount: new Money(3_000, "MXN"), quoteId: "quote-1" },
  }, audit("1"));

  const persisted = encodeOrderRecord(created.order);
  assert.deepEqual(persisted.deliveryCharge, { amount: { amountMinor: 3_000, currency: "MXN" }, quoteId: "quote-1" });
  const decoded = decodeOrderRecord(JSON.parse(JSON.stringify(persisted)) as unknown);
  assert.deepEqual(decoded.deliveryCharge, created.order.deliveryCharge);

  // A pre-H13 persisted order never had the key at all; decode must treat that as null, exactly
  // like an explicit null, rather than rejecting historical records.
  const withoutKey: Record<string, unknown> = { ...persisted };
  delete withoutKey["deliveryCharge"];
  const legacyDecoded = decodeOrderRecord(JSON.parse(JSON.stringify(withoutKey)) as unknown);
  assert.equal(legacyDecoded.deliveryCharge, null);
});

test("H23: encodeOrderRecord omits deliveryCharge when null, so persist_order_mutation's byte-equality across mutations holds", () => {
  const created = createOrder({
    orderId: "order-no-charge-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter",
    currency: "MXN",
    timeZone: "America/Hermosillo",
  }, audit("1"));
  assert.equal(created.order.deliveryCharge, null);

  const persisted = encodeOrderRecord(created.order);
  assert.equal(Object.hasOwn(persisted, "deliveryCharge"), false);

  // A legacy record from before H13 never had the key either: decode -> encode must reproduce
  // the EXACT same JSON, not silently re-add `deliveryCharge: null` -- that mismatch is exactly
  // what broke persist_order_mutation's "aggregate outside items/status is byte-identical" check
  // for a subsequent order.item_added/order.state_changed mutation on any such order.
  const legacyJson = JSON.stringify(persisted);
  const roundTripped = encodeOrderRecord(decodeOrderRecord(JSON.parse(legacyJson) as unknown));
  assert.equal(JSON.stringify(roundTripped), legacyJson);

  // A charge, once set, keeps the key present through the same round trip -- immutable, never
  // silently dropped either.
  const withCharge = createOrder({
    orderId: "order-with-charge-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "delivery",
    currency: "MXN",
    timeZone: "America/Hermosillo",
    deliveryCharge: { amount: new Money(3_000, "MXN"), quoteId: "quote-1" },
  }, audit("1"));
  const chargedJson = JSON.stringify(encodeOrderRecord(withCharge.order));
  const chargedRoundTripped = encodeOrderRecord(decodeOrderRecord(JSON.parse(chargedJson) as unknown));
  assert.equal(JSON.stringify(chargedRoundTripped), chargedJson);
  assert.ok(chargedJson.includes("deliveryCharge"));
});

test("H13: decoding rejects a negative or malformed delivery charge", () => {
  const created = createOrder({
    orderId: "order-delivery-2",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "delivery",
    currency: "MXN",
    timeZone: "America/Hermosillo",
    deliveryCharge: { amount: new Money(3_000, "MXN"), quoteId: "quote-1" },
  }, audit("1"));
  const persisted = encodeOrderRecord(created.order);
  const negative = { ...persisted, deliveryCharge: { amount: { amountMinor: -1, currency: "MXN" }, quoteId: "quote-1" } };
  assert.throws(() => decodeOrderRecord(negative), OrderPersistenceCodecError);
  const missingQuoteId = { ...persisted, deliveryCharge: { amount: { amountMinor: 3_000, currency: "MXN" } } };
  assert.throws(() => decodeOrderRecord(missingQuoteId), OrderPersistenceCodecError);
});

test("round-trips cancellation evidence and verifies its event linkage", () => {
  const added = richOrderMutation();
  const opened = transitionOrderStatus(added.order, "open", audit("3"));
  const cancelled = transitionOrderStatus(opened.order, "cancelled", audit("4", true));

  assert.deepEqual(
    decodeOrderMutationRecord(JSON.parse(JSON.stringify(encodeOrderMutationRecord(cancelled))) as unknown),
    cancelled,
  );
});

test("fails closed for extra fields, accessors, proxies and unsafe money", () => {
  const persisted = encodeOrderRecord(richOrderMutation().order);

  assert.throws(() => decodeOrderRecord({ ...persisted, extra: true }), OrderPersistenceCodecError);
  assert.throws(() => decodeOrderRecord(new Proxy(persisted, {})), OrderPersistenceCodecError);

  const accessor = { ...persisted } as Record<string, unknown>;
  Object.defineProperty(accessor, "orderId", { enumerable: true, get: () => "order-1" });
  assert.throws(() => decodeOrderRecord(accessor), OrderPersistenceCodecError);

  const unsafe = JSON.parse(JSON.stringify(persisted)) as {
    tip: { amountMinor: number };
  };
  unsafe.tip.amountMinor = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => decodeOrderRecord(unsafe), OrderPersistenceCodecError);
});

test("rejects non-canonical ratios and divergent mutation scope", () => {
  const mutation = richOrderMutation();
  const persisted = JSON.parse(JSON.stringify(encodeOrderMutationRecord(mutation))) as {
    order: { items: Array<{ snapshot: { tax: { rate: { numerator: string } } } }> };
    auditEvent: { branchId: string };
  };

  persisted.order.items[0]!.snapshot.tax.rate.numerator = "016";
  assert.throws(() => decodeOrderMutationRecord(persisted), OrderPersistenceCodecError);

  const divergent = JSON.parse(JSON.stringify(encodeOrderMutationRecord(mutation))) as {
    auditEvent: { branchId: string };
  };
  divergent.auditEvent.branchId = "branch-2";
  assert.throws(() => decodeOrderMutationRecord(divergent), OrderPersistenceCodecError);
});
import "./customer-persistence-codec.test.js";
