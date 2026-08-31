import {
  DomainError,
  DuplicateOrderItemIdError,
  InvalidOrderAggregateError,
  InvalidOrderChannelError,
  InvalidOrderTableAssignmentError,
  InvalidSnapshotError,
  OrderAggregateNotImmutableError,
  OrderCancellationRequiresItemCancellationError,
  OrderClosureRequiresItemCompletionError,
  OrderItemCancellationScopeMismatchError,
  OrderItemMutationNotAllowedError,
  OrderItemNotFoundError,
  OrderItemScopeMismatchError,
} from "./errors.js";
import {
  calculateOrderItemTotals,
  calculateOrderTotals,
  type CalculatedOrderTotals,
  type OrderDiscountSnapshot,
  type OrderItemPricingInput,
} from "./order-totals.js";
import {
  assertOrderAcceptsNewLines,
  orderAcceptsNewLines,
  transitionOrder,
  transitionOrderItem,
  type CancellableOrderItemState,
  type CancellationAuthorization,
  type OrderItemCancellationAudit,
  type OrderItemState,
  type OrderState,
} from "./order-state.js";
import { Money } from "./money.js";
import {
  createOrderCreatedAuditEvent,
  createOrderItemAddedAuditEvent,
  createOrderItemStateChangedAuditEvent,
  createOrderStateChangedAuditEvent,
  type OrderAuditContext,
  type OrderAuditEvent,
  type OrderCreatedAuditEvent,
  type OrderItemAddedAuditEvent,
  type OrderItemStateChangedAuditEvent,
  type OrderStateChangedAuditEvent,
} from "./order-audit.js";

export type OrderChannel = "table" | "counter" | "takeout" | "delivery";

/** A historical, immutable, tenant-scoped order line. */
export interface OrderItem extends OrderItemPricingInput {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly status: OrderItemState;
  readonly cancellationAudit?: OrderItemCancellationAudit;
}

/** Pure aggregate boundary for a restaurant order. All contained values are detached and frozen. */
export interface Order {
  readonly orderId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly channel: OrderChannel;
  readonly tableId?: string;
  readonly currency: string;
  readonly timeZone: string;
  readonly status: OrderState;
  readonly items: readonly OrderItem[];
  readonly orderDiscount?: OrderDiscountSnapshot;
  readonly tip?: Money;
  /** Immutable evidence of an aggregate cancellation. Payment settlement remains an application boundary. */
  readonly cancellationAudit?: OrderCancellationAudit;
}

export interface CreateOrderInput {
  readonly orderId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly channel: OrderChannel;
  readonly tableId?: string;
  readonly currency: string;
  readonly timeZone: string;
  readonly orderDiscount?: OrderDiscountSnapshot;
  readonly tip?: Money;
}

export type AddOrderItemInput = OrderItemPricingInput;

/** Immutable evidence retained by a cancelled aggregate and linked to its audit event. */
export interface OrderCancellationAudit {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly from: "draft" | "open";
  readonly actorId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason: string;
  readonly authorization: CancellationAuthorization;
}

/** The next aggregate and its inseparable audit fact; persistence must commit both atomically. */
export interface OrderMutation<TEvent extends OrderAuditEvent = OrderAuditEvent> {
  readonly order: Order;
  readonly auditEvent: TEvent;
}

/** Creates a draft order after validating and freezing its monetary and channel facts. */
export function createOrder(
  input: CreateOrderInput,
  auditContext: OrderAuditContext,
): OrderMutation<OrderCreatedAuditEvent> {
  assertRecord(input, "order");
  assertStableValueGraph(input, "order");
  assertText(input.orderId, "orderId");
  assertText(input.restaurantId, "restaurantId");
  assertText(input.branchId, "branchId");
  assertChannel(input.channel, input.tableId);
  const totals = asDomainValidation(() => calculateOrderTotals({
    currency: input.currency,
    timeZone: input.timeZone,
    lines: [],
    ...(input.orderDiscount === undefined ? {} : { orderDiscount: input.orderDiscount }),
    ...(input.tip === undefined ? {} : { tip: input.tip }),
  }), "monetary policy");

  const order = freezeOrder({
    orderId: input.orderId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    channel: input.channel,
    ...(input.tableId === undefined ? {} : { tableId: input.tableId }),
    currency: totals.input.currency,
    timeZone: totals.input.timeZone,
    status: "draft",
    items: [],
    ...(totals.input.orderDiscount === undefined ? {} : { orderDiscount: totals.input.orderDiscount }),
    ...(totals.input.tip === undefined ? {} : { tip: totals.input.tip }),
  });
  return freezeMutation(order, createOrderCreatedAuditEvent(auditScope(order), auditContext));
}

