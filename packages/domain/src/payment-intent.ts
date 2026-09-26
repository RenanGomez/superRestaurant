import { Money } from "./money.js";

export const PAYMENT_INTENT_METHODS = Object.freeze(["cash", "card_manual", "transfer"] as const);
export const PAYMENT_INTENT_TIMINGS = Object.freeze(["now", "on_fulfillment"] as const);

export type PaymentIntentMethod = (typeof PAYMENT_INTENT_METHODS)[number];
export type PaymentIntentTiming = (typeof PAYMENT_INTENT_TIMINGS)[number];

export interface BuildPaymentIntentQuoteInput {
  readonly capturedAmount: Money;
  readonly method: PaymentIntentMethod;
  readonly orderTotal: Money;
  readonly plannedAmount: Money;
  readonly tenderedAmount: Money | null;
  readonly timing: PaymentIntentTiming;
}

/**
 * A non-financial quote used while capturing the customer's stated payment plan.
 * It never creates a Payment, changes an Order, or records a cash movement.
 */
export interface PaymentIntentQuote {
  readonly capturedAmount: Money;
  readonly changeDue: Money | null;
  readonly method: PaymentIntentMethod;
  readonly orderTotal: Money;
  readonly plannedAmount: Money;
  readonly remainingAfterPlan: Money;
  readonly remainingBeforePlan: Money;
  readonly tenderedAmount: Money | null;
  readonly timing: PaymentIntentTiming;
}

/**
 * Calculates an exact, informational payment intention against confirmed money facts.
 * The caller must persist/revalidate the source versions before any financial effect.
 */
export function buildPaymentIntentQuote(inputValue: BuildPaymentIntentQuoteInput): PaymentIntentQuote {
  try {
    const input = normalizeInput(inputValue);
    const remainingBeforePlan = input.orderTotal.subtract(input.capturedAmount);
    if (input.orderTotal.amountMinor < 0 || input.capturedAmount.amountMinor < 0
      || input.plannedAmount.amountMinor <= 0 || remainingBeforePlan.amountMinor < input.plannedAmount.amountMinor) {
      throw new InvalidPaymentIntentError();
    }
    if (input.method !== "cash" && input.tenderedAmount !== null) throw new InvalidPaymentIntentError();
    if (input.tenderedAmount !== null && input.tenderedAmount.compare(input.plannedAmount) < 0) {
      throw new InvalidPaymentIntentError();
    }

    const changeDue = input.tenderedAmount === null
      ? null
      : input.tenderedAmount.subtract(input.plannedAmount);
    return Object.freeze({
      capturedAmount: cloneMoney(input.capturedAmount),
      changeDue: changeDue === null ? null : cloneMoney(changeDue),
      method: input.method,
      orderTotal: cloneMoney(input.orderTotal),
      plannedAmount: cloneMoney(input.plannedAmount),
      remainingAfterPlan: cloneMoney(remainingBeforePlan.subtract(input.plannedAmount)),
      remainingBeforePlan: cloneMoney(remainingBeforePlan),
      tenderedAmount: input.tenderedAmount === null ? null : cloneMoney(input.tenderedAmount),
      timing: input.timing,
    });
  } catch (error: unknown) {
    if (error instanceof InvalidPaymentIntentError) throw error;
    throw new InvalidPaymentIntentError();
  }
}

export class InvalidPaymentIntentError extends Error {
  public readonly code = "INVALID_PAYMENT_INTENT" as const;

  public constructor() {
    super("Payment intent facts are invalid");
    this.name = "InvalidPaymentIntentError";
  }
}

function normalizeInput(value: BuildPaymentIntentQuoteInput): BuildPaymentIntentQuoteInput {
  const record = exactRecord(value, [
    "capturedAmount", "method", "orderTotal", "plannedAmount", "tenderedAmount", "timing",
  ]);
  const capturedAmount = data(record, "capturedAmount");
  const method = data(record, "method");
  const orderTotal = data(record, "orderTotal");
  const plannedAmount = data(record, "plannedAmount");
  const tenderedAmount = data(record, "tenderedAmount");
  const timing = data(record, "timing");
  if (!isMoney(capturedAmount) || !isMoney(orderTotal) || !isMoney(plannedAmount)
    || (tenderedAmount !== null && !isMoney(tenderedAmount))
    || !includes(PAYMENT_INTENT_METHODS, method) || !includes(PAYMENT_INTENT_TIMINGS, timing)) {
    throw new InvalidPaymentIntentError();
  }
  const currency = orderTotal.currency;
  if (capturedAmount.currency !== currency || plannedAmount.currency !== currency
    || (tenderedAmount !== null && tenderedAmount.currency !== currency)) {
    throw new InvalidPaymentIntentError();
  }
  return Object.freeze({ capturedAmount, method, orderTotal, plannedAmount, tenderedAmount, timing });
}

function isMoney(value: unknown): value is Money {
  return value instanceof Money && Object.isFrozen(value);
}

function cloneMoney(value: Money): Money {
  return new Money(value.amountMinor, value.currency);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new InvalidPaymentIntentError();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new InvalidPaymentIntentError();
  }
  return value as Record<string, unknown>;
}

function data(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidPaymentIntentError();
  return descriptor.value;
}

function includes<const T extends readonly unknown[]>(values: T, value: unknown): value is T[number] {
  return values.includes(value);
}
