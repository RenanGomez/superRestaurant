import assert from "node:assert/strict";
import test from "node:test";

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
  }, audit("2"));
}

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
