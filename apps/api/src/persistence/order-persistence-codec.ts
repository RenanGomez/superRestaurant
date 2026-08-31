import { types as nodeTypes } from "node:util";

import {
  Money,
  ORDER_AUDIT_SCHEMA_VERSION,
  calculateOrderAggregateTotals,
  transitionOrder,
  transitionOrderItem,
  type AppliedDiscountSnapshot,
  type CancellationAuthorization,
  type ExactRatio,
  type ModifierPriceSnapshot,
  type Order,
  type OrderAuditEvent,
  type OrderCancellationAudit,
  type OrderDiscountSnapshot,
  type OrderItem,
  type OrderItemCancellationAudit,
  type OrderItemPriceSnapshot,
  type OrderMutation,
  type TaxSnapshot,
} from "@super-restaurant/domain";

export const ORDER_PERSISTENCE_SCHEMA_VERSION = 1 as const;

export class OrderPersistenceCodecError extends Error {
  public constructor(field: string) {
    super(`Invalid persisted order data: ${field}.`);
    this.name = "OrderPersistenceCodecError";
  }
}

export interface PersistedMoneyV1 {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface PersistedExactRatioV1 {
  readonly numerator: string;
  readonly denominator: string;
}

export interface PersistedAuthorizationV1 {
  readonly approved: true;
  readonly actorId: string;
}

export interface PersistedCancellationAuditV1 {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly from: "pending" | "sent" | "preparing" | "ready";
  readonly actorId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason: string;
  readonly authorization?: PersistedAuthorizationV1;
}

export interface PersistedOrderCancellationAuditV1 {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly from: "draft" | "open";
  readonly actorId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason: string;
  readonly authorization: PersistedAuthorizationV1;
}

export interface PersistedModifierPriceSnapshotV1 {
  readonly modifierId: string;
  readonly name: string;
  readonly groupId?: string;
  readonly groupName?: string;
  readonly groupCatalogVersion?: string;
  readonly unitPrice: PersistedMoneyV1;
  readonly quantity: number;
}

export interface PersistedTaxSnapshotV1 {
  readonly taxId: string;
  readonly name: string;
  readonly taxRuleVersion: string;
  readonly rate: PersistedExactRatioV1;
  readonly inclusion: "included" | "excluded";
}

export interface PersistedDiscountSnapshotV1 {
  readonly discountId: string;
  readonly discountRuleVersion: string;
  readonly amount: PersistedMoneyV1;
}

export interface PersistedOrderDiscountSnapshotV1 extends PersistedDiscountSnapshotV1 {
  readonly allocationStrategy: OrderDiscountSnapshot["allocationStrategy"];
}

export interface PersistedOrderItemPriceSnapshotV1 {
  readonly catalogVersion: string;
  readonly productId: string;
  readonly name: string;
  readonly sku?: string;
  readonly stationId: string;
  readonly unit: string;
  readonly unitPrice: PersistedMoneyV1;
  readonly modifiers: readonly PersistedModifierPriceSnapshotV1[];
  readonly tax?: PersistedTaxSnapshotV1;
}

export interface PersistedOrderItemV1 {
  readonly orderItemId: string;
  readonly snapshot: PersistedOrderItemPriceSnapshotV1;
  readonly quantity: number;
  readonly lineDiscount?: PersistedDiscountSnapshotV1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly status: OrderItem["status"];
  readonly cancellationAudit?: PersistedCancellationAuditV1;
}

export interface PersistedOrderV1 {
  readonly schemaVersion: typeof ORDER_PERSISTENCE_SCHEMA_VERSION;
  readonly orderId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly channel: Order["channel"];
  readonly tableId?: string;
  readonly currency: string;
  readonly timeZone: string;
  readonly status: Order["status"];
  readonly items: readonly PersistedOrderItemV1[];
  readonly orderDiscount?: PersistedOrderDiscountSnapshotV1;
  readonly tip?: PersistedMoneyV1;
  readonly cancellationAudit?: PersistedOrderCancellationAuditV1;
}

type PersistedAuditCommonV1 = {
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
  readonly authorization?: PersistedAuthorizationV1;
};

export type PersistedOrderAuditEventV1 = PersistedAuditCommonV1 & (
  | {
    readonly operation: "order.created";
    readonly entityType: "order";
    readonly entityId: string;
    readonly to: "draft";
  }
  | {
    readonly operation: "order.item_added";
    readonly entityType: "order_item";
    readonly entityId: string;
    readonly orderItemId: string;
  }
  | {
    readonly operation: "order.state_changed";
    readonly entityType: "order";
    readonly entityId: string;
    readonly from: Order["status"];
    readonly to: Order["status"];
    readonly automaticallyCancelledOrderItemIds: readonly string[];
  }
  | {
    readonly operation: "order_item.state_changed";
    readonly entityType: "order_item";
    readonly entityId: string;
    readonly orderItemId: string;
    readonly from: OrderItem["status"];
    readonly to: OrderItem["status"];
  }
);

export interface PersistedOrderMutationV1 {
  readonly order: PersistedOrderV1;
  readonly auditEvent: PersistedOrderAuditEventV1;
}

const commonAuditKeys = [
  "schemaVersion", "eventId", "idempotencyKey", "restaurantId", "branchId", "orderId",
  "actorId", "deviceId", "occurredAt",
] as const;

const commonAuditOptionalKeys = ["reason", "authorization"] as const;

/** Serializes a validated aggregate without leaking Money instances or bigint ratios. */
export function encodeOrderRecord(order: Order): PersistedOrderV1 {
  atCodecBoundary(() => {
    assertStableTree(order, "order", true);
    calculateOrderAggregateTotals(order);
  });
  return deepFreeze({
    schemaVersion: ORDER_PERSISTENCE_SCHEMA_VERSION,
    orderId: order.orderId,
    restaurantId: order.restaurantId,
    branchId: order.branchId,
    channel: order.channel,
    ...(order.tableId === undefined ? {} : { tableId: order.tableId }),
    currency: order.currency,
    timeZone: order.timeZone,
    status: order.status,
    items: order.items.map(encodeOrderItem),
    ...(order.orderDiscount === undefined ? {} : { orderDiscount: encodeOrderDiscount(order.orderDiscount) }),
    ...(order.tip === undefined ? {} : { tip: encodeMoney(order.tip) }),
    ...(order.cancellationAudit === undefined
      ? {}
      : { cancellationAudit: encodeOrderCancellationAudit(order.cancellationAudit) }),
  });
}

/** Rehydrates a detached, deeply frozen aggregate and delegates invariant checks to the domain. */
export function decodeOrderRecord(value: unknown): Order {
  return atCodecBoundary(() => {
    assertStableTree(value, "order record", false);
    const record = exactRecord(value, [
      "schemaVersion", "orderId", "restaurantId", "branchId", "channel", "currency", "timeZone", "status", "items",
    ], ["tableId", "orderDiscount", "tip", "cancellationAudit"], "order record");
    assertVersion(data(record, "schemaVersion"));
    const order = deepFreeze({
      orderId: text(data(record, "orderId"), "orderId"),
      restaurantId: text(data(record, "restaurantId"), "restaurantId"),
      branchId: text(data(record, "branchId"), "branchId"),
      channel: data(record, "channel") as Order["channel"],
      ...(optionalData(record, "tableId") === undefined
        ? {}
        : { tableId: text(optionalData(record, "tableId"), "tableId") }),
      currency: text(data(record, "currency"), "currency"),
      timeZone: text(data(record, "timeZone"), "timeZone"),
      status: data(record, "status") as Order["status"],
      items: dataArray(data(record, "items"), "items").map(decodeOrderItem),
      ...(optionalData(record, "orderDiscount") === undefined
        ? {}
        : { orderDiscount: decodeOrderDiscount(optionalData(record, "orderDiscount")) }),
      ...(optionalData(record, "tip") === undefined ? {} : { tip: decodeMoney(optionalData(record, "tip"), "tip") }),
      ...(optionalData(record, "cancellationAudit") === undefined
        ? {}
        : { cancellationAudit: decodeOrderCancellationAudit(optionalData(record, "cancellationAudit")) }),
    }) as Order;
    calculateOrderAggregateTotals(order);
    return order;
  });
}

export function encodeOrderAuditEventRecord(event: OrderAuditEvent): PersistedOrderAuditEventV1 {
  return atCodecBoundary(() => {
    assertStableTree(event, "audit event", false);
    return copyAuditEvent(decodeOrderAuditEventRecord(event));
  });
}

/** Rehydrates only canonical v1 events and validates lifecycle transitions through the domain. */
export function decodeOrderAuditEventRecord(value: unknown): OrderAuditEvent {
  return atCodecBoundary(() => {
    assertStableTree(value, "audit event", false);
    const operationRecord = exactRecordWithOperation(value);
    const operation = text(data(operationRecord, "operation"), "operation");
    const common = decodeAuditCommon(operationRecord);

    if (operation === "order.created") {
      exactKeys(operationRecord, [...commonAuditKeys, "operation", "entityType", "entityId", "to"], commonAuditOptionalKeys, "created event");
      if (data(operationRecord, "entityType") !== "order" || data(operationRecord, "entityId") !== common.orderId
        || data(operationRecord, "to") !== "draft") fail("created event divergence");
      return deepFreeze({ ...common, operation, entityType: "order", entityId: common.orderId, to: "draft" });
    }

    if (operation === "order.item_added") {
      exactKeys(operationRecord, [...commonAuditKeys, "operation", "entityType", "entityId", "orderItemId"], commonAuditOptionalKeys, "item-added event");
      const orderItemId = text(data(operationRecord, "orderItemId"), "orderItemId");
      if (data(operationRecord, "entityType") !== "order_item" || data(operationRecord, "entityId") !== orderItemId) {
        fail("item-added event divergence");
      }
      return deepFreeze({ ...common, operation, entityType: "order_item", entityId: orderItemId, orderItemId });
    }

    if (operation === "order.state_changed") {
      exactKeys(operationRecord, [...commonAuditKeys, "operation", "entityType", "entityId", "from", "to", "automaticallyCancelledOrderItemIds"], commonAuditOptionalKeys, "order-state event");
      if (data(operationRecord, "entityType") !== "order" || data(operationRecord, "entityId") !== common.orderId) {
        fail("order-state event divergence");
      }
      const from = data(operationRecord, "from") as Order["status"];
      const to = data(operationRecord, "to") as Order["status"];
      transitionOrder(from, to);
      const automaticallyCancelledOrderItemIds = uniqueTexts(
        dataArray(data(operationRecord, "automaticallyCancelledOrderItemIds"), "automaticallyCancelledOrderItemIds"),
        "automaticallyCancelledOrderItemIds",
      );
      if (to !== "cancelled" && automaticallyCancelledOrderItemIds.length !== 0) fail("automatic cancellations");
      if (to === "cancelled" && (common.reason === undefined || common.authorization === undefined)) {
        fail("order cancellation evidence");
      }
      return deepFreeze({ ...common, operation, entityType: "order", entityId: common.orderId, from, to, automaticallyCancelledOrderItemIds });
    }

    if (operation === "order_item.state_changed") {
      exactKeys(operationRecord, [...commonAuditKeys, "operation", "entityType", "entityId", "orderItemId", "from", "to"], commonAuditOptionalKeys, "order-item-state event");
      const orderItemId = text(data(operationRecord, "orderItemId"), "orderItemId");
      if (data(operationRecord, "entityType") !== "order_item" || data(operationRecord, "entityId") !== orderItemId) {
        fail("order-item-state event divergence");
      }
      const from = data(operationRecord, "from") as OrderItem["status"];
      const to = data(operationRecord, "to") as OrderItem["status"];
      if (to === "cancelled") {
        const cancellationAudit = eventCancellationAudit(common, from);
        transitionOrderItem(from, to, { cancellationAudit });
      } else {
        transitionOrderItem(from, to);
      }
      return deepFreeze({ ...common, operation, entityType: "order_item", entityId: orderItemId, orderItemId, from, to });
    }

    return fail("operation");
  });
}

export function encodeOrderMutationRecord(mutation: OrderMutation): PersistedOrderMutationV1 {
  return atCodecBoundary(() => {
    const record = deepFreeze({
      order: encodeOrderRecord(mutation.order),
      auditEvent: encodeOrderAuditEventRecord(mutation.auditEvent),
    });
    assertMutationConsistency(mutation.order, mutation.auditEvent);
    return record;
  });
}

export function decodeOrderMutationRecord(value: unknown): OrderMutation {
  return atCodecBoundary(() => {
    assertStableTree(value, "order mutation", false);
    const record = exactRecord(value, ["order", "auditEvent"], [], "order mutation");
    const mutation = deepFreeze({
      order: decodeOrderRecord(data(record, "order")),
      auditEvent: decodeOrderAuditEventRecord(data(record, "auditEvent")),
    });
    assertMutationConsistency(mutation.order, mutation.auditEvent);
    return mutation;
  });
}

function encodeOrderItem(item: OrderItem): PersistedOrderItemV1 {
  return deepFreeze({
    orderItemId: item.orderItemId,
    snapshot: encodePriceSnapshot(item.snapshot),
    quantity: item.quantity,
    ...(item.lineDiscount === undefined ? {} : { lineDiscount: encodeDiscount(item.lineDiscount) }),
    restaurantId: item.restaurantId,
    branchId: item.branchId,
    status: item.status,
    ...(item.cancellationAudit === undefined ? {} : { cancellationAudit: encodeCancellationAudit(item.cancellationAudit) }),
  });
}

function decodeOrderItem(value: unknown): OrderItem {
  const record = exactRecord(value, ["orderItemId", "snapshot", "quantity", "restaurantId", "branchId", "status"], ["lineDiscount", "cancellationAudit"], "order item");
  const quantity = safeInteger(data(record, "quantity"), "quantity");
  return deepFreeze({
    orderItemId: text(data(record, "orderItemId"), "orderItemId"),
    snapshot: decodePriceSnapshot(data(record, "snapshot")),
    quantity,
    ...(optionalData(record, "lineDiscount") === undefined ? {} : { lineDiscount: decodeDiscount(optionalData(record, "lineDiscount"), "line discount") }),
    restaurantId: text(data(record, "restaurantId"), "restaurantId"),
    branchId: text(data(record, "branchId"), "branchId"),
    status: data(record, "status") as OrderItem["status"],
    ...(optionalData(record, "cancellationAudit") === undefined ? {} : { cancellationAudit: decodeCancellationAudit(optionalData(record, "cancellationAudit")) }),
  });
}

function encodePriceSnapshot(snapshot: OrderItemPriceSnapshot): PersistedOrderItemPriceSnapshotV1 {
  return deepFreeze({
    catalogVersion: snapshot.catalogVersion,
    productId: snapshot.productId,
    name: snapshot.name,
    ...(snapshot.sku === undefined ? {} : { sku: snapshot.sku }),
    stationId: snapshot.stationId,
    unit: snapshot.unit,
    unitPrice: encodeMoney(snapshot.unitPrice),
    modifiers: snapshot.modifiers.map(encodeModifier),
    ...(snapshot.tax === undefined ? {} : { tax: encodeTax(snapshot.tax) }),
  });
}

function decodePriceSnapshot(value: unknown): OrderItemPriceSnapshot {
  const record = exactRecord(value, ["catalogVersion", "productId", "name", "stationId", "unit", "unitPrice", "modifiers"], ["sku", "tax"], "price snapshot");
  return deepFreeze({
    catalogVersion: text(data(record, "catalogVersion"), "catalogVersion"),
    productId: text(data(record, "productId"), "productId"),
    name: text(data(record, "name"), "name"),
    ...(optionalData(record, "sku") === undefined ? {} : { sku: text(optionalData(record, "sku"), "sku") }),
    stationId: text(data(record, "stationId"), "stationId"),
    unit: text(data(record, "unit"), "unit"),
    unitPrice: decodeMoney(data(record, "unitPrice"), "unit price"),
    modifiers: dataArray(data(record, "modifiers"), "modifiers").map(decodeModifier),
    ...(optionalData(record, "tax") === undefined ? {} : { tax: decodeTax(optionalData(record, "tax")) }),
  });
}

function encodeModifier(modifier: ModifierPriceSnapshot): PersistedModifierPriceSnapshotV1 {
  return deepFreeze({
    modifierId: modifier.modifierId,
    name: modifier.name,
    ...(modifier.groupId === undefined ? {} : { groupId: modifier.groupId }),
    ...(modifier.groupName === undefined ? {} : { groupName: modifier.groupName }),
    ...(modifier.groupCatalogVersion === undefined ? {} : { groupCatalogVersion: modifier.groupCatalogVersion }),
    unitPrice: encodeMoney(modifier.unitPrice),
    quantity: modifier.quantity,
  });
}

function decodeModifier(value: unknown): ModifierPriceSnapshot {
  const record = exactRecord(value, ["modifierId", "name", "unitPrice", "quantity"], ["groupId", "groupName", "groupCatalogVersion"], "modifier");
  return deepFreeze({
    modifierId: text(data(record, "modifierId"), "modifierId"),
    name: text(data(record, "name"), "modifier name"),
    ...(optionalData(record, "groupId") === undefined ? {} : { groupId: text(optionalData(record, "groupId"), "groupId") }),
    ...(optionalData(record, "groupName") === undefined ? {} : { groupName: text(optionalData(record, "groupName"), "groupName") }),
    ...(optionalData(record, "groupCatalogVersion") === undefined ? {} : { groupCatalogVersion: text(optionalData(record, "groupCatalogVersion"), "groupCatalogVersion") }),
    unitPrice: decodeMoney(data(record, "unitPrice"), "modifier unit price"),
    quantity: safeInteger(data(record, "quantity"), "modifier quantity"),
  });
}

function encodeTax(tax: TaxSnapshot): PersistedTaxSnapshotV1 {
  return deepFreeze({ taxId: tax.taxId, name: tax.name, taxRuleVersion: tax.taxRuleVersion, rate: encodeRatio(tax.rate), inclusion: tax.inclusion });
}

function decodeTax(value: unknown): TaxSnapshot {
  const record = exactRecord(value, ["taxId", "name", "taxRuleVersion", "rate", "inclusion"], [], "tax");
  return deepFreeze({
    taxId: text(data(record, "taxId"), "taxId"),
    name: text(data(record, "name"), "tax name"),
    taxRuleVersion: text(data(record, "taxRuleVersion"), "taxRuleVersion"),
    rate: decodeRatio(data(record, "rate")),
    inclusion: data(record, "inclusion") as TaxSnapshot["inclusion"],
  });
}

function encodeRatio(ratio: ExactRatio): PersistedExactRatioV1 {
  return deepFreeze({ numerator: ratio.numerator.toString(10), denominator: ratio.denominator.toString(10) });
}

function decodeRatio(value: unknown): ExactRatio {
  const record = exactRecord(value, ["numerator", "denominator"], [], "ratio");
  const numerator = decimalInteger(data(record, "numerator"), true, "ratio numerator");
  const denominator = decimalInteger(data(record, "denominator"), false, "ratio denominator");
  return deepFreeze({ numerator, denominator });
}

function encodeMoney(money: Money): PersistedMoneyV1 {
  return deepFreeze({ amountMinor: money.amountMinor, currency: money.currency });
}

function decodeMoney(value: unknown, field: string): Money {
  const record = exactRecord(value, ["amountMinor", "currency"], [], field);
  return new Money(safeInteger(data(record, "amountMinor"), `${field} amountMinor`), text(data(record, "currency"), `${field} currency`));
}

function encodeDiscount(discount: AppliedDiscountSnapshot): PersistedDiscountSnapshotV1 {
  return deepFreeze({ discountId: discount.discountId, discountRuleVersion: discount.discountRuleVersion, amount: encodeMoney(discount.amount) });
}

function decodeDiscount(value: unknown, field: string): AppliedDiscountSnapshot {
  const record = exactRecord(value, ["discountId", "discountRuleVersion", "amount"], [], field);
  return deepFreeze({
    discountId: text(data(record, "discountId"), "discountId"),
    discountRuleVersion: text(data(record, "discountRuleVersion"), "discountRuleVersion"),
    amount: decodeMoney(data(record, "amount"), `${field} amount`),
  });
}

function encodeOrderDiscount(discount: OrderDiscountSnapshot): PersistedOrderDiscountSnapshotV1 {
  return deepFreeze({ ...encodeDiscount(discount), allocationStrategy: discount.allocationStrategy });
}

function decodeOrderDiscount(value: unknown): OrderDiscountSnapshot {
  const record = exactRecord(value, ["discountId", "discountRuleVersion", "amount", "allocationStrategy"], [], "order discount");
  return deepFreeze({
    discountId: text(data(record, "discountId"), "discountId"),
    discountRuleVersion: text(data(record, "discountRuleVersion"), "discountRuleVersion"),
    amount: decodeMoney(data(record, "amount"), "order discount amount"),
    allocationStrategy: data(record, "allocationStrategy") as OrderDiscountSnapshot["allocationStrategy"],
  });
}

function encodeAuthorization(value: CancellationAuthorization): PersistedAuthorizationV1 {
  return deepFreeze({ approved: true, actorId: value.actorId });
}

function decodeAuthorization(value: unknown): CancellationAuthorization {
  const record = exactRecord(value, ["approved", "actorId"], [], "authorization");
  if (data(record, "approved") !== true) fail("authorization approved");
  return deepFreeze({ approved: true, actorId: text(data(record, "actorId"), "authorization actorId") });
}

function encodeCancellationAudit(audit: OrderItemCancellationAudit): PersistedCancellationAuditV1 {
  return deepFreeze({ ...audit, ...(audit.authorization === undefined ? {} : { authorization: encodeAuthorization(audit.authorization) }) });
}

function decodeCancellationAudit(value: unknown): OrderItemCancellationAudit {
  const record = exactRecord(value, ["eventId", "idempotencyKey", "from", "actorId", "branchId", "deviceId", "occurredAt", "reason"], ["authorization"], "item cancellation audit");
  const from = data(record, "from") as OrderItemCancellationAudit["from"];
  const candidate = deepFreeze({
    eventId: text(data(record, "eventId"), "eventId"),
    idempotencyKey: text(data(record, "idempotencyKey"), "idempotencyKey"),
    from,
    actorId: text(data(record, "actorId"), "actorId"),
    branchId: text(data(record, "branchId"), "branchId"),
    deviceId: text(data(record, "deviceId"), "deviceId"),
    occurredAt: utcInstant(data(record, "occurredAt"), "occurredAt"),
    reason: text(data(record, "reason"), "reason"),
    ...(optionalData(record, "authorization") === undefined ? {} : { authorization: decodeAuthorization(optionalData(record, "authorization")) }),
  }) as OrderItemCancellationAudit;
  return transitionOrderItem(from, "cancelled", { cancellationAudit: candidate }).cancellationAudit!;
}

function encodeOrderCancellationAudit(audit: OrderCancellationAudit): PersistedOrderCancellationAuditV1 {
  return deepFreeze({ ...audit, authorization: encodeAuthorization(audit.authorization) });
}

function decodeOrderCancellationAudit(value: unknown): OrderCancellationAudit {
  const record = exactRecord(value, ["eventId", "idempotencyKey", "from", "actorId", "branchId", "deviceId", "occurredAt", "reason", "authorization"], [], "order cancellation audit");
  const from = data(record, "from") as OrderCancellationAudit["from"];
  transitionOrder(from, "cancelled");
  return deepFreeze({
    eventId: text(data(record, "eventId"), "eventId"),
    idempotencyKey: text(data(record, "idempotencyKey"), "idempotencyKey"),
    from,
    actorId: text(data(record, "actorId"), "actorId"),
    branchId: text(data(record, "branchId"), "branchId"),
    deviceId: text(data(record, "deviceId"), "deviceId"),
    occurredAt: utcInstant(data(record, "occurredAt"), "occurredAt"),
    reason: text(data(record, "reason"), "reason"),
    authorization: decodeAuthorization(data(record, "authorization")),
  });
}

function decodeAuditCommon(record: Record<string, unknown>): Omit<OrderAuditEvent, "operation" | "entityType" | "entityId" | "to"> & Record<string, never> {
  assertVersion(data(record, "schemaVersion"));
  const reason = optionalData(record, "reason");
  const authorization = optionalData(record, "authorization");
  return deepFreeze({
    schemaVersion: ORDER_AUDIT_SCHEMA_VERSION,
    eventId: text(data(record, "eventId"), "eventId"),
    idempotencyKey: text(data(record, "idempotencyKey"), "idempotencyKey"),
    restaurantId: text(data(record, "restaurantId"), "restaurantId"),
    branchId: text(data(record, "branchId"), "branchId"),
    orderId: text(data(record, "orderId"), "orderId"),
    actorId: text(data(record, "actorId"), "actorId"),
    deviceId: text(data(record, "deviceId"), "deviceId"),
    occurredAt: utcInstant(data(record, "occurredAt"), "occurredAt"),
    ...(reason === undefined ? {} : { reason: text(reason, "reason") }),
    ...(authorization === undefined ? {} : { authorization: decodeAuthorization(authorization) }),
  }) as never;
}

function eventCancellationAudit(common: ReturnType<typeof decodeAuditCommon>, from: OrderItem["status"]): OrderItemCancellationAudit {
  return deepFreeze({
    eventId: common.eventId,
    idempotencyKey: common.idempotencyKey,
    from,
    actorId: common.actorId,
    branchId: common.branchId,
    deviceId: common.deviceId,
    occurredAt: common.occurredAt,
    reason: common.reason ?? fail("item cancellation reason"),
    ...(common.authorization === undefined ? {} : { authorization: common.authorization }),
  }) as OrderItemCancellationAudit;
}

function copyAuditEvent(event: OrderAuditEvent): PersistedOrderAuditEventV1 {
  if (event.operation === "order.state_changed") {
    return deepFreeze({ ...event, automaticallyCancelledOrderItemIds: [...event.automaticallyCancelledOrderItemIds], ...(event.authorization === undefined ? {} : { authorization: encodeAuthorization(event.authorization) }) });
  }
  return deepFreeze({ ...event, ...(event.authorization === undefined ? {} : { authorization: encodeAuthorization(event.authorization) }) });
}

function assertMutationConsistency(order: Order, event: OrderAuditEvent): void {
  if (event.restaurantId !== order.restaurantId || event.branchId !== order.branchId || event.orderId !== order.orderId) {
    fail("mutation scope divergence");
  }
  if (event.operation === "order.created") {
    if (order.status !== "draft" || order.items.length !== 0) fail("created mutation divergence");
    return;
  }
  if (event.operation === "order.item_added") {
    const item = order.items.find((candidate) => candidate.orderItemId === event.orderItemId);
    if (item?.status !== "pending") fail("item-added mutation divergence");
    return;
  }
  if (event.operation === "order.state_changed") {
    if (order.status !== event.to) fail("order-state mutation divergence");
    if (event.to === "cancelled") {
      if (order.cancellationAudit === undefined || !auditMatchesEvent(order.cancellationAudit, event)) fail("order cancellation divergence");
      const linked = order.items.filter((item) => item.cancellationAudit !== undefined
        && item.cancellationAudit.from === "pending" && auditMatchesEventEvidence(item.cancellationAudit, event))
        .map((item) => item.orderItemId).sort(compareCodeUnits);
      if (!sameStrings(linked, [...event.automaticallyCancelledOrderItemIds].sort(compareCodeUnits))) {
        fail("automatic cancellation divergence");
      }
    }
    return;
  }
  const item = order.items.find((candidate) => candidate.orderItemId === event.orderItemId);
  if (item?.status !== event.to) fail("order-item-state mutation divergence");
  if (event.to === "cancelled" && (item.cancellationAudit === undefined || !auditMatchesEvent(item.cancellationAudit, event))) {
    fail("item cancellation divergence");
  }
}

function auditMatchesEvent(audit: OrderCancellationAudit | OrderItemCancellationAudit, event: OrderAuditEvent): boolean {
  return auditMatchesEventEvidence(audit, event)
    && audit.from === ("from" in event ? event.from : undefined);
}

function auditMatchesEventEvidence(audit: OrderCancellationAudit | OrderItemCancellationAudit, event: OrderAuditEvent): boolean {
  return audit.eventId === event.eventId && audit.idempotencyKey === event.idempotencyKey
    && audit.actorId === event.actorId && audit.branchId === event.branchId && audit.deviceId === event.deviceId
    && audit.occurredAt === event.occurredAt && audit.reason === event.reason
    && authorizationEquals(audit.authorization, event.authorization);
}

function authorizationEquals(left: CancellationAuthorization | undefined, right: CancellationAuthorization | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined && left.approved === right.approved && left.actorId === right.actorId;
}

function exactRecordWithOperation(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("audit event");
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[], field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(field);
  const record = value as Record<string, unknown>;
  exactKeys(record, required, optional, field);
  return record;
}

function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[], field: string): void {
  const keys = Reflect.ownKeys(record);
  const allowed = new Set([...required, ...optional]);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) || required.some((key) => !Object.hasOwn(record, key))) fail(field);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) fail(field);
  }
}

