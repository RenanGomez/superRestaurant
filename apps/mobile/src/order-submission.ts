/**
 * Runs one delivery plan against the Order endpoints, in the only order the
 * contracts accept: `CreateOrderCommandV2`, then one `AddOrderItemCommandV1`
 * per line, then `OpenOrderCommandV1`.
 *
 * Two things make this more than a loop.
 *
 * **`expectedVersion` is never guessed.** Each step sends the version the
 * *previous* authoritative response reported. Nothing here assumes a version
 * advances by one, or reuses a version the client computed itself.
 *
 * **A retry resumes; it does not repeat.** `create` is idempotent by
 * `idempotencyKey`, so retrying it answers `replayed` — but `addItem` and
 * `open` are guarded by `expectedVersion` on the server, so a step that already
 * landed would come back as a conflict rather than a replay. Blindly retrying
 * the sequence would therefore strand a delivery that had half succeeded. So
 * when `create` replays, the current state of that order is read back from
 * `GET /api/v1/orders/active` — the same authoritative list the table screen
 * shows — and only the lines whose `orderItemId` is not there yet are sent. The
 * ids come from the immutable plan, which is exactly what makes them
 * recognisable across attempts.
 *
 * Failure stops the sequence where it happened: no further request is made, and
 * `open` is never reached while a line is unconfirmed. What already succeeded
 * stays succeeded on the server, and retrying the same plan continues from
 * there rather than duplicating it.
 */
import type {
  ActiveTableOrderListV2,
  ActiveTableOrderSummaryV2,
  AddOrderItemCommandV1,
  BranchScope,
  CreateOrderCommandV2,
  OpenOrderCommandV1,
  OrderMutationSummaryV1,
} from "@super-restaurant/shared-types";

import { MobileRequestError } from "./mobile-client.js";
import type { OrderDraftFailure } from "./order-draft.js";
import type { OrderDeliveryLinePlanV1, OrderDeliveryPlanV1 } from "./order-plan.js";
import { toMobileFailure } from "./mobile-state.js";

/** Which step a failure belongs to, so the screen can say what is unconfirmed. */
export type OrderSubmissionStep = "addItem" | "create" | "open" | "read";

export type OrderSubmissionOutcome =
  | {
    readonly kind: "sent";
    readonly orderId: string;
    /** The version the last authoritative response reported. */
    readonly version: number;
  }
  | {
    readonly failure: OrderDraftFailure;
    readonly kind: "failed";
    readonly step: OrderSubmissionStep;
  };

/** The four calls one delivery can make. Nothing else is reachable from here. */
export interface OrderMutationTransport {
  readonly addItem: (command: AddOrderItemCommandV1) => Promise<OrderMutationSummaryV1>;
  readonly createOrder: (command: CreateOrderCommandV2) => Promise<OrderMutationSummaryV1>;
  readonly listActiveOrders: (tableId: string) => Promise<ActiveTableOrderListV2>;
  readonly openOrder: (command: OpenOrderCommandV1) => Promise<OrderMutationSummaryV1>;
}

/** Statuses in which the order is already past `draft`: `open` must not be sent again. */
const ALREADY_OPEN = Object.freeze(["open", "partially_paid", "paid", "closed"] as const);

