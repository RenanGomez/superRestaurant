import type { BranchScope } from "./index.js";
import {
  parseHoldCaptureDraftCommandV1,
  type HoldCaptureDraftCommandV1,
} from "./commercial-capture.js";
import {
  parseCaptureWorkspaceV4,
  type CaptureWorkspaceV4,
} from "./capture-selection-plan.js";
import { parseDeliveryQuoteV1, type DeliveryQuoteV1 } from "./delivery-quote.js";

export const CAPTURE_PAYMENT_INTENT_SCHEMA_VERSION = 1 as const;
export const CAPTURE_WORKSPACE_V5_SCHEMA_VERSION = 5 as const;

/** Read request for `CaptureWorkspaceV5`, mirroring `CaptureWorkspaceRequestV4`'s shape. */
export interface CaptureWorkspaceRequestV5 {
  readonly captureDraftId: string;
  readonly schemaVersion: typeof CAPTURE_WORKSPACE_V5_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export function parseCaptureWorkspaceRequestV5(value: unknown): CaptureWorkspaceRequestV5 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "scope", "captureDraftId"]);
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_WORKSPACE_V5_SCHEMA_VERSION) return undefined;
    const scope = parseUuidScope(own(record, "scope"));
    const captureDraftId = uuid(own(record, "captureDraftId"));
    return scope === undefined || captureDraftId === undefined
      ? undefined
      : Object.freeze({ captureDraftId, schemaVersion: CAPTURE_WORKSPACE_V5_SCHEMA_VERSION, scope });
  });
}

function parseUuidScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

export const CAPTURE_PAYMENT_INTENT_METHODS_V1 = Object.freeze(["cash", "card_manual", "transfer"] as const);
export const CAPTURE_PAYMENT_INTENT_TIMINGS_V1 = Object.freeze(["now", "on_fulfillment"] as const);
export const CAPTURE_PAYMENT_INTENT_STATUSES_V1 = Object.freeze(["ready", "stale", "insufficient"] as const);

export type CapturePaymentIntentMethodV1 = (typeof CAPTURE_PAYMENT_INTENT_METHODS_V1)[number];
export type CapturePaymentIntentTimingV1 = (typeof CAPTURE_PAYMENT_INTENT_TIMINGS_V1)[number];
export type CapturePaymentIntentStatusV1 = (typeof CAPTURE_PAYMENT_INTENT_STATUSES_V1)[number];

/**
 * The customer's stated payment intent, frozen inside a held capture draft.
 * `method`/`tenderedAmountMinor`/`tipMinor` are the only facts the client
 * supplies; totals, change and timing are always server-derived (see
 * `CapturePaymentIntentProjectionV1`). No Payment or CashMovement is implied.
 */
export interface CapturePaymentIntentV1 {
  readonly method: CapturePaymentIntentMethodV1;
  readonly schemaVersion: typeof CAPTURE_PAYMENT_INTENT_SCHEMA_VERSION;
  readonly tenderedAmountMinor: number | null;
  readonly tipMinor: number;
}

/**
 * Sets or replaces the capture's payment intent. Versioned and leased like
 * `SetCaptureFulfillmentCommandV1`: it targets a held draft at an expected
 * version and requires the caller's current attention lease.
 */
export interface SetCapturePaymentIntentCommandV1 extends HoldCaptureDraftCommandV1 {
  readonly method: CapturePaymentIntentMethodV1;
  readonly tenderedAmountMinor: number | null;
  readonly tipMinor: number;
}

/**
 * Requests a fresh, API-computed delivery-fee quote be frozen against a held,
 * delivery-channel capture. Versioned and leased like `SetCaptureFulfillmentCommandV1`;
 * `scheduledFor` is optional (`null` means "as soon as possible").
 */
export interface RequestCaptureDeliveryQuoteCommandV1 extends HoldCaptureDraftCommandV1 {
  readonly scheduledFor: string | null;
}

export function parseRequestCaptureDeliveryQuoteCommandV1(value: unknown): RequestCaptureDeliveryQuoteCommandV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "scope", "captureDraftId", "expectedVersion", "eventId", "idempotencyKey", "deviceId",
      "occurredAt", "attentionLeaseId", "scheduledFor",
    ]);
    if (record === undefined) return undefined;
    const common = parseHoldCaptureDraftCommandV1({
      schemaVersion: own(record, "schemaVersion"),
      scope: own(record, "scope"),
      captureDraftId: own(record, "captureDraftId"),
      expectedVersion: own(record, "expectedVersion"),
      eventId: own(record, "eventId"),
      idempotencyKey: own(record, "idempotencyKey"),
      deviceId: own(record, "deviceId"),
      occurredAt: own(record, "occurredAt"),
      attentionLeaseId: own(record, "attentionLeaseId"),
    });
    const rawScheduledFor = own(record, "scheduledFor");
    const scheduledFor = rawScheduledFor === null ? null : timestamp(rawScheduledFor);
    if (common === undefined || scheduledFor === undefined) return undefined;
    return Object.freeze({ ...common, scheduledFor });
  });
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Server-computed projection of the capture payment intent against the
 * authoritative total (items subtotal + frozen delivery fee when
 * applicable). The tip is informational and is excluded from
 * `orderTotalMinor` and from `changeDueMinor`. `status` is `"insufficient"`
 * when a stated cash tender does not cover the total, and `"stale"` when the
 * intent was fixed before a later change to lines/fulfillment/quote and has
 * not been refreshed.
 */
