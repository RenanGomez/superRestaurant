/**
 * Gives every read the screen owns an identity of its own, and settles it
 * exactly once: open shifts, dining layout, menu catalog, one table's active
 * Orders, and the operator's membership list, which is read before any branch
 * exists and belongs to a `userId` rather than to a Restaurant/Branch pair.
 * One tracker serves them all, so an attempt names exactly one request.
 *
 * The previous guard was an effect-scoped boolean, and it could not work: the
 * effect announces its own `loading` state, React re-runs the effect on that
 * very state, and the cleanup then cancelled the request the effect had just
 * issued — which is what left the shift screen on "Consultando turnos
 * abiertos…" forever after a foreground revalidation. Dropping the boolean
 * without replacing it is not right either: what a read belongs to is not what
 * identifies it. Restaurant/Branch is the same pair before and after a token
 * renewal, a shift change or a revalidation, and one operator reads their
 * membership list more than once, so neither can tell an answer that is still
 * wanted from one that is not.
 *
 * So an attempt carries a serial. The serial is announced before the request,
 * stored on the resource by the reducer, and returned with the answer; the
 * reducer applies success, failure or the revocation a 401 causes only while
 * that serial is still the one the resource is waiting for. Nothing here
 * decides what is stale — that belongs to the state — and nothing here performs
 * a request: the reader is the only effect, and it is called once per attempt.
 *
 * This mirrors `order-delivery.ts`, which does the same for the one write the
 * app hands over.
 */
import { toMobileFailure, type MobileFailure } from "./mobile-state.js";

export interface BranchReadRun<T> {
  /** Runs at most once, and never together with `onLoaded`. */
  readonly onFailed: (failure: MobileFailure, attempt: number) => void;
  /** Runs at most once, and never together with `onFailed`. */
  readonly onLoaded: (value: T, attempt: number) => void;
  /** Runs synchronously when the attempt is allocated, before the request. */
  readonly onLoading: (attempt: number) => void;
  /** The single effect boundary: one request per accepted attempt. */
  readonly read: () => Promise<T>;
}

export interface BranchReadTracker {
  /** Starts one read and returns the attempt that owns its answer. */
  readonly start: <T>(run: BranchReadRun<T>) => number;
}

export function createBranchReadTracker(): BranchReadTracker {
  let attempts = 0;

  function start<T>(run: BranchReadRun<T>): number {
    attempts += 1;
    const attempt = attempts;
    run.onLoading(attempt);

    // Exactly one outcome leaves this attempt. A promise that settles twice, or
    // a `read` that both throws and returns, stops here rather than reaching the
    // reducer twice.
    let settled = false;
    const settle = (apply: () => void): void => {
      if (settled) return;
      settled = true;
      apply();
    };

    // A reader that throws before returning a promise is contained: it becomes
    // the same operational failure as a rejection, so the resource never stays
    // `loading` and no rejection is left unhandled.
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(run.read());
    } catch (error: unknown) {
      settle(() => { run.onFailed(toMobileFailure(error), attempt); });
      return attempt;
    }

    // Two arguments rather than `.catch`, so a throw from `onLoaded` itself is
    // not mistaken for the read failing.
    void pending.then(
      (value) => { settle(() => { run.onLoaded(value, attempt); }); },
      (error: unknown) => { settle(() => { run.onFailed(toMobileFailure(error), attempt); }); },
    );
    return attempt;
  }

  return Object.freeze({ start });
}
