import assert from "node:assert/strict";
import test from "node:test";

import {
  addOrderItem,
  calculateOrderAggregateTotals,
  canAddOrderItem,
  cancelOrderItem,
  createOrder,
  DomainError,
  DuplicateOrderItemIdError,
  InvalidOrderAuditContextError,
  InvalidOrderAggregateError,
  InvalidOrderChannelError,
  InvalidOrderTableAssignmentError,
  Money,
  OrderAggregateNotImmutableError,
  OrderCancellationRequiresItemCancellationError,
  OrderClosureRequiresItemCompletionError,
  OrderDoesNotAcceptNewLinesError,
  OrderItemNotFoundError,
  OrderItemMutationNotAllowedError,
  OrderItemScopeMismatchError,
  transitionOrderItemStatus,
  transitionOrderStatus,
} from "./index.js";
import type {
  AddOrderItemInput,
  Order,
  OrderAuditContext,
  OrderCancellationAudit,
  OrderItemCancellationAudit,
  OrderItemState,
  OrderState,
} from "./index.js";

function mxn(amount: number): Money {
  return new Money(amount, "MXN");
}

function line(overrides: Partial<AddOrderItemInput> = {}): AddOrderItemInput {
  return {
    orderItemId: "line-1",
    quantity: 1,
    snapshot: {
      catalogVersion: "menu-v1",
      productId: "burger",
      name: "Hamburguesa",
      stationId: "grill",
      unit: "each",
      unitPrice: mxn(10000),
      modifiers: [],
    },
    ...overrides,
  };
}

function audit(overrides: Partial<OrderAuditContext> = {}): OrderAuditContext {
  return {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    actorId: "cashier-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-28T12:00:00Z",
    reason: "Producto agotado",
    authorization: { approved: true, actorId: "manager-1" },
    ...overrides,
  };
}

function cancellationEvidence(
  from: "pending" | "sent" | "preparing" | "ready" = "sent",
): OrderItemCancellationAudit {
  return {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    from,
    actorId: "cashier-1",
    branchId: "branch-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-28T12:00:00Z",
    reason: "Producto agotado",
    authorization: { approved: true, actorId: "manager-1" },
  };
}

function orderCancellationEvidence(from: "draft" | "open" = "draft"): OrderCancellationAudit {
  return {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    from,
    actorId: "cashier-1",
    branchId: "branch-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-28T12:00:00Z",
    reason: "Producto agotado",
    authorization: { approved: true, actorId: "manager-1" },
  };
}

function auditWithoutAuthorization(): OrderAuditContext {
  return {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    actorId: "cashier-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-28T12:00:00Z",
    reason: "Producto agotado",
  };
}

test("Order creates an immutable tenant-scoped draft and adds detached immutable snapshots", () => {
  const source = line();
  const order = createOrder({
    orderId: "order-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    channel: "counter",
    currency: "MXN",
    timeZone: "America/Mexico_City",
  }, audit()).order;
  const next = addOrderItem(order, source, audit()).order;

  assert.equal(order.items.length, 0);
  assert.equal(next.items.length, 1);
  assert.notEqual(next, order);
  assert.equal(next.status, "draft");
  assert.equal(next.restaurantId, "restaurant-1");
  assert.equal(next.branchId, "branch-1");
  assert.equal(next.items[0]?.restaurantId, "restaurant-1");
  assert.equal(next.items[0]?.branchId, "branch-1");
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.isFrozen(next.items[0]?.snapshot), true);
  (source.snapshot as { name: string }).name = "Manipulada";
  assert.equal(next.items[0]?.snapshot.name, "Hamburguesa");
});

test("Order rejects duplicate lines and additions after its shared state rule closes the aggregate", () => {
  const order = added(baseOrder(), line());
  assert.throws(() => addOrderItem(order, line(), audit()), DuplicateOrderItemIdError);

  const paid = changedOrder(changedOrder(order, "open"), "paid");
  assert.equal(canAddOrderItem(paid), false);
  assert.throws(() => addOrderItem(paid, line({ orderItemId: "line-2" }), audit()), OrderDoesNotAcceptNewLinesError);
});

