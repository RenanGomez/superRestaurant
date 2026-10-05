import type { BranchScope } from "./index.js";
import {
  parsePaymentCollectionSummaryV1,
  type PaymentCollectionSummaryV1,
} from "./payments.js";

export const DELIVERY_SCHEMA_VERSION = 1 as const;
/** Two attempts per order, no partial deliveries (decisions 8.1/9.1, 2026-09-26). */
export const MAX_DELIVERY_ATTEMPTS = 2 as const;
export const DELIVERY_STATES = Object.freeze(["pending", "assigned", "en_route", "delivered", "failed", "settled"] as const);
export const DELIVERY_PAYMENT_METHODS = Object.freeze(["cash", "card_manual", "transfer"] as const);
const MAX_DELIVERY_LIST = 500;

export type DeliveryStateV1 = (typeof DELIVERY_STATES)[number];

/**
 * Dispatch and settlement facts of one `delivery`-channel Order. It never replaces the Order state
 * machine: the Order stays `open`/`partially_paid` until settlement creates the Payment. `pending`
 * with version 0 is the virtual state of an Order that has no delivery row yet.
 */
export interface OrderDeliveryV1 {
  readonly assignedAt: string | null;
  readonly attemptCount: number;
  readonly courierUserId: string | null;
  readonly deliveredAt: string | null;
  readonly dispatchedAt: string | null;
  readonly failedReason: string | null;
  readonly orderId: string;
  readonly schemaVersion: typeof DELIVERY_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly settledAt: string | null;
  readonly settledPaymentId: string | null;
  readonly state: DeliveryStateV1;
  readonly version: number;
}