/** The aggregate-facing predicate delegates the shared state rule after fail-closed revalidation. */
export function canAddOrderItem(order: Order): boolean {
  assertValidOrder(order);
  return orderAcceptsNewLines(order.status);
}

/** Adds one pending, tenant-scoped line and returns the aggregate with its audit fact. */
export function addOrderItem(
  order: Order,
  input: AddOrderItemInput,
  auditContext: OrderAuditContext,
): OrderMutation<OrderItemAddedAuditEvent> {
  assertValidOrder(order);
  assertRecord(input, "item snapshot");
  assertStableValueGraph(input, "item snapshot");
  const orderItemId = asDomainValidation(() => input.orderItemId, "item snapshot");
  if (!canAddOrderItem(order)) {
    assertOrderAcceptsNewLines(order.status);
  }
  if (order.items.some((item) => item.orderItemId === orderItemId)) {
    throw new DuplicateOrderItemIdError(orderItemId);
  }

  const calculated = asDomainValidation(() => calculateOrderItemTotals(input), "item snapshot");
  const item = freezeOrderItem({
    ...calculated.input,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    status: "pending",
  });
  const nextOrder = freezeOrder({ ...order, items: [...order.items, item] });
  return freezeMutation(
    nextOrder,
    createOrderItemAddedAuditEvent(auditScope(order), item.orderItemId, auditContext),
  );
}

/**
 * Delegates lifecycle validation and makes aggregate cancellation all-or-nothing.
 * The application layer owns Payment linkage and persisted table scope; this pure
 * aggregate only enforces the cancellation facts it already contains.
 */
export function transitionOrderStatus(
  order: Order,
  to: OrderState,
  auditContext: OrderAuditContext,
): OrderMutation<OrderStateChangedAuditEvent> {
  assertValidOrder(order);
  const from = order.status;
  const status = transitionOrder(from, to);
  if (status === "closed") {
    assertOrderCanBeClosed(order);
    const nextOrder = freezeOrder({ ...order, status });
    return freezeMutation(
      nextOrder,
      createOrderStateChangedAuditEvent(auditScope(order), from, status, [], auditContext),
    );
  }
  if (status !== "cancelled") {
    const nextOrder = freezeOrder({ ...order, status });
    return freezeMutation(
      nextOrder,
      createOrderStateChangedAuditEvent(auditScope(order), from, status, [], auditContext),
    );
  }

  assertOrderCanBeCancelled(order);
  const automaticallyCancelledOrderItemIds = order.items
    .filter((item) => item.status === "pending")
    .map((item) => item.orderItemId);
  const auditEvent = createOrderStateChangedAuditEvent(
    auditScope(order),
    from,
    status,
    automaticallyCancelledOrderItemIds,
    auditContext,
  );
  const cancellationAudit = orderCancellationAuditFromEvent(auditEvent);
  const automaticallyCancelledItemAudit = orderItemCancellationAuditFromOrderEvent(auditEvent);
  const items = order.items.map((item) => item.status === "pending"
    ? freezeOrderItem({
      ...item,
      status: "cancelled",
      cancellationAudit: automaticallyCancelledItemAudit,
    })
    : item);
  return freezeMutation(
    freezeOrder({ ...order, status, items, cancellationAudit }),
    auditEvent,
  );
}