test("Order requires a valid channel and table identity only for table service", () => {
  assert.throws(() => createOrder({ ...baseInput(), channel: "drive_through" as never }, audit()), InvalidOrderChannelError);
  assert.throws(() => createOrder({ ...baseInput(), channel: "table" }, audit()), InvalidOrderTableAssignmentError);
  assert.throws(() => createOrder({ ...baseInput(), channel: "counter", tableId: "table-1" }, audit()), InvalidOrderTableAssignmentError);

  const table = createOrder({ ...baseInput(), channel: "table", tableId: "table-1" }, audit()).order;
  assert.equal(table.channel, "table");
  assert.equal(table.tableId, "table-1");
});

test("Order creation rejects accessors, hostile prototypes, and proxies before reading input facts", () => {
  let channelReads = 0;
  const accessorInput = { ...baseInput() };
  Object.defineProperty(accessorInput, "channel", {
    enumerable: true,
    get() {
      channelReads += 1;
      return channelReads === 1 ? "table" : "counter";
    },
  });
  const hostilePrototype = { ...baseInput() };
  Object.setPrototypeOf(hostilePrototype, { tableId: "inherited-table" });
  const hostileProxy = new Proxy({ ...baseInput() }, {
    ownKeys() {
      throw new TypeError("hostile ownKeys trap");
    },
  });

  for (const invalidInput of [accessorInput, hostilePrototype, hostileProxy]) {
    assert.throws(
      () => createOrder(invalidInput as never, audit()),
      InvalidOrderAggregateError,
    );
  }
  assert.equal(channelReads, 0);
});

test("Order delegates item transitions and stores immutable, branch-scoped cancellation audit evidence", () => {
  const sent = changedItem(added(baseOrder(), line()), "line-1", "sent");
  const cancelled = cancelOrderItem(sent, "line-1", audit()).order;

  assert.equal(sent.items[0]?.status, "sent");
  assert.equal(cancelled.items[0]?.status, "cancelled");
  assert.deepEqual(cancelled.items[0]?.cancellationAudit, cancellationEvidence());
  assert.equal(Object.isFrozen(cancelled.items[0]?.cancellationAudit), true);
  assert.throws(() => cancelOrderItem(sent, "missing", audit()), OrderItemNotFoundError);
});

test("Order totals use the shared calculator and omit cancelled lines without mutating history", () => {
  const twoLines = added(added(baseOrder(), line()), line({ orderItemId: "line-2", snapshot: { ...line().snapshot, productId: "soda", name: "Refresco", unitPrice: mxn(5000) } }));
  const total = calculateOrderAggregateTotals(twoLines);
  assert.equal(total.total.amountMinor, 15000);

  const cancelled = cancelOrderItem(twoLines, "line-1", auditWithoutAuthorization()).order;
  const afterCancellation = calculateOrderAggregateTotals(cancelled);
  assert.equal(afterCancellation.total.amountMinor, 5000);
  assert.deepEqual(cancelled.items[0]?.cancellationAudit, {
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    from: "pending",
    actorId: "cashier-1",
    branchId: "branch-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-28T12:00:00Z",
    reason: "Producto agotado",
  });
  assert.equal(twoLines.items[0]?.status, "pending");
});

