import {
  CAPTURE_ATTENTION_STATUSES,
  CAPTURE_FULFILLMENT_CHANNELS,
  CAPTURE_SOURCE_CHANNELS,
  type CaptureAttentionStatusV1,
  type CaptureFulfillmentChannelV1,
  type CaptureSourceChannelV1,
} from "./commercial-capture.js";
import type { BranchScope } from "./index.js";

export const OPERATIONAL_WORK_TRAY_SCHEMA_VERSION = 1 as const;
export const OPERATIONAL_WORK_ITEM_TYPES = Object.freeze(["capture", "order"] as const);
export const OPERATIONAL_ORDER_STATUSES = Object.freeze(["draft", "confirmed", "completed", "cancelled", "no_sale"] as const);
export const OPERATIONAL_PREPARATION_STATUSES = Object.freeze([
  "not_sent", "queued", "preparing", "partially_ready", "ready", "cancelled",
] as const);
export const OPERATIONAL_FULFILLMENT_STATUSES = Object.freeze([
  "unconfirmed", "scheduled", "confirmed", "ready", "in_progress", "fulfilled", "failed", "cancelled",
] as const);
export const OPERATIONAL_PAYMENT_STATUSES = Object.freeze([
  "unpaid", "pending", "ambiguous", "partially_paid", "paid", "partially_refunded", "refunded",
] as const);
export const OPERATIONAL_WORK_ATTENTION_CODES = Object.freeze([
  "unclaimed", "held", "ownership_conflict", "production", "fulfillment", "payment", "overdue",
] as const);
export const OPERATIONAL_WORK_ACTION_CODES = Object.freeze([
  "claim", "resume", "transfer", "takeover", "open_capture", "open_order", "send", "collect", "dispatch",
] as const);
export const OPERATIONAL_WORK_FILTERS = Object.freeze([
  "all", "draft", "on_hold", "scheduled", "confirmed", "preparing", "ready", "dispatch", "in_route",
  "incident", "payment_attention",
] as const);

export type OperationalWorkItemTypeV1 = (typeof OPERATIONAL_WORK_ITEM_TYPES)[number];
export type OperationalOrderStatusV1 = (typeof OPERATIONAL_ORDER_STATUSES)[number];
export type OperationalPreparationStatusV1 = (typeof OPERATIONAL_PREPARATION_STATUSES)[number];
export type OperationalFulfillmentStatusV1 = (typeof OPERATIONAL_FULFILLMENT_STATUSES)[number];
export type OperationalPaymentStatusV1 = (typeof OPERATIONAL_PAYMENT_STATUSES)[number];
export type OperationalWorkAttentionCodeV1 = (typeof OPERATIONAL_WORK_ATTENTION_CODES)[number];
export type OperationalWorkActionCodeV1 = (typeof OPERATIONAL_WORK_ACTION_CODES)[number];
export type OperationalWorkFilterV1 = (typeof OPERATIONAL_WORK_FILTERS)[number];

