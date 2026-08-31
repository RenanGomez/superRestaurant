import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOrderAcceptsNewLines,
  InvalidOrderItemTransitionError,
  InvalidOrderStateError,
  InvalidOrderTransitionError,
  OrderDoesNotAcceptNewLinesError,
  OrderItemCancellationAuditContextRequiredError,
  OrderItemCancellationAuthorizationRequiredError,
  OrderItemCancellationReasonRequiredError,
  orderAcceptsNewLines,
  transitionOrder,
  transitionOrderItem,
} from "./index.js";
import type { OrderItemCancellationAudit, OrderItemState } from "./index.js";

test("Order transitions follow the declared payment and closing lifecycle", () => {
  assert.equal(transitionOrder("draft", "open"), "open");
  assert.equal(transitionOrder("draft", "cancelled"), "cancelled");
  assert.equal(transitionOrder("open", "partially_paid"), "partially_paid");
  assert.equal(transitionOrder("open", "paid"), "paid");
  assert.equal(transitionOrder("open", "cancelled"), "cancelled");
  assert.equal(transitionOrder("partially_paid", "paid"), "paid");
  assert.equal(transitionOrder("paid", "closed"), "closed");
});

test("Order rejects skipped, backwards, and terminal-state transitions", () => {
  assert.throws(() => transitionOrder("draft", "paid"), InvalidOrderTransitionError);
  assert.throws(() => transitionOrder("partially_paid", "cancelled"), InvalidOrderTransitionError);
  assert.throws(() => transitionOrder("paid", "open"), InvalidOrderTransitionError);
  assert.throws(() => transitionOrder("closed", "open"), InvalidOrderTransitionError);
  assert.throws(() => transitionOrder("cancelled", "open"), InvalidOrderTransitionError);
});

test("Only paid, closed, and cancelled orders reject new lines", () => {
  assert.equal(orderAcceptsNewLines("draft"), true);
  assert.equal(orderAcceptsNewLines("open"), true);
  assert.equal(orderAcceptsNewLines("partially_paid"), true);
  assert.equal(orderAcceptsNewLines("paid"), false);
  assert.equal(orderAcceptsNewLines("closed"), false);
  assert.equal(orderAcceptsNewLines("cancelled"), false);
  assert.throws(() => assertOrderAcceptsNewLines("paid"), OrderDoesNotAcceptNewLinesError);
  assert.throws(() => assertOrderAcceptsNewLines("closed"), OrderDoesNotAcceptNewLinesError);
});

test("Order item transitions follow KDS preparation lifecycle", () => {
  assert.equal(transitionOrderItem("pending", "sent").to, "sent");
  assert.equal(transitionOrderItem("sent", "preparing").to, "preparing");
  assert.equal(transitionOrderItem("preparing", "ready").to, "ready");
  assert.equal(transitionOrderItem("ready", "delivered").to, "delivered");
  assert.throws(
    () => transitionOrderItem("pending", "cancelled"),
    OrderItemCancellationAuditContextRequiredError,
  );
  const pendingAudit = auditFor({ from: "pending", authorization: undefined });
  assert.deepEqual(
    transitionOrderItem("pending", "cancelled", { cancellationAudit: pendingAudit }),
    {
      from: "pending",
      to: "cancelled",
      cancellationAudit: {
        eventId: "event-1",
        idempotencyKey: "idempotency-1",
        from: "pending",
        actorId: "cashier-1",
        branchId: "branch-1",
        deviceId: "device-1",
        occurredAt: "2026-08-25T12:00:00Z",
        reason: "Sin stock",
      },
    },
  );
});

test("Order items reject skipped and terminal transitions", () => {
  assert.throws(() => transitionOrderItem("pending", "ready"), InvalidOrderItemTransitionError);
  assert.throws(() => transitionOrderItem("sent", "delivered"), InvalidOrderItemTransitionError);
  assert.throws(() => transitionOrderItem("delivered", "cancelled"), InvalidOrderItemTransitionError);
  assert.throws(() => transitionOrderItem("cancelled", "sent"), InvalidOrderItemTransitionError);
});

test("State helpers reject malformed runtime states with domain errors instead of TypeError", () => {
  for (const invalidState of [undefined, { state: "open" }, "unknown"] as const) {
    assert.throws(() => orderAcceptsNewLines(invalidState as never), InvalidOrderStateError);
    assert.throws(() => assertOrderAcceptsNewLines(invalidState as never), InvalidOrderStateError);
    assert.throws(() => transitionOrder(invalidState as never, "open"), InvalidOrderTransitionError);
    assert.throws(() => transitionOrder("draft", invalidState as never), InvalidOrderTransitionError);
    assert.throws(() => transitionOrderItem(invalidState as never, "sent"), InvalidOrderItemTransitionError);
    assert.throws(() => transitionOrderItem("pending", invalidState as never), InvalidOrderItemTransitionError);
  }
});