test("Order cancellation retains complete evidence, cancels pending lines atomically, and makes its total zero", () => {
  const pending = added(
    added(createOrder({ ...baseInput(), tip: mxn(250) }, audit()).order, line()),
    line({ orderItemId: "line-2" }),
  );

  assert.throws(
    () => transitionOrderStatus(pending, "cancelled", undefined as never),
    InvalidOrderAuditContextError,
  );

  const cancelled = transitionOrderStatus(pending, "cancelled", audit()).order;
  assert.equal(pending.items[0]?.status, "pending");
  assert.deepEqual(cancelled.items.map((item) => item.status), ["cancelled", "cancelled"]);
  assert.deepEqual(cancelled.cancellationAudit, orderCancellationEvidence());
  assert.deepEqual(cancelled.items[0]?.cancellationAudit, cancellationEvidence("pending"));
  assert.equal(Object.isFrozen(cancelled.cancellationAudit), true);
  assert.equal(Object.isFrozen(cancelled.cancellationAudit?.authorization), true);
  assert.equal(calculateOrderAggregateTotals(cancelled).total.amountMinor, 0);
});

test("Order cancellation requires active kitchen lines to be cancelled individually first", () => {
  const sent = changedItem(added(baseOrder(), line()), "line-1", "sent");
  assert.throws(
    () => transitionOrderStatus(sent, "cancelled", audit()),
    OrderCancellationRequiresItemCancellationError,
  );

  const lineCancelled = cancelOrderItem(sent, "line-1", audit()).order;
  const cancelled = transitionOrderStatus(lineCancelled, "cancelled", audit()).order;
  assert.equal(cancelled.status, "cancelled");
});

test("Closed and cancelled orders reject item mutations while paid orders preserve the prepayment boundary", () => {
  const paid = changedOrder(changedOrder(added(baseOrder(), line()), "open"), "paid");
  assert.equal(changedItem(paid, "line-1", "sent").items[0]?.status, "sent");

  const sent = changedItem(paid, "line-1", "sent");
  const preparing = changedItem(sent, "line-1", "preparing");
  const ready = changedItem(preparing, "line-1", "ready");
  const closed = changedOrder(changedItem(ready, "line-1", "delivered"), "closed");
  assert.throws(() => transitionOrderItemStatus(closed, "line-1", "sent", audit()), OrderItemMutationNotAllowedError);

  const cancelled = transitionOrderStatus(added(baseOrder(), line()), "cancelled", audit()).order;
  assert.throws(() => cancelOrderItem(cancelled, "line-1", audit()), OrderItemMutationNotAllowedError);
});

test("Order closure requires every item to be delivered or cancelled", () => {
  const paid = changedOrder(changedOrder(added(baseOrder(), line()), "open"), "paid");
  assert.throws(() => transitionOrderStatus(paid, "closed", audit()), OrderClosureRequiresItemCompletionError);

  const sent = changedItem(paid, "line-1", "sent");
  const preparing = changedItem(sent, "line-1", "preparing");
  const ready = changedItem(preparing, "line-1", "ready");
  const delivered = changedItem(ready, "line-1", "delivered");
  assert.equal(changedOrder(delivered, "closed").status, "closed");
});

test("Order revalidation rejects accessors before reading changing values", () => {
  const valid = added(baseOrder(), line());
  let reads = 0;
  const accessorOrder = Object.freeze({
    ...valid,
    get orderId() {
      reads += 1;
      return reads === 1 ? "order-1" : "order-2";
    },
  });

  assert.throws(() => calculateOrderAggregateTotals(accessorOrder), InvalidOrderAggregateError);
  assert.equal(reads, 0);
});

