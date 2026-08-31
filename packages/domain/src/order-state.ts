import {
  DomainError,
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

export type CancellableOrderItemState = "pending" | "sent" | "preparing" | "ready";

interface OrderItemCancellationAuditBase {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly reason: string;
}

/** Pending-line cancellation needs a reason but does not inherently require a supervisor. */
export interface PendingOrderItemCancellationAudit extends OrderItemCancellationAuditBase {
  readonly from: "pending";
  readonly authorization?: CancellationAuthorization;
}

/** Once a line reached KDS, cancellation requires explicit supervisor evidence. */
export interface AuthorizedOrderItemCancellationAudit extends OrderItemCancellationAuditBase {
  readonly from: "sent" | "preparing" | "ready";
  readonly authorization: CancellationAuthorization;
}

/** Immutable evidence retained by every cancelled line and linked to its audit event. */
export type OrderItemCancellationAudit =
  | PendingOrderItemCancellationAudit
  | AuthorizedOrderItemCancellationAudit;

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
 * cancellation leaves its caller untouched. Every cancellation returns evidence
 * linked to an immutable audit event; post-send cancellation also requires a
 * supervisor authorization.
 */
export function transitionOrderItem(
  from: OrderItemState,
  to: OrderItemState,
  context: OrderItemTransitionContext = {},
): OrderItemTransition {
  if (!isOrderItemState(from) || !isOrderItemState(to) || !orderItemTransitions[from].includes(to)) {
    throw new InvalidOrderItemTransitionError(from, to);
  }

  if (to === "cancelled") {
    return Object.freeze({
      from,
      to,
      cancellationAudit: normalizeCancellationAudit(from as CancellableOrderItemState, context),
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

function normalizeCancellationAudit(
  from: CancellableOrderItemState,
  context: OrderItemTransitionContext,
): OrderItemCancellationAudit {
  return atCancellationBoundary(() => {
    const contextRecord = asPlainRecord(context);
    const auditValue = ownData(contextRecord, "cancellationAudit", false);
    if (auditValue === undefined) throw new OrderItemCancellationAuditContextRequiredError();
    const audit = asPlainRecord(auditValue);
    const evidenceFrom = ownText(audit, "from");
    if (evidenceFrom !== from) throw new OrderItemCancellationAuditContextRequiredError();
    const reason = ownText(audit, "reason", "reason");
    const occurredAt = ownText(audit, "occurredAt");
    assertCanonicalUtcInstant(occurredAt);
    const authorizationValue = ownData(audit, "authorization", false);
    const authorization = authorizationValue === undefined
      ? undefined
      : normalizeAuthorization(authorizationValue);
    if (from !== "pending" && authorization === undefined) {
      throw new OrderItemCancellationAuthorizationRequiredError();
    }
    const common = {
      eventId: ownText(audit, "eventId"),
      idempotencyKey: ownText(audit, "idempotencyKey"),
      actorId: ownText(audit, "actorId"),
      branchId: ownText(audit, "branchId"),
      deviceId: ownText(audit, "deviceId"),
      occurredAt,
      reason,
    };
    if (from === "pending") {
      return Object.freeze({
        ...common,
        from,
        ...(authorization === undefined ? {} : { authorization }),
      });
    }
    return Object.freeze({ ...common, from, authorization: authorization! });
  });
}

function normalizeAuthorization(value: unknown): CancellationAuthorization {
  const authorization = asPlainRecord(value);
  if (ownData(authorization, "approved", true) !== true) {
    throw new OrderItemCancellationAuthorizationRequiredError();
  }
  const actorId = ownText(authorization, "actorId", "authorization");
  return Object.freeze({ approved: true, actorId });
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OrderItemCancellationAuditContextRequiredError();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new OrderItemCancellationAuditContextRequiredError();
  }
  return value as Record<string, unknown>;
}

function ownData(record: Record<string, unknown>, key: string, required: boolean): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    if (required) throw new OrderItemCancellationAuditContextRequiredError();
    return undefined;
  }
  if (!("value" in descriptor)) throw new OrderItemCancellationAuditContextRequiredError();
  return descriptor.value;
}

function ownText(
  record: Record<string, unknown>,
  key: string,
  errorKind: "context" | "reason" | "authorization" = "context",
): string {
  const value = ownData(record, key, true);
  if (typeof value !== "string" || value.trim().length === 0) {
    if (errorKind === "reason") throw new OrderItemCancellationReasonRequiredError();
    if (errorKind === "authorization") throw new OrderItemCancellationAuthorizationRequiredError();
    throw new OrderItemCancellationAuditContextRequiredError();
  }
  return value;
}

function assertCanonicalUtcInstant(value: string): void {
  if (!value.endsWith("Z")) throw new OrderItemCancellationAuditContextRequiredError();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new OrderItemCancellationAuditContextRequiredError();
  const canonical = parsed.toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    throw new OrderItemCancellationAuditContextRequiredError();
  }
}

function atCancellationBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new OrderItemCancellationAuditContextRequiredError();
  }
}
