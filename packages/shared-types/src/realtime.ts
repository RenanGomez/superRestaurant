import type { BranchScope } from "./index.js";

export const REALTIME_SCHEMA_VERSION = 1 as const;
export const REALTIME_NAMESPACE = "/realtime/v1" as const;
export const REALTIME_SUBSCRIBE_EVENT = "scope.subscribe.v1" as const;
export const REALTIME_NOTIFICATION_EVENT = "state.changed.v1" as const;
export const KDS_INITIAL_CURSOR = "v1:0" as KdsCursorV1;

declare const kdsCursorBrand: unique symbol;

export type KdsCursorV1 = string & { readonly [kdsCursorBrand]: "KdsCursorV1" };

export const KDS_ORDER_ITEM_STATUSES = Object.freeze([
  "pending",
  "sent",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
] as const);

export type KdsOrderItemStatusV1 = (typeof KDS_ORDER_ITEM_STATUSES)[number];

export interface RealtimeSubscriptionV1 {
  readonly schemaVersion: typeof REALTIME_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly stationId: string;
}

export interface RealtimeSubscriptionAckV1 extends RealtimeSubscriptionV1 {
  readonly cursor: KdsCursorV1;
  readonly status: "subscribed";
}

export interface KdsEventV1 {
  readonly cursor: KdsCursorV1;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly operation: "order_item.created" | "order_item.status_changed";
  readonly orderId: string;
  readonly orderItemId: string;
  readonly receivedAt: string;
  readonly schemaVersion: typeof REALTIME_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly stationId: string;
  readonly status: KdsOrderItemStatusV1;
}

export interface KdsEventPageV1 extends RealtimeSubscriptionV1 {
  readonly events: readonly KdsEventV1[];
  readonly hasMore: boolean;
  readonly nextCursor: KdsCursorV1;
}

export interface RealtimeNotificationV1 extends RealtimeSubscriptionV1 {
  readonly cursor: KdsCursorV1;
  readonly eventId: string;
  readonly eventType: "kds.changed";
}

export function parseKdsCursorV1(value: unknown): KdsCursorV1 | undefined {
  if (typeof value !== "string" || !/^v1:(?:0|[1-9][0-9]{0,18})$/u.test(value)) return undefined;
  try {
    const sequence = BigInt(value.slice(3));
    return sequence <= 9_223_372_036_854_775_807n ? value as KdsCursorV1 : undefined;
  } catch {
    return undefined;
  }
}

export function parseRealtimeSubscriptionV1(value: unknown): RealtimeSubscriptionV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "stationId"]);
  if (record === undefined || ownValue(record, "schemaVersion") !== REALTIME_SCHEMA_VERSION) return undefined;
  const scope = parseScope(ownValue(record, "scope"));
  const stationId = parseStationId(ownValue(record, "stationId"));
  return scope === undefined || stationId === undefined
    ? undefined
    : Object.freeze({ schemaVersion: REALTIME_SCHEMA_VERSION, scope, stationId });
}

export function parseRealtimeSubscriptionAckV1(value: unknown): RealtimeSubscriptionAckV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "stationId", "cursor", "status"]);
  if (
    record === undefined
    || ownValue(record, "schemaVersion") !== REALTIME_SCHEMA_VERSION
    || ownValue(record, "status") !== "subscribed"
  ) return undefined;
  const scope = parseScope(ownValue(record, "scope"));
  const stationId = parseStationId(ownValue(record, "stationId"));
  const cursor = parseKdsCursorV1(ownValue(record, "cursor"));
  return scope === undefined || stationId === undefined || cursor === undefined
    ? undefined
    : Object.freeze({ cursor, schemaVersion: REALTIME_SCHEMA_VERSION, scope, stationId, status: "subscribed" });
}

