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
  type OrderItemCancellationAudit,
  type OrderItemState,
  type OrderItemTransitionContext,
  type OrderState,
} from "./order-state.js";
import { Money } from "./money.js";

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

/** Aggregate-cancellation evidence mirrors the sensitive line-cancellation record. */
export type OrderCancellationAudit = OrderItemCancellationAudit;

export interface OrderTransitionContext {
  readonly cancellationAudit?: OrderCancellationAudit;
}

/** Creates a draft order after validating and freezing its monetary and channel facts. */
export function createOrder(input: CreateOrderInput): Order {
  assertRecord(input, "order");
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

  return freezeOrder({
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
}

/** The aggregate-facing predicate delegates the shared state rule after fail-closed revalidation. */
export function canAddOrderItem(order: Order): boolean {
  assertValidOrder(order);
  return orderAcceptsNewLines(order.status);
}

/** Adds one pending, tenant-scoped line and returns a new immutable aggregate. */
export function addOrderItem(order: Order, input: AddOrderItemInput): Order {
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
  return freezeOrder({ ...order, items: [...order.items, item] });
}

/**
 * Delegates lifecycle validation and makes aggregate cancellation all-or-nothing.
 * The application layer owns Payment linkage and persisted table scope; this pure
 * aggregate only enforces the cancellation facts it already contains.
 */
export function transitionOrderStatus(
  order: Order,
  to: OrderState,
  context: OrderTransitionContext = {},
): Order {
  assertValidOrder(order);
  const status = transitionOrder(order.status, to);
  if (status === "closed") {
    assertOrderCanBeClosed(order);
    return freezeOrder({ ...order, status });
  }
  if (status !== "cancelled") return freezeOrder({ ...order, status });

  const cancellationAudit = assertOrderCancellationAudit(order, context.cancellationAudit);
  assertOrderCanBeCancelled(order);
  const items = order.items.map((item) => item.status === "pending"
    ? freezeOrderItem({ ...item, status: "cancelled" })
    : item);
  return freezeOrder({ ...order, status, items, cancellationAudit });
}

/** Delegates line lifecycle validation and preserves validated cancellation evidence. */
export function transitionOrderItemStatus(order: Order, orderItemId: string, to: OrderItemState, context: OrderItemTransitionContext = {}): Order {
  assertValidOrder(order);
  assertOrderAllowsItemMutation(order.status);
  const item = findItem(order, orderItemId);
  if (to === "cancelled" && item.status !== "pending") {
    assertCancellationScope(order, context.cancellationAudit);
  }
  const transition = transitionOrderItem(item.status, to, context);
  const nextItem = freezeOrderItem({ ...item, status: transition.to, ...(transition.cancellationAudit === undefined ? {} : { cancellationAudit: transition.cancellationAudit }) });
  return replaceItem(order, nextItem);
}

/** Explicit convenience operation for cancellation; post-send evidence remains mandatory in the state machine. */
export function cancelOrderItem(order: Order, orderItemId: string, context: OrderItemTransitionContext = {}): Order {
  assertValidOrder(order);
  return transitionOrderItemStatus(order, orderItemId, "cancelled", context);
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
    if (item.cancellationAudit !== undefined) {
      if (!isRecord(item.cancellationAudit) || item.cancellationAudit.branchId !== order.branchId) {
        throw new OrderItemCancellationScopeMismatchError();
      }
      if (item.status !== "cancelled") throw new InvalidOrderAggregateError("cancellation audit");
      // Reuse the state-machine validation rather than accepting malformed audit history.
      asDomainValidation(
        () => transitionOrderItem("sent", "cancelled", { cancellationAudit: item.cancellationAudit as unknown as OrderItemCancellationAudit }),
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

function assertCancellationScope(order: Order, audit: OrderItemCancellationAudit | undefined): void {
  if (audit !== undefined && audit.branchId !== order.branchId) throw new OrderItemCancellationScopeMismatchError();
}

function assertOrderCancellationAudit(
  order: Order,
  audit: OrderCancellationAudit | undefined,
): OrderCancellationAudit {
  assertCancellationScope(order, audit);
  return asDomainValidation(() => transitionOrderItem(
    "sent",
    "cancelled",
    audit === undefined ? {} : { cancellationAudit: audit },
  ).cancellationAudit!, "cancellation audit");
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
