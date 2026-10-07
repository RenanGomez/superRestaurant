import type { BranchScope } from "./index.js";
import { parseKdsEventV1, type KdsEventV1 } from "./realtime.js";

/**
 * Whole-order cancellation (T2) and the "Canceladas" view. The server derives the supervisor authorization from the
 * authenticated actor; the client only supplies the reason and audit context, never an approval.
 */
export const ORDER_CANCELLATION_SCHEMA_VERSION = 1 as const;
export const ORDER_CANCELLATION_REASON_MAX_LENGTH = 200 as const;
export const CANCELLED_WORK_TRAY_MAX_LIMIT = 100 as const;
export const ORDER_REFUND_OBLIGATION_STATUSES = Object.freeze(["none", "pending"] as const);
export const CANCELLED_WORK_ITEM_KINDS = Object.freeze(["order", "capture"] as const);
const CANCELLED_FROM_STATUSES = Object.freeze(["draft", "open", "partially_paid", "paid"] as const);
const WORK_CHANNELS = Object.freeze(["table", "counter", "takeout", "delivery"] as const);
const CAPTURE_SOURCE_CHANNELS = Object.freeze([
  "phone", "whatsapp_manual", "counter", "table", "self_service", "integration",
] as const);
const CAPTURE_FULFILLMENT_CHANNELS_LOCAL = Object.freeze(["dine_in", "counter", "pickup", "delivery"] as const);

export type OrderRefundObligationStatusV1 = (typeof ORDER_REFUND_OBLIGATION_STATUSES)[number];

export interface CancelOrderCommandV1 {
  readonly schemaVersion: typeof ORDER_CANCELLATION_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly orderId: string;
  readonly expectedVersion: number;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  /** 1..200 characters, trimmed, no control characters. */
  readonly reason: string;
}

/** Money already captured by the order that must be returned; recorded, never refunded here (no refund exists yet). */
export interface OrderRefundObligationV1 {
  readonly status: OrderRefundObligationStatusV1;
  readonly capturedMinor: number;
  /** Tips captured apart from the bill; returned together with it when the obligation is settled. */
  readonly capturedTipMinor: number;
  readonly currency: string;
}

export interface CancelOrderResultV1 {
  readonly schemaVersion: typeof ORDER_CANCELLATION_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly orderId: string;
  readonly orderStatus: "cancelled";
  readonly version: number;
  readonly replayed: boolean;
  readonly refundObligation: OrderRefundObligationV1;
  /** One `cancelled` correction per line that had reached the kitchen. */
  readonly kdsEvents: readonly KdsEventV1[];
}

export interface CancelledWorkCursorV1 {
  readonly at: string;
  readonly id: string;
}

export interface CancelledWorkTrayRequestV1 {
  readonly schemaVersion: typeof ORDER_CANCELLATION_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly limit: number;
  readonly cursor: CancelledWorkCursorV1 | null;
}

export interface CancelledOrderWorkItemV1 {
  readonly kind: "order";
  readonly orderId: string;
  readonly channel: (typeof WORK_CHANNELS)[number];
  readonly fromStatus: (typeof CANCELLED_FROM_STATUSES)[number];
  readonly version: number;
  readonly cancelledAt: string;
  readonly reason: string;
  readonly cancelledByActorId: string;
  readonly refundObligation: OrderRefundObligationV1;
  /** What the order was worth before cancellation (historical, never payable); `null` when unavailable. */
  readonly totalMinor: number | null;
  readonly lineCount: number;
  /** Masked name and phone suffix; `null` without `customers.read`. */
  readonly customerLabel: string | null;
  readonly timeZone: string;
}

export interface CancelledCaptureWorkItemV1 {
  readonly kind: "capture";
  readonly captureDraftId: string;
  readonly folio: string;
  readonly sourceChannel: (typeof CAPTURE_SOURCE_CHANNELS)[number];
  readonly fulfillmentChannel: (typeof CAPTURE_FULFILLMENT_CHANNELS_LOCAL)[number] | null;
  readonly cancelledAt: string;
  readonly reason: string;
  readonly cancelledByActorId: string;
}

export type CancelledWorkItemV1 = CancelledOrderWorkItemV1 | CancelledCaptureWorkItemV1;

export interface CancelledWorkTrayV1 {
  readonly schemaVersion: typeof ORDER_CANCELLATION_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly items: readonly CancelledWorkItemV1[];
  readonly nextCursor: CancelledWorkCursorV1 | null;
}

