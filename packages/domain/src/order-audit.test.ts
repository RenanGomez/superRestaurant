import assert from "node:assert/strict";
import test from "node:test";

import {
  addOrderItem,
  cancelOrderItem,
  createOrder,
  DomainError,
  InvalidOrderAuditContextError,
  InvalidOrderItemTransitionError,
  Money,
  ORDER_AUDIT_SCHEMA_VERSION,
  OrderAuditAuthorizationRequiredError,
  OrderAuditReasonRequiredError,
  transitionOrderItemStatus,
  transitionOrderStatus,
} from "./index.js";
import type { AddOrderItemInput, Order, OrderAuditContext } from "./index.js";

function context(overrides: Partial<OrderAuditContext> = {}): OrderAuditContext {
  return {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    actorId: "waiter-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-29T12:00:00Z",
    ...overrides,
  };
}

function sensitiveContext(overrides: Partial<OrderAuditContext> = {}): OrderAuditContext {
  return context({
    reason: "Customer requested cancellation",
    authorization: { approved: true, actorId: "manager-1" },
    ...overrides,
  });
}

function baseInput() {
  return {
    orderId: "order-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter" as const,
    currency: "MXN",
    timeZone: "America/Mexico_City",
  };
}

function line(orderItemId = "line-1"): AddOrderItemInput {
  return {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "menu-v1",
      productId: `product-${orderItemId}`,
      name: "Product",
      stationId: "grill",
      unit: "each",
      unitPrice: new Money(1000, "MXN"),
      modifiers: [],
    },
  };
}

function baseOrder(): Order {
  return createOrder(baseInput(), context()).order;
}

test("order creation returns the immutable aggregate and exact versioned audit event together", () => {
  const input = baseInput();
  const auditInput = {
    ...context(),
    actorId: "cashier-1",
    branchId: "attacker-controlled-branch",
    ignoredSecret: "must-not-be-retained",
  } as OrderAuditContext;
  const mutation = createOrder(input, auditInput);

  assert.deepEqual(mutation.auditEvent, {
    schemaVersion: ORDER_AUDIT_SCHEMA_VERSION,
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    orderId: "order-1",
    actorId: "cashier-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-29T12:00:00Z",
    operation: "order.created",
    entityType: "order",
    entityId: "order-1",
    to: "draft",
  });
  assert.equal(Object.isFrozen(mutation), true);
  assert.equal(Object.isFrozen(mutation.order), true);
  assert.equal(Object.isFrozen(mutation.auditEvent), true);
  assert.equal("ignoredSecret" in mutation.auditEvent, false);
  assert.equal(mutation.auditEvent.branchId, mutation.order.branchId);
});

test("audit events detach mutable caller context instead of freezing or retaining it", () => {
  const source = {
    eventId: "event-detached",
    idempotencyKey: "idempotency-detached",
    actorId: "cashier-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-29T12:00:00Z",
    reason: "Supervisor observed creation",
    authorization: { approved: true as const, actorId: "manager-1" },
  };
  const mutation = createOrder(baseInput(), source);

  source.actorId = "attacker";
  source.authorization.actorId = "attacker";

  assert.equal(mutation.auditEvent.actorId, "cashier-1");
  assert.equal(mutation.auditEvent.authorization?.actorId, "manager-1");
  assert.equal(Object.isFrozen(mutation.auditEvent.authorization), true);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(source.authorization), false);
});

test("item additions and normal state changes emit scoped facts without copying catalog snapshots", () => {
  const added = addOrderItem(baseOrder(), line(), context({ eventId: "event-add" }));
  assert.equal(added.auditEvent.operation, "order.item_added");
  assert.equal(added.auditEvent.entityType, "order_item");
  assert.equal(added.auditEvent.orderItemId, "line-1");
  assert.equal("snapshot" in added.auditEvent, false);

  const opened = transitionOrderStatus(added.order, "open", context({ eventId: "event-open" }));
  assert.equal(opened.auditEvent.operation, "order.state_changed");
  assert.equal(opened.auditEvent.from, "draft");
  assert.equal(opened.auditEvent.to, "open");
  assert.deepEqual(opened.auditEvent.automaticallyCancelledOrderItemIds, []);

  const sent = transitionOrderItemStatus(opened.order, "line-1", "sent", context({ eventId: "event-send" }));
  assert.equal(sent.auditEvent.operation, "order_item.state_changed");
  assert.equal(sent.auditEvent.from, "pending");
  assert.equal(sent.auditEvent.to, "sent");
  assert.equal(sent.auditEvent.entityId, "line-1");
});

test("pending cancellation requires a reason but not supervisor authorization", () => {
  const order = addOrderItem(baseOrder(), line(), context()).order;
  assert.throws(
    () => cancelOrderItem(order, "line-1", context()),
    OrderAuditReasonRequiredError,
  );

  const mutation = cancelOrderItem(order, "line-1", context({ reason: "Wrong item" }));
  assert.equal(mutation.order.items[0]?.status, "cancelled");
  assert.deepEqual(mutation.order.items[0]?.cancellationAudit, {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    from: "pending",
    actorId: "waiter-1",
    branchId: "branch-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-29T12:00:00Z",
    reason: "Wrong item",
  });
  assert.equal(mutation.auditEvent.reason, "Wrong item");
  assert.equal(mutation.auditEvent.authorization, undefined);
});

