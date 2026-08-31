import {
  DomainError,
  InvalidOrderAuditContextError,
  OrderAuditAuthorizationRequiredError,
  OrderAuditReasonRequiredError,
} from "./errors.js";
import type { CancellationAuthorization, OrderItemState, OrderState } from "./order-state.js";

export const ORDER_AUDIT_SCHEMA_VERSION = 1 as const;

/** Caller-supplied facts. Tenant, entity, operation and state are always derived by domain code. */
export interface OrderAuditContext {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly deviceId: string;
  /** Device-declared UTC instant. Persistence must add its own authoritative receivedAt. */
  readonly occurredAt: string;
  readonly reason?: string;
  readonly authorization?: CancellationAuthorization;
}

export interface OrderAuditScope {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
}

interface OrderAuditEventBase {
  readonly schemaVersion: typeof ORDER_AUDIT_SCHEMA_VERSION;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly orderId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason?: string;
  readonly authorization?: CancellationAuthorization;
}

export interface OrderCreatedAuditEvent extends OrderAuditEventBase {
  readonly operation: "order.created";
  readonly entityType: "order";
  readonly entityId: string;
  readonly to: "draft";
}

export interface OrderItemAddedAuditEvent extends OrderAuditEventBase {
  readonly operation: "order.item_added";
  readonly entityType: "order_item";
  readonly entityId: string;
  readonly orderItemId: string;
}

export interface OrderStateChangedAuditEvent extends OrderAuditEventBase {
  readonly operation: "order.state_changed";
  readonly entityType: "order";
  readonly entityId: string;
  readonly from: OrderState;
  readonly to: OrderState;
  readonly automaticallyCancelledOrderItemIds: readonly string[];
}

export interface OrderItemStateChangedAuditEvent extends OrderAuditEventBase {
  readonly operation: "order_item.state_changed";
  readonly entityType: "order_item";
  readonly entityId: string;
  readonly orderItemId: string;
  readonly from: OrderItemState;
  readonly to: OrderItemState;
}

export type OrderAuditEvent =
  | OrderCreatedAuditEvent
  | OrderItemAddedAuditEvent
  | OrderStateChangedAuditEvent
  | OrderItemStateChangedAuditEvent;

export function createOrderCreatedAuditEvent(
  scopeValue: OrderAuditScope,
  contextValue: OrderAuditContext,
): OrderCreatedAuditEvent {
  return atAuditBoundary("created event", () => {
    const scope = normalizeScope(scopeValue);
    const context = normalizeContext(contextValue);
    return deepFreeze({
      ...baseEvent(scope, context),
      operation: "order.created" as const,
      entityType: "order" as const,
      entityId: scope.orderId,
      to: "draft" as const,
    });
  });
}

export function createOrderItemAddedAuditEvent(
  scopeValue: OrderAuditScope,
  orderItemIdValue: string,
  contextValue: OrderAuditContext,
): OrderItemAddedAuditEvent {
  return atAuditBoundary("item-added event", () => {
    const scope = normalizeScope(scopeValue);
    const orderItemId = normalizeText(orderItemIdValue, "orderItemId");
    const context = normalizeContext(contextValue);
    return deepFreeze({
      ...baseEvent(scope, context),
      operation: "order.item_added" as const,
      entityType: "order_item" as const,
      entityId: orderItemId,
      orderItemId,
    });
  });
}

export function createOrderStateChangedAuditEvent(
  scopeValue: OrderAuditScope,
  fromValue: OrderState,
  toValue: OrderState,
  automaticallyCancelledOrderItemIdsValue: readonly string[],
  contextValue: OrderAuditContext,
): OrderStateChangedAuditEvent {
  return atAuditBoundary("order-state event", () => {
    const scope = normalizeScope(scopeValue);
    const from = normalizeOrderState(fromValue, "from");
    const to = normalizeOrderState(toValue, "to");
    const context = normalizeContext(contextValue);
    if (to === "cancelled") assertSensitiveCancellation(context, "order.state_changed", true);
    const automaticallyCancelledOrderItemIds = normalizeUniqueTextArray(
      automaticallyCancelledOrderItemIdsValue,
      "automaticallyCancelledOrderItemIds",
    );
    if (to !== "cancelled" && automaticallyCancelledOrderItemIds.length !== 0) {
      throw new InvalidOrderAuditContextError("automaticallyCancelledOrderItemIds");
    }
    return deepFreeze({
      ...baseEvent(scope, context),
      operation: "order.state_changed" as const,
      entityType: "order" as const,
      entityId: scope.orderId,
      from,
      to,
      automaticallyCancelledOrderItemIds,
    });
  });
}

export function createOrderItemStateChangedAuditEvent(
  scopeValue: OrderAuditScope,
  orderItemIdValue: string,
  fromValue: OrderItemState,
  toValue: OrderItemState,
  contextValue: OrderAuditContext,
): OrderItemStateChangedAuditEvent {
  return atAuditBoundary("order-item-state event", () => {
    const scope = normalizeScope(scopeValue);
    const orderItemId = normalizeText(orderItemIdValue, "orderItemId");
    const from = normalizeOrderItemState(fromValue, "from");
    const to = normalizeOrderItemState(toValue, "to");
    const context = normalizeContext(contextValue);
    if (to === "cancelled") {
      assertSensitiveCancellation(context, "order_item.state_changed", from !== "pending");
    }
    return deepFreeze({
      ...baseEvent(scope, context),
      operation: "order_item.state_changed" as const,
      entityType: "order_item" as const,
      entityId: orderItemId,
      orderItemId,
      from,
      to,
    });
  });
}

