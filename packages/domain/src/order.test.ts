import assert from "node:assert/strict";
import test from "node:test";

import {
  addOrderItem,
  calculateOrderAggregateTotals,
  canAddOrderItem,
  cancelOrderItem,
  createOrder,
  DuplicateOrderItemIdError,
  InvalidOrderAggregateError,
  InvalidOrderChannelError,
  InvalidOrderTableAssignmentError,
  Money,
  OrderAggregateNotImmutableError,
  OrderCancellationRequiresItemCancellationError,
  OrderClosureRequiresItemCompletionError,
  OrderDoesNotAcceptNewLinesError,
  OrderItemCancellationScopeMismatchError,
  OrderItemCancellationAuditContextRequiredError,
  OrderItemNotFoundError,
  OrderItemMutationNotAllowedError,
  OrderItemScopeMismatchError,
  transitionOrderItemStatus,
  transitionOrderStatus,
} from "./index.js";
import type { AddOrderItemInput, OrderItemCancellationAudit } from "./index.js";

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

function audit(overrides: Partial<OrderItemCancellationAudit> = {}): OrderItemCancellationAudit {
  return {
    actorId: "cashier-1",
    branchId: "branch-1",
    deviceId: "terminal-1",
    occurredAt: "2026-08-28T12:00:00Z",
    reason: "Producto agotado",
    authorization: { approved: true, actorId: "manager-1" },
    ...overrides,
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
  });
  const next = addOrderItem(order, source);

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
  const order = addOrderItem(baseOrder(), line());
  assert.throws(() => addOrderItem(order, line()), DuplicateOrderItemIdError);

  const paid = transitionOrderStatus(transitionOrderStatus(order, "open"), "paid");
  assert.equal(canAddOrderItem(paid), false);
  assert.throws(() => addOrderItem(paid, line({ orderItemId: "line-2" })), OrderDoesNotAcceptNewLinesError);
});

test("Order requires a valid channel and table identity only for table service", () => {
  assert.throws(() => createOrder({ ...baseInput(), channel: "drive_through" as never }), InvalidOrderChannelError);
  assert.throws(() => createOrder({ ...baseInput(), channel: "table" }), InvalidOrderTableAssignmentError);
  assert.throws(() => createOrder({ ...baseInput(), channel: "counter", tableId: "table-1" }), InvalidOrderTableAssignmentError);

  const table = createOrder({ ...baseInput(), channel: "table", tableId: "table-1" });
  assert.equal(table.channel, "table");
  assert.equal(table.tableId, "table-1");
});

test("Order delegates item transitions and stores immutable, branch-scoped cancellation audit evidence", () => {
  const sent = transitionOrderItemStatus(addOrderItem(baseOrder(), line()), "line-1", "sent");
  const cancelled = cancelOrderItem(sent, "line-1", { cancellationAudit: audit() });

  assert.equal(sent.items[0]?.status, "sent");
  assert.equal(cancelled.items[0]?.status, "cancelled");
  assert.deepEqual(cancelled.items[0]?.cancellationAudit, audit());
  assert.equal(Object.isFrozen(cancelled.items[0]?.cancellationAudit), true);
  assert.throws(
    () => cancelOrderItem(sent, "line-1", { cancellationAudit: audit({ branchId: "branch-2" }) }),
    OrderItemCancellationScopeMismatchError,
  );
  assert.throws(() => cancelOrderItem(sent, "missing", { cancellationAudit: audit() }), OrderItemNotFoundError);
});

test("Order totals use the shared calculator and omit cancelled lines without mutating history", () => {
  const twoLines = addOrderItem(addOrderItem(baseOrder(), line()), line({ orderItemId: "line-2", snapshot: { ...line().snapshot, productId: "soda", name: "Refresco", unitPrice: mxn(5000) } }));
  const total = calculateOrderAggregateTotals(twoLines);
  assert.equal(total.total.amountMinor, 15000);

  const cancelled = cancelOrderItem(twoLines, "line-1");
  const afterCancellation = calculateOrderAggregateTotals(cancelled);
  assert.equal(afterCancellation.total.amountMinor, 5000);
  assert.equal(twoLines.items[0]?.status, "pending");
});