export function parseCancelOrderCommandV1(value: unknown): CancelOrderCommandV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "orderId", "expectedVersion", "reason", "eventId", "idempotencyKey", "deviceId", "occurredAt",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_CANCELLATION_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const orderId = uuid(own(record, "orderId"));
  const expectedVersion = integer(own(record, "expectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const reason = text(own(record, "reason"), 1, ORDER_CANCELLATION_REASON_MAX_LENGTH);
  const eventId = uuid(own(record, "eventId"));
  const deviceId = uuid(own(record, "deviceId"));
  const idempotencyKey = text(own(record, "idempotencyKey"), 1, 200);
  const occurredAt = timestamp(own(record, "occurredAt"));
  return scope === undefined || orderId === undefined || expectedVersion === undefined || reason === undefined
    || eventId === undefined || deviceId === undefined || idempotencyKey === undefined || occurredAt === undefined
    ? undefined
    : Object.freeze({
      deviceId, eventId, expectedVersion, idempotencyKey, occurredAt, orderId, reason,
      schemaVersion: ORDER_CANCELLATION_SCHEMA_VERSION, scope,
    });
}

export function parseOrderRefundObligationV1(value: unknown): OrderRefundObligationV1 | undefined {
  const record = exactRecord(value, ["status", "capturedMinor", "capturedTipMinor", "currency"]);
  if (record === undefined) return undefined;
  const status = own(record, "status");
  const capturedMinor = integer(own(record, "capturedMinor"), 0, Number.MAX_SAFE_INTEGER);
  const capturedTipMinor = integer(own(record, "capturedTipMinor"), 0, Number.MAX_SAFE_INTEGER);
  const currency = typeof own(record, "currency") === "string" && /^[A-Z]{3}$/u.test(own(record, "currency") as string)
    ? own(record, "currency") as string : undefined;
  if (typeof status !== "string" || !(ORDER_REFUND_OBLIGATION_STATUSES as readonly string[]).includes(status)
    || capturedMinor === undefined || capturedTipMinor === undefined || currency === undefined
    || (status === "none" && (capturedMinor !== 0 || capturedTipMinor !== 0))) return undefined;
  return Object.freeze({ capturedMinor, capturedTipMinor, currency, status: status as OrderRefundObligationStatusV1 });
}

export function parseCancelOrderResultV1(value: unknown): CancelOrderResultV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "orderId", "orderStatus", "version", "replayed", "refundObligation", "kdsEvents",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_CANCELLATION_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const orderId = uuid(own(record, "orderId"));
  const version = integer(own(record, "version"), 2, Number.MAX_SAFE_INTEGER);
  const replayed = own(record, "replayed");
  const refundObligation = parseOrderRefundObligationV1(own(record, "refundObligation"));
  const rawEvents = denseArray(own(record, "kdsEvents"), 500);
  if (scope === undefined || orderId === undefined || own(record, "orderStatus") !== "cancelled"
    || version === undefined || typeof replayed !== "boolean" || refundObligation === undefined
    || rawEvents === undefined) return undefined;
  const kdsEvents: KdsEventV1[] = [];
  for (const raw of rawEvents) {
    const event = parseKdsEventV1(raw);
    if (event === undefined || event.scope.restaurantId !== scope.restaurantId || event.scope.branchId !== scope.branchId
      || event.orderId !== orderId || event.status !== "cancelled") return undefined;
    kdsEvents.push(event);
  }
  return Object.freeze({
    kdsEvents: Object.freeze(kdsEvents), orderId, orderStatus: "cancelled" as const, refundObligation, replayed,
    schemaVersion: ORDER_CANCELLATION_SCHEMA_VERSION, scope, version,
  });
}

export function parseCancelledWorkTrayRequestV1(value: unknown): CancelledWorkTrayRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "limit", "cursor"]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_CANCELLATION_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const limit = integer(own(record, "limit"), 1, CANCELLED_WORK_TRAY_MAX_LIMIT);
  const rawCursor = own(record, "cursor");
  const cursor = rawCursor === null ? null : parseCursor(rawCursor);
  return scope === undefined || limit === undefined || cursor === undefined
    ? undefined
    : Object.freeze({ cursor, limit, schemaVersion: ORDER_CANCELLATION_SCHEMA_VERSION, scope });
}