test("Post-send cancellation returns complete audit evidence and is all-or-nothing", () => {
  let itemState: OrderItemState = "sent";

  assert.throws(
    () => transitionOrderItem(itemState, "cancelled"),
    OrderItemCancellationAuditContextRequiredError,
  );
  assert.equal(itemState, "sent");

  assert.throws(
    () => transitionOrderItem(itemState, "cancelled", { cancellationAudit: auditFor({ reason: "   " }) }),
    OrderItemCancellationReasonRequiredError,
  );
  assert.throws(
    () => transitionOrderItem(itemState, "cancelled", {
      cancellationAudit: { ...auditFor(), authorization: undefined } as unknown as OrderItemCancellationAudit,
    }),
    OrderItemCancellationAuthorizationRequiredError,
  );
  assert.throws(
    () =>
      transitionOrderItem(itemState, "cancelled", {
        cancellationAudit: auditFor({ authorization: { approved: true, actorId: "  " } }),
      }),
    OrderItemCancellationAuthorizationRequiredError,
  );

  for (const audit of [
    auditFor({ actorId: "  " }),
    auditFor({ branchId: "  " }),
    auditFor({ deviceId: "  " }),
    auditFor({ occurredAt: "  " }),
  ]) {
    assert.throws(
      () => transitionOrderItem(itemState, "cancelled", { cancellationAudit: audit }),
      OrderItemCancellationAuditContextRequiredError,
    );
  }

  const audit = auditFor();
  const transition = transitionOrderItem(itemState, "cancelled", { cancellationAudit: audit });
  itemState = transition.to;
  assert.equal(itemState, "cancelled");
  assert.equal(Object.isFrozen(transition), true);
  assert.equal(Object.isFrozen(transition.cancellationAudit), true);
  assert.equal(Object.isFrozen(transition.cancellationAudit?.authorization), true);
  assert.deepEqual(transition.cancellationAudit, audit);
});

test("Preparing and ready cancellation require and preserve audit evidence", () => {
  for (const state of ["preparing", "ready"] as const) {
    assert.throws(
      () => transitionOrderItem(state, "cancelled"),
      OrderItemCancellationAuditContextRequiredError,
    );
    const audit = auditFor({ from: state, reason: `Cancel ${state}` });
    assert.deepEqual(
      transitionOrderItem(state, "cancelled", { cancellationAudit: audit }).cancellationAudit,
      audit,
    );
  }
});

test("Cancellation evidence rejects mismatched origins, invalid UTC, accessors, and proxies fail-closed", () => {
  let reads = 0;
  const accessorAudit = { ...auditFor() };
  Object.defineProperty(accessorAudit, "actorId", {
    enumerable: true,
    get() {
      reads += 1;
      return "attacker";
    },
  });
  const proxyAudit = new Proxy({ ...auditFor() }, {
    getOwnPropertyDescriptor() {
      throw new TypeError("hostile descriptor trap");
    },
  });

  for (const cancellationAudit of [
    auditFor({ from: "preparing" }),
    auditFor({ occurredAt: "2026-02-30T12:00:00Z" }),
    accessorAudit,
    proxyAudit,
  ]) {
    assert.throws(
      () => transitionOrderItem("sent", "cancelled", { cancellationAudit: cancellationAudit as never }),
      OrderItemCancellationAuditContextRequiredError,
    );
  }
  assert.equal(reads, 0);
});

function auditFor(
  overrides: Partial<{
    eventId: string;
    idempotencyKey: string;
    from: "pending" | "sent" | "preparing" | "ready";
    actorId: string;
    branchId: string;
    deviceId: string;
    occurredAt: string;
    reason: string;
    authorization: { readonly approved: true; readonly actorId: string } | undefined;
  }> = {},
): OrderItemCancellationAudit {
  const value = {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    from: "sent" as const,
    actorId: "cashier-1",
    branchId: "branch-1",
    deviceId: "device-1",
    occurredAt: "2026-08-25T12:00:00Z",
    reason: "Sin stock",
    authorization: { approved: true, actorId: "supervisor-1" },
    ...overrides,
  };
  return value as OrderItemCancellationAudit;
}
