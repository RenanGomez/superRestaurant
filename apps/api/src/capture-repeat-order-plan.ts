import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import {
  addOrderItem,
  createMenuProductPriceSnapshot,
  createOrder,
  type DeliveryChargeSnapshot,
  type Order,
  type OrderAuditContext,
  type OrderAuditEvent,
} from "@super-restaurant/domain";
import type { CaptureSelectionPlanV1, ConfirmCaptureDraftCommandV2, MenuCatalogV1 } from "@super-restaurant/shared-types";

import { toDomainMenuCatalog } from "./menu-catalog-domain.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface CaptureRepeatSelectionPlan {
  readonly catalogVersion: string;
  readonly customerId: string;
  readonly lines: readonly CaptureRepeatSelectionLine[];
  readonly schemaVersion: 1;
  readonly sourceOrderId: string;
}

export interface CaptureRepeatSelectionLine {
  readonly modifierGroups: readonly Readonly<{
    groupId: string;
    selections: readonly Readonly<{ optionId: string; quantity: number }>[];
  }>[];
  readonly productId: string;
  readonly quantity: number;
  readonly sourceOrderItemId: string;
}

export interface CaptureOrderMaterialization {
  readonly auditEvents: readonly OrderAuditEvent[];
  readonly order: Order;
}

export function parseCaptureRepeatSelectionPlan(value: unknown): CaptureRepeatSelectionPlan | undefined {
  const record = exactRecord(value, ["schemaVersion", "customerId", "sourceOrderId", "catalogVersion", "lines"]);
  if (record === undefined || own(record, "schemaVersion") !== 1) return undefined;
  const customerId = uuid(own(record, "customerId"));
  const sourceOrderId = uuid(own(record, "sourceOrderId"));
  const catalogVersion = uuid(own(record, "catalogVersion"));
  const rawLines = denseArray(own(record, "lines"), 1, 200);
  if (customerId === undefined || sourceOrderId === undefined || catalogVersion === undefined || rawLines === undefined) {
    return undefined;
  }
  const sourceIds = new Set<string>();
  const lines: CaptureRepeatSelectionLine[] = [];
  for (const rawLine of rawLines) {
    const line = parseLine(rawLine);
    if (line === undefined || sourceIds.has(line.sourceOrderItemId)) return undefined;
    sourceIds.add(line.sourceOrderItemId);
    lines.push(line);
  }
  return deepFreeze({ catalogVersion, customerId, lines, schemaVersion: 1, sourceOrderId });
}

export function materializeCaptureOrder(
  command: ConfirmCaptureDraftCommandV2,
  actorId: string,
  channel: "counter" | "delivery" | "table" | "takeout",
  plan: CaptureRepeatSelectionPlan | null,
  catalog: MenuCatalogV1 | null,
  deliveryCharge: DeliveryChargeSnapshot | null = null,
): CaptureOrderMaterialization {
  const base = createBaseOrder(command, actorId, channel, deliveryCharge);
  if (plan === null) return base;
  if (catalog === null || plan.lines.length === 0 || catalog.currency !== command.currency) {
    throw new Error("CAPTURE_REPEAT_CATALOG_CONFLICT");
  }
  const domainCatalog = toDomainMenuCatalog(catalog, command.scope.restaurantId);
  return appendMaterializedItems(base, command, actorId, domainCatalog, plan.lines.map((line) => ({
    identity: line.sourceOrderItemId,
    modifierGroups: line.modifierGroups,
    // A repeated order never carries forward a prior line's kitchen note.
    note: null,
    productId: line.productId,
    quantity: line.quantity,
    variantId: null,
  })), "capture-repeat");
}

/**
 * Materializes the Order from a catalog-derived `CaptureSelectionPlanV1`
 * (server-owned pricing via `createMenuProductPriceSnapshot`, never a
 * client-supplied price). A line's `variantId` (catalog size) is priced by the domain from the
 * catalog's variant, never from the client; an unknown/inactive variant, or a sized product without
 * one, throws and the caller maps it to a conflict.
 */
export function materializeCaptureSelectionOrder(
  command: ConfirmCaptureDraftCommandV2,
  actorId: string,
  channel: "counter" | "delivery" | "table" | "takeout",
  plan: CaptureSelectionPlanV1,
  catalog: MenuCatalogV1 | null,
  deliveryCharge: DeliveryChargeSnapshot | null = null,
): CaptureOrderMaterialization {
  const base = createBaseOrder(command, actorId, channel, deliveryCharge);
  if (catalog === null || plan.lines.length === 0 || catalog.currency !== command.currency
    || catalog.catalogVersion !== plan.catalogVersion) {
    throw new Error("CAPTURE_SELECTION_CATALOG_CONFLICT");
  }
  const domainCatalog = toDomainMenuCatalog(catalog, command.scope.restaurantId);
  return appendMaterializedItems(base, command, actorId, domainCatalog, plan.lines.map((line) => ({
    identity: line.lineId,
    modifierGroups: line.modifierGroups,
    note: line.note,
    productId: line.productId,
    quantity: line.quantity,
    variantId: line.variantId,
  })), "capture-selection");
}