export interface OperationalWorkTrayRequestV1 {
  readonly cursor: string | null;
  readonly filters: readonly OperationalWorkFilterV1[];
  readonly limit: number;
  readonly schemaVersion: typeof OPERATIONAL_WORK_TRAY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface OperationalWorkItemV1 {
  readonly attentionStatus: CaptureAttentionStatusV1 | null;
  readonly availableActions: readonly OperationalWorkActionCodeV1[];
  readonly captureDraftId: string | null;
  readonly customerLabel: string | null;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1 | null;
  readonly fulfillmentStatus: OperationalFulfillmentStatusV1 | null;
  readonly humanFolio: string | null;
  readonly itemType: OperationalWorkItemTypeV1;
  readonly needsAttention: readonly OperationalWorkAttentionCodeV1[];
  readonly orderId: string | null;
  readonly orderStatus: OperationalOrderStatusV1 | null;
  readonly ownerLabel: string | null;
  readonly promisedFor: string | null;
  readonly paymentStatus: OperationalPaymentStatusV1 | null;
  readonly preparationStatus: OperationalPreparationStatusV1 | null;
  readonly scheduledFor: string | null;
  readonly shiftId: string | null;
  readonly sourceChannel: CaptureSourceChannelV1 | null;
  readonly tableId: string | null;
  readonly updatedAt: string;
  readonly version: number;
  readonly workItemId: string;
}

export interface OperationalWorkTrayV1 {
  readonly generatedAt: string;
  readonly items: readonly OperationalWorkItemV1[];
  readonly nextCursor: string | null;
  readonly schemaVersion: typeof OPERATIONAL_WORK_TRAY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export function parseOperationalWorkTrayRequestV1(value: unknown): OperationalWorkTrayRequestV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "filters", "limit", "cursor"]);
    if (record === undefined || own(record, "schemaVersion") !== OPERATIONAL_WORK_TRAY_SCHEMA_VERSION) return undefined;
    const scope = parseScope(own(record, "scope"));
    const filters = uniqueMembers(own(record, "filters"), OPERATIONAL_WORK_FILTERS, 11, false);
    const limit = integer(own(record, "limit"), 1, 100);
    const cursor = nullableText(own(record, "cursor"), 1, 500);
    if (scope === undefined || filters === undefined || limit === undefined || cursor === undefined) return undefined;
    return Object.freeze({ cursor, filters, limit, schemaVersion: OPERATIONAL_WORK_TRAY_SCHEMA_VERSION, scope });
  });
}

export function parseOperationalWorkItemV1(value: unknown): OperationalWorkItemV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "workItemId", "itemType", "captureDraftId", "orderId", "humanFolio", "customerLabel", "ownerLabel",
      "sourceChannel", "fulfillmentChannel", "attentionStatus", "orderStatus", "preparationStatus",
      "fulfillmentStatus", "paymentStatus", "shiftId", "tableId",
      "scheduledFor", "promisedFor", "needsAttention", "availableActions", "updatedAt", "version",
    ]);
    if (record === undefined) return undefined;
    const workItemId = uuid(own(record, "workItemId"));
    const itemType = member(own(record, "itemType"), OPERATIONAL_WORK_ITEM_TYPES);
    const captureDraftId = nullableUuid(own(record, "captureDraftId"));
    const orderId = nullableUuid(own(record, "orderId"));
    const humanFolio = nullableText(own(record, "humanFolio"), 1, 32);
    const customerLabel = nullableText(own(record, "customerLabel"), 1, 120);
    const ownerLabel = nullableText(own(record, "ownerLabel"), 1, 120);
    const sourceChannel = nullableMember(own(record, "sourceChannel"), CAPTURE_SOURCE_CHANNELS);
    const fulfillmentChannel = nullableMember(own(record, "fulfillmentChannel"), CAPTURE_FULFILLMENT_CHANNELS);
    const attentionStatus = nullableMember(own(record, "attentionStatus"), CAPTURE_ATTENTION_STATUSES);
    const orderStatus = nullableMember(own(record, "orderStatus"), OPERATIONAL_ORDER_STATUSES);
    const preparationStatus = nullableMember(own(record, "preparationStatus"), OPERATIONAL_PREPARATION_STATUSES);
    const fulfillmentStatus = nullableMember(own(record, "fulfillmentStatus"), OPERATIONAL_FULFILLMENT_STATUSES);
    const paymentStatus = nullableMember(own(record, "paymentStatus"), OPERATIONAL_PAYMENT_STATUSES);
    const shiftId = nullableUuid(own(record, "shiftId"));
    const tableId = nullableUuid(own(record, "tableId"));
    const scheduledFor = nullableTimestamp(own(record, "scheduledFor"));
    const promisedFor = nullableTimestamp(own(record, "promisedFor"));
    const needsAttention = uniqueMembers(own(record, "needsAttention"), OPERATIONAL_WORK_ATTENTION_CODES, 7, true);
    const availableActions = uniqueMembers(own(record, "availableActions"), OPERATIONAL_WORK_ACTION_CODES, 9, true);
    const updatedAt = timestamp(own(record, "updatedAt"));
    const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
    if (workItemId === undefined || itemType === undefined || captureDraftId === undefined || orderId === undefined
      || humanFolio === undefined || customerLabel === undefined || ownerLabel === undefined
      || sourceChannel === undefined || fulfillmentChannel === undefined || attentionStatus === undefined
      || orderStatus === undefined || preparationStatus === undefined || fulfillmentStatus === undefined
      || paymentStatus === undefined || shiftId === undefined || tableId === undefined || scheduledFor === undefined
      || promisedFor === undefined || needsAttention === undefined || availableActions === undefined
      || updatedAt === undefined || version === undefined) return undefined;
    if (itemType === "capture") {
      if (captureDraftId === null || orderId !== null || workItemId !== captureDraftId || attentionStatus === null
        || orderStatus !== null || sourceChannel === null || tableId !== null) return undefined;
    } else if (orderId === null || workItemId !== orderId || attentionStatus !== null || orderStatus === null) {
      return undefined;
    }
    if (itemType === "order" && fulfillmentChannel !== null
      && (fulfillmentChannel === "dine_in") !== (tableId !== null)) return undefined;
    return Object.freeze({
      attentionStatus,
      availableActions,
      captureDraftId,
      customerLabel,
      fulfillmentChannel,
      fulfillmentStatus,
      humanFolio,
      itemType,
      needsAttention,
      orderId,
      orderStatus,
      ownerLabel,
      paymentStatus,
      preparationStatus,
      promisedFor,
      scheduledFor,
      shiftId,
      sourceChannel,
      tableId,
      updatedAt,
      version,
      workItemId,
    });
  });
}