test("post-send cancellation binds the same actor, reason, device, branch, and supervisor evidence", () => {
  const order = addOrderItem(baseOrder(), line(), context()).order;
  const sent = transitionOrderItemStatus(order, "line-1", "sent", context()).order;
  assert.throws(
    () => cancelOrderItem(sent, "line-1", context({ reason: "Kitchen cancellation" })),
    OrderAuditAuthorizationRequiredError,
  );

  const mutation = cancelOrderItem(sent, "line-1", sensitiveContext());
  const retained = mutation.order.items[0]?.cancellationAudit;
  assert.deepEqual(retained, {
    eventId: mutation.auditEvent.eventId,
    idempotencyKey: mutation.auditEvent.idempotencyKey,
    from: mutation.auditEvent.from,
    actorId: mutation.auditEvent.actorId,
    branchId: mutation.auditEvent.branchId,
    deviceId: mutation.auditEvent.deviceId,
    occurredAt: mutation.auditEvent.occurredAt,
    reason: mutation.auditEvent.reason,
    authorization: mutation.auditEvent.authorization,
  });
  assert.equal(Object.isFrozen(retained), true);
  assert.equal(Object.isFrozen(retained?.authorization), true);
});

test("aggregate cancellation emits one event with a deterministic list of automatically cancelled lines", () => {
  const first = addOrderItem(baseOrder(), line("line-b"), context()).order;
  const pending = addOrderItem(first, line("line-a"), context()).order;

  assert.throws(
    () => transitionOrderStatus(pending, "cancelled", context({ reason: "Close order" })),
    OrderAuditAuthorizationRequiredError,
  );
  const mutation = transitionOrderStatus(pending, "cancelled", sensitiveContext());

  assert.deepEqual(mutation.order.items.map(({ status }) => status), ["cancelled", "cancelled"]);
  assert.deepEqual(mutation.auditEvent.automaticallyCancelledOrderItemIds, ["line-a", "line-b"]);
  assert.equal(mutation.auditEvent.operation, "order.state_changed");
  assert.equal(mutation.auditEvent.to, "cancelled");
  assert.deepEqual(mutation.order.cancellationAudit, {
    eventId: mutation.auditEvent.eventId,
    idempotencyKey: mutation.auditEvent.idempotencyKey,
    from: mutation.auditEvent.from,
    actorId: mutation.auditEvent.actorId,
    branchId: mutation.auditEvent.branchId,
    deviceId: mutation.auditEvent.deviceId,
    occurredAt: mutation.auditEvent.occurredAt,
    reason: mutation.auditEvent.reason,
    authorization: mutation.auditEvent.authorization,
  });
  for (const item of mutation.order.items) {
    assert.deepEqual(item.cancellationAudit, {
      eventId: mutation.auditEvent.eventId,
      idempotencyKey: mutation.auditEvent.idempotencyKey,
      from: "pending",
      actorId: mutation.auditEvent.actorId,
      branchId: mutation.auditEvent.branchId,
      deviceId: mutation.auditEvent.deviceId,
      occurredAt: mutation.auditEvent.occurredAt,
      reason: mutation.auditEvent.reason,
      authorization: mutation.auditEvent.authorization,
    });
  }
});

test("audit boundaries reject malformed timestamps, accessors, prototypes, and proxies without leaking TypeError", () => {
  let accessorReads = 0;
  const accessorContext = { ...context() };
  Object.defineProperty(accessorContext, "actorId", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "attacker";
    },
  });
  const hostilePrototype = { ...context() };
  Object.setPrototypeOf(hostilePrototype, { actorId: "inherited" });
  const hostileProxy = new Proxy({ ...context() }, {
    getOwnPropertyDescriptor() {
      throw new TypeError("hostile descriptor trap");
    },
  });

  for (const invalidContext of [
    null,
    [],
    context({ reason: " " }),
    context({ authorization: { approved: false, actorId: "manager-1" } as never }),
    context({ occurredAt: "2026-08-29T12:00:00-07:00" }),
    context({ occurredAt: "2026-02-30T12:00:00Z" }),
    accessorContext,
    hostilePrototype,
    hostileProxy,
  ]) {
    assert.throws(
      () => createOrder(baseInput(), invalidContext as never),
      DomainError,
    );
  }
  assert.equal(accessorReads, 0);
});

test("a rejected audited mutation leaves the original aggregate unchanged and returns no partial result", () => {
  const order = addOrderItem(baseOrder(), line(), context()).order;
  assert.throws(
    () => transitionOrderItemStatus(order, "line-1", "ready", context()),
    InvalidOrderItemTransitionError,
  );
  assert.equal(order.items[0]?.status, "pending");
  assert.equal(Object.isFrozen(order), true);

  assert.throws(
    () => addOrderItem(order, line("line-2"), { ...context(), eventId: " " }),
    InvalidOrderAuditContextError,
  );
  assert.equal(order.items.length, 1);
});
