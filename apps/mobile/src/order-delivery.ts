/**
 * Keeps at most one draft delivery in flight, and keeps it tied to the context
 * it was started for.
 *
 * A boolean "sending" flag could only ever say that *something* was in flight.
 * That was enough to make two things go wrong: an integration whose promise
 * never settled blocked every later delivery — including one belonging to a
 * different operator, branch or shift — and an outcome that arrived long after
 * a context change was applied to whatever draft existed by then.
 *
 * So an attempt carries a serial and its context. Only an attempt started for
 * the *same* context blocks a new one; only the outcome of the attempt whose
 * serial is still current is ever applied; and `abandon` drops the current
 * attempt outright, which is what a context change does. Nothing here performs
 * a request, and nothing here knows what a request is: the integration is the
 * only effect, and it is called exactly once per accepted attempt.
 */
import type { OrderDraftFailure } from "./order-draft.js";
import type { OrderDeliveryPlanV1 } from "./order-plan.js";
import type { OrderDeliveryPort } from "./order-submission.js";

export interface OrderDeliveryRun {
  /** Which operator, restaurant, branch and shift this delivery belongs to. */
  readonly context: string;
  /**
   * The plan for this delivery, or `undefined` for a draft the current catalog
   * refuses. A retry of the same draft returns the *same* plan, byte for byte,
   * which is what makes the retry idempotent rather than a second order.
   */
  readonly build: () => OrderDeliveryPlanV1 | undefined;
  readonly integration: OrderDeliveryPort;
  /** Runs synchronously when the attempt is accepted, before anything else. */
  readonly onStart: () => void;
  /** Runs at most once, and never for an attempt that is no longer current. */
  readonly onSettle: (failure: OrderDraftFailure | undefined) => void;
}

export interface OrderDeliveryTracker {
  /**
   * Drops the attempt in flight, if any. Its outcome, whenever it arrives, is
   * ignored, and the next context is not blocked by it.
   */
  readonly abandon: () => void;
  /**
   * Runs one delivery. Returns `false`, having done nothing at all, when a
   * delivery for the same context is already in flight.
   */
  readonly run: (input: OrderDeliveryRun) => boolean;
}

export function createOrderDeliveryTracker(): OrderDeliveryTracker {
  let current: { readonly context: string; readonly serial: number } | undefined;
  let serials = 0;

  function run(input: OrderDeliveryRun): boolean {
    // A hand-over already in flight for this very context is the double tap
    // this guards against. One left hanging by an earlier context is not: it
    // has been superseded, and holding this delivery for it would strand the
    // operator who is here now.
    if (current?.context === input.context) return false;

    serials += 1;
    const serial = serials;
    current = { context: input.context, serial };
    input.onStart();

    // Exactly one outcome reaches the caller, and only while this attempt is
    // still the current one. A late resolution, a rejection after the context
    // changed, or a second call from a badly behaved integration all stop here.
    const settle = (failure: OrderDraftFailure | undefined): void => {
      if (current?.serial !== serial) return;
      current = undefined;
      input.onSettle(failure);
    };

    let plan: OrderDeliveryPlanV1 | undefined;
    try {
      plan = input.build();
    } catch {
      settle("unavailable");
      return true;
    }
    if (plan === undefined) {
      settle("stale");
      return true;
    }

    // The single effect boundary. An integration that throws before returning,
    // or returns something that is not a promise, is contained here: neither
    // can leave a stuck `sending` or an unhandled rejection.
    let delivery: Promise<OrderDraftFailure | undefined>;
    try {
      delivery = Promise.resolve(input.integration.deliver(plan));
    } catch {
      settle("unavailable");
      return true;
    }
    // Two arguments rather than `.catch`, so a throw from `onSettle` itself is
    // not mistaken for the integration failing.
    void delivery.then(settle, () => { settle("unavailable"); });
    return true;
  }

  return Object.freeze({
    abandon: (): void => { current = undefined; },
    run,
  });
}