export interface DeliveryAuditInputV1 {
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

interface DeliveryTransitionBaseV1 extends DeliveryAuditInputV1 {
  /** 0 when the Order has no delivery row yet (only `assign` accepts it). */
  readonly expectedVersion: number;
  readonly orderId: string;
  readonly schemaVersion: typeof DELIVERY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface AssignDeliveryCommandV1 extends DeliveryTransitionBaseV1 {
  readonly courierUserId: string;
}
export type DispatchDeliveryCommandV1 = DeliveryTransitionBaseV1;
export type CompleteDeliveryCommandV1 = DeliveryTransitionBaseV1;
export interface FailDeliveryCommandV1 extends DeliveryTransitionBaseV1 {
  readonly reason: string;
}

/**
 * Settles a delivered Order in the cash register. Amount and method are never client input: the
 * server charges the Order's remaining balance with the frozen payment intent's method. `null`
 * tender/tip means "use the frozen intent's value".
 */
export interface SettleDeliveryCommandV1 extends DeliveryTransitionBaseV1 {
  readonly cashRegisterExpectedVersion: number;
  readonly cashRegisterSessionId: string;
  readonly localSequence: number;
  readonly orderExpectedVersion: number;
  readonly paymentId: string;
  readonly tenderedAmountMinor: number | null;
  readonly tipMinor: number | null;
}

export interface OrderDeliveryResultV1 {
  readonly delivery: OrderDeliveryV1;
  readonly replayed: boolean;
  readonly schemaVersion: typeof DELIVERY_SCHEMA_VERSION;
}

export interface SettleDeliveryResultV1 extends OrderDeliveryResultV1 {
  readonly payment: PaymentCollectionSummaryV1;
}

export interface BranchDeliveriesRequestV1 {
  readonly schemaVersion: typeof DELIVERY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface BranchDeliveryItemV1 {
  /**
   * Roles with `customers.read`: street-level label. The courier assigned to this delivery gets the full
   * address. Everyone else gets `null`.
   */
  readonly addressLabel: string | null;
  /** Money already captured for the Order and what is left, both derived on the server (never client money). */
  readonly capturedMinor: number;
  readonly courierLabel: string | null;
  readonly currency: string;
  /** Masked phone suffix for `customers.read` roles; name and full phone only for the assigned courier. */
  readonly customerLabel: string | null;
  readonly delivery: OrderDeliveryV1;
  /** Only the assigned courier (or a `customers.read` role) receives the frozen delivery instructions. */
  readonly deliveryInstructions: string | null;
  readonly orderStatus: "open" | "partially_paid";
  readonly paymentIntent: {
    readonly method: (typeof DELIVERY_PAYMENT_METHODS)[number];
    readonly tenderedAmountMinor: number | null;
    readonly tipMinor: number;
  } | null;
  readonly promiseEnd: string | null;
  readonly promiseStart: string | null;
  readonly remainingMinor: number;
  readonly totalMinor: number;
}

export interface BranchDeliveriesV1 {
  readonly items: readonly BranchDeliveryItemV1[];
  readonly schemaVersion: typeof DELIVERY_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

const AUDIT_KEYS = ["eventId", "idempotencyKey", "deviceId", "occurredAt"] as const;
const BASE_KEYS = ["schemaVersion", "scope", "orderId", "expectedVersion", ...AUDIT_KEYS] as const;

export function parseAssignDeliveryCommandV1(value: unknown): AssignDeliveryCommandV1 | undefined {
  const record = exactRecord(value, [...BASE_KEYS, "courierUserId"]);
  const base = record === undefined ? undefined : parseBase(record);
  const courierUserId = record === undefined ? undefined : uuid(own(record, "courierUserId"));
  return base === undefined || courierUserId === undefined ? undefined : Object.freeze({ ...base, courierUserId });
}

export function parseDispatchDeliveryCommandV1(value: unknown): DispatchDeliveryCommandV1 | undefined {
  const record = exactRecord(value, BASE_KEYS);
  const base = record === undefined ? undefined : parseBase(record);
  return base === undefined || base.expectedVersion < 1 ? undefined : base;
}

export function parseCompleteDeliveryCommandV1(value: unknown): CompleteDeliveryCommandV1 | undefined {
  return parseDispatchDeliveryCommandV1(value);
}

export function parseFailDeliveryCommandV1(value: unknown): FailDeliveryCommandV1 | undefined {
  const record = exactRecord(value, [...BASE_KEYS, "reason"]);
  const base = record === undefined ? undefined : parseBase(record);
  const reason = record === undefined ? undefined : boundedText(own(record, "reason"), 1, 300);
  return base === undefined || base.expectedVersion < 1 || reason === undefined
    ? undefined : Object.freeze({ ...base, reason });
}

export function parseSettleDeliveryCommandV1(value: unknown): SettleDeliveryCommandV1 | undefined {
  const record = exactRecord(value, [
    ...BASE_KEYS, "orderExpectedVersion", "cashRegisterSessionId", "cashRegisterExpectedVersion",
    "paymentId", "localSequence", "tenderedAmountMinor", "tipMinor",
  ]);
  const base = record === undefined ? undefined : parseBase(record);
  if (record === undefined || base === undefined || base.expectedVersion < 1) return undefined;
  const orderExpectedVersion = integer(own(record, "orderExpectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const cashRegisterSessionId = uuid(own(record, "cashRegisterSessionId"));
  const cashRegisterExpectedVersion = integer(own(record, "cashRegisterExpectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const paymentId = uuid(own(record, "paymentId"));
  const localSequence = integer(own(record, "localSequence"), 1, Number.MAX_SAFE_INTEGER);
  const rawTendered = own(record, "tenderedAmountMinor");
  const tenderedAmountMinor = rawTendered === null ? null : integer(rawTendered, 1, Number.MAX_SAFE_INTEGER);
  const rawTip = own(record, "tipMinor");
  const tipMinor = rawTip === null ? null : integer(rawTip, 0, Number.MAX_SAFE_INTEGER);
  if (orderExpectedVersion === undefined || cashRegisterSessionId === undefined
    || cashRegisterExpectedVersion === undefined || paymentId === undefined || localSequence === undefined
    || tenderedAmountMinor === undefined || tipMinor === undefined) return undefined;
  return Object.freeze({
    ...base, cashRegisterExpectedVersion, cashRegisterSessionId, localSequence, orderExpectedVersion,
    paymentId, tenderedAmountMinor, tipMinor,
  });
}

export function parseBranchDeliveriesRequestV1(value: unknown): BranchDeliveriesRequestV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope"]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  return scope === undefined ? undefined : Object.freeze({ schemaVersion: DELIVERY_SCHEMA_VERSION, scope });
}

export function parseOrderDeliveryV1(value: unknown): OrderDeliveryV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "orderId", "state", "version", "courierUserId", "attemptCount", "assignedAt",
    "dispatchedAt", "deliveredAt", "failedReason", "settledPaymentId", "settledAt",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const orderId = uuid(own(record, "orderId"));
  const state = own(record, "state");
  const version = integer(own(record, "version"), 0, Number.MAX_SAFE_INTEGER);
  const courierUserId = nullable(own(record, "courierUserId"), uuid);
  const attemptCount = integer(own(record, "attemptCount"), 0, MAX_DELIVERY_ATTEMPTS);
  const assignedAt = nullable(own(record, "assignedAt"), timestamp);
  const dispatchedAt = nullable(own(record, "dispatchedAt"), timestamp);
  const deliveredAt = nullable(own(record, "deliveredAt"), timestamp);
  const failedReason = nullable(own(record, "failedReason"), (raw) => boundedText(raw, 1, 300));
  const settledPaymentId = nullable(own(record, "settledPaymentId"), uuid);
  const settledAt = nullable(own(record, "settledAt"), timestamp);
  if (scope === undefined || orderId === undefined || typeof state !== "string"
    || !(DELIVERY_STATES as readonly string[]).includes(state) || version === undefined
    || courierUserId === undefined || attemptCount === undefined || assignedAt === undefined
    || dispatchedAt === undefined || deliveredAt === undefined || failedReason === undefined
    || settledPaymentId === undefined || settledAt === undefined
    || (state === "pending") !== (version === 0) || (state === "pending" && courierUserId !== null)
    || (state === "settled") !== (settledPaymentId !== null) || (settledPaymentId === null) !== (settledAt === null)
    || (state === "failed") !== (failedReason !== null)) return undefined;
  return Object.freeze({
    assignedAt, attemptCount, courierUserId, deliveredAt, dispatchedAt, failedReason, orderId,
    schemaVersion: DELIVERY_SCHEMA_VERSION, scope, settledAt, settledPaymentId,
    state: state as DeliveryStateV1, version,
  });
}

export function parseOrderDeliveryResultV1(value: unknown): OrderDeliveryResultV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "delivery", "replayed"]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_SCHEMA_VERSION) return undefined;
  const delivery = parseOrderDeliveryV1(own(record, "delivery"));
  const replayed = own(record, "replayed");
  return delivery === undefined || typeof replayed !== "boolean"
    ? undefined : Object.freeze({ delivery, replayed, schemaVersion: DELIVERY_SCHEMA_VERSION });
}

export function parseSettleDeliveryResultV1(value: unknown): SettleDeliveryResultV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "delivery", "replayed", "payment"]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_SCHEMA_VERSION) return undefined;
  const delivery = parseOrderDeliveryV1(own(record, "delivery"));
  const replayed = own(record, "replayed");
  const payment = parsePaymentCollectionSummaryV1(own(record, "payment"));
  return delivery === undefined || typeof replayed !== "boolean" || payment === undefined
    ? undefined : Object.freeze({ delivery, payment, replayed, schemaVersion: DELIVERY_SCHEMA_VERSION });
}