export function parseKdsEventV1(value: unknown): KdsEventV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "cursor", "eventId", "orderId", "orderItemId", "stationId",
    "operation", "status", "occurredAt", "receivedAt",
  ]);
  if (record === undefined || ownValue(record, "schemaVersion") !== REALTIME_SCHEMA_VERSION) return undefined;
  const scope = parseScope(ownValue(record, "scope"));
  const cursor = parseKdsCursorV1(ownValue(record, "cursor"));
  const eventId = parseUuid(ownValue(record, "eventId"));
  const orderId = parseUuid(ownValue(record, "orderId"));
  const orderItemId = parseUuid(ownValue(record, "orderItemId"));
  const stationId = parseStationId(ownValue(record, "stationId"));
  const operation = ownValue(record, "operation");
  const status = ownValue(record, "status");
  const occurredAt = parseTimestamp(ownValue(record, "occurredAt"));
  const receivedAt = parseTimestamp(ownValue(record, "receivedAt"));
  if (
    scope === undefined || cursor === undefined || eventId === undefined || orderId === undefined
    || orderItemId === undefined || stationId === undefined
    || (operation !== "order_item.created" && operation !== "order_item.status_changed")
    || typeof status !== "string" || !(KDS_ORDER_ITEM_STATUSES as readonly string[]).includes(status)
    || occurredAt === undefined || receivedAt === undefined
  ) return undefined;
  return Object.freeze({
    cursor,
    eventId,
    occurredAt,
    operation,
    orderId,
    orderItemId,
    receivedAt,
    schemaVersion: REALTIME_SCHEMA_VERSION,
    scope,
    stationId,
    status: status as KdsOrderItemStatusV1,
  });
}

export function parseKdsEventPageV1(value: unknown): KdsEventPageV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "stationId", "events", "nextCursor", "hasMore"]);
  if (record === undefined || ownValue(record, "schemaVersion") !== REALTIME_SCHEMA_VERSION) return undefined;
  const scope = parseScope(ownValue(record, "scope"));
  const stationId = parseStationId(ownValue(record, "stationId"));
  const nextCursor = parseKdsCursorV1(ownValue(record, "nextCursor"));
  const rawEvents = ownValue(record, "events");
  const hasMore = ownValue(record, "hasMore");
  if (scope === undefined || stationId === undefined || nextCursor === undefined || !Array.isArray(rawEvents) || typeof hasMore !== "boolean" || rawEvents.length > 200) {
    return undefined;
  }
  const events: KdsEventV1[] = [];
  let previousCursor = -1n;
  for (const rawEvent of rawEvents) {
    const event = parseKdsEventV1(rawEvent);
    if (event === undefined || !sameScope(event.scope, scope) || event.stationId !== stationId) return undefined;
    const cursor = BigInt(event.cursor.slice(3));
    if (cursor <= previousCursor || cursor > BigInt(nextCursor.slice(3))) return undefined;
    previousCursor = cursor;
    events.push(event);
  }
  return Object.freeze({
    events: Object.freeze(events),
    hasMore,
    nextCursor,
    schemaVersion: REALTIME_SCHEMA_VERSION,
    scope,
    stationId,
  });
}

export function parseRealtimeNotificationV1(value: unknown): RealtimeNotificationV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "stationId", "cursor", "eventId", "eventType"]);
  if (
    record === undefined
    || ownValue(record, "schemaVersion") !== REALTIME_SCHEMA_VERSION
    || ownValue(record, "eventType") !== "kds.changed"
  ) return undefined;
  const scope = parseScope(ownValue(record, "scope"));
  const stationId = parseStationId(ownValue(record, "stationId"));
  const cursor = parseKdsCursorV1(ownValue(record, "cursor"));
  const eventId = parseUuid(ownValue(record, "eventId"));
  return scope === undefined || stationId === undefined || cursor === undefined || eventId === undefined
    ? undefined
    : Object.freeze({
      cursor,
      eventId,
      eventType: "kds.changed",
      schemaVersion: REALTIME_SCHEMA_VERSION,
      scope,
      stationId,
    });
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  if (record === undefined) return undefined;
  const restaurantId = parseUuid(ownValue(record, "restaurantId"));
  const branchId = parseUuid(ownValue(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

function parseStationId(value: unknown): string | undefined {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 64
    && value === value.trim()
    && !/[\p{Cc}\p{Cf}]/u.test(value)
    ? value
    : undefined;
}

function parseUuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function sameScope(left: BranchScope, right: BranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

function ownValue(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