test("Order cancellation retains complete evidence, cancels pending lines atomically, and makes its total zero", () => {
  const pending = addOrderItem(
    addOrderItem(createOrder({ ...baseInput(), tip: mxn(250) }), line()),
    line({ orderItemId: "line-2" }),
  );

  assert.throws(
    () => transitionOrderStatus(pending, "cancelled"),
    OrderItemCancellationAuditContextRequiredError,
  );
  assert.throws(
    () => transitionOrderStatus(pending, "cancelled", { cancellationAudit: audit({ branchId: "branch-2" }) }),
    OrderItemCancellationScopeMismatchError,
  );

  const cancelled = transitionOrderStatus(pending, "cancelled", { cancellationAudit: audit() });
  assert.equal(pending.items[0]?.status, "pending");
  assert.deepEqual(cancelled.items.map((item) => item.status), ["cancelled", "cancelled"]);
  assert.deepEqual(cancelled.cancellationAudit, audit());
  assert.equal(Object.isFrozen(cancelled.cancellationAudit), true);
  assert.equal(Object.isFrozen(cancelled.cancellationAudit?.authorization), true);
  assert.equal(calculateOrderAggregateTotals(cancelled).total.amountMinor, 0);
});

test("Order cancellation requires active kitchen lines to be cancelled individually first", () => {
  const sent = transitionOrderItemStatus(addOrderItem(baseOrder(), line()), "line-1", "sent");
  assert.throws(
    () => transitionOrderStatus(sent, "cancelled", { cancellationAudit: audit() }),
    OrderCancellationRequiresItemCancellationError,
  );

  const lineCancelled = cancelOrderItem(sent, "line-1", { cancellationAudit: audit() });
  const cancelled = transitionOrderStatus(lineCancelled, "cancelled", { cancellationAudit: audit() });
  assert.equal(cancelled.status, "cancelled");
});

test("Closed and cancelled orders reject item mutations while paid orders preserve the prepayment boundary", () => {
  const paid = transitionOrderStatus(transitionOrderStatus(addOrderItem(baseOrder(), line()), "open"), "paid");
  assert.equal(transitionOrderItemStatus(paid, "line-1", "sent").items[0]?.status, "sent");

  const sent = transitionOrderItemStatus(paid, "line-1", "sent");
  const preparing = transitionOrderItemStatus(sent, "line-1", "preparing");
  const ready = transitionOrderItemStatus(preparing, "line-1", "ready");
  const closed = transitionOrderStatus(transitionOrderItemStatus(ready, "line-1", "delivered"), "closed");
  assert.throws(() => transitionOrderItemStatus(closed, "line-1", "sent"), OrderItemMutationNotAllowedError);

  const cancelled = transitionOrderStatus(addOrderItem(baseOrder(), line()), "cancelled", { cancellationAudit: audit() });
  assert.throws(() => cancelOrderItem(cancelled, "line-1"), OrderItemMutationNotAllowedError);
});

test("Order closure requires every item to be delivered or cancelled", () => {
  const paid = transitionOrderStatus(transitionOrderStatus(addOrderItem(baseOrder(), line()), "open"), "paid");
  assert.throws(() => transitionOrderStatus(paid, "closed"), OrderClosureRequiresItemCompletionError);

  const sent = transitionOrderItemStatus(paid, "line-1", "sent");
  const preparing = transitionOrderItemStatus(sent, "line-1", "preparing");
  const ready = transitionOrderItemStatus(preparing, "line-1", "ready");
  const delivered = transitionOrderItemStatus(ready, "line-1", "delivered");
  assert.equal(transitionOrderStatus(delivered, "closed").status, "closed");
});

test("Order revalidation rejects accessors before reading changing values", () => {
  const valid = addOrderItem(baseOrder(), line());
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
  const valid = addOrderItem(baseOrder(), line());
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
  assert.throws(() => addOrderItem(order, null as unknown as AddOrderItemInput), InvalidOrderAggregateError);

  let reads = 0;
  const accessorInput = {
    ...line(),
    get orderItemId() {
      reads += 1;
      return "line-2";
    },
  };
  assert.throws(() => addOrderItem(order, accessorInput), InvalidOrderAggregateError);
  assert.equal(reads, 0);
});

test("Every aggregate operation fails closed for mutable or scope-manipulated rehydrated orders", () => {
  const valid = addOrderItem(baseOrder(), line());
  const mutable = { ...valid, items: [...valid.items] };
  const foreignScope = freeze({
    ...valid,
    items: valid.items.map((item) => ({ ...item, branchId: "branch-2" })),
  });

  for (const operation of [
    () => canAddOrderItem(mutable),
    () => addOrderItem(mutable, line({ orderItemId: "line-2" })),
    () => transitionOrderStatus(mutable, "open"),
    () => transitionOrderItemStatus(mutable, "line-1", "sent"),
    () => cancelOrderItem(mutable, "line-1"),
    () => calculateOrderAggregateTotals(mutable),
  ]) {
    assert.throws(operation, OrderAggregateNotImmutableError);
  }
  assert.throws(() => calculateOrderAggregateTotals(foreignScope), OrderItemScopeMismatchError);
});

function baseOrder() {
  return createOrder(baseInput());
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