export function parseBranchDeliveryItemV1(value: unknown): BranchDeliveryItemV1 | undefined {
  const record = exactRecord(value, [
    "delivery", "orderStatus", "currency", "totalMinor", "customerLabel", "addressLabel", "courierLabel",
    "paymentIntent", "promiseStart", "promiseEnd", "capturedMinor", "remainingMinor", "deliveryInstructions",
  ]);
  if (record === undefined) return undefined;
  const capturedMinor = integer(own(record, "capturedMinor"), 0, Number.MAX_SAFE_INTEGER);
  const remainingMinor = integer(own(record, "remainingMinor"), 0, Number.MAX_SAFE_INTEGER);
  const deliveryInstructions = nullable(own(record, "deliveryInstructions"), (raw) => boundedText(raw, 1, 500));
  const delivery = parseOrderDeliveryV1(own(record, "delivery"));
  const orderStatus = own(record, "orderStatus");
  const currency = typeof own(record, "currency") === "string" && /^[A-Z]{3}$/u.test(own(record, "currency") as string)
    ? own(record, "currency") as string : undefined;
  const totalMinor = integer(own(record, "totalMinor"), 0, Number.MAX_SAFE_INTEGER);
  const customerLabel = nullable(own(record, "customerLabel"), (raw) => boundedText(raw, 1, 160));
  const addressLabel = nullable(own(record, "addressLabel"), (raw) => boundedText(raw, 1, 200));
  const courierLabel = nullable(own(record, "courierLabel"), (raw) => boundedText(raw, 1, 120));
  const rawIntent = own(record, "paymentIntent");
  const intentRecord = rawIntent === null ? null : exactRecord(rawIntent, ["method", "tenderedAmountMinor", "tipMinor"]);
  const method = intentRecord === null || intentRecord === undefined ? undefined : own(intentRecord, "method");
  const tendered = intentRecord === null || intentRecord === undefined
    ? undefined : nullable(own(intentRecord, "tenderedAmountMinor"), (raw) => integer(raw, 0, Number.MAX_SAFE_INTEGER));
  const tip = intentRecord === null || intentRecord === undefined
    ? undefined : integer(own(intentRecord, "tipMinor"), 0, Number.MAX_SAFE_INTEGER);
  const promiseStart = nullable(own(record, "promiseStart"), timestamp);
  const promiseEnd = nullable(own(record, "promiseEnd"), timestamp);
  if (delivery === undefined || (orderStatus !== "open" && orderStatus !== "partially_paid") || currency === undefined
    || totalMinor === undefined || customerLabel === undefined || addressLabel === undefined
    || courierLabel === undefined || intentRecord === undefined || promiseStart === undefined
    || promiseEnd === undefined || capturedMinor === undefined || remainingMinor === undefined
    || deliveryInstructions === undefined || capturedMinor + remainingMinor !== totalMinor) return undefined;
  let paymentIntent: BranchDeliveryItemV1["paymentIntent"] = null;
  if (intentRecord !== null) {
    if (typeof method !== "string" || !(DELIVERY_PAYMENT_METHODS as readonly string[]).includes(method)
      || tendered === undefined || tip === undefined) return undefined;
    paymentIntent = Object.freeze({
      method: method as (typeof DELIVERY_PAYMENT_METHODS)[number], tenderedAmountMinor: tendered, tipMinor: tip,
    });
  }
  return Object.freeze({
    addressLabel, capturedMinor, courierLabel, currency, customerLabel, delivery, deliveryInstructions,
    orderStatus, paymentIntent, promiseEnd, promiseStart, remainingMinor, totalMinor,
  });
}