export function parseOperationalWorkTrayV1(value: unknown): OperationalWorkTrayV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "generatedAt", "nextCursor", "items"]);
    if (record === undefined || own(record, "schemaVersion") !== OPERATIONAL_WORK_TRAY_SCHEMA_VERSION) return undefined;
    const scope = parseScope(own(record, "scope"));
    const generatedAt = timestamp(own(record, "generatedAt"));
    const nextCursor = nullableText(own(record, "nextCursor"), 1, 500);
    const rawItems = denseArray(own(record, "items"), 100);
    if (scope === undefined || generatedAt === undefined || nextCursor === undefined || rawItems === undefined) return undefined;
    const items: OperationalWorkItemV1[] = [];
    const ids = new Set<string>();
    for (const raw of rawItems) {
      const item = parseOperationalWorkItemV1(raw);
      if (item === undefined || ids.has(item.workItemId)) return undefined;
      ids.add(item.workItemId);
      items.push(item);
    }
    return Object.freeze({
      generatedAt,
      items: Object.freeze(items),
      nextCursor,
      schemaVersion: OPERATIONAL_WORK_TRAY_SCHEMA_VERSION,
      scope,
    });
  });
}

type PlainRecord = Record<string, unknown>;

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key))
    ? value as PlainRecord : undefined;
}

function own(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

function denseArray(value: unknown, max: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return undefined;
  return value;
}

function uniqueMembers<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  max: number,
  emptyAllowed: boolean,
): readonly T[number][] | undefined {
  const values = denseArray(value, max);
  if (values === undefined || (!emptyAllowed && values.length === 0)) return undefined;
  const parsed: T[number][] = [];
  for (const candidate of values) {
    const entry = member(candidate, allowed);
    if (entry === undefined || parsed.includes(entry)) return undefined;
    parsed.push(entry);
  }
  return Object.freeze(parsed);
}

function member<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function nullableMember<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | null | undefined {
  return value === null ? null : member(value, allowed);
}

function nullableUuid(value: unknown): string | null | undefined { return value === null ? null : uuid(value); }
function uuid(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase() : undefined;
}

function integer(value: unknown, min: number, max: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : undefined;
}

function nullableText(value: unknown, min: number, max: number): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value === value.trim() && value.length >= min && value.length <= max
    ? value : undefined;
}

function nullableTimestamp(value: unknown): string | null | undefined { return value === null ? null : timestamp(value); }
function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? value : undefined;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}