export interface CapturePaymentIntentProjectionV1 {
  readonly changeDueMinor: number | null;
  readonly currency: string;
  readonly deliveryFeeMinor: number;
  readonly itemsSubtotalMinor: number;
  readonly method: CapturePaymentIntentMethodV1;
  readonly orderTotalMinor: number;
  readonly status: CapturePaymentIntentStatusV1;
  readonly tenderedAmountMinor: number | null;
  readonly timing: CapturePaymentIntentTimingV1;
  readonly tipMinor: number;
}

/**
 * Additive widening of `CaptureWorkspaceV4`: adds the durable payment intent
 * (facts from storage) and its nullable, server-computed projection. Neither
 * field existing on V4 changes shape or meaning.
 */
export interface CaptureWorkspaceV5 extends Omit<CaptureWorkspaceV4, "schemaVersion"> {
  readonly deliveryQuote: DeliveryQuoteV1 | null;
  readonly paymentIntent: CapturePaymentIntentV1 | null;
  readonly paymentProjection: CapturePaymentIntentProjectionV1 | null;
  readonly schemaVersion: typeof CAPTURE_WORKSPACE_V5_SCHEMA_VERSION;
}

export function parseCapturePaymentIntentV1(value: unknown): CapturePaymentIntentV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, ["schemaVersion", "method", "tenderedAmountMinor", "tipMinor"]);
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_PAYMENT_INTENT_SCHEMA_VERSION) return undefined;
    const method = member(CAPTURE_PAYMENT_INTENT_METHODS_V1, own(record, "method"));
    const rawTendered = own(record, "tenderedAmountMinor");
    const tenderedAmountMinor = rawTendered === null ? null : money(rawTendered, true);
    const tipMinor = money(own(record, "tipMinor"), true);
    if (method === undefined || tenderedAmountMinor === undefined || tipMinor === undefined
      || (method !== "cash" && tenderedAmountMinor !== null)) return undefined;
    return Object.freeze({ method, schemaVersion: CAPTURE_PAYMENT_INTENT_SCHEMA_VERSION, tenderedAmountMinor, tipMinor });
  });
}

export function parseSetCapturePaymentIntentCommandV1(value: unknown): SetCapturePaymentIntentCommandV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "scope", "captureDraftId", "expectedVersion", "eventId", "idempotencyKey", "deviceId",
      "occurredAt", "attentionLeaseId", "method", "tenderedAmountMinor", "tipMinor",
    ]);
    if (record === undefined) return undefined;
    const common = parseHoldCaptureDraftCommandV1({
      schemaVersion: own(record, "schemaVersion"),
      scope: own(record, "scope"),
      captureDraftId: own(record, "captureDraftId"),
      expectedVersion: own(record, "expectedVersion"),
      eventId: own(record, "eventId"),
      idempotencyKey: own(record, "idempotencyKey"),
      deviceId: own(record, "deviceId"),
      occurredAt: own(record, "occurredAt"),
      attentionLeaseId: own(record, "attentionLeaseId"),
    });
    const method = member(CAPTURE_PAYMENT_INTENT_METHODS_V1, own(record, "method"));
    const rawTendered = own(record, "tenderedAmountMinor");
    const tenderedAmountMinor = rawTendered === null ? null : money(rawTendered, true);
    const tipMinor = money(own(record, "tipMinor"), true);
    if (common === undefined || method === undefined || tenderedAmountMinor === undefined || tipMinor === undefined
      || (method !== "cash" && tenderedAmountMinor !== null)) return undefined;
    return Object.freeze({ ...common, method, tenderedAmountMinor, tipMinor });
  });
}