test("Order revalidation rejects inherited getters before they can substitute validated facts", () => {
  const valid = added(baseOrder(), line());
  let itemReads = 0;
  const itemPrototype = {
    get items() {
      itemReads += 1;
      return valid.items;
    },
  };
  const inheritedItemsOrder = Object.create(itemPrototype) as typeof valid;
  const orderDescriptors = Object.getOwnPropertyDescriptors(valid);
  Reflect.deleteProperty(orderDescriptors, "items");
  Object.defineProperties(inheritedItemsOrder, orderDescriptors);
  Object.freeze(inheritedItemsOrder);

  assert.throws(() => calculateOrderAggregateTotals(inheritedItemsOrder), InvalidOrderAggregateError);
  assert.equal(itemReads, 0);

  let priceReads = 0;
  const snapshotPrototype = {
    get unitPrice() {
      priceReads += 1;
      return mxn(1);
    },
  };
  const inheritedPriceSnapshot = Object.create(snapshotPrototype) as AddOrderItemInput["snapshot"];
  const snapshotDescriptors = Object.getOwnPropertyDescriptors(valid.items[0]!.snapshot);
  Reflect.deleteProperty(snapshotDescriptors, "unitPrice");
  Object.defineProperties(inheritedPriceSnapshot, snapshotDescriptors);
  Object.freeze(inheritedPriceSnapshot);
  const inheritedSnapshotItem = Object.freeze({ ...valid.items[0]!, snapshot: inheritedPriceSnapshot });
  const inheritedSnapshotOrder = Object.freeze({ ...valid, items: Object.freeze([inheritedSnapshotItem]) });

  assert.throws(() => calculateOrderAggregateTotals(inheritedSnapshotOrder), InvalidOrderAggregateError);
  assert.equal(priceReads, 0);
});

test("Adding an item validates records and rejects accessors without leaking TypeError", () => {
  const order = baseOrder();
  assert.throws(() => addOrderItem(order, null as unknown as AddOrderItemInput, audit()), InvalidOrderAggregateError);

  let reads = 0;
  const accessorInput = {
    ...line(),
    get orderItemId() {
      reads += 1;
      return "line-2";
    },
  };
  assert.throws(() => addOrderItem(order, accessorInput, audit()), InvalidOrderAggregateError);
  assert.equal(reads, 0);
});

test("Every aggregate operation fails closed for mutable or scope-manipulated rehydrated orders", () => {
  const valid = added(baseOrder(), line());
  const mutable = { ...valid, items: [...valid.items] };
  const foreignScope = freeze({
    ...valid,
    items: valid.items.map((item) => ({ ...item, branchId: "branch-2" })),
  });

  for (const operation of [
    () => canAddOrderItem(mutable),
    () => addOrderItem(mutable, line({ orderItemId: "line-2" }), audit()),
    () => transitionOrderStatus(mutable, "open", audit()),
    () => transitionOrderItemStatus(mutable, "line-1", "sent", audit()),
    () => cancelOrderItem(mutable, "line-1", audit()),
    () => calculateOrderAggregateTotals(mutable),
  ]) {
    assert.throws(operation, OrderAggregateNotImmutableError);
  }
  assert.throws(() => calculateOrderAggregateTotals(foreignScope), OrderItemScopeMismatchError);
});

test("Rehydrated cancelled lines require immutable event-linked evidence with a valid origin", () => {
  const cancelled = cancelOrderItem(
    added(baseOrder(), line()),
    "line-1",
    auditWithoutAuthorization(),
  ).order;
  const missingEvidence = freeze({
    ...cancelled,
    items: cancelled.items.map(({ cancellationAudit, ...item }) => {
      assert.ok(cancellationAudit);
      return freeze(item);
    }),
  }) as Order;
  const forgedOrigin = freeze({
    ...cancelled,
    items: cancelled.items.map((item) => freeze({
      ...item,
      cancellationAudit: freeze({ ...item.cancellationAudit!, from: "delivered" }),
    })),
  }) as unknown as Order;

  assert.throws(() => calculateOrderAggregateTotals(missingEvidence), InvalidOrderAggregateError);
  assert.throws(() => calculateOrderAggregateTotals(forgedOrigin), DomainError);
});

function baseOrder() {
  return createOrder(baseInput(), audit()).order;
}

function added(order: Order, input: AddOrderItemInput): Order {
  return addOrderItem(order, input, audit()).order;
}

function changedOrder(order: Order, to: OrderState): Order {
  return transitionOrderStatus(order, to, audit()).order;
}

function changedItem(order: Order, orderItemId: string, to: OrderItemState): Order {
  return transitionOrderItemStatus(order, orderItemId, to, audit()).order;
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

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
