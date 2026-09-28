import {
  CAPTURE_FULFILLMENT_CHANNELS,
  parseCaptureCustomerSnapshotV1,
  parseCaptureDraftDetailV1,
  parseCaptureFulfillmentSnapshotV1,
  type CaptureCustomerSnapshotV1,
  type CaptureDraftDetailV1,
  type CaptureFulfillmentChannelV1,
  type CaptureFulfillmentSnapshotV1,
  type CaptureVersionedMutationInputV1,
} from "./commercial-capture.js";
import { parseCapturePaymentIntentV1, type CapturePaymentIntentV1 } from "./capture-payment-intent.js";
import { parseDeliveryQuoteV1, type DeliveryQuoteV1 } from "./delivery-quote.js";

export const DELIVERY_INSTRUCTIONS_SCHEMA_VERSION = 1 as const;
export const DELIVERY_INSTRUCTIONS_MAX_LENGTH = 500 as const;
export const DELIVERY_INSTRUCTION_SUGGESTION_LIMIT = 5 as const;
export const DELIVERY_INSTRUCTION_SUGGESTION_WINDOW_DAYS = 180 as const;

/**
 * Capture owns the current delivery instructions. The client may replace or
 * explicitly clear them only while it holds the draft lease and supplies the
 * expected Capture version.
 */
export interface SetCaptureDeliveryInstructionsCommandV1 extends CaptureVersionedMutationInputV1 {
  readonly attentionLeaseId: string;
  readonly deliveryInstructions: string | null;
  readonly schemaVersion: typeof DELIVERY_INSTRUCTIONS_SCHEMA_VERSION;
}

/** V1 journal detail remains unchanged; this endpoint returns the D4 value beside it. */
export interface SetCaptureDeliveryInstructionsResultV1 {
  readonly deliveryInstructions: string | null;
  readonly detail: CaptureDraftDetailV1;
  readonly replayed: boolean;
  readonly schemaVersion: typeof DELIVERY_INSTRUCTIONS_SCHEMA_VERSION;
}

/**
 * Reads history for the Customer already frozen on this Capture. The request
 * never accepts a Customer id, so callers cannot use this endpoint as a
 * cross-customer history lookup.
 */
export interface CaptureDeliveryInstructionSuggestionsRequestV1 {
  readonly captureDraftId: string;
  readonly schemaVersion: typeof DELIVERY_INSTRUCTIONS_SCHEMA_VERSION;
  readonly scope: CaptureVersionedMutationInputV1["scope"];
}

export interface CaptureDeliveryInstructionSuggestionV1 {
  readonly deliveryInstructions: string;
  readonly lastUsedAt: string;
  readonly usageCount: number;
}

export interface CaptureDeliveryInstructionSuggestionsV1 {
  readonly captureDraftId: string;
  readonly items: readonly CaptureDeliveryInstructionSuggestionV1[];
  readonly schemaVersion: typeof DELIVERY_INSTRUCTIONS_SCHEMA_VERSION;
}

/**
 * Fulfillment facts frozen into Order by the atomic confirmation bridge. Party
 * and Address snapshots are the immutable Capture snapshots, not live records.
 */
export interface OrderFulfillmentSnapshotV1 {
  readonly captureDraftId: string;
  readonly captureVersion: number;
  readonly deliveryInstructions: string | null;
  readonly frozenAt: string;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1;
  readonly fulfillmentSnapshot: CaptureFulfillmentSnapshotV1 | null;
  readonly orderId: string;
  readonly partySnapshot: CaptureCustomerSnapshotV1 | null;
  readonly schemaVersion: typeof DELIVERY_INSTRUCTIONS_SCHEMA_VERSION;
  readonly tableId: string | null;
}

export const ORDER_FULFILLMENT_SNAPSHOT_V2_SCHEMA_VERSION = 2 as const;

/**
 * Additive successor to `OrderFulfillmentSnapshotV1`: adds the frozen `deliveryQuote` and
 * `paymentIntent` raw facts (both nullable -- present only for a delivery capture that had a
 * quote frozen, or any capture that had a payment intent set) that `confirm_capture_draft_v3`
 * now merges into the snapshot at confirm time. Every other field is unchanged from V1.
 */
