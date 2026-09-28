import { Money } from "./money.js";
import { PAYMENT_INTENT_METHODS, type PaymentIntentMethod, type PaymentIntentTiming } from "./payment-intent.js";

/**
 * Fulfillment channels that determine a capture's payment-intent timing.
 * Mirrors (deliberately, per the domain's no-shared-types-dependency rule)
 * `CAPTURE_FULFILLMENT_CHANNELS` in packages/shared-types/src/commercial-capture.ts.
 */
export const CAPTURE_PAYMENT_INTENT_FULFILLMENT_CHANNELS = Object.freeze([
  "dine_in",
  "counter",
  "pickup",
  "delivery",
] as const);
export type CapturePaymentIntentFulfillmentChannel = (typeof CAPTURE_PAYMENT_INTENT_FULFILLMENT_CHANNELS)[number];

export const CAPTURE_PAYMENT_INTENT_STATUSES = Object.freeze(["ready", "insufficient"] as const);
export type CapturePaymentIntentStatus = (typeof CAPTURE_PAYMENT_INTENT_STATUSES)[number];

export class InvalidCapturePaymentIntentError extends Error {
  public readonly code = "INVALID_CAPTURE_PAYMENT_INTENT" as const;

  public constructor() {
    super("Capture payment intent facts are invalid");
    this.name = "InvalidCapturePaymentIntentError";
  }
}

/**
 * Timing is derived from the fulfillment channel, never chosen by the client:
 * delivery/pickup settle on_fulfillment; dine_in/counter settle now.
 */
export function deriveCapturePaymentIntentTiming(
  fulfillmentChannel: CapturePaymentIntentFulfillmentChannel,
): PaymentIntentTiming {
  if (!CAPTURE_PAYMENT_INTENT_FULFILLMENT_CHANNELS.includes(fulfillmentChannel)) {
    throw new InvalidCapturePaymentIntentError();
  }
  return fulfillmentChannel === "delivery" || fulfillmentChannel === "pickup" ? "on_fulfillment" : "now";
}

export interface BuildCapturePaymentIntentProjectionInput {
  readonly currency: string;
  readonly deliveryFeeMinor: number;
  readonly fulfillmentChannel: CapturePaymentIntentFulfillmentChannel;
  readonly itemsSubtotalMinor: number;
  readonly method: PaymentIntentMethod;
  readonly tenderedAmountMinor: number | null;
  readonly tipMinor: number;
}

/**
 * A non-financial capture-time projection of the customer's stated payment
 * intent. It never creates a Payment, changes an Order, or records a cash
 * movement; the tip is informational and deliberately excluded from
 * `orderTotalMinor` and from the change calculation.
 */
export interface CapturePaymentIntentProjection {
  readonly changeDueMinor: Money | null;
  readonly currency: string;
  readonly deliveryFeeMinor: number;
  readonly itemsSubtotalMinor: number;
  readonly method: PaymentIntentMethod;
  readonly orderTotalMinor: number;
  readonly status: CapturePaymentIntentStatus;
  readonly tenderedAmountMinor: number | null;
  readonly timing: PaymentIntentTiming;
  readonly tipMinor: number;
}

/**
 * Derives the authoritative capture payment-intent projection: total = items
 * subtotal + frozen delivery fee (tip excluded), timing derived from
 * fulfillment, and — when cash tender is stated — the invariant
 * `tenderedAmountMinor >= orderTotalMinor` (otherwise `status` is
 * `"insufficient"` and no change is computed; the caller must reject, not
 * clamp to a negative change).
 */
export function buildCapturePaymentIntentProjection(
  input: BuildCapturePaymentIntentProjectionInput,
): CapturePaymentIntentProjection {
  if (!isSafeNonNegativeInteger(input.itemsSubtotalMinor) || !isSafeNonNegativeInteger(input.deliveryFeeMinor)
    || !isSafeNonNegativeInteger(input.tipMinor) || !PAYMENT_INTENT_METHODS.includes(input.method)
    || !CAPTURE_PAYMENT_INTENT_FULFILLMENT_CHANNELS.includes(input.fulfillmentChannel)
    || (input.tenderedAmountMinor !== null && !isSafeNonNegativeInteger(input.tenderedAmountMinor))
    || (input.method !== "cash" && input.tenderedAmountMinor !== null)) {
    throw new InvalidCapturePaymentIntentError();
  }

  let itemsSubtotal: Money;
  let deliveryFee: Money;
  let orderTotal: Money;
  try {
    itemsSubtotal = new Money(input.itemsSubtotalMinor, input.currency);
    deliveryFee = new Money(input.deliveryFeeMinor, input.currency);
    orderTotal = itemsSubtotal.add(deliveryFee);
  } catch {
    throw new InvalidCapturePaymentIntentError();
  }

  const timing = deriveCapturePaymentIntentTiming(input.fulfillmentChannel);

  if (input.tenderedAmountMinor === null) {
    return Object.freeze({
      changeDueMinor: null,
      currency: orderTotal.currency,
      deliveryFeeMinor: deliveryFee.amountMinor,
      itemsSubtotalMinor: itemsSubtotal.amountMinor,
      method: input.method,
      orderTotalMinor: orderTotal.amountMinor,
      status: "ready" as const,
      tenderedAmountMinor: null,
      timing,
      tipMinor: input.tipMinor,
    });
  }

  let tendered: Money;
  try {
    tendered = new Money(input.tenderedAmountMinor, input.currency);
  } catch {
    throw new InvalidCapturePaymentIntentError();
  }
  if (tendered.compare(orderTotal) < 0) {
    return Object.freeze({
      changeDueMinor: null,
      currency: orderTotal.currency,
      deliveryFeeMinor: deliveryFee.amountMinor,
      itemsSubtotalMinor: itemsSubtotal.amountMinor,
      method: input.method,
      orderTotalMinor: orderTotal.amountMinor,
      status: "insufficient" as const,
      tenderedAmountMinor: tendered.amountMinor,
      timing,
      tipMinor: input.tipMinor,
    });
  }
  return Object.freeze({
    changeDueMinor: tendered.subtract(orderTotal),
    currency: orderTotal.currency,
    deliveryFeeMinor: deliveryFee.amountMinor,
    itemsSubtotalMinor: itemsSubtotal.amountMinor,
    method: input.method,
    orderTotalMinor: orderTotal.amountMinor,
    status: "ready" as const,
    tenderedAmountMinor: tendered.amountMinor,
    timing,
    tipMinor: input.tipMinor,
  });
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