export function parseCancelledWorkItemV1(value: unknown): CancelledWorkItemV1 | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const kind = own(value as Readonly<Record<string, unknown>>, "kind");
  if (kind === "order") {
    const record = exactRecord(value, [
      "kind", "orderId", "channel", "fromStatus", "version", "cancelledAt", "reason", "cancelledByActorId",
      "refundObligation", "totalMinor", "lineCount", "customerLabel", "timeZone",
    ]);
    if (record === undefined) return undefined;
    const orderId = uuid(own(record, "orderId"));
    const channel = own(record, "channel");
    const fromStatus = own(record, "fromStatus");
    const version = integer(own(record, "version"), 2, Number.MAX_SAFE_INTEGER);
    const cancelledAt = timestamp(own(record, "cancelledAt"));
    const reason = text(own(record, "reason"), 1, ORDER_CANCELLATION_REASON_MAX_LENGTH);
    const actor = uuid(own(record, "cancelledByActorId"));
    const refundObligation = parseOrderRefundObligationV1(own(record, "refundObligation"));
    const rawTotal = own(record, "totalMinor");
    const totalMinor = rawTotal === null ? null : integer(rawTotal, 0, Number.MAX_SAFE_INTEGER);
    const lineCount = integer(own(record, "lineCount"), 0, 10_000);
    const rawLabel = own(record, "customerLabel");
    const customerLabel = rawLabel === null ? null : text(rawLabel, 1, 160);
    const timeZone = text(own(record, "timeZone"), 1, 100);
    if (orderId === undefined || typeof channel !== "string" || !(WORK_CHANNELS as readonly string[]).includes(channel)
      || typeof fromStatus !== "string" || !(CANCELLED_FROM_STATUSES as readonly string[]).includes(fromStatus)
      || version === undefined || cancelledAt === undefined || reason === undefined || actor === undefined
      || refundObligation === undefined || totalMinor === undefined || lineCount === undefined
      || customerLabel === undefined || timeZone === undefined
      || ((fromStatus === "partially_paid" || fromStatus === "paid") && refundObligation.status !== "pending")) return undefined;
    return Object.freeze({
      cancelledAt, cancelledByActorId: actor, channel: channel as CancelledOrderWorkItemV1["channel"],
      customerLabel, fromStatus: fromStatus as CancelledOrderWorkItemV1["fromStatus"], kind: "order" as const,
      lineCount, orderId, reason, refundObligation, timeZone, totalMinor, version,
    });
  }
  if (kind === "capture") {
    const record = exactRecord(value, [
      "kind", "captureDraftId", "folio", "sourceChannel", "fulfillmentChannel", "cancelledAt", "reason", "cancelledByActorId",
    ]);
    if (record === undefined) return undefined;
    const captureDraftId = uuid(own(record, "captureDraftId"));
    const folio = text(own(record, "folio"), 1, 40);
    const sourceChannel = own(record, "sourceChannel");
    const rawFulfillment = own(record, "fulfillmentChannel");
    const cancelledAt = timestamp(own(record, "cancelledAt"));
    const reason = text(own(record, "reason"), 1, 500);
    const actor = uuid(own(record, "cancelledByActorId"));
    if (captureDraftId === undefined || folio === undefined || typeof sourceChannel !== "string"
      || !(CAPTURE_SOURCE_CHANNELS as readonly string[]).includes(sourceChannel)
      || !(rawFulfillment === null || (typeof rawFulfillment === "string"
        && (CAPTURE_FULFILLMENT_CHANNELS_LOCAL as readonly string[]).includes(rawFulfillment)))
      || cancelledAt === undefined || reason === undefined || actor === undefined) return undefined;
    return Object.freeze({
      cancelledAt, cancelledByActorId: actor, captureDraftId,
      fulfillmentChannel: rawFulfillment as CancelledCaptureWorkItemV1["fulfillmentChannel"], folio,
      kind: "capture" as const, reason, sourceChannel: sourceChannel as CancelledCaptureWorkItemV1["sourceChannel"],
    });
  }
  return undefined;
}

export function parseCancelledWorkTrayV1(value: unknown): CancelledWorkTrayV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "items", "nextCursor"]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_CANCELLATION_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const rawItems = denseArray(own(record, "items"), CANCELLED_WORK_TRAY_MAX_LIMIT);
  const rawCursor = own(record, "nextCursor");
  const nextCursor = rawCursor === null ? null : parseCursor(rawCursor);
  if (scope === undefined || rawItems === undefined || nextCursor === undefined) return undefined;
  const items: CancelledWorkItemV1[] = [];
  const ids = new Set<string>();
  for (const raw of rawItems) {
    const item = parseCancelledWorkItemV1(raw);
    if (item === undefined) return undefined;
    const id = item.kind === "order" ? item.orderId : item.captureDraftId;
    if (ids.has(id)) return undefined;
    ids.add(id);
    items.push(item);
  }
  return Object.freeze({ items: Object.freeze(items), nextCursor, schemaVersion: ORDER_CANCELLATION_SCHEMA_VERSION, scope });
}

function parseCursor(value: unknown): CancelledWorkCursorV1 | undefined {
  const record = exactRecord(value, ["at", "id"]);
  if (record === undefined) return undefined;
  const at = microTimestamp(own(record, "at"));
  const id = uuid(own(record, "id"));
  return at === undefined || id === undefined ? undefined : Object.freeze({ at, id });
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  if (record === undefined) return undefined;
  const restaurantId = uuid(own(record, "restaurantId"));
  const branchId = uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined ? undefined : Object.freeze({ branchId, restaurantId }) as BranchScope;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch { return undefined; }
}

function denseArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    items.push(descriptor.value);
  }
  return items;
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}
function integer(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}
function text(value: unknown, min: number, max: number): string | undefined {
  return typeof value === "string" && value.length >= min && value.length <= max && value === value.trim()
    && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}
function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try { return new Date(value).toISOString() === value ? value : undefined; } catch { return undefined; }
}
function microTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)) return undefined;
  try { return new Date(`${value.slice(0, 23)}Z`).toISOString() === `${value.slice(0, 23)}Z` ? value : undefined; } catch { return undefined; }
}