export interface OrderFulfillmentSnapshotV2 {
  readonly captureDraftId: string;
  readonly captureVersion: number;
  readonly deliveryInstructions: string | null;
  readonly deliveryQuote: DeliveryQuoteV1 | null;
  readonly frozenAt: string;
  readonly fulfillmentChannel: CaptureFulfillmentChannelV1;
  readonly fulfillmentSnapshot: CaptureFulfillmentSnapshotV1 | null;
  readonly orderId: string;
  readonly partySnapshot: CaptureCustomerSnapshotV1 | null;
  readonly paymentIntent: CapturePaymentIntentV1 | null;
  readonly schemaVersion: typeof ORDER_FULFILLMENT_SNAPSHOT_V2_SCHEMA_VERSION;
  readonly tableId: string | null;
}

const MUTATION_KEYS = [
  "schemaVersion", "scope", "captureDraftId", "expectedVersion", "attentionLeaseId", "deliveryInstructions",
  "eventId", "idempotencyKey", "deviceId", "occurredAt",
] as const;

export function parseSetCaptureDeliveryInstructionsCommandV1(
  value: unknown,
): SetCaptureDeliveryInstructionsCommandV1 | undefined {
  const record = exactRecord(value, MUTATION_KEYS);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_INSTRUCTIONS_SCHEMA_VERSION) return undefined;
  const scope = exactRecord(own(record, "scope"), ["restaurantId", "branchId"]);
  const restaurantId = scope === undefined ? undefined : uuid(own(scope, "restaurantId"));
  const branchId = scope === undefined ? undefined : uuid(own(scope, "branchId"));
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const expectedVersion = integer(own(record, "expectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const attentionLeaseId = uuid(own(record, "attentionLeaseId"));
  const deliveryInstructions = nullableInstructions(own(record, "deliveryInstructions"));
  const eventId = uuid(own(record, "eventId"));
  const idempotencyKey = uuid(own(record, "idempotencyKey"));
  const deviceId = uuid(own(record, "deviceId"));
  const occurredAt = timestamp(own(record, "occurredAt"));
  if (restaurantId === undefined || branchId === undefined || captureDraftId === undefined
    || expectedVersion === undefined || attentionLeaseId === undefined || deliveryInstructions === undefined
    || eventId === undefined || idempotencyKey === undefined || deviceId === undefined || occurredAt === undefined) {
    return undefined;
  }
  return Object.freeze({
    attentionLeaseId,
    captureDraftId,
    deliveryInstructions,
    deviceId,
    eventId,
    expectedVersion,
    idempotencyKey,
    occurredAt,
    schemaVersion: DELIVERY_INSTRUCTIONS_SCHEMA_VERSION,
    scope: Object.freeze({ branchId, restaurantId }),
  }) as SetCaptureDeliveryInstructionsCommandV1;
}

export function parseSetCaptureDeliveryInstructionsResultV1(
  value: unknown,
): SetCaptureDeliveryInstructionsResultV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "replayed", "detail", "deliveryInstructions"]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_INSTRUCTIONS_SCHEMA_VERSION) return undefined;
  const detail = parseCaptureDraftDetailV1(own(record, "detail"));
  const replayed = own(record, "replayed");
  const deliveryInstructions = nullableInstructions(own(record, "deliveryInstructions"));
  return detail === undefined || typeof replayed !== "boolean" || deliveryInstructions === undefined
    ? undefined
    : Object.freeze({ deliveryInstructions, detail, replayed, schemaVersion: DELIVERY_INSTRUCTIONS_SCHEMA_VERSION });
}

export function parseCaptureDeliveryInstructionSuggestionsRequestV1(
  value: unknown,
): CaptureDeliveryInstructionSuggestionsRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "captureDraftId"]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_INSTRUCTIONS_SCHEMA_VERSION) return undefined;
  const scope = exactRecord(own(record, "scope"), ["restaurantId", "branchId"]);
  const restaurantId = scope === undefined ? undefined : uuid(own(scope, "restaurantId"));
  const branchId = scope === undefined ? undefined : uuid(own(scope, "branchId"));
  const captureDraftId = uuid(own(record, "captureDraftId"));
  return restaurantId === undefined || branchId === undefined || captureDraftId === undefined
    ? undefined
    : Object.freeze({
      captureDraftId,
      schemaVersion: DELIVERY_INSTRUCTIONS_SCHEMA_VERSION,
      scope: Object.freeze({ branchId, restaurantId }),
    }) as CaptureDeliveryInstructionSuggestionsRequestV1;
}

