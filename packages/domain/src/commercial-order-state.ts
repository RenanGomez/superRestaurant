import { DomainError } from "./errors.js";
import type { OrderItemState } from "./order-state.js";

/** How the conversation entered the restaurant. It is never a fulfillment promise. */
export const ORDER_SOURCE_CHANNELS = Object.freeze([
  "phone",
  "whatsapp_manual",
  "counter",
  "table",
  "self_service",
  "integration",
] as const);

export type OrderSourceChannel = (typeof ORDER_SOURCE_CHANNELS)[number];

/** How the restaurant promises to hand the order to the customer. */
export const ORDER_FULFILLMENT_CHANNELS = Object.freeze([
  "dine_in",
  "counter",
  "pickup",
  "delivery",
] as const);

export type OrderFulfillmentChannel = (typeof ORDER_FULFILLMENT_CHANNELS)[number];

/** Commercial lifecycle only. Payment, preparation and fulfillment never mutate this axis implicitly. */
export type CommercialOrderState = "draft" | "confirmed" | "completed" | "cancelled" | "no_sale";

/** Operator ownership/continuity is independent from whether the customer confirmed the order. */
export type OrderAttentionState = "unclaimed" | "claimed" | "held";

/** Read model derived from authoritative item/KDS states; clients must not write it directly. */
export type OrderPreparationStatus =
  | "not_sent"
  | "queued"
  | "preparing"
  | "partially_ready"
  | "ready"
  | "cancelled";

/** Fulfillment has its own authority and cannot be inferred from payment or kitchen completion. */
export type OrderFulfillmentStatus =
  | "unconfirmed"
  | "scheduled"
  | "confirmed"
  | "ready"
  | "in_progress"
  | "fulfilled"
  | "failed"
  | "cancelled";

/** Aggregate payment projection. It is derived from authoritative Payment attempts and refunds. */
export type OrderPaymentStatus =
  | "unpaid"
  | "pending"
  | "ambiguous"
  | "partially_paid"
  | "paid"
  | "partially_refunded"
  | "refunded";

export interface CommercialOrderStatusSnapshot {
  readonly attention: OrderAttentionState;
  readonly fulfillment: OrderFulfillmentStatus;
  readonly order: CommercialOrderState;
  readonly payment: OrderPaymentStatus;
  readonly preparation: OrderPreparationStatus;
}

export class InvalidCommercialOrderTransitionError extends DomainError {
  public readonly code = "INVALID_COMMERCIAL_ORDER_TRANSITION";

  public constructor(from: unknown, to: unknown) {
    super("The commercial order lifecycle transition is not allowed.");
    this.from = from;
    this.to = to;
  }

  public readonly from: unknown;
  public readonly to: unknown;
}

export class InvalidOrderPreparationStateError extends DomainError {
  public readonly code = "INVALID_ORDER_PREPARATION_STATE";

  public constructor(public readonly state: unknown) {
    super("Preparation can only be projected from known order item states.");
  }
}

const commercialOrderTransitions: Readonly<Record<CommercialOrderState, readonly CommercialOrderState[]>> = {
  draft: ["confirmed", "cancelled", "no_sale"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_sale: [],
};

/**
 * Validates only the structural lifecycle. Authorization, cancellation cost,
 * inventory compensation and refund policy remain explicit application boundaries.
 */
export function transitionCommercialOrder(
  from: CommercialOrderState,
  to: CommercialOrderState,
): CommercialOrderState {
  if (!isCommercialOrderState(from) || !isCommercialOrderState(to)
    || !commercialOrderTransitions[from].includes(to)) {
    throw new InvalidCommercialOrderTransitionError(from, to);
  }
  return to;
}

/**
 * Projects kitchen progress from the existing item state machine. Cancelled
 * lines do not prevent the remaining active lines from becoming ready.
 */
export function deriveOrderPreparationStatus(
  itemStates: readonly OrderItemState[],
): OrderPreparationStatus {
  for (const state of itemStates) {
    if (!ORDER_ITEM_STATES.includes(state)) throw new InvalidOrderPreparationStateError(state);
  }
  if (itemStates.length === 0 || itemStates.every((state) => state === "pending")) return "not_sent";
  const active = itemStates.filter((state) => state !== "cancelled");
  if (active.length === 0) return "cancelled";
  if (active.every((state) => state === "ready" || state === "delivered")) return "ready";
  if (active.some((state) => state === "ready" || state === "delivered")) return "partially_ready";
  if (active.some((state) => state === "preparing")) return "preparing";
  return "queued";
}

const ORDER_ITEM_STATES: readonly OrderItemState[] = Object.freeze([
  "pending", "sent", "preparing", "ready", "delivered", "cancelled",
]);

function isCommercialOrderState(state: unknown): state is CommercialOrderState {
  return typeof state === "string" && Object.hasOwn(commercialOrderTransitions, state);
}
