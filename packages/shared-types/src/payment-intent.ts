export const PAYMENT_INTENT_SCHEMA_VERSION = 1 as const;
export const PAYMENT_INTENT_METHODS_V1 = Object.freeze(["cash", "card_manual", "transfer"] as const);
export const PAYMENT_INTENT_TIMINGS_V1 = Object.freeze(["now", "on_fulfillment"] as const);

export type PaymentIntentMethodV1 = (typeof PAYMENT_INTENT_METHODS_V1)[number];
export type PaymentIntentTimingV1 = (typeof PAYMENT_INTENT_TIMINGS_V1)[number];

export interface QuotePaymentIntentRequestV1 {
  readonly capturedAmountMinor: number;
  readonly currency: string;
  readonly method: PaymentIntentMethodV1;
  readonly orderTotalMinor: number;
  readonly plannedAmountMinor: number;
  readonly schemaVersion: typeof PAYMENT_INTENT_SCHEMA_VERSION;
  readonly tenderedAmountMinor: number | null;
  readonly timing: PaymentIntentTimingV1;
}

export interface PaymentIntentQuoteV1 extends QuotePaymentIntentRequestV1 {
  readonly changeDueMinor: number | null;
  readonly remainingAfterPlanMinor: number;
  readonly remainingBeforePlanMinor: number;
}

export function parseQuotePaymentIntentRequestV1(value: unknown): QuotePaymentIntentRequestV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "capturedAmountMinor", "currency", "method", "orderTotalMinor", "plannedAmountMinor",
      "tenderedAmountMinor", "timing",
    ]);
    if (record === undefined || own(record, "schemaVersion") !== PAYMENT_INTENT_SCHEMA_VERSION) return undefined;
    const capturedAmountMinor = money(own(record, "capturedAmountMinor"), true);
    const currency = currencyCode(own(record, "currency"));
    const method = member(PAYMENT_INTENT_METHODS_V1, own(record, "method"));
    const orderTotalMinor = money(own(record, "orderTotalMinor"), true);
    const plannedAmountMinor = money(own(record, "plannedAmountMinor"), false);
    const rawTendered = own(record, "tenderedAmountMinor");
    const tenderedAmountMinor = rawTendered === null ? null : money(rawTendered, false);
    const timing = member(PAYMENT_INTENT_TIMINGS_V1, own(record, "timing"));
    if (capturedAmountMinor === undefined || currency === undefined || method === undefined
      || orderTotalMinor === undefined || plannedAmountMinor === undefined || tenderedAmountMinor === undefined
      || timing === undefined || capturedAmountMinor > orderTotalMinor
      || plannedAmountMinor > orderTotalMinor - capturedAmountMinor
      || (method !== "cash" && tenderedAmountMinor !== null)
      || (tenderedAmountMinor !== null && tenderedAmountMinor < plannedAmountMinor)) return undefined;
    return Object.freeze({
      capturedAmountMinor, currency, method, orderTotalMinor, plannedAmountMinor,
      schemaVersion: PAYMENT_INTENT_SCHEMA_VERSION, tenderedAmountMinor, timing,
    });
  });
}

export function parsePaymentIntentQuoteV1(value: unknown): PaymentIntentQuoteV1 | undefined {
  return safely(() => {
    const record = exactRecord(value, [
      "schemaVersion", "capturedAmountMinor", "currency", "method", "orderTotalMinor", "plannedAmountMinor",
      "tenderedAmountMinor", "timing", "changeDueMinor", "remainingAfterPlanMinor", "remainingBeforePlanMinor",
    ]);
    if (record === undefined) return undefined;
    const request = parseQuotePaymentIntentRequestV1({
      capturedAmountMinor: own(record, "capturedAmountMinor"),
      currency: own(record, "currency"),
      method: own(record, "method"),
      orderTotalMinor: own(record, "orderTotalMinor"),
      plannedAmountMinor: own(record, "plannedAmountMinor"),
      schemaVersion: own(record, "schemaVersion"),
      tenderedAmountMinor: own(record, "tenderedAmountMinor"),
      timing: own(record, "timing"),
    });
    const rawChange = own(record, "changeDueMinor");
    const changeDueMinor = rawChange === null ? null : money(rawChange, true);
    const remainingAfterPlanMinor = money(own(record, "remainingAfterPlanMinor"), true);
    const remainingBeforePlanMinor = money(own(record, "remainingBeforePlanMinor"), true);
    if (request === undefined || changeDueMinor === undefined || remainingAfterPlanMinor === undefined
      || remainingBeforePlanMinor === undefined) return undefined;
    if (remainingBeforePlanMinor !== request.orderTotalMinor - request.capturedAmountMinor
      || remainingAfterPlanMinor !== remainingBeforePlanMinor - request.plannedAmountMinor
      || remainingBeforePlanMinor < request.plannedAmountMinor
      || (request.tenderedAmountMinor === null) !== (changeDueMinor === null)
      || (changeDueMinor !== null && changeDueMinor !== (request.tenderedAmountMinor as number) - request.plannedAmountMinor)) {
      return undefined;
    }
    return Object.freeze({ ...request, changeDueMinor, remainingAfterPlanMinor, remainingBeforePlanMinor });
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
