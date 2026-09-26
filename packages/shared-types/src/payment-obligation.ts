export const PAYMENT_OBLIGATION_SCHEMA_VERSION = 1 as const;

export const PAYMENT_OBLIGATION_STATUSES_V1 = Object.freeze([
  "unpaid",
  "pending",
  "ambiguous",
  "partially_paid",
  "paid",
] as const);

export type PaymentObligationStatusV1 = (typeof PAYMENT_OBLIGATION_STATUSES_V1)[number];

export interface ProjectPaymentObligationRequestV1 {
  readonly ambiguousAmountMinor: number;
  readonly capturedAmountMinor: number;
  readonly currency: string;
  readonly orderTotalMinor: number;
  readonly pendingAmountMinor: number;
  readonly schemaVersion: typeof PAYMENT_OBLIGATION_SCHEMA_VERSION;
}

export interface PaymentObligationProjectionV1 extends ProjectPaymentObligationRequestV1 {
  readonly collectibleAmountMinor: number | null;
  readonly overexposureAmountMinor: number;
  readonly paymentStatus: PaymentObligationStatusV1;
  readonly remainingBalanceMinor: number;
  readonly unresolvedExposureMinor: number;
}

export function parseProjectPaymentObligationRequestV1(
  value: unknown,
): ProjectPaymentObligationRequestV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "ambiguousAmountMinor", "capturedAmountMinor", "currency", "orderTotalMinor",
      "pendingAmountMinor",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== PAYMENT_OBLIGATION_SCHEMA_VERSION) return undefined;
    const ambiguousAmountMinor = money(own(record, "ambiguousAmountMinor"));
    const capturedAmountMinor = money(own(record, "capturedAmountMinor"));
    const currency = currencyCode(own(record, "currency"));
    const orderTotalMinor = money(own(record, "orderTotalMinor"));
    const pendingAmountMinor = money(own(record, "pendingAmountMinor"));
    const unresolvedExposureMinor = ambiguousAmountMinor === undefined || pendingAmountMinor === undefined
      ? undefined : ambiguousAmountMinor + pendingAmountMinor;
    if (ambiguousAmountMinor === undefined || capturedAmountMinor === undefined || currency === undefined
      || orderTotalMinor === undefined || pendingAmountMinor === undefined
      || capturedAmountMinor > orderTotalMinor || !Number.isSafeInteger(unresolvedExposureMinor)) return undefined;
    return Object.freeze({
      ambiguousAmountMinor,
      capturedAmountMinor,
      currency,
      orderTotalMinor,
      pendingAmountMinor,
      schemaVersion: PAYMENT_OBLIGATION_SCHEMA_VERSION,
    });
  });
}

export function parsePaymentObligationProjectionV1(value: unknown): PaymentObligationProjectionV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "ambiguousAmountMinor", "capturedAmountMinor", "currency", "orderTotalMinor",
      "pendingAmountMinor", "collectibleAmountMinor", "overexposureAmountMinor", "paymentStatus",
      "remainingBalanceMinor", "unresolvedExposureMinor",
    ]);
    if (record === undefined) return undefined;
    const request = parseProjectPaymentObligationRequestV1({
      ambiguousAmountMinor: own(record, "ambiguousAmountMinor"),
      capturedAmountMinor: own(record, "capturedAmountMinor"),
      currency: own(record, "currency"),
      orderTotalMinor: own(record, "orderTotalMinor"),
      pendingAmountMinor: own(record, "pendingAmountMinor"),
      schemaVersion: own(record, "schemaVersion"),
    });
    const rawCollectible = own(record, "collectibleAmountMinor");
    const collectibleAmountMinor = rawCollectible === null ? null : money(rawCollectible);
    const overexposureAmountMinor = money(own(record, "overexposureAmountMinor"));
    const paymentStatus = status(own(record, "paymentStatus"));
    const remainingBalanceMinor = money(own(record, "remainingBalanceMinor"));
    const unresolvedExposureMinor = money(own(record, "unresolvedExposureMinor"));
    if (request === undefined || collectibleAmountMinor === undefined || overexposureAmountMinor === undefined
      || paymentStatus === undefined || remainingBalanceMinor === undefined || unresolvedExposureMinor === undefined) {
      return undefined;
    }
    const expectedRemaining = request.orderTotalMinor - request.capturedAmountMinor;
    const expectedExposure = request.pendingAmountMinor + request.ambiguousAmountMinor;
    const expectedOverexposure = Math.max(0, expectedExposure - expectedRemaining);
    const expectedStatus: PaymentObligationStatusV1 = request.ambiguousAmountMinor > 0 ? "ambiguous"
      : request.pendingAmountMinor > 0 ? "pending"
        : expectedRemaining === 0 ? "paid"
          : request.capturedAmountMinor > 0 ? "partially_paid" : "unpaid";
    if (remainingBalanceMinor !== expectedRemaining || unresolvedExposureMinor !== expectedExposure
      || overexposureAmountMinor !== expectedOverexposure || paymentStatus !== expectedStatus
      || (expectedExposure > 0 ? collectibleAmountMinor !== null : collectibleAmountMinor !== expectedRemaining)) {
      return undefined;
    }
    return Object.freeze({
      ...request,
      collectibleAmountMinor,
      overexposureAmountMinor,
      paymentStatus,
      remainingBalanceMinor,
      unresolvedExposureMinor,
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

function money(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function currencyCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z]{3}$/u.test(value) ? value : undefined;
}

function status(value: unknown): PaymentObligationStatusV1 | undefined {
  return typeof value === "string" && (PAYMENT_OBLIGATION_STATUSES_V1 as readonly string[]).includes(value)
    ? value as PaymentObligationStatusV1 : undefined;
}

function safely<T>(operation: () => T | undefined): T | undefined {
  try { return operation(); } catch { return undefined; }
}