function data(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) return fail(key);
  return descriptor.value;
}

function optionalData(record: Record<string, unknown>, key: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor) || descriptor.value === undefined) return fail(key);
  return descriptor.value;
}

function dataArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail(field);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) fail(field);
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) fail(field);
  return value;
}

function assertStableTree(value: unknown, field: string, allowMoney: boolean, visiting = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail(field); return; }
  if (typeof value === "bigint") { if (!allowMoney) fail(field); return; }
  if (typeof value !== "object") fail(field);
  if (nodeTypes.isProxy(value) || visiting.has(value)) fail(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype
    && !(allowMoney && prototype === Money.prototype)) fail(field);
  visiting.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !("value" in descriptor) || !descriptor.enumerable && key !== "length") fail(field);
    assertStableTree(descriptor.value, field, allowMoney, visiting);
  }
  visiting.delete(value);
}

function assertVersion(value: unknown): asserts value is 1 { if (value !== ORDER_PERSISTENCE_SCHEMA_VERSION) fail("schemaVersion"); }
function text(value: unknown, field: string): string { if (typeof value !== "string" || value.trim().length === 0) return fail(field); return value; }
function safeInteger(value: unknown, field: string): number { if (!Number.isSafeInteger(value)) return fail(field); return value as number; }
function utcInstant(value: unknown, field: string): string {
  const result = text(value, field);
  if (!result.endsWith("Z")) return fail(field);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.valueOf())) return fail(field);
  const canonical = parsed.toISOString();
  if (result !== canonical && result !== canonical.replace(".000Z", "Z")) return fail(field);
  return result;
}
function decimalInteger(value: unknown, allowZero: boolean, field: string): bigint {
  if (typeof value !== "string" || !(allowZero ? /^(0|[1-9]\d*)$/u : /^[1-9]\d*$/u).test(value)) return fail(field);
  return BigInt(value);
}
function uniqueTexts(values: readonly unknown[], field: string): readonly string[] {
  const normalized = values.map((value) => text(value, field));
  if (new Set(normalized).size !== normalized.length) fail(field);
  return Object.freeze(normalized);
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function compareCodeUnits(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function fail(field: string): never { throw new OrderPersistenceCodecError(field); }
function atCodecBoundary<T>(operation: () => T): T {
  try { return operation(); } catch (error) { if (error instanceof OrderPersistenceCodecError) throw error; return fail("domain invariant"); }
}
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if ("value" in descriptor) deepFreeze(descriptor.value, seen);
    Object.freeze(value);
  }
  return value;
}
