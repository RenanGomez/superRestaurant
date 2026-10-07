import assert from "node:assert/strict";
import test from "node:test";

import {
  addOrderItem,
  calculateCancelledOrderOriginalTotal,
  calculateOrderAggregateTotals,
  cancelOrder,
  createOrder,
  DomainError,
  InvalidOrderAggregateError,
  InvalidOrderTransitionError,
  Money,
  OrderCancellationRequiresItemCancellationError,
  OrderItemNotFoundError,
  transitionOrderItemStatus,
  transitionOrderStatus,
} from "./index.js";
import type { AddOrderItemInput, Order, OrderAuditContext, OrderItemState, OrderState } from "./index.js";

function line(orderItemId: string): AddOrderItemInput {
  return {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "menu-v1",
      productId: "burger",
      name: "Hamburguesa",
      stationId: "grill",
      unit: "each",
      unitPrice: new Money(10000, "MXN"),
      modifiers: [],
    },
  };
}

function audit(overrides: Partial<OrderAuditContext> = {}): OrderAuditContext {
  return {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    actorId: "manager-1",
    deviceId: "terminal-1",
    occurredAt: "2026-10-06T12:00:00Z",
    reason: "Cliente se arrepintio",
    authorization: { approved: true, actorId: "manager-1" },
    ...overrides,
  };
}

function withoutAuthorization(): OrderAuditContext {
  const { authorization: _authorization, ...rest } = audit();
  return rest;
}

function changedOrder(order: Order, to: OrderState): Order {
  return transitionOrderStatus(order, to, audit()).order;
}

function changedItem(order: Order, orderItemId: string, to: OrderItemState): Order {
  return transitionOrderItemStatus(order, orderItemId, to, audit()).order;
}

function twoLineOrder(status: "open" | "partially_paid" | "paid"): Order {
  let order = createOrder({
    orderId: "order-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter",
    currency: "MXN",
    timeZone: "America/Mexico_City",
  }, audit()).order;
  order = addOrderItem(order, line("line-1"), audit()).order;
  order = addOrderItem(order, line("line-2"), audit()).order;
  order = changedOrder(order, "open");
  if (status === "paid") order = changedOrder(order, "paid");
  if (status === "partially_paid") order = changedOrder(order, "partially_paid");
  return order;
}

const lineContexts = {
  "line-1": { eventId: "event-line-1", idempotencyKey: "idem-line-1" },
};

test("cancelOrder cancels sent lines one by one, then the order, with a pending refund obligation after payment", () => {
  const paid = changedItem(twoLineOrder("paid"), "line-1", "sent");
  const mutations = cancelOrder(paid, { auditContext: audit(), lineContexts, refundObligation: "pending" });
  assert.equal(mutations.length, 2);
  const [lineStep, orderStep] = mutations;
  assert.equal(lineStep!.auditEvent.operation, "order_item.state_changed");
  assert.equal(lineStep!.auditEvent.eventId, "event-line-1");
  assert.equal(lineStep!.order.status, "paid");
  assert.equal(lineStep!.order.items[0]!.status, "cancelled");
  assert.equal(lineStep!.order.items[1]!.status, "pending");
  assert.equal(orderStep!.auditEvent.operation, "order.state_changed");
  assert.equal(orderStep!.order.status, "cancelled");
  assert.equal(orderStep!.order.cancellationAudit!.from, "paid");
  assert.equal(orderStep!.order.cancellationAudit!.reason, "Cliente se arrepintio");
  assert.deepEqual(orderStep!.order.items.map((item) => item.status), ["cancelled", "cancelled"]);
  assert.equal(orderStep!.order.items[1]!.cancellationAudit!.eventId, "event-1");
  assert.equal(Object.isFrozen(mutations), true);
});

test("cancelOrder from partially_paid and open needs only the order step when nothing reached the kitchen", () => {
  const steps = cancelOrder(twoLineOrder("partially_paid"), {
    auditContext: audit(), lineContexts: {}, refundObligation: "pending",
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.order.cancellationAudit!.from, "partially_paid");
  const open = cancelOrder(twoLineOrder("open"), { auditContext: audit(), lineContexts: {}, refundObligation: "none" });
  assert.equal(open.length, 1);
  assert.equal(open[0]!.order.cancellationAudit!.from, "open");
});

test("cancelOrder refuses money states without a pending obligation, a reason, a supervisor or a line identity", () => {
  const paid = twoLineOrder("paid");
  assert.throws(
    () => cancelOrder(paid, { auditContext: audit(), lineContexts: {}, refundObligation: "none" }),
    InvalidOrderTransitionError,
  );
  assert.throws(
    () => cancelOrder(paid, { auditContext: audit({ reason: "   " }), lineContexts: {}, refundObligation: "pending" }),
    DomainError,
  );
  assert.throws(
    () => cancelOrder(paid, { auditContext: withoutAuthorization(), lineContexts: {}, refundObligation: "pending" }),
    DomainError,
  );
  const sent = changedItem(paid, "line-1", "sent");
  assert.throws(
    () => cancelOrder(sent, { auditContext: audit(), lineContexts: {}, refundObligation: "pending" }),
    OrderItemNotFoundError,
  );
  assert.equal(sent.status, "paid");
  assert.equal(sent.items[0]!.status, "sent");
});

test("cancelOrder rejects delivered lines and already cancelled orders; transitionOrderStatus keeps money states gated", () => {
  const sent = changedItem(twoLineOrder("paid"), "line-1", "sent");
  const delivered = changedItem(changedItem(changedItem(sent, "line-1", "preparing"), "line-1", "ready"), "line-1", "delivered");
  assert.throws(
    () => cancelOrder(delivered, { auditContext: audit(), lineContexts, refundObligation: "pending" }),
    OrderCancellationRequiresItemCancellationError,
  );
  const cancelled = cancelOrder(twoLineOrder("open"), {
    auditContext: audit(), lineContexts: {}, refundObligation: "none",
  })[0]!.order;
  assert.throws(
    () => cancelOrder(cancelled, { auditContext: audit(), lineContexts: {}, refundObligation: "none" }),
    InvalidOrderTransitionError,
  );
  assert.throws(() => transitionOrderStatus(twoLineOrder("paid"), "cancelled", audit()), InvalidOrderTransitionError);
});

test("calculateCancelledOrderOriginalTotal reports the frozen worth of a cancelled order and nothing else", () => {
  const paid = twoLineOrder("paid");
  const cancelled = cancelOrder(paid, { auditContext: audit(), lineContexts: {}, refundObligation: "pending" })[0]!.order;
  assert.equal(calculateOrderAggregateTotals(cancelled).total.amountMinor, 0);
  assert.equal(calculateCancelledOrderOriginalTotal(cancelled).amountMinor, 20000);
  assert.equal(calculateCancelledOrderOriginalTotal(cancelled).currency, "MXN");
  assert.throws(() => calculateCancelledOrderOriginalTotal(paid), InvalidOrderAggregateError);
});
