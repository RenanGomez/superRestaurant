import type { BranchScope } from "./index.js";

export const FINANCIAL_SCHEMA_VERSION = 1 as const;
export const SIMPLE_PAYMENT_METHODS = Object.freeze(["cash", "card_manual"] as const);

export type SimplePaymentMethodV1 = (typeof SIMPLE_PAYMENT_METHODS)[number];

export interface FinancialAuditInputV1 {
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface OpenCashRegisterCommandV1 extends FinancialAuditInputV1 {
  readonly cashRegisterSessionId: string;
  readonly currency: string;
  readonly openingFloatMinor: number;
  readonly registerId: string;
  readonly shiftId: string;
  readonly schemaVersion: typeof FINANCIAL_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CardManualEvidenceV1 {
  readonly externalConfirmed: true;
  readonly provider: string;
  readonly reference: string | null;
  readonly terminalId: string;
}

export interface CollectPaymentCommandV1 extends FinancialAuditInputV1 {
  readonly amountMinor: number;
  readonly cardManualEvidence: CardManualEvidenceV1 | null;
  readonly cashRegisterExpectedVersion: number;
  readonly cashRegisterSessionId: string;
  readonly localSequence: number;
  readonly method: SimplePaymentMethodV1;
  readonly orderExpectedVersion: number;
  readonly orderId: string;
  readonly paymentId: string;
  readonly schemaVersion: typeof FINANCIAL_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CloseCashRegisterCommandV1 extends FinancialAuditInputV1 {
  readonly cashRegisterExpectedVersion: number;
  readonly cashRegisterSessionId: string;
  readonly countedClosingBalanceMinor: number;
  readonly reason: string | null;
  readonly schemaVersion: typeof FINANCIAL_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export interface CashRegisterSummaryV1 {
  readonly cashRegisterSessionId: string;
  readonly cashierId: string;
  readonly closedAt: string | null;
  readonly countedClosingBalanceMinor: number | null;
  readonly currency: string;
  readonly differenceMinor: number | null;
  readonly expectedCashBalanceMinor: number;
  readonly openedAt: string;
  readonly openingFloatMinor: number;
  readonly registerId: string;
  readonly shiftId: string;
  readonly replayed: boolean;
  readonly schemaVersion: typeof FINANCIAL_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly status: "open" | "closed";
  readonly version: number;
}

export interface PaymentCollectionSummaryV1 {
  readonly amountMinor: number;
  readonly cashRegisterSessionId: string;
  readonly cashRegisterVersion: number;
  readonly currency: string;
  readonly method: SimplePaymentMethodV1;
  readonly orderId: string;
  readonly orderStatus: "partially_paid" | "paid";
  readonly orderVersion: number;
  readonly paymentId: string;
  readonly paymentState: "captured";
  readonly remainingBalanceMinor: number;
  readonly replayed: boolean;
  readonly schemaVersion: typeof FINANCIAL_SCHEMA_VERSION;
  readonly scope: BranchScope;
}

export function parseOpenCashRegisterCommandV1(value: unknown): OpenCashRegisterCommandV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "cashRegisterSessionId", "registerId", "shiftId", "openingFloatMinor", "currency",
    "eventId", "idempotencyKey", "deviceId", "occurredAt",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== FINANCIAL_SCHEMA_VERSION) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record, "scope"));
  const cashRegisterSessionId = uuid(own(record, "cashRegisterSessionId"));
  const registerId = uuid(own(record, "registerId"));
  const shiftId = uuid(own(record, "shiftId"));
  const openingFloatMinor = integer(own(record, "openingFloatMinor"), 0, Number.MAX_SAFE_INTEGER);
  const currency = currencyCode(own(record, "currency"));
  return common === undefined || scope === undefined || cashRegisterSessionId === undefined
    || registerId === undefined || shiftId === undefined || openingFloatMinor === undefined || currency === undefined
    ? undefined
    : Object.freeze({ ...common, cashRegisterSessionId, currency, openingFloatMinor, registerId, schemaVersion: 1, scope, shiftId });
}