export function parseCaptureDeliveryInstructionSuggestionsV1(
  value: unknown,
): CaptureDeliveryInstructionSuggestionsV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "captureDraftId", "items"]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_INSTRUCTIONS_SCHEMA_VERSION) return undefined;
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const rawItems = own(record, "items");
  if (captureDraftId === undefined || !Array.isArray(rawItems)
    || rawItems.length > DELIVERY_INSTRUCTION_SUGGESTION_LIMIT) return undefined;
  const seen = new Set<string>();
  const items: CaptureDeliveryInstructionSuggestionV1[] = [];
  let previousUsedAt: string | undefined;
  for (const rawItem of rawItems as readonly unknown[]) {
    const item = exactRecord(rawItem, ["deliveryInstructions", "lastUsedAt", "usageCount"]);
    if (item === undefined) return undefined;
    const deliveryInstructions = nullableInstructions(own(item, "deliveryInstructions"));
    const lastUsedAt = timestamp(own(item, "lastUsedAt"));
    const usageCount = integer(own(item, "usageCount"), 1, Number.MAX_SAFE_INTEGER);
    if (deliveryInstructions === undefined || deliveryInstructions === null || lastUsedAt === undefined
      || usageCount === undefined || seen.has(deliveryInstructions)
      || (previousUsedAt !== undefined && lastUsedAt > previousUsedAt)) return undefined;
    seen.add(deliveryInstructions);
    previousUsedAt = lastUsedAt;
    items.push(Object.freeze({ deliveryInstructions, lastUsedAt, usageCount }));
  }
  return Object.freeze({
    captureDraftId,
    items: Object.freeze(items),
    schemaVersion: DELIVERY_INSTRUCTIONS_SCHEMA_VERSION,
  });
}

export function parseOrderFulfillmentSnapshotV1(value: unknown): OrderFulfillmentSnapshotV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "orderId", "captureDraftId", "captureVersion", "fulfillmentChannel", "tableId",
    "partySnapshot", "fulfillmentSnapshot", "deliveryInstructions", "frozenAt",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_INSTRUCTIONS_SCHEMA_VERSION) return undefined;
  const orderId = uuid(own(record, "orderId"));
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const captureVersion = integer(own(record, "captureVersion"), 1, Number.MAX_SAFE_INTEGER);
  const fulfillmentChannel = member(own(record, "fulfillmentChannel"), CAPTURE_FULFILLMENT_CHANNELS);
  const tableId = nullableUuid(own(record, "tableId"));
  const rawParty = own(record, "partySnapshot");
  const partySnapshot = rawParty === null ? null : parseCaptureCustomerSnapshotV1(rawParty);
  const rawFulfillment = own(record, "fulfillmentSnapshot");
  const fulfillmentSnapshot = rawFulfillment === null ? null : parseCaptureFulfillmentSnapshotV1(rawFulfillment);
  const deliveryInstructions = nullableInstructions(own(record, "deliveryInstructions"));
  const frozenAt = timestamp(own(record, "frozenAt"));
  return orderId === undefined || captureDraftId === undefined || captureVersion === undefined
    || fulfillmentChannel === undefined || tableId === undefined || partySnapshot === undefined
    || fulfillmentSnapshot === undefined || deliveryInstructions === undefined || frozenAt === undefined
    || (fulfillmentChannel === "dine_in") !== (tableId !== null)
    || (fulfillmentChannel === "delivery") !== (fulfillmentSnapshot !== null)
    || (fulfillmentChannel === "delivery" && partySnapshot === null)
    || (fulfillmentChannel !== "delivery" && deliveryInstructions !== null)
    || (fulfillmentSnapshot !== null && (fulfillmentSnapshot.customerSnapshotRef !== partySnapshot?.snapshotRef
      || fulfillmentSnapshot.customerId !== partySnapshot?.customerId))
    ? undefined
    : Object.freeze({
      captureDraftId,
      captureVersion,
      deliveryInstructions,
      frozenAt,
      fulfillmentChannel,
      fulfillmentSnapshot,
      orderId,
      partySnapshot,
      schemaVersion: DELIVERY_INSTRUCTIONS_SCHEMA_VERSION,
      tableId,
    });
}

