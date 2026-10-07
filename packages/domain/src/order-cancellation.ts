import type { OrderItemState, OrderRefundObligation, OrderState } from "./order-state.js";

export const ORDER_CANCELLATION_DELIVERY_STATES = Object.freeze([
  "assigned", "en_route", "delivered", "failed", "settled",
] as const);

export type OrderCancellationDeliveryState = (typeof ORDER_CANCELLATION_DELIVERY_STATES)[number];
export type OrderCancellationBlockReason =
  | "already_cancelled"
  | "closed"
  | "delivery_active"
  | "items_delivered";

export interface AssessOrderCancellationInput {
  readonly orderStatus: OrderState;
  readonly items: readonly { readonly orderItemId: string; readonly status: OrderItemState }[];
  /** State of the order's delivery row, or `null` when it has none (non-delivery orders, unassigned deliveries). */
  readonly deliveryStatus: OrderCancellationDeliveryState | null;
  readonly capturedAmountMinor: number;
}

export interface OrderCancellationAssessment {
  readonly eligible: boolean;
  readonly blockReason: OrderCancellationBlockReason | null;
  /** Captured money is never lost: it becomes a pending obligation to return it, not a blocker (S6 §5.1 decision 6). */
  readonly refundObligation: OrderRefundObligation;
  /** Every line that will end `cancelled` (pending, sent, preparing, ready), in order. Empty when blocked. */
  readonly itemsToCancel: readonly string[];
  /** The subset already on the kitchen's screen (sent, preparing, ready): each one needs a KDS correction. */
  readonly itemsNeedingKitchenCorrection: readonly string[];
}

export class InvalidOrderCancellationAssessmentError extends Error {
  public readonly code = "INVALID_ORDER_CANCELLATION_ASSESSMENT" as const;

  public constructor() {
    super("Order cancellation assessment input is invalid");
    this.name = "InvalidOrderCancellationAssessmentError";
  }
}

const orderStates: readonly string[] = ["draft", "open", "partially_paid", "paid", "closed", "cancelled"];
const itemStates: readonly string[] = ["pending", "sent", "preparing", "ready", "delivered", "cancelled"];

/**
 * Pure classification of a whole-order cancellation. It performs no mutation and trusts no permission; callers must
 * authorize the actor and persist every consequence atomically and idempotently.
 *
 * Precedence of block reasons: already cancelled, closed (history is never reopened), an active delivery
 * (`assigned|en_route`: the courier holds the order until they mark it failed or it is settled) and delivered lines
 * (food already served needs a refund flow, which is out of scope). A pending obligation is derived when money was
 * captured or the order reached `partially_paid|paid`.
 */
export function assessOrderCancellation(input: AssessOrderCancellationInput): OrderCancellationAssessment {
  const value = normalize(input);
  const refundObligation: OrderRefundObligation = value.capturedAmountMinor > 0
    || value.orderStatus === "partially_paid" || value.orderStatus === "paid"
    ? "pending"
    : "none";
  const blockReason: OrderCancellationBlockReason | null = value.orderStatus === "cancelled"
    ? "already_cancelled"
    : value.orderStatus === "closed"
      ? "closed"
      : value.deliveryStatus === "assigned" || value.deliveryStatus === "en_route"
        ? "delivery_active"
        : value.items.some((item) => item.status === "delivered")
          ? "items_delivered"
          : null;
  const blocked = blockReason !== null;
  const itemsToCancel = blocked ? [] : value.items
    .filter((item) => item.status === "pending" || item.status === "sent" || item.status === "preparing" || item.status === "ready")
    .map((item) => item.orderItemId);
  const itemsNeedingKitchenCorrection = blocked ? [] : value.items
    .filter((item) => item.status === "sent" || item.status === "preparing" || item.status === "ready")
    .map((item) => item.orderItemId);
  return Object.freeze({
    eligible: !blocked,
    blockReason,
    refundObligation,
    itemsToCancel: Object.freeze(itemsToCancel),
    itemsNeedingKitchenCorrection: Object.freeze(itemsNeedingKitchenCorrection),
  });
}

function normalize(input: AssessOrderCancellationInput): AssessOrderCancellationInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype) throw new InvalidOrderCancellationAssessmentError();
  const orderStatus: unknown = data(input, "orderStatus");
  const items: unknown = data(input, "items");
  const deliveryStatus: unknown = data(input, "deliveryStatus");
  const capturedAmountMinor: unknown = data(input, "capturedAmountMinor");
  if (typeof orderStatus !== "string" || !orderStates.includes(orderStatus)
    || !Array.isArray(items)
    || !(deliveryStatus === null
      || (typeof deliveryStatus === "string"
        && (ORDER_CANCELLATION_DELIVERY_STATES as readonly string[]).includes(deliveryStatus)))
    || typeof capturedAmountMinor !== "number" || !Number.isSafeInteger(capturedAmountMinor) || capturedAmountMinor < 0
  ) throw new InvalidOrderCancellationAssessmentError();
  const ids = new Set<string>();
  const normalizedItems: { orderItemId: string; status: OrderItemState }[] = [];
  for (const raw of items as readonly unknown[]) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new InvalidOrderCancellationAssessmentError();
    const orderItemId: unknown = data(raw as Record<string, unknown>, "orderItemId");
    const status: unknown = data(raw as Record<string, unknown>, "status");
    if (typeof orderItemId !== "string" || orderItemId.trim().length === 0 || ids.has(orderItemId)
      || typeof status !== "string" || !itemStates.includes(status)) throw new InvalidOrderCancellationAssessmentError();
    ids.add(orderItemId);
    normalizedItems.push({ orderItemId, status: status as OrderItemState });
  }
  return {
    orderStatus: orderStatus as OrderState,
    items: normalizedItems,
    deliveryStatus: deliveryStatus as OrderCancellationDeliveryState | null,
    capturedAmountMinor,
  };
}

function data(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new InvalidOrderCancellationAssessmentError();
  return descriptor.value;
}