export function parseCollectPaymentCommandV1(value: unknown): CollectPaymentCommandV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "cashRegisterSessionId", "cashRegisterExpectedVersion", "orderId",
    "orderExpectedVersion", "paymentId", "amountMinor", "method", "cardManualEvidence", "localSequence",
    "eventId", "idempotencyKey", "deviceId", "occurredAt",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== FINANCIAL_SCHEMA_VERSION) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record, "scope"));
  const cashRegisterSessionId = uuid(own(record, "cashRegisterSessionId"));
  const cashRegisterExpectedVersion = integer(own(record, "cashRegisterExpectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const orderId = uuid(own(record, "orderId"));
  const orderExpectedVersion = integer(own(record, "orderExpectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const paymentId = uuid(own(record, "paymentId"));
  const amountMinor = integer(own(record, "amountMinor"), 1, Number.MAX_SAFE_INTEGER);
  const localSequence = integer(own(record, "localSequence"), 1, Number.MAX_SAFE_INTEGER);
  const method = paymentMethod(own(record, "method"));
  const rawCard = own(record, "cardManualEvidence");
  const cardManualEvidence = rawCard === null ? null : parseCardManualEvidenceV1(rawCard);
  if (common === undefined || scope === undefined || cashRegisterSessionId === undefined
    || cashRegisterExpectedVersion === undefined || orderId === undefined || orderExpectedVersion === undefined
    || paymentId === undefined || amountMinor === undefined || localSequence === undefined || method === undefined
    || cardManualEvidence === undefined || (method === "cash") !== (cardManualEvidence === null)) return undefined;
  return Object.freeze({
    ...common, amountMinor, cardManualEvidence, cashRegisterExpectedVersion, cashRegisterSessionId,
    localSequence, method, orderExpectedVersion, orderId, paymentId, schemaVersion: 1, scope,
  });
}

export function parseCloseCashRegisterCommandV1(value: unknown): CloseCashRegisterCommandV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "cashRegisterSessionId", "cashRegisterExpectedVersion",
    "countedClosingBalanceMinor", "reason", "eventId", "idempotencyKey", "deviceId", "occurredAt",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== FINANCIAL_SCHEMA_VERSION) return undefined;
  const common = parseCommon(record);
  const scope = parseScope(own(record, "scope"));
  const cashRegisterSessionId = uuid(own(record, "cashRegisterSessionId"));
  const cashRegisterExpectedVersion = integer(own(record, "cashRegisterExpectedVersion"), 1, Number.MAX_SAFE_INTEGER);
  const countedClosingBalanceMinor = integer(own(record, "countedClosingBalanceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const rawReason = own(record, "reason");
  const reason = rawReason === null ? null : text(rawReason, 1, 500);
  return common === undefined || scope === undefined || cashRegisterSessionId === undefined
    || cashRegisterExpectedVersion === undefined || countedClosingBalanceMinor === undefined || reason === undefined
    ? undefined
    : Object.freeze({ ...common, cashRegisterExpectedVersion, cashRegisterSessionId, countedClosingBalanceMinor, reason, schemaVersion: 1, scope });
}

export function parseCardManualEvidenceV1(value: unknown): CardManualEvidenceV1 | undefined {
  const record = exactRecord(value, ["externalConfirmed", "provider", "terminalId", "reference"]);
  const externalConfirmed = record === undefined ? undefined : own(record, "externalConfirmed");
  const provider = record === undefined ? undefined : text(own(record, "provider"), 1, 120);
  const terminalId = record === undefined ? undefined : text(own(record, "terminalId"), 1, 100);
  const rawReference = record === undefined ? undefined : own(record, "reference");
  const reference = rawReference === null ? null : text(rawReference, 1, 200);
  return externalConfirmed !== true || provider === undefined || terminalId === undefined || reference === undefined
    ? undefined : Object.freeze({ externalConfirmed, provider, reference, terminalId });
}

export function parseCashRegisterSummaryV1(value: unknown): CashRegisterSummaryV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "cashRegisterSessionId", "registerId", "shiftId", "cashierId", "currency", "status",
    "openingFloatMinor", "expectedCashBalanceMinor", "countedClosingBalanceMinor", "differenceMinor",
    "version", "openedAt", "closedAt", "replayed",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== 1) return undefined;
  const scope = parseScope(own(record, "scope"));
  const cashRegisterSessionId = uuid(own(record, "cashRegisterSessionId"));
  const registerId = uuid(own(record, "registerId"));
  const shiftId = uuid(own(record, "shiftId"));
  const cashierId = uuid(own(record, "cashierId"));
  const currency = currencyCode(own(record, "currency"));
  const status = own(record, "status");
  const openingFloatMinor = integer(own(record, "openingFloatMinor"), 0, Number.MAX_SAFE_INTEGER);
  const expectedCashBalanceMinor = safeInteger(own(record, "expectedCashBalanceMinor"));
  const counted = nullableSafeInteger(own(record, "countedClosingBalanceMinor"), 0);
  const difference = nullableSafeInteger(own(record, "differenceMinor"));
  const version = integer(own(record, "version"), 1, Number.MAX_SAFE_INTEGER);
  const openedAt = timestamp(own(record, "openedAt"));
  const rawClosedAt = own(record, "closedAt");
  const closedAt = rawClosedAt === null ? null : timestamp(rawClosedAt);
  const replayed = own(record, "replayed");
  if (scope === undefined || cashRegisterSessionId === undefined || registerId === undefined || shiftId === undefined || cashierId === undefined
    || currency === undefined || (status !== "open" && status !== "closed") || openingFloatMinor === undefined
    || expectedCashBalanceMinor === undefined || counted === undefined || difference === undefined
    || version === undefined || openedAt === undefined || closedAt === undefined || typeof replayed !== "boolean"
    || (status === "open" && (counted !== null || difference !== null || closedAt !== null))
    || (status === "closed" && (counted === null || difference === null || closedAt === null))) return undefined;
  return Object.freeze({
    cashRegisterSessionId, cashierId, closedAt, countedClosingBalanceMinor: counted, currency,
    differenceMinor: difference, expectedCashBalanceMinor, openedAt, openingFloatMinor, registerId,
    replayed, schemaVersion: 1, scope, shiftId, status, version,
  });
}

export function parsePaymentCollectionSummaryV1(value: unknown): PaymentCollectionSummaryV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion", "scope", "cashRegisterSessionId", "cashRegisterVersion", "paymentId", "orderId",
    "method", "amountMinor", "currency", "paymentState", "orderStatus", "orderVersion",
    "remainingBalanceMinor", "replayed",
  ]);
  if (record === undefined || own(record, "schemaVersion") !== 1) return undefined;
  const scope = parseScope(own(record, "scope"));
  const cashRegisterSessionId = uuid(own(record, "cashRegisterSessionId"));
  const cashRegisterVersion = integer(own(record, "cashRegisterVersion"), 1, Number.MAX_SAFE_INTEGER);
  const paymentId = uuid(own(record, "paymentId"));
  const orderId = uuid(own(record, "orderId"));
  const method = paymentMethod(own(record, "method"));
  const amountMinor = integer(own(record, "amountMinor"), 1, Number.MAX_SAFE_INTEGER);
  const currency = currencyCode(own(record, "currency"));
  const paymentState = own(record, "paymentState");
  const orderStatus = own(record, "orderStatus");
  const orderVersion = integer(own(record, "orderVersion"), 1, Number.MAX_SAFE_INTEGER);
  const remainingBalanceMinor = integer(own(record, "remainingBalanceMinor"), 0, Number.MAX_SAFE_INTEGER);
  const replayed = own(record, "replayed");
  if (scope === undefined || cashRegisterSessionId === undefined || cashRegisterVersion === undefined
    || paymentId === undefined || orderId === undefined || method === undefined || amountMinor === undefined
    || currency === undefined || paymentState !== "captured"
    || (orderStatus !== "partially_paid" && orderStatus !== "paid") || orderVersion === undefined
    || remainingBalanceMinor === undefined || typeof replayed !== "boolean"
    || (orderStatus === "paid") !== (remainingBalanceMinor === 0)) return undefined;
  return Object.freeze({
    amountMinor, cashRegisterSessionId, cashRegisterVersion, currency, method, orderId, orderStatus,
    orderVersion, paymentId, paymentState, remainingBalanceMinor, replayed, schemaVersion: 1, scope,
  });
}