function createBaseOrder(
  command: ConfirmCaptureDraftCommandV2,
  actorId: string,
  channel: "counter" | "delivery" | "table" | "takeout",
  deliveryCharge: DeliveryChargeSnapshot | null = null,
): CaptureOrderMaterialization {
  const created = createOrder({
    orderId: command.orderId,
    restaurantId: command.scope.restaurantId,
    branchId: command.scope.branchId,
    channel,
    ...(command.tableId === null ? {} : { tableId: command.tableId }),
    currency: command.currency,
    timeZone: command.timeZone,
    deliveryCharge,
  }, audit(command, actorId));
  return deepFreeze({ auditEvents: [created.auditEvent], order: created.order });
}

interface MaterializableLine {
  readonly identity: string;
  readonly modifierGroups: readonly Readonly<{
    groupId: string;
    selections: readonly Readonly<{ optionId: string; quantity: number }>[];
  }>[];
  readonly note: string | null;
  readonly productId: string;
  readonly quantity: number;
  /** Catalog size of the line; `null` for a product sold without sizes. */
  readonly variantId: string | null;
}

function appendMaterializedItems(
  base: CaptureOrderMaterialization,
  command: ConfirmCaptureDraftCommandV2,
  actorId: string,
  domainCatalog: ReturnType<typeof toDomainMenuCatalog>,
  lines: readonly MaterializableLine[],
  namespace: "capture-repeat" | "capture-selection",
): CaptureOrderMaterialization {
  let order = base.order;
  const auditEvents: OrderAuditEvent[] = [...base.auditEvents];
  for (const line of lines) {
    const snapshot = createMenuProductPriceSnapshot(domainCatalog, {
      currency: command.currency,
      productId: line.productId,
      restaurantId: command.scope.restaurantId,
      variantId: line.variantId,
    }, line.modifierGroups);
    const added = addOrderItem(order, {
      orderItemId: derivedUuid(`${namespace}-item`, command.eventId, line.identity),
      quantity: line.quantity,
      snapshot,
      note: line.note,
    }, {
      ...audit(command, actorId),
      eventId: derivedUuid(`${namespace}-event`, command.eventId, line.identity),
      idempotencyKey: derivedUuid(`${namespace}-idempotency`, command.idempotencyKey, line.identity),
    });
    order = added.order;
    auditEvents.push(added.auditEvent);
  }
  return deepFreeze({ auditEvents, order });
}

function parseLine(value: unknown): CaptureRepeatSelectionLine | undefined {
  const record = exactRecord(value, ["sourceOrderItemId", "productId", "quantity", "modifierGroups"]);
  if (record === undefined) return undefined;
  const sourceOrderItemId = uuid(own(record, "sourceOrderItemId"));
  const productId = uuid(own(record, "productId"));
  const quantity = integer(own(record, "quantity"), 1, 1_000_000);
  const rawGroups = denseArray(own(record, "modifierGroups"), 0, 200);
  if (sourceOrderItemId === undefined || productId === undefined || quantity === undefined || rawGroups === undefined) {
    return undefined;
  }
  const groupIds = new Set<string>();
  const modifierGroups: Array<Readonly<{
    groupId: string;
    selections: readonly Readonly<{ optionId: string; quantity: number }>[];
  }>> = [];
  for (const rawGroup of rawGroups) {
    const group = parseGroup(rawGroup);
    if (group === undefined || groupIds.has(group.groupId)) return undefined;
    groupIds.add(group.groupId);
    modifierGroups.push(group);
  }
  return deepFreeze({ modifierGroups, productId, quantity, sourceOrderItemId });
}

function parseGroup(value: unknown): Readonly<{
  groupId: string;
  selections: readonly Readonly<{ optionId: string; quantity: number }>[];
}> | undefined {
  const record = exactRecord(value, ["groupId", "selections"]);
  if (record === undefined) return undefined;
  const groupId = uuid(own(record, "groupId"));
  const rawSelections = denseArray(own(record, "selections"), 0, 1_000);
  if (groupId === undefined || rawSelections === undefined) return undefined;
  const optionIds = new Set<string>();
  const selections: Array<Readonly<{ optionId: string; quantity: number }>> = [];
  for (const rawSelection of rawSelections) {
    const selection = exactRecord(rawSelection, ["optionId", "quantity"]);
    if (selection === undefined) return undefined;
    const optionId = uuid(own(selection, "optionId"));
    const quantity = integer(own(selection, "quantity"), 1, 1_000);
    if (optionId === undefined || quantity === undefined || optionIds.has(optionId)) return undefined;
    optionIds.add(optionId);
    selections.push(Object.freeze({ optionId, quantity }));
  }
  return deepFreeze({ groupId, selections });
}

function audit(command: ConfirmCaptureDraftCommandV2, actorId: string): OrderAuditContext {
  return Object.freeze({
    actorId,
    branchId: command.scope.branchId,
    deviceId: command.deviceId,
    eventId: command.eventId,
    idempotencyKey: command.idempotencyKey,
    occurredAt: command.occurredAt,
  });
}

function derivedUuid(kind: string, namespace: string, identity: string): string {
  const bytes = createHash("sha256").update(`${kind}:${namespace}:${identity}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    const detached: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch { return undefined; }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function denseArray(value: unknown, minimum: number, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < minimum || value.length > maximum) return undefined;
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return undefined;
    result.push(Object.getOwnPropertyDescriptor(value, String(index))?.value);
  }
  return result;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : undefined;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === "object" && value !== null && !seen.has(value)) {
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ("value" in descriptor) deepFreeze(descriptor.value, seen);
    }
    Object.freeze(value);
  }
  return value;
}
