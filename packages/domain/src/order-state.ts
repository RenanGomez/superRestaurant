import {
  InvalidOrderItemTransitionError,
  InvalidOrderStateError,
  InvalidOrderTransitionError,
  OrderDoesNotAcceptNewLinesError,
  OrderItemCancellationAuditContextRequiredError,
  OrderItemCancellationAuthorizationRequiredError,
  OrderItemCancellationReasonRequiredError,
} from "./errors.js";

export type OrderState = "draft" | "open" | "partially_paid" | "paid" | "closed" | "cancelled";
export type OrderItemState =
  | "pending"
  | "sent"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export interface CancellationAuthorization {
  readonly approved: true;
  readonly actorId: string;
}

/**
 * Evidence that the application layer must persist with a sensitive item
 * cancellation. The domain stays storage-free but returns this exact evidence
 * in the transition result so the caller cannot lose it before audit logging.
 */
export interface OrderItemCancellationAudit {
  readonly actorId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason: string;
  readonly authorization: CancellationAuthorization;
}

export interface OrderItemTransitionContext {
  readonly cancellationAudit?: OrderItemCancellationAudit;
}

/** A validated, immutable transition that is safe for the caller to persist. */
export interface OrderItemTransition {
  readonly from: OrderItemState;
  readonly to: OrderItemState;
  readonly cancellationAudit?: OrderItemCancellationAudit;
}

const orderTransitions: Readonly<Record<OrderState, readonly OrderState[]>> = {
  draft: ["open", "cancelled"],
  open: ["partially_paid", "paid", "cancelled"],
  partially_paid: ["paid"],
  paid: ["closed"],
  closed: [],
  cancelled: [],
};

const orderItemTransitions: Readonly<Record<OrderItemState, readonly OrderItemState[]>> = {
  pending: ["sent", "cancelled"],
  sent: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

/**
 * The payment lifecycle does not by itself prohibit adding lines. The plan only
 * prohibits new lines once an order is paid or closed; later payment rules may
 * constrain settlement adjustments without changing this state invariant.
 */
export function orderAcceptsNewLines(state: OrderState): boolean {
  if (!isOrderState(state)) {
    throw new InvalidOrderStateError(state);
  }
  return state === "draft" || state === "open" || state === "partially_paid";
}

export function assertOrderAcceptsNewLines(state: OrderState): void {
  if (!orderAcceptsNewLines(state)) {
    throw new OrderDoesNotAcceptNewLinesError(state);
  }
}

/** Returns the next state; it never mutates an order. */
export function transitionOrder(from: OrderState, to: OrderState): OrderState {
  if (!isOrderState(from) || !isOrderState(to) || !orderTransitions[from].includes(to)) {
    throw new InvalidOrderTransitionError(from, to);
  }

  return to;
}

/**
 * Returns a validated transition record; it never mutates an item. A rejected
 * cancellation leaves its caller untouched. For an item already sent to KDS,
 * the returned record carries the complete evidence that the application layer
 * must write to its immutable audit log.
 */
export function transitionOrderItem(
  from: OrderItemState,
  to: OrderItemState,
  context: OrderItemTransitionContext = {},
): OrderItemTransition {
  if (!isOrderItemState(from) || !isOrderItemState(to) || !orderItemTransitions[from].includes(to)) {
    throw new InvalidOrderItemTransitionError(from, to);
  }

  if (to === "cancelled" && from !== "pending") {
    return Object.freeze({
      from,
      to,
      cancellationAudit: freezeCancellationAudit(assertPostSendCancellation(context)),
    });
  }

  return Object.freeze({ from, to });
}

function isOrderState(state: unknown): state is OrderState {
  return typeof state === "string" && (Object.hasOwn(orderTransitions, state));
}

function isOrderItemState(state: unknown): state is OrderItemState {
  return typeof state === "string" && (Object.hasOwn(orderItemTransitions, state));
}

function assertPostSendCancellation(
  context: OrderItemTransitionContext,
): OrderItemCancellationAudit {
  const audit = context.cancellationAudit;
  if (audit === undefined) {
    throw new OrderItemCancellationAuditContextRequiredError();
  }

  if (!hasText(audit.reason)) {
    throw new OrderItemCancellationReasonRequiredError();
  }

  const authorization = audit.authorization;
  if (authorization?.approved !== true || !hasText(authorization?.actorId ?? "")) {
    throw new OrderItemCancellationAuthorizationRequiredError();
  }

  if (!hasText(audit.actorId) || !hasText(audit.branchId) || !hasText(audit.deviceId) || !hasText(audit.occurredAt)) {
    throw new OrderItemCancellationAuditContextRequiredError();
  }

  return audit;
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function freezeCancellationAudit(audit: OrderItemCancellationAudit): OrderItemCancellationAudit {
  return Object.freeze({
    ...audit,
    authorization: Object.freeze({ ...audit.authorization }),
  });
}