/** Delegates line lifecycle validation and preserves validated cancellation evidence. */
export function transitionOrderItemStatus(
  order: Order,
  orderItemId: string,
  to: OrderItemState,
  auditContext: OrderAuditContext,
): OrderMutation<OrderItemStateChangedAuditEvent> {
  assertValidOrder(order);
  assertOrderAllowsItemMutation(order.status);
  const item = findItem(order, orderItemId);
  const auditEvent = createOrderItemStateChangedAuditEvent(
    auditScope(order),
    item.orderItemId,
    item.status,
    to,
    auditContext,
  );
  const cancellationAudit = to === "cancelled"
    ? orderItemCancellationAuditFromEvent(auditEvent)
    : undefined;
  const transition = transitionOrderItem(
    item.status,
    to,
    cancellationAudit === undefined ? {} : { cancellationAudit },
  );
  const nextItem = freezeOrderItem({ ...item, status: transition.to, ...(transition.cancellationAudit === undefined ? {} : { cancellationAudit: transition.cancellationAudit }) });
  return freezeMutation(replaceItem(order, nextItem), auditEvent);
}

/** Explicit convenience operation for cancellation; post-send evidence remains mandatory in the state machine. */
export function cancelOrderItem(
  order: Order,
  orderItemId: string,
  auditContext: OrderAuditContext,
): OrderMutation<OrderItemStateChangedAuditEvent> {
  return transitionOrderItemStatus(order, orderItemId, "cancelled", auditContext);
}

/** Uses the existing calculator and deliberately excludes cancelled lines from the payable amount. */
export function calculateOrderAggregateTotals(order: Order): CalculatedOrderTotals {
  assertValidOrder(order);
  return calculateForOrder(order);
}

function calculateForOrder(order: Order): CalculatedOrderTotals {
  if (order.status === "cancelled") {
    // Keep historical snapshots on Order, but a cancelled aggregate is never payable.
    return asDomainValidation(() => calculateOrderTotals({
      currency: order.currency,
      timeZone: order.timeZone,
      lines: [],
    }), "monetary policy");
  }
  return asDomainValidation(() => calculateOrderTotals({
    currency: order.currency,
    timeZone: order.timeZone,
    lines: order.items.filter((item) => item.status !== "cancelled"),
    ...(order.orderDiscount === undefined ? {} : { orderDiscount: order.orderDiscount }),
    ...(order.tip === undefined ? {} : { tip: order.tip }),
  }), "monetary policy");
}

