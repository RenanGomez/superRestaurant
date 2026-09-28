import {
  CAPTURE_FULFILLMENT_CHANNELS,
  type CaptureFulfillmentChannelV1,
} from "./commercial-capture.js";
import {
  CAPTURE_PAYMENT_INTENT_METHODS_V1,
  type CapturePaymentIntentMethodV1,
} from "./capture-payment-intent.js";
import type { BranchScope } from "./index.js";

/**
 * Read-only projection for the web operator's `/app/orders` view (S9.1). Deliberately independent
 * from `OperationalWorkTrayV1` (captures + dine-in table Orders): it never touches that contract's
 * parser, so Mobile/KDS consumers of the V1 tray are unaffected by this addition.
 */
export const BRANCH_ORDER_WORK_TRAY_SCHEMA_VERSION = 1 as const;
export const BRANCH_ORDER_WORK_CHANNELS = Object.freeze(["table", "counter", "takeout", "delivery"] as const);
export const BRANCH_ORDER_WORK_STATUSES = Object.freeze(["draft", "open", "partially_paid"] as const);
export const BRANCH_ORDER_WORK_PREPARATION_STATUSES = Object.freeze([
  "not_sent", "queued", "preparing", "partially_ready", "ready", "cancelled",
] as const);

export type BranchOrderWorkChannelV1 = (typeof BRANCH_ORDER_WORK_CHANNELS)[number];
export type BranchOrderWorkStatusV1 = (typeof BRANCH_ORDER_WORK_STATUSES)[number];
export type BranchOrderWorkPreparationStatusV1 = (typeof BRANCH_ORDER_WORK_PREPARATION_STATUSES)[number];

export interface BranchOrderWorkCursorV1 {
  readonly updatedAt: string;
  readonly orderId: string;
}

export interface BranchOrderWorkTotalsV1 {
  readonly currency: string;
  /** Items after line/order discount and tax -- never delivery or tip. */
  readonly itemsTotalMinor: number;
  readonly deliveryChargeMinor: number;
  /** Additive: kept separate from itemsTotalMinor so totalMinor === items + delivery + tip. */
  readonly tipMinor: number;
  readonly totalMinor: number;
}

export interface BranchOrderWorkPaymentIntentV1 {
  readonly method: CapturePaymentIntentMethodV1;
  readonly tenderedAmountMinor: number | null;
  readonly tipMinor: number;
}

export interface BranchOrderWorkItemV1 {
  readonly orderId: string;
  readonly channel: BranchOrderWorkChannelV1;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1 | null;
  readonly status: BranchOrderWorkStatusV1;
  readonly preparation: BranchOrderWorkPreparationStatusV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The Order's own frozen IANA zone -- never the viewer's device zone -- so createdAt/updatedAt render identically everywhere. */
  readonly timeZone: string;
  readonly customerLabel: string | null;
  readonly addressLabel: string | null;
  readonly totals: BranchOrderWorkTotalsV1;
  readonly paymentIntent: BranchOrderWorkPaymentIntentV1 | null;
  readonly lineCount: number;
  readonly hasNotes: boolean;
}

export interface BranchOrderWorkTrayRequestV1 {
  readonly schemaVersion: typeof BRANCH_ORDER_WORK_TRAY_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly cursor: BranchOrderWorkCursorV1 | null;
  readonly limit: number;
  /** `null` means every channel; filtering happens in SQL, never by discarding a loaded page client-side. */
  readonly channel: BranchOrderWorkChannelV1 | null;
}

export interface BranchOrderWorkTrayV1 {
  readonly schemaVersion: typeof BRANCH_ORDER_WORK_TRAY_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly items: readonly BranchOrderWorkItemV1[];
  readonly nextCursor: BranchOrderWorkCursorV1 | null;
}

export function parseBranchOrderWorkTrayRequestV1(value: unknown): BranchOrderWorkTrayRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "cursor", "limit", "channel"]);
  if (record === undefined || own(record, "schemaVersion") !== BRANCH_ORDER_WORK_TRAY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const rawCursor = own(record, "cursor");
  const cursor = rawCursor === null ? null : parseCursor(rawCursor);
  const limit = integer(own(record, "limit"), 1, 100);
  const rawChannel = own(record, "channel");
  const channel = rawChannel === null ? null : member(rawChannel, BRANCH_ORDER_WORK_CHANNELS);
  return scope === undefined || cursor === undefined || limit === undefined || channel === undefined
    ? undefined
    : Object.freeze({ channel, cursor, limit, schemaVersion: BRANCH_ORDER_WORK_TRAY_SCHEMA_VERSION, scope });
}