function baseEvent(scope: OrderAuditScope, context: OrderAuditContext): OrderAuditEventBase {
  return {
    schemaVersion: ORDER_AUDIT_SCHEMA_VERSION,
    eventId: context.eventId,
    idempotencyKey: context.idempotencyKey,
    restaurantId: scope.restaurantId,
    branchId: scope.branchId,
    orderId: scope.orderId,
    actorId: context.actorId,
    deviceId: context.deviceId,
    occurredAt: context.occurredAt,
    ...(context.reason === undefined ? {} : { reason: context.reason }),
    ...(context.authorization === undefined ? {} : { authorization: context.authorization }),
  };
}

function normalizeScope(value: unknown): OrderAuditScope {
  const scope = asPlainRecord(value, "scope");
  return Object.freeze({
    restaurantId: normalizeText(ownData(scope, "restaurantId", "restaurantId"), "restaurantId"),
    branchId: normalizeText(ownData(scope, "branchId", "branchId"), "branchId"),
    orderId: normalizeText(ownData(scope, "orderId", "orderId"), "orderId"),
  });
}

function normalizeContext(value: unknown): OrderAuditContext {
  const context = asPlainRecord(value, "context");
  const reasonValue = optionalOwnData(context, "reason", "reason");
  const authorizationValue = optionalOwnData(context, "authorization", "authorization");
  const occurredAt = normalizeText(ownData(context, "occurredAt", "occurredAt"), "occurredAt");
  assertUtcInstant(occurredAt);
  return deepFreeze({
    eventId: normalizeText(ownData(context, "eventId", "eventId"), "eventId"),
    idempotencyKey: normalizeText(ownData(context, "idempotencyKey", "idempotencyKey"), "idempotencyKey"),
    actorId: normalizeText(ownData(context, "actorId", "actorId"), "actorId"),
    deviceId: normalizeText(ownData(context, "deviceId", "deviceId"), "deviceId"),
    occurredAt,
    ...(reasonValue === undefined ? {} : { reason: normalizeText(reasonValue, "reason") }),
    ...(authorizationValue === undefined ? {} : { authorization: normalizeAuthorization(authorizationValue) }),
  });
}

function normalizeAuthorization(value: unknown): CancellationAuthorization {
  const authorization = asPlainRecord(value, "authorization");
  if (ownData(authorization, "approved", "authorization.approved") !== true) {
    throw new InvalidOrderAuditContextError("authorization.approved");
  }
  return Object.freeze({
    approved: true,
    actorId: normalizeText(ownData(authorization, "actorId", "authorization.actorId"), "authorization.actorId"),
  });
}

function assertSensitiveCancellation(
  context: OrderAuditContext,
  operation: string,
  authorizationRequired: boolean,
): void {
  if (context.reason === undefined) throw new OrderAuditReasonRequiredError(operation);
  if (authorizationRequired && context.authorization === undefined) {
    throw new OrderAuditAuthorizationRequiredError(operation);
  }
}

function normalizeOrderState(value: unknown, field: string): OrderState {
  if (typeof value !== "string" || !orderStates.has(value as OrderState)) {
    throw new InvalidOrderAuditContextError(field);
  }
  return value as OrderState;
}

function normalizeOrderItemState(value: unknown, field: string): OrderItemState {
  if (typeof value !== "string" || !orderItemStates.has(value as OrderItemState)) {
    throw new InvalidOrderAuditContextError(field);
  }
  return value as OrderItemState;
}

function normalizeUniqueTextArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new InvalidOrderAuditContextError(field);
  }
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (length === undefined || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) {
    throw new InvalidOrderAuditContextError(field);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length.value; index += 1) {
    const item = normalizeText(ownData(value as unknown as Record<string, unknown>, String(index), field), field);
    if (seen.has(item)) throw new InvalidOrderAuditContextError(field);
    seen.add(item);
    normalized.push(item);
  }
  return Object.freeze(normalized.sort(compareCodeUnits));
}

function assertUtcInstant(value: string): void {
  if (!value.endsWith("Z")) throw new InvalidOrderAuditContextError("occurredAt");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new InvalidOrderAuditContextError("occurredAt");
  const canonical = parsed.toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    throw new InvalidOrderAuditContextError("occurredAt");
  }
}

function normalizeText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidOrderAuditContextError(field);
  }
  return value;
}

function asPlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidOrderAuditContextError(field);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidOrderAuditContextError(field);
  return value as Record<string, unknown>;
}

function ownData(record: Record<string, unknown>, key: string, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidOrderAuditContextError(field);
  return descriptor.value;
}

function optionalOwnData(record: Record<string, unknown>, key: string, field: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new InvalidOrderAuditContextError(field);
  return descriptor.value;
}

function atAuditBoundary<T>(field: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new InvalidOrderAuditContextError(field);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get === undefined && descriptor.set === undefined) deepFreeze(descriptor.value, seen);
    }
    Object.freeze(value);
  }
  return value;
}

const orderStates: ReadonlySet<OrderState> = new Set([
  "draft",
  "open",
  "partially_paid",
  "paid",
  "closed",
  "cancelled",
]);
const orderItemStates: ReadonlySet<OrderItemState> = new Set([
  "pending",
  "sent",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
]);
