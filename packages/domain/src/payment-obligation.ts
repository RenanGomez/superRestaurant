import { Money } from "./money.js";
import type { OrderPaymentStatus } from "./commercial-order-state.js";

export interface DerivePaymentObligationInput {
  readonly ambiguousAmount: Money;
  readonly capturedAmount: Money;
  readonly orderTotal: Money;
  readonly pendingAmount: Money;
}

export interface PaymentObligationProjection {
  readonly ambiguousAmount: Money;
  readonly capturedAmount: Money;
  /** Null means a new collection must wait for authoritative reconciliation. */
  readonly collectibleAmount: Money | null;
  readonly orderTotal: Money;
  readonly overexposureAmount: Money;
  readonly paymentStatus: Extract<OrderPaymentStatus, "ambiguous" | "paid" | "partially_paid" | "pending" | "unpaid">;
  readonly pendingAmount: Money;
  readonly remainingBalance: Money;
  readonly unresolvedExposure: Money;
}

/**
 * Projects a checkout obligation without mutating Payment, Order or cash.
 * Pending and ambiguous attempts remain exposure, never captured money.
 */
export function derivePaymentObligation(inputValue: DerivePaymentObligationInput): PaymentObligationProjection {
  try {
    const input = normalizeInput(inputValue);
    if (input.orderTotal.amountMinor < 0 || input.capturedAmount.amountMinor < 0
      || input.pendingAmount.amountMinor < 0 || input.ambiguousAmount.amountMinor < 0
      || input.capturedAmount.compare(input.orderTotal) > 0) throw new InvalidPaymentObligationError();
    const remainingBalance = input.orderTotal.subtract(input.capturedAmount);
    const unresolvedExposure = input.pendingAmount.add(input.ambiguousAmount);
    const overexposureAmount = new Money(
      Math.max(0, unresolvedExposure.amountMinor - remainingBalance.amountMinor),
      input.orderTotal.currency,
    );
    const paymentStatus = input.ambiguousAmount.amountMinor > 0 ? "ambiguous"
      : input.pendingAmount.amountMinor > 0 ? "pending"
        : remainingBalance.amountMinor === 0 ? "paid"
          : input.capturedAmount.amountMinor > 0 ? "partially_paid" : "unpaid";
    const collectibleAmount = unresolvedExposure.amountMinor > 0 ? null : remainingBalance;
    return Object.freeze({
      ambiguousAmount: cloneMoney(input.ambiguousAmount),
      capturedAmount: cloneMoney(input.capturedAmount),
      collectibleAmount: collectibleAmount === null ? null : cloneMoney(collectibleAmount),
      orderTotal: cloneMoney(input.orderTotal),
      overexposureAmount: cloneMoney(overexposureAmount),
      paymentStatus,
      pendingAmount: cloneMoney(input.pendingAmount),
      remainingBalance: cloneMoney(remainingBalance),
      unresolvedExposure: cloneMoney(unresolvedExposure),
    });
  } catch (error: unknown) {
    if (error instanceof InvalidPaymentObligationError) throw error;
    throw new InvalidPaymentObligationError();
  }
}

export class InvalidPaymentObligationError extends Error {
  public readonly code = "INVALID_PAYMENT_OBLIGATION" as const;

  public constructor() {
    super("Payment obligation facts are invalid");
    this.name = "InvalidPaymentObligationError";
  }
}

function normalizeInput(value: DerivePaymentObligationInput): DerivePaymentObligationInput {
  const record = exactRecord(value, ["ambiguousAmount", "capturedAmount", "orderTotal", "pendingAmount"]);
  const ambiguousAmount = data(record, "ambiguousAmount");
  const capturedAmount = data(record, "capturedAmount");
  const orderTotal = data(record, "orderTotal");
  const pendingAmount = data(record, "pendingAmount");
  if (!isMoney(ambiguousAmount) || !isMoney(capturedAmount) || !isMoney(orderTotal) || !isMoney(pendingAmount)) {
    throw new InvalidPaymentObligationError();
  }
  const currency = orderTotal.currency;
  if (ambiguousAmount.currency !== currency || capturedAmount.currency !== currency || pendingAmount.currency !== currency) {
    throw new InvalidPaymentObligationError();
  }
  return Object.freeze({ ambiguousAmount, capturedAmount, orderTotal, pendingAmount });
}

function isMoney(value: unknown): value is Money {
  return value instanceof Money && Object.isFrozen(value);
}

function cloneMoney(value: Money): Money {
  return new Money(value.amountMinor, value.currency);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new InvalidPaymentObligationError();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new InvalidPaymentObligationError();
  }
  return value as Record<string, unknown>;
}

function data(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidPaymentObligationError();
  return descriptor.value;
}