export function parseBranchOrderWorkItemV1(value: unknown): BranchOrderWorkItemV1 | undefined {
  const record = exactRecord(value, [
    "orderId", "channel", "fulfillmentChannel", "status", "preparation", "createdAt", "updatedAt", "timeZone",
    "customerLabel", "addressLabel", "totals", "paymentIntent", "lineCount", "hasNotes",
  ]);
  if (record === undefined) return undefined;
  const orderId = uuid(own(record, "orderId"));
  const channel = member(own(record, "channel"), BRANCH_ORDER_WORK_CHANNELS);
  const fulfillmentChannel = nullableMember(own(record, "fulfillmentChannel"), CAPTURE_FULFILLMENT_CHANNELS);
  const status = member(own(record, "status"), BRANCH_ORDER_WORK_STATUSES);
  const preparation = member(own(record, "preparation"), BRANCH_ORDER_WORK_PREPARATION_STATUSES);
  const createdAt = timestamp(own(record, "createdAt"));
  const updatedAt = timestamp(own(record, "updatedAt"));
  const timeZone = timeZoneId(own(record, "timeZone"));
  const customerLabel = nullableText(own(record, "customerLabel"), 1, 160);
  const addressLabel = nullableText(own(record, "addressLabel"), 1, 200);
  const totals = parseTotals(own(record, "totals"));
  const rawPaymentIntent = own(record, "paymentIntent");
  const paymentIntent = rawPaymentIntent === null ? null : parsePaymentIntent(rawPaymentIntent);
  const lineCount = integer(own(record, "lineCount"), 0, 1000);
  const hasNotes = own(record, "hasNotes");
  if (orderId === undefined || channel === undefined || fulfillmentChannel === undefined || status === undefined
    || preparation === undefined || createdAt === undefined || updatedAt === undefined || timeZone === undefined
    || customerLabel === undefined || addressLabel === undefined || totals === undefined
    || paymentIntent === undefined || lineCount === undefined || typeof hasNotes !== "boolean") return undefined;
  // `fulfillmentChannel` is null whenever the Order has no fulfillment snapshot (e.g. a
  // counter/takeout/delivery Order created outside Capture); only a *present* value must agree
  // with the Order's own channel, never the absence of one.
  if (fulfillmentChannel === "dine_in" && channel !== "table") return undefined;
  if (channel === "table" && fulfillmentChannel !== null && fulfillmentChannel !== "dine_in") return undefined;
  return Object.freeze({
    addressLabel, channel, createdAt, customerLabel, fulfillmentChannel, hasNotes, lineCount,
    orderId, paymentIntent, preparation, status, timeZone, totals, updatedAt,
  });
}

export function parseBranchOrderWorkTrayV1(value: unknown): BranchOrderWorkTrayV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "items", "nextCursor"]);
  if (record === undefined || own(record, "schemaVersion") !== BRANCH_ORDER_WORK_TRAY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const rawItems = denseArray(own(record, "items"), 100);
  const rawCursor = own(record, "nextCursor");
  const nextCursor = rawCursor === null ? null : parseCursor(rawCursor);
  if (scope === undefined || rawItems === undefined || nextCursor === undefined) return undefined;
  const items: BranchOrderWorkItemV1[] = [];
  const ids = new Set<string>();
  for (const raw of rawItems) {
    const item = parseBranchOrderWorkItemV1(raw);
    if (item === undefined || ids.has(item.orderId)) return undefined;
    ids.add(item.orderId);
    items.push(item);
  }
  return Object.freeze({ items: Object.freeze(items), nextCursor, schemaVersion: BRANCH_ORDER_WORK_TRAY_SCHEMA_VERSION, scope });
}

function parseTotals(value: unknown): BranchOrderWorkTotalsV1 | undefined {
  const record = exactRecord(value, ["currency", "itemsTotalMinor", "deliveryChargeMinor", "tipMinor", "totalMinor"]);
  if (record === undefined) return undefined;
  const currency = own(record, "currency");
  const itemsTotalMinor = integer(own(record, "itemsTotalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const deliveryChargeMinor = integer(own(record, "deliveryChargeMinor"), 0, Number.MAX_SAFE_INTEGER);
  const tipMinor = integer(own(record, "tipMinor"), 0, Number.MAX_SAFE_INTEGER);
  const totalMinor = integer(own(record, "totalMinor"), 0, Number.MAX_SAFE_INTEGER);
  if (typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency) || itemsTotalMinor === undefined
    || deliveryChargeMinor === undefined || tipMinor === undefined || totalMinor === undefined
    || itemsTotalMinor + deliveryChargeMinor + tipMinor !== totalMinor) return undefined;
  return Object.freeze({ currency, deliveryChargeMinor, itemsTotalMinor, tipMinor, totalMinor });
}

function parsePaymentIntent(value: unknown): BranchOrderWorkPaymentIntentV1 | undefined {
  const record = exactRecord(value, ["method", "tenderedAmountMinor", "tipMinor"]);
  if (record === undefined) return undefined;
  const method = member(own(record, "method"), CAPTURE_PAYMENT_INTENT_METHODS_V1);
  const rawTendered = own(record, "tenderedAmountMinor");
  const tenderedAmountMinor = rawTendered === null ? null : integer(rawTendered, 0, Number.MAX_SAFE_INTEGER);
  const tipMinor = integer(own(record, "tipMinor"), 0, Number.MAX_SAFE_INTEGER);
  return method === undefined || tenderedAmountMinor === undefined || tipMinor === undefined
    ? undefined : Object.freeze({ method, tenderedAmountMinor, tipMinor });
}

function parseCursor(value: unknown): BranchOrderWorkCursorV1 | undefined {
  const record = exactRecord(value, ["updatedAt", "orderId"]);
  if (record === undefined) return undefined;
  const updatedAt = own(record, "updatedAt");
  const orderId = uuid(own(record, "orderId"));
  return typeof updatedAt !== "string" || updatedAt.length < 1 || updatedAt.length > 40 || orderId === undefined
    ? undefined : Object.freeze({ orderId, updatedAt });
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined : Object.freeze({ restaurantId, branchId }) as BranchScope;
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

function denseArray(value: unknown, max: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return undefined;
  return value;
}

function member<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function nullableMember<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | null | undefined {
  return value === null ? null : member(value, allowed);
}

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

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? value : undefined;
}

function timeZoneId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 100 || value !== value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return undefined;
  }
}