export async function submitOrderPlan({ plan, transport }: {
  readonly plan: OrderDeliveryPlanV1;
  readonly transport: OrderMutationTransport;
}): Promise<OrderSubmissionOutcome> {
  const scope = plan.scope as unknown as BranchScope;

  let created: OrderMutationSummaryV1;
  try {
    created = await transport.createOrder(Object.freeze({
      channel: plan.channel,
      currency: plan.currency,
      deviceId: plan.deviceId,
      eventId: plan.createOrder.eventId,
      idempotencyKey: plan.createOrder.idempotencyKey,
      occurredAt: plan.occurredAt,
      orderId: plan.orderId,
      schemaVersion: 2,
      scope,
      shiftId: plan.shiftId,
      tableId: plan.tableId,
      timeZone: plan.timeZone,
    }));
  } catch (error: unknown) {
    return failed("create", error);
  }

  let version = created.version;
  let status: OrderMutationSummaryV1["orderStatus"] = created.orderStatus;
  let applied: ReadonlySet<string> = new Set();

  if (created.replayed) {
    // This plan has been attempted before. What is already on the server is the
    // only thing that can say how far it got.
    let list: ActiveTableOrderListV2;
    try {
      list = await transport.listActiveOrders(plan.tableId);
    } catch (error: unknown) {
      return failed("read", error);
    }
    const existing = list.orders.find((order) => order.orderId.toLowerCase() === plan.orderId);
    if (existing === undefined) {
      // The order is no longer active. If the previous attempt got it open, the
      // delivery is done; anything else is a state this screen cannot resolve.
      return (ALREADY_OPEN as readonly string[]).includes(status)
        ? Object.freeze({ kind: "sent", orderId: plan.orderId, version })
        : Object.freeze({ failure: "conflict", kind: "failed", step: "read" });
    }
    version = existing.version;
    status = existing.status;
    applied = appliedItems(existing);
  }

  for (const line of pendingLines(plan.addItems, applied)) {
    let summary: OrderMutationSummaryV1;
    try {
      summary = await transport.addItem(Object.freeze({
        deviceId: plan.deviceId,
        eventId: line.eventId,
        expectedVersion: version,
        idempotencyKey: line.idempotencyKey,
        modifierGroups: line.modifierGroups,
        occurredAt: plan.occurredAt,
        orderId: plan.orderId,
        orderItemId: line.orderItemId,
        productId: line.productId,
        quantity: line.quantity,
        schemaVersion: 1,
        scope,
      }));
    } catch (error: unknown) {
      // Stops here. `open` is unreachable while a line is unconfirmed.
      return failed("addItem", error);
    }
    version = summary.version;
    status = summary.orderStatus;
  }

  if (!(ALREADY_OPEN as readonly string[]).includes(status)) {
    let opened: OrderMutationSummaryV1;
    try {
      opened = await transport.openOrder(Object.freeze({
        deviceId: plan.deviceId,
        eventId: plan.openOrder.eventId,
        expectedVersion: version,
        idempotencyKey: plan.openOrder.idempotencyKey,
        occurredAt: plan.occurredAt,
        orderId: plan.orderId,
        schemaVersion: 1,
        scope,
      }));
    } catch (error: unknown) {
      return failed("open", error);
    }
    version = opened.version;
  }

  return Object.freeze({ kind: "sent", orderId: plan.orderId, version });
}

/** The order of the plan is preserved: a resumed delivery adds what is missing, in place. */
function pendingLines(
  lines: readonly OrderDeliveryLinePlanV1[],
  applied: ReadonlySet<string>,
): readonly OrderDeliveryLinePlanV1[] {
  return lines.filter((line) => !applied.has(line.orderItemId));
}

/**
 * Every id the order already carries, whatever the line's status. A cancelled
 * line counts as applied: its `orderItemId` is taken, so sending it again would
 * be refused as a duplicate, and reviving a line the kitchen cancelled is not
 * something a retry may decide.
 */
function appliedItems(order: ActiveTableOrderSummaryV2): ReadonlySet<string> {
  return new Set(order.items.map((item) => item.orderItemId.toLowerCase()));
}

function failed(step: OrderSubmissionStep, error: unknown): OrderSubmissionOutcome {
  return Object.freeze({ failure: toOrderSubmissionFailure(error), kind: "failed", step });
}

/**
 * A version conflict is its own operational state: it means the order moved
 * under this device, which the operator has to be told about rather than shown
 * as "the service is unavailable".
 */
export function toOrderSubmissionFailure(error: unknown): OrderDraftFailure {
  return error instanceof MobileRequestError && error.status === 409 ? "conflict" : toMobileFailure(error);
}

/**
 * The one effect boundary between the composer and the Order endpoints. The
 * screen holds a port, not a client: the harness substitutes an outcome, a test
 * substitutes a controlled promise, and production substitutes the real
 * sequence — none of them changes the screen.
 */
export interface OrderDeliveryPort {
  readonly deliver: (plan: OrderDeliveryPlanV1) => Promise<OrderDraftFailure | undefined>;
}

/** The productive port: it runs the plan against the three Order paths. */
export function createOrderDeliveryPort(transport: OrderMutationTransport): OrderDeliveryPort {
  return Object.freeze({
    deliver: async (plan: OrderDeliveryPlanV1): Promise<OrderDraftFailure | undefined> => {
      const outcome = await submitOrderPlan({ plan, transport });
      return outcome.kind === "sent" ? undefined : outcome.failure;
    },
  });
}