/** Rehydrated aggregates are accepted only when complete, scoped, and deeply immutable. */
function assertValidOrder(order: Order): void {
  if (!isRecord(order)) throw new InvalidOrderAggregateError("order");
  assertStableValueGraph(order, "accessor");
  if (!isDeepFrozen(order)) throw new OrderAggregateNotImmutableError();
  assertOwnDataProperties(
    order,
    ["orderId", "restaurantId", "branchId", "channel", "currency", "timeZone", "status", "items"],
    ["tableId", "orderDiscount", "tip", "cancellationAudit"],
    "order",
  );
  if (order.orderDiscount !== undefined) assertOrderDiscountFacts(order.orderDiscount);
  if (order.tip !== undefined) assertMoneyFacts(order.tip, "tip");
  assertText(order.orderId, "orderId");
  assertText(order.restaurantId, "restaurantId");
  assertText(order.branchId, "branchId");
  assertChannel(order.channel, order.tableId);
  if (!orderStates.has(order.status)) throw new InvalidOrderAggregateError("status");
  if (!Array.isArray(order.items)) throw new InvalidOrderAggregateError("items");

  if (order.status === "cancelled") {
    assertOrderCancellationAudit(order, order.cancellationAudit);
  } else if (order.cancellationAudit !== undefined) {
    throw new InvalidOrderAggregateError("cancellation audit");
  }

  const itemIds = new Set<string>();
  for (const item of order.items) {
    if (!isRecord(item)) throw new InvalidOrderAggregateError("items");
    assertOwnDataProperties(
      item,
      ["orderItemId", "snapshot", "quantity", "restaurantId", "branchId", "status"],
      ["lineDiscount", "cancellationAudit"],
      "item",
    );
    assertOrderItemPricingFacts(item as unknown as OrderItem);
    assertText(item.orderItemId, "orderItemId");
    if (itemIds.has(item.orderItemId)) throw new DuplicateOrderItemIdError(item.orderItemId);
    itemIds.add(item.orderItemId);
    if (item.restaurantId !== order.restaurantId || item.branchId !== order.branchId) throw new OrderItemScopeMismatchError();
    if (typeof item.status !== "string" || !orderItemStates.has(item.status as OrderItemState)) throw new InvalidOrderAggregateError("item status");
    const itemCancellationAudit = item.cancellationAudit as OrderItemCancellationAudit | undefined;
    if (item.status === "cancelled" && itemCancellationAudit === undefined) {
      throw new InvalidOrderAggregateError("cancellation audit");
    }
    if (itemCancellationAudit !== undefined) {
      if (!isRecord(itemCancellationAudit) || itemCancellationAudit.branchId !== order.branchId) {
        throw new OrderItemCancellationScopeMismatchError();
      }
      if (item.status !== "cancelled") throw new InvalidOrderAggregateError("cancellation audit");
      // Reuse the state-machine validation rather than accepting malformed audit history.
      asDomainValidation(
        () => transitionOrderItem(
          itemCancellationAudit.from,
          "cancelled",
          { cancellationAudit: itemCancellationAudit },
        ),
        "cancellation audit",
      );
    }
    const calculated = asDomainValidation(() => calculateOrderItemTotals(item as unknown as OrderItem), "item snapshot");
    asDomainValidation(() => new Money(0, order.currency).add(calculated.total), "item currency");
  }
  if (order.status === "cancelled" && order.items.some((item) => item.status !== "cancelled")) {
    throw new InvalidOrderAggregateError("cancelled items");
  }
  if (order.status === "cancelled") {
    // Validate the historical financial snapshots without making them payable.
    asDomainValidation(() => calculateOrderTotals({
      currency: order.currency,
      timeZone: order.timeZone,
      lines: order.items,
      ...(order.orderDiscount === undefined ? {} : { orderDiscount: order.orderDiscount }),
      ...(order.tip === undefined ? {} : { tip: order.tip }),
    }), "monetary policy");
  }
  calculateForOrder(order);
}

function findItem(order: Order, orderItemId: string): OrderItem {
  const item = order.items.find((candidate) => candidate.orderItemId === orderItemId);
  if (item === undefined) throw new OrderItemNotFoundError(orderItemId);
  return item;
}

function replaceItem(order: Order, item: OrderItem): Order {
  return freezeOrder({ ...order, items: order.items.map((candidate) => candidate.orderItemId === item.orderItemId ? item : candidate) });
}

function auditScope(order: Pick<Order, "restaurantId" | "branchId" | "orderId">) {
  return {
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    orderId: order.orderId,
  };
}

function orderItemCancellationAuditFromEvent(
  event: OrderItemStateChangedAuditEvent,
): OrderItemCancellationAudit {
  const common = {
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    from: event.from as CancellableOrderItemState,
    actorId: event.actorId,
    branchId: event.branchId,
    deviceId: event.deviceId,
    occurredAt: event.occurredAt,
    reason: event.reason!,
  };
  if (event.from === "pending") {
    return deepFreeze({
      ...common,
      from: event.from,
      ...(event.authorization === undefined ? {} : { authorization: event.authorization }),
    });
  }
  if (event.from !== "sent" && event.from !== "preparing" && event.from !== "ready") {
    throw new InvalidOrderAggregateError("cancellation audit");
  }
  return deepFreeze({ ...common, from: event.from, authorization: event.authorization! });
}

function orderItemCancellationAuditFromOrderEvent(
  event: OrderStateChangedAuditEvent,
): OrderItemCancellationAudit {
  return deepFreeze({
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    from: "pending",
    actorId: event.actorId,
    branchId: event.branchId,
    deviceId: event.deviceId,
    occurredAt: event.occurredAt,
    reason: event.reason!,
    authorization: event.authorization!,
  });
}