export function parseOrderFulfillmentSnapshotV2(value: unknown): OrderFulfillmentSnapshotV2 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "orderId", "captureDraftId", "captureVersion", "fulfillmentChannel", "tableId",
    "partySnapshot", "fulfillmentSnapshot", "deliveryInstructions", "frozenAt", "deliveryQuote", "paymentIntent",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== ORDER_FULFILLMENT_SNAPSHOT_V2_SCHEMA_VERSION) return undefined;
  const orderId = uuid(own(record, "orderId"));
  const captureDraftId = uuid(own(record, "captureDraftId"));
  const captureVersion = integer(own(record, "captureVersion"), 1, Number.MAX_SAFE_INTEGER);
  const fulfillmentChannel = member(own(record, "fulfillmentChannel"), CAPTURE_FULFILLMENT_CHANNELS);
  const tableId = nullableUuid(own(record, "tableId"));
  const rawParty = own(record, "partySnapshot");
  const partySnapshot = rawParty === null ? null : parseCaptureCustomerSnapshotV1(rawParty);
  const rawFulfillment = own(record, "fulfillmentSnapshot");
  const fulfillmentSnapshot = rawFulfillment === null ? null : parseCaptureFulfillmentSnapshotV1(rawFulfillment);
  const deliveryInstructions = nullableInstructions(own(record, "deliveryInstructions"));
  const frozenAt = timestamp(own(record, "frozenAt"));
  const rawDeliveryQuote = own(record, "deliveryQuote");
  const deliveryQuote = rawDeliveryQuote === null ? null : parseDeliveryQuoteV1(rawDeliveryQuote);
  const rawPaymentIntent = own(record, "paymentIntent");
  const paymentIntent = rawPaymentIntent === null ? null : parseCapturePaymentIntentV1(rawPaymentIntent);
  return orderId === undefined || captureDraftId === undefined || captureVersion === undefined
    || fulfillmentChannel === undefined || tableId === undefined || partySnapshot === undefined
    || fulfillmentSnapshot === undefined || deliveryInstructions === undefined || frozenAt === undefined
    || deliveryQuote === undefined || paymentIntent === undefined
    || (fulfillmentChannel === "dine_in") !== (tableId !== null)
    || (fulfillmentChannel === "delivery") !== (fulfillmentSnapshot !== null)
    || (fulfillmentChannel === "delivery" && partySnapshot === null)
    || (fulfillmentChannel !== "delivery" && deliveryInstructions !== null)
    || (fulfillmentChannel !== "delivery" && deliveryQuote !== null)
    || (fulfillmentSnapshot !== null && (fulfillmentSnapshot.customerSnapshotRef !== partySnapshot?.snapshotRef
      || fulfillmentSnapshot.customerId !== partySnapshot?.customerId))
    ? undefined
    : Object.freeze({
      captureDraftId,
      captureVersion,
      deliveryInstructions,
      deliveryQuote,
      frozenAt,
      fulfillmentChannel,
      fulfillmentSnapshot,
      orderId,
      partySnapshot,
      paymentIntent,
      schemaVersion: ORDER_FULFILLMENT_SNAPSHOT_V2_SCHEMA_VERSION,
      tableId,
    });
}

/**
 * Accepts either the historical `OrderFulfillmentSnapshotV1` or the additive V2 (with the frozen
 * delivery quote/payment intent raw facts): every current and future consumer of the fulfillment
 * snapshot must go through this, never assume V1 alone, since `confirm_capture_draft_v3` now
 * writes V2.
 */
export function parseOrderFulfillmentSnapshotV1OrV2(
  value: unknown,
): OrderFulfillmentSnapshotV1 | OrderFulfillmentSnapshotV2 | undefined {
  return parseOrderFulfillmentSnapshotV1(value) ?? parseOrderFulfillmentSnapshotV2(value);
}

function nullableInstructions(value: unknown): string | null | undefined {
  return value === null ? null : boundedText(value, 1, DELIVERY_INSTRUCTIONS_MAX_LENGTH);
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))) return undefined;
    const stable: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      stable[key] = descriptor.value;
    }
    return stable;
  } catch {
    return undefined;
  }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function boundedText(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value)
    ? value
    : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

function member<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] | undefined {
  return typeof value === "string" && values.includes(value) ? value as Values[number] : undefined;
}

function nullableUuid(value: unknown): string | null | undefined {
  return value === null ? null : uuid(value);
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try {
    return new Date(value).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : undefined;
}