function parseCommon(record: Readonly<Record<string, unknown>>): FinancialAuditInputV1 | undefined {
  const deviceId = uuid(own(record, "deviceId"));
  const eventId = uuid(own(record, "eventId"));
  const idempotencyKey = text(own(record, "idempotencyKey"), 1, 200);
  const occurredAt = timestamp(own(record, "occurredAt"));
  return deviceId === undefined || eventId === undefined || idempotencyKey === undefined || occurredAt === undefined
    ? undefined : Object.freeze({ deviceId, eventId, idempotencyKey, occurredAt });
}

function parseScope(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  const restaurantId = record === undefined ? undefined : uuid(own(record, "restaurantId"));
  const branchId = record === undefined ? undefined : uuid(own(record, "branchId"));
  return restaurantId === undefined || branchId === undefined
    ? undefined : Object.freeze({ restaurantId, branchId }) as BranchScope;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
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

function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function paymentMethod(value: unknown): SimplePaymentMethodV1 | undefined {
  return typeof value === "string" && (SIMPLE_PAYMENT_METHODS as readonly string[]).includes(value)
    ? value as SimplePaymentMethodV1 : undefined;
}

function nullableSafeInteger(value: unknown, minimum = -Number.MAX_SAFE_INTEGER): number | null | undefined {
  return value === null ? null : integer(value, minimum, Number.MAX_SAFE_INTEGER);
}

function safeInteger(value: unknown): number | undefined {
  return integer(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
}

function integer(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value : undefined;
}

function currencyCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : undefined;
}

function text(value: unknown, minimum: number, maximum: number): string | undefined {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum
    && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length !== 24) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? value : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