function orderCancellationAuditFromEvent(
  event: OrderStateChangedAuditEvent,
): OrderCancellationAudit {
  return deepFreeze({
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    from: event.from as "draft" | "open",
    actorId: event.actorId,
    branchId: event.branchId,
    deviceId: event.deviceId,
    occurredAt: event.occurredAt,
    reason: event.reason!,
    authorization: event.authorization!,
  });
}

function assertCancellationScope(order: Order, audit: { readonly branchId: string } | undefined): void {
  if (audit !== undefined && audit.branchId !== order.branchId) throw new OrderItemCancellationScopeMismatchError();
}

function assertOrderCancellationAudit(
  order: Order,
  audit: OrderCancellationAudit | undefined,
): OrderCancellationAudit {
  assertCancellationScope(order, audit);
  if (!isRecord(audit)) throw new InvalidOrderAggregateError("cancellation audit");
  assertOwnDataProperties(
    audit,
    ["eventId", "idempotencyKey", "from", "actorId", "branchId", "deviceId", "occurredAt", "reason", "authorization"],
    [],
    "cancellation audit",
  );
  if (audit.from !== "draft" && audit.from !== "open") {
    throw new InvalidOrderAggregateError("cancellation audit");
  }
  const event = createOrderStateChangedAuditEvent(
    auditScope(order),
    audit.from,
    "cancelled",
    [],
    {
      eventId: audit.eventId,
      idempotencyKey: audit.idempotencyKey,
      actorId: audit.actorId,
      deviceId: audit.deviceId,
      occurredAt: audit.occurredAt,
      reason: audit.reason,
      authorization: audit.authorization,
    },
  );
  return orderCancellationAuditFromEvent(event);
}

function assertOrderCanBeCancelled(order: Order): void {
  const activeItem = order.items.find((item) => item.status !== "pending" && item.status !== "cancelled");
  if (activeItem !== undefined) {
    throw new OrderCancellationRequiresItemCancellationError(activeItem.orderItemId, activeItem.status);
  }
}

function assertOrderCanBeClosed(order: Order): void {
  const incompleteItem = order.items.find((item) => item.status !== "delivered" && item.status !== "cancelled");
  if (incompleteItem !== undefined) {
    throw new OrderClosureRequiresItemCompletionError(incompleteItem.orderItemId, incompleteItem.status);
  }
}

function assertOrderItemPricingFacts(item: OrderItem): void {
  const snapshot = item.snapshot;
  if (!isRecord(snapshot)) throw new InvalidOrderAggregateError("item snapshot");
  assertOwnDataProperties(
    snapshot,
    ["catalogVersion", "productId", "name", "stationId", "unit", "unitPrice", "modifiers"],
    ["sku", "tax"],
    "item snapshot",
  );
  assertMoneyFacts(snapshot.unitPrice, "unit price");
  if (!Array.isArray(snapshot.modifiers)) throw new InvalidOrderAggregateError("modifiers");
  for (const modifier of snapshot.modifiers) assertModifierPricingFacts(modifier);
  if (snapshot.tax !== undefined) assertTaxFacts(snapshot.tax);
  if (item.lineDiscount !== undefined) assertDiscountFacts(item.lineDiscount, "line discount");
}

function assertModifierPricingFacts(modifier: unknown): void {
  if (!isRecord(modifier)) throw new InvalidOrderAggregateError("modifier snapshot");
  assertOwnDataProperties(
    modifier,
    ["modifierId", "name", "unitPrice", "quantity"],
    ["groupId", "groupName", "groupCatalogVersion"],
    "modifier snapshot",
  );
  assertMoneyFacts(modifier.unitPrice, "modifier unit price");
}

function assertTaxFacts(tax: unknown): void {
  if (!isRecord(tax)) throw new InvalidOrderAggregateError("tax snapshot");
  assertOwnDataProperties(tax, ["taxId", "name", "taxRuleVersion", "rate", "inclusion"], [], "tax snapshot");
  if (!isRecord(tax.rate)) throw new InvalidOrderAggregateError("tax rate");
  assertOwnDataProperties(tax.rate, ["numerator", "denominator"], [], "tax rate");
}