export function parseCapturePaymentIntentProjectionV1(value: unknown): CapturePaymentIntentProjectionV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "method", "timing", "currency", "itemsSubtotalMinor", "deliveryFeeMinor", "orderTotalMinor",
      "tenderedAmountMinor", "changeDueMinor", "tipMinor", "status",
    ]);
    if (record === undefined) return undefined;
    const method = member(CAPTURE_PAYMENT_INTENT_METHODS_V1, own(record, "method"));
    const timing = member(CAPTURE_PAYMENT_INTENT_TIMINGS_V1, own(record, "timing"));
    const currency = currencyCode(own(record, "currency"));
    const itemsSubtotalMinor = money(own(record, "itemsSubtotalMinor"), true);
    const deliveryFeeMinor = money(own(record, "deliveryFeeMinor"), true);
    const orderTotalMinor = money(own(record, "orderTotalMinor"), true);
    const rawTendered = own(record, "tenderedAmountMinor");
    const tenderedAmountMinor = rawTendered === null ? null : money(rawTendered, true);
    const rawChange = own(record, "changeDueMinor");
    const changeDueMinor = rawChange === null ? null : money(rawChange, true);
    const tipMinor = money(own(record, "tipMinor"), true);
    const status = member(CAPTURE_PAYMENT_INTENT_STATUSES_V1, own(record, "status"));
    if (method === undefined || timing === undefined || currency === undefined || itemsSubtotalMinor === undefined
      || deliveryFeeMinor === undefined || orderTotalMinor === undefined || tenderedAmountMinor === undefined
      || changeDueMinor === undefined || tipMinor === undefined || status === undefined) return undefined;
    if (orderTotalMinor !== itemsSubtotalMinor + deliveryFeeMinor) return undefined;
    if (method !== "cash" && tenderedAmountMinor !== null) return undefined;
    if (changeDueMinor !== null && (tenderedAmountMinor === null || status !== "ready"
      || changeDueMinor !== tenderedAmountMinor - orderTotalMinor)) return undefined;
    if (status === "insufficient" && (tenderedAmountMinor === null || tenderedAmountMinor >= orderTotalMinor)) return undefined;
    if (status === "ready" && tenderedAmountMinor !== null && tenderedAmountMinor < orderTotalMinor) return undefined;
    return Object.freeze({
      changeDueMinor, currency, deliveryFeeMinor, itemsSubtotalMinor, method, orderTotalMinor, status,
      tenderedAmountMinor, timing, tipMinor,
    });
  });
}

export function parseCaptureWorkspaceV5(value: unknown): CaptureWorkspaceV5 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "detail", "customerSnapshot", "fulfillmentSnapshot", "repeatOrderPlan",
      "selectionPlan", "selectionProjection", "deliveryQuote", "paymentIntent", "paymentProjection",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== CAPTURE_WORKSPACE_V5_SCHEMA_VERSION) return undefined;
    const v4 = parseCaptureWorkspaceV4({
      schemaVersion: 4,
      detail: own(record, "detail"),
      customerSnapshot: own(record, "customerSnapshot"),
      fulfillmentSnapshot: own(record, "fulfillmentSnapshot"),
      repeatOrderPlan: own(record, "repeatOrderPlan"),
      selectionPlan: own(record, "selectionPlan"),
      selectionProjection: own(record, "selectionProjection"),
    });
    const rawDeliveryQuote = own(record, "deliveryQuote");
    const deliveryQuote = rawDeliveryQuote === null ? null : parseDeliveryQuoteV1(rawDeliveryQuote);
    const rawPaymentIntent = own(record, "paymentIntent");
    const paymentIntent = rawPaymentIntent === null ? null : parseCapturePaymentIntentV1(rawPaymentIntent);
    const rawPaymentProjection = own(record, "paymentProjection");
    const paymentProjection = rawPaymentProjection === null
      ? null
      : parseCapturePaymentIntentProjectionV1(rawPaymentProjection);
    if (v4 === undefined || deliveryQuote === undefined || paymentIntent === undefined || paymentProjection === undefined
      || (paymentProjection !== null && paymentIntent === null)
      || (paymentProjection !== null && paymentProjection.tenderedAmountMinor !== paymentIntent?.tenderedAmountMinor)
      || (paymentProjection !== null && paymentProjection.method !== paymentIntent?.method)
      || (paymentProjection !== null && paymentProjection.tipMinor !== paymentIntent?.tipMinor)) return undefined;
    return Object.freeze({
      customerSnapshot: v4.customerSnapshot,
      deliveryQuote,
      detail: v4.detail,
      fulfillmentSnapshot: v4.fulfillmentSnapshot,
      paymentIntent,
      paymentProjection,
      repeatOrderPlan: v4.repeatOrderPlan,
      schemaVersion: CAPTURE_WORKSPACE_V5_SCHEMA_VERSION,
      selectionPlan: v4.selectionPlan,
      selectionProjection: v4.selectionProjection,
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

function money(value: unknown, zeroAllowed: boolean): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= (zeroAllowed ? 0 : 1) ? value as number : undefined;
}

function currencyCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : undefined;
}

function member<const T extends readonly string[]>(values: T, value: unknown): T[number] | undefined {
  return typeof value === "string" && values.includes(value) ? value as T[number] : undefined;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