export function parseBranchDeliveriesV1(value: unknown): BranchDeliveriesV1 | undefined {
  const record = exactRecord(value, ["schemaVersion", "scope", "items"]);
  if (record === undefined || own(record, "schemaVersion") !== DELIVERY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const rawItems = denseArray(own(record, "items"), MAX_DELIVERY_LIST);
  if (scope === undefined || rawItems === undefined) return undefined;
  const items: BranchDeliveryItemV1[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = parseBranchDeliveryItemV1(raw);
    if (item === undefined || seen.has(item.delivery.orderId)
      || item.delivery.scope.restaurantId !== scope.restaurantId || item.delivery.scope.branchId !== scope.branchId) return undefined;
    seen.add(item.delivery.orderId);
    items.push(item);
  }
  return Object.freeze({ items: Object.freeze(items), schemaVersion: DELIVERY_SCHEMA_VERSION, scope });
}

function parseBase(record: Readonly<Record<string, unknown>>): DeliveryTransitionBaseV1 | undefined {
  if (own(record, "schemaVersion") !== DELIVERY_SCHEMA_VERSION) return undefined;
  const scope = parseScope(own(record, "scope"));
  const orderId = uuid(own(record, "orderId"));
  const expectedVersion = integer(own(record, "expectedVersion"), 0, Number.MAX_SAFE_INTEGER);
  const eventId = uuid(own(record, "eventId"));
  const idempotencyKey = boundedText(own(record, "idempotencyKey"), 1, 200);
  const deviceId = uuid(own(record, "deviceId"));
  const occurredAt = timestamp(own(record, "occurredAt"));
  return scope === undefined || orderId === undefined || expectedVersion === undefined || eventId === undefined
    || idempotencyKey === undefined || deviceId === undefined || occurredAt === undefined
    ? undefined
    : Object.freeze({
      deviceId, eventId, expectedVersion, idempotencyKey, occurredAt, orderId,
      schemaVersion: DELIVERY_SCHEMA_VERSION, scope,
    });
}

function nullable<T>(value: unknown, parse: (raw: unknown) => T | undefined): T | null | undefined {
  return value === null ? null : parse(value);
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined
    : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
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
  try {
    if (!Array.isArray(value) || value.length > maximum) return undefined;
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result.push(descriptor.value);
    }
    return result;
  } catch { return undefined; }
}

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function boundedText(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return undefined;
  try { return new Date(value).toISOString() === value ? value : undefined; } catch { return undefined; }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