function assertDiscountFacts(discount: unknown, field: string): void {
  if (!isRecord(discount)) throw new InvalidOrderAggregateError(field);
  assertOwnDataProperties(discount, ["discountId", "discountRuleVersion", "amount"], [], field);
  assertMoneyFacts(discount.amount, field);
}

function assertOrderDiscountFacts(discount: OrderDiscountSnapshot): void {
  assertDiscountFacts(discount, "order discount");
  assertOwnDataProperties(discount, ["allocationStrategy"], [], "order discount");
}

function assertMoneyFacts(value: unknown, field: string): void {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Money.prototype) {
    throw new InvalidOrderAggregateError(field);
  }
  assertOwnDataProperties(value, ["amountMinor", "currency"], [], field);
}

function assertOrderAllowsItemMutation(status: OrderState): void {
  if (status === "closed" || status === "cancelled") {
    throw new OrderItemMutationNotAllowedError(status);
  }
}

const orderStates: ReadonlySet<OrderState> = new Set(["draft", "open", "partially_paid", "paid", "closed", "cancelled"]);
const orderItemStates: ReadonlySet<OrderItemState> = new Set(["pending", "sent", "preparing", "ready", "delivered", "cancelled"]);
const orderChannels: ReadonlySet<OrderChannel> = new Set(["table", "counter", "takeout", "delivery"]);

function assertChannel(channel: unknown, tableId: unknown): asserts channel is OrderChannel {
  if (typeof channel !== "string" || !orderChannels.has(channel as OrderChannel)) throw new InvalidOrderChannelError(channel);
  if (channel === "table") {
    if (typeof tableId !== "string" || tableId.trim().length === 0) throw new InvalidOrderTableAssignmentError(channel);
  } else if (tableId !== undefined) {
    throw new InvalidOrderTableAssignmentError(channel);
  }
}

function assertText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new InvalidSnapshotError(field);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidOrderAggregateError(field);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Reject dynamic property access before revalidation reads any aggregate fact. */
function assertStableValueGraph(value: unknown, field: string, seen = new WeakSet<object>()): void {
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    assertAllowedValuePrototype(value, field);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new InvalidOrderAggregateError(field);
  }
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new InvalidOrderAggregateError(field);
    }
    assertStableValueGraph(descriptor.value, field, seen);
  }
}

/**
 * Rehydrated facts may contain plain records, arrays, or the immutable Money
 * value object. Any other prototype can provide inherited getters whose value
 * changes after the aggregate has been validated.
 */
function assertAllowedValuePrototype(value: object, field: string): void {
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype
    && prototype !== null
    && prototype !== Array.prototype
    && prototype !== Money.prototype
  ) {
    throw new InvalidOrderAggregateError(field);
  }
}

/** Ensures domain facts read below are present as immutable own data, never inherited behavior. */
function assertOwnDataProperties(
  value: object,
  required: readonly string[],
  optional: readonly string[],
  field: string,
): void {
  for (const property of required) {
    assertOwnDataProperty(value, property, field, true);
  }
  for (const property of optional) {
    assertOwnDataProperty(value, property, field, false);
  }
}

function assertOwnDataProperty(value: object, property: string, field: string, required: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) {
    if (required || property in value) throw new InvalidOrderAggregateError(field);
    return;
  }
  if (descriptor.get !== undefined || descriptor.set !== undefined) throw new InvalidOrderAggregateError(field);
}

function asDomainValidation<T>(operation: () => T, field: string): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new InvalidOrderAggregateError(field);
  }
}

function freezeOrderItem(item: OrderItem): OrderItem { return deepFreeze(item); }
function freezeOrder(order: Order): Order { return deepFreeze(order); }
function freezeMutation<TEvent extends OrderAuditEvent>(order: Order, auditEvent: TEvent): OrderMutation<TEvent> {
  return deepFreeze({ order, auditEvent });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (isRecord(value) && !seen.has(value)) {
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get === undefined && descriptor.set === undefined) deepFreeze(descriptor.value, seen);
    }
    Object.freeze(value);
  }
  return value;
}

function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!isRecord(value)) return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
    descriptor.get === undefined && descriptor.set === undefined && isDeepFrozen(descriptor.value, seen));
}
