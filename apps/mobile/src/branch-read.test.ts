import assert from "node:assert/strict";
import test from "node:test";

import { createBranchReadTracker } from "./branch-read.js";
import { MobileRequestError, type MobileBranchScope } from "./mobile-client.js";
import {
  initialMobileState,
  layoutReadTarget,
  menuReadTarget,
  mobileScreen,
  reduceMobileState,
  shiftsReadTarget,
  type MobileEvent,
  type MobileFailure,
  type MobileState,
} from "./mobile-state.js";
import {
  authorizedBranchBody,
  diningLayoutBody,
  fixtureSession,
  membershipListBody,
  menuCatalogStateBody,
  operationalShiftListBody,
  scopeA,
  scopeB,
  FIXTURE_USER_B,
} from "./test-fixtures.js";
import {
  parseBranchMembershipListV1,
  parseDiningLayoutV1,
  parseMenuCatalogStateV1,
  parseOperationalShiftListV1,
  type DiningLayoutV1,
  type MenuCatalogStateV1,
  type OperationalShiftListV1,
} from "@super-restaurant/shared-types";

// Nothing here may leave a rejection nobody handled. The listener also keeps
// node from tearing the process down before the assertion at the end can run.
const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => { unhandled.push(reason); });

const memberships = parseBranchMembershipListV1(membershipListBody([scopeA, scopeB]))?.memberships ?? [];

function branchOf(scope: MobileBranchScope): { branchId: string; restaurantId: string; roles: readonly "waiter"[] } {
  return authorizedBranchBody(scope) as { branchId: string; restaurantId: string; roles: readonly "waiter"[] };
}

function shiftListOf(scope: MobileBranchScope): OperationalShiftListV1 {
  const parsed = parseOperationalShiftListV1(operationalShiftListBody(scope));
  assert.ok(parsed !== undefined);
  return parsed;
}

function layoutOf(scope: MobileBranchScope): DiningLayoutV1 {
  const parsed = parseDiningLayoutV1(diningLayoutBody(scope, scope.branchId === scopeB.branchId ? "Salón" : "Terraza"));
  assert.ok(parsed !== undefined);
  return parsed;
}

function menuOf(scope: MobileBranchScope): MenuCatalogStateV1 {
  const parsed = parseMenuCatalogStateV1(menuCatalogStateBody(scope));
  assert.ok(parsed !== undefined);
  return parsed;
}

type ReadKind = "layout" | "menu" | "shifts";

/** One request in flight, settled by the test rather than by a timer. */
interface StartedRead {
  readonly answer: () => Promise<void>;
  readonly attempt: number;
  readonly fail: (error: unknown) => Promise<void>;
  readonly kind: ReadKind;
  readonly scope: MobileBranchScope;
}

/** Lets every already-queued promise callback run before the next assertion. */
function drain(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

/**
 * The screen's read loop without React: the same reducer, the same tracker and
 * the same `*ReadTarget` functions `src/ui/app.tsx` uses, driven by hand.
 *
 * It reproduces the one property that made the effect-scoped cancel flag wrong:
 * announcing `loading` is itself a state change, so the read pass runs again
 * immediately — exactly as React re-runs an effect on the state it dispatched.
 * Nothing is cancelled when that happens; what decides whether an answer counts
 * is the attempt the reducer stored on the resource.
 */
function screen(): {
  readonly dispatch: (event: MobileEvent) => void;
  readonly reads: readonly StartedRead[];
  readonly selectTable: (selected: boolean) => void;
  readonly state: () => MobileState;
} {
  let state = initialMobileState;
  let tableSelected = false;
  let running = false;
  const tracker = createBranchReadTracker();
  const reads: StartedRead[] = [];

  function dispatch(event: MobileEvent): void {
    state = reduceMobileState(state, event);
    runReads();
  }

  function runReads(): void {
    if (running) return;
    running = true;
    // Each started read announces its own `loading`, which re-enters `dispatch`
    // and returns here; looking again is what a re-run of the effect does.
    try { while (startOne()) { /* keep going until nothing else may be read */ } }
    finally { running = false; }
  }

  function begin<T>(kind: ReadKind, scope: MobileBranchScope, value: T, events: {
    readonly failed: (failure: MobileFailure, attempt: number) => MobileEvent;
    readonly loaded: (loadedValue: T, attempt: number) => MobileEvent;
    readonly loading: (attempt: number) => MobileEvent;
  }): void {
    let resolve: ((loaded: T) => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const request = new Promise<T>((resolveRequest, rejectRequest) => {
      resolve = resolveRequest;
      reject = rejectRequest;
    });
    const attempt = tracker.start<T>({
      onFailed: (failure, at) => { dispatch(events.failed(failure, at)); },
      onLoaded: (loaded, at) => { dispatch(events.loaded(loaded, at)); },
      onLoading: (at) => { dispatch(events.loading(at)); },
      read: () => request,
    });
    reads.push({
      answer: async (): Promise<void> => { resolve?.(value); await drain(); },
      attempt,
      fail: async (error: unknown): Promise<void> => { reject?.(error); await drain(); },
      kind,
      scope,
    });
  }

  function startOne(): boolean {
    const shifts = shiftsReadTarget(state);
    if (shifts !== undefined) {
      begin("shifts", shifts, shiftListOf(shifts), {
        failed: (failure, attempt) => ({ attempt, failure, scope: shifts, type: "shiftsFailed" }),
        loaded: (list, attempt) => ({ attempt, list, scope: shifts, type: "shiftsLoaded" }),
        loading: (attempt) => ({ attempt, scope: shifts, type: "shiftsLoading" }),
      });
      return true;
    }
    const layout = layoutReadTarget(state);
    if (layout !== undefined) {
      begin("layout", layout, layoutOf(layout), {
        failed: (failure, attempt) => ({ attempt, failure, scope: layout, type: "layoutFailed" }),
        loaded: (loaded, attempt) => ({ attempt, layout: loaded, scope: layout, type: "layoutLoaded" }),
        loading: (attempt) => ({ attempt, scope: layout, type: "layoutLoading" }),
      });
      return true;
    }
    const menu = menuReadTarget(state, tableSelected);
    if (menu !== undefined) {
      begin("menu", menu, menuOf(menu), {
        failed: (failure, attempt) => ({ attempt, failure, scope: menu, type: "menuFailed" }),
        loaded: (loaded, attempt) => ({ attempt, menu: loaded, scope: menu, type: "menuLoaded" }),
        loading: (attempt) => ({ attempt, scope: menu, type: "menuLoading" }),
      });
      return true;
    }
    return false;
  }

  return {
    dispatch,
    reads,
    selectTable: (selected: boolean): void => { tableSelected = selected; runReads(); },
    state: (): MobileState => state,
  };
}

const only = (reads: readonly StartedRead[], kind: ReadKind): readonly StartedRead[] =>
  reads.filter((read) => read.kind === kind);

const last = (reads: readonly StartedRead[], kind: ReadKind): StartedRead => {
  const matching = only(reads, kind);
  const found = matching[matching.length - 1];
  assert.ok(found !== undefined, `no ${kind} read was started`);
  return found;
};

/** Signed in, branch A authorized, shift list answered and a shift chosen. */
async function onShift(): Promise<ReturnType<typeof screen>> {
  const app = screen();
  app.dispatch({ session: fixtureSession(), type: "sessionObserved" });
  app.dispatch({ memberships, type: "membershipsLoaded" });
  app.dispatch({ scope: scopeA, type: "branchRequested" });
  app.dispatch({ branch: branchOf(scopeA), type: "branchAuthorized" });
  await last(app.reads, "shifts").answer();
  const shift = app.state().shifts.value?.shifts[0];
  assert.ok(shift !== undefined);
  app.dispatch({ shift, type: "shiftSelected" });
  return app;
}

test("a read is not cancelled by the loading it announced itself", async () => {
  const app = await onShift();

  // Choosing the shift is the discrete event that starts the layout read; the
  // `loading` it dispatches runs the read pass again straight away.
  assert.equal(only(app.reads, "layout").length, 1, "exactly one request, not one per pass");
  assert.equal(app.state().layout.status, "loading");
  await last(app.reads, "layout").answer();
  assert.equal(app.state().layout.status, "ready");
  assert.equal(app.state().layout.value?.scope.branchId, scopeA.branchId);

  // Selecting a table is the second discrete event, for the catalog this time.
  app.selectTable(true);
  assert.equal(only(app.reads, "menu").length, 1);
  await last(app.reads, "menu").answer();
  assert.equal(app.state().menu.status, "ready");
  assert.equal(only(app.reads, "menu").length, 1, "the answer must not start another read");
});

test("the shift list is never left loading by a foreground revalidation", async () => {
  const app = await onShift();
  await last(app.reads, "layout").answer();
  const before = app.reads.length;

  app.dispatch({ type: "revalidationStarted" });
  assert.equal(app.state().shifts.status, "idle");
  assert.equal(app.reads.length, before, "nothing may be read while the scope is unconfirmed");

  app.dispatch({ session: fixtureSession(), type: "sessionObserved" });
  app.dispatch({ branch: branchOf(scopeA), type: "revalidationSucceeded" });

  const reread = only(app.reads, "shifts");
  assert.equal(reread.length, 2, "the list is read again, once");
  assert.equal(app.state().shifts.status, "loading");
  await last(app.reads, "shifts").answer();
  assert.equal(app.state().shifts.status, "ready");
  assert.equal(mobileScreen(app.state()), "shifts");
});

test("an answer started before the revalidation cannot repopulate what it emptied", async () => {
  const app = await onShift();
  const stale = last(app.reads, "layout");

  app.dispatch({ type: "revalidationStarted" });
  assert.equal(app.state().layout.status, "idle");

  // The layout request from before the foreground answers now. It is the same
  // Restaurant/Branch, so scope alone would have accepted it.
  await stale.answer();
  assert.equal(app.state().layout.status, "idle");
  assert.equal(app.state().layout.value, undefined);
  assert.equal(app.state().menu.value, undefined);

  app.dispatch({ session: fixtureSession(), type: "sessionObserved" });
  app.dispatch({ branch: branchOf(scopeA), type: "revalidationSucceeded" });
  await last(app.reads, "shifts").answer();
  const shift = app.state().shifts.value?.shifts[0];
  assert.ok(shift !== undefined);

  // Choosing the shift again reads the layout again, under a new attempt.
  app.dispatch({ shift, type: "shiftSelected" });
  const fresh = last(app.reads, "layout");
  assert.notEqual(fresh.attempt, stale.attempt);
  assert.equal(only(app.reads, "layout").length, 2);
  await fresh.answer();
  assert.equal(app.state().layout.status, "ready");
});

test("a late 401 from the previous token does not revoke the renewed session", async () => {
  const app = await onShift();
  const withOldToken = last(app.reads, "layout");

  app.dispatch({ session: fixtureSession({ accessToken: "token-renewed" }), type: "sessionObserved" });
  // The read started with the replaced token is given up, and the current token
  // starts its own read instead of the screen waiting forever.
  assert.equal(only(app.reads, "layout").length, 2);
  const withNewToken = last(app.reads, "layout");
  assert.notEqual(withNewToken.attempt, withOldToken.attempt);

  await withOldToken.fail(new MobileRequestError(401));
  assert.equal(app.state().branch?.branchId, scopeA.branchId, "the branch survives a 401 nobody was waiting for");
  assert.equal(app.state().notice, undefined);
  assert.equal(app.state().session?.accessToken, "token-renewed");
  assert.equal(mobileScreen(app.state()), "workspace");

  await withNewToken.answer();
  assert.equal(app.state().layout.status, "ready");
});

test("a 401 from the read the screen is waiting for does revoke the branch", async () => {
  const app = await onShift();

  await last(app.reads, "layout").fail(new MobileRequestError(403));
  assert.equal(app.state().branch, undefined);
  assert.equal(app.state().notice, "branchRevoked");
  assert.equal(app.state().branchFailure, "authorization");
  assert.equal(mobileScreen(app.state()), "branches");
});

test("a late answer for the same branch but another shift is ignored", async () => {
  const app = await onShift();
  const underFirstShift = last(app.reads, "layout");

  app.dispatch({ type: "shiftReleased" });
  const shift = app.state().shifts.value?.shifts[0];
  assert.ok(shift !== undefined);
  app.dispatch({ shift, type: "shiftSelected" });

  const underSecondShift = last(app.reads, "layout");
  assert.notEqual(underSecondShift.attempt, underFirstShift.attempt);
  assert.equal(underSecondShift.scope.branchId, underFirstShift.scope.branchId, "same Restaurant/Branch on purpose");

  await underFirstShift.answer();
  assert.equal(app.state().layout.status, "loading", "the current read still owns the resource");
  assert.equal(app.state().layout.attempt, underSecondShift.attempt);

  await underSecondShift.answer();
  assert.equal(app.state().layout.status, "ready");
});

test("changing branch, changing operator and signing out all fail closed", async () => {
  const changingBranch = await onShift();
  const forA = last(changingBranch.reads, "layout");
  changingBranch.dispatch({ scope: scopeB, type: "branchRequested" });
  changingBranch.dispatch({ branch: branchOf(scopeB), type: "branchAuthorized" });
  await forA.answer();
  assert.equal(changingBranch.state().layout.value, undefined);
  assert.equal(changingBranch.state().layout.status, "idle");

  const changingOperator = await onShift();
  const forOperatorA = last(changingOperator.reads, "layout");
  changingOperator.dispatch({
    session: fixtureSession({ accessToken: "token-b", userId: FIXTURE_USER_B }),
    type: "sessionObserved",
  });
  await forOperatorA.answer();
  assert.equal(changingOperator.state().layout.value, undefined);
  assert.equal(changingOperator.state().branch, undefined);
  assert.equal(mobileScreen(changingOperator.state()), "branches");

  const signingOut = await onShift();
  const beforeSignOut = last(signingOut.reads, "layout");
  signingOut.dispatch({ notice: "sessionEnded", type: "signedOut" });
  await beforeSignOut.answer();
  assert.deepEqual(signingOut.state(), { ...initialMobileState, notice: "sessionEnded", started: true });
  assert.equal(mobileScreen(signingOut.state()), "signIn");
});

test("a failed read is reported once and can be retried", async () => {
  const app = await onShift();
  const failing = last(app.reads, "layout");

  await failing.fail(new MobileRequestError("network"));
  assert.equal(app.state().layout.status, "failed");
  assert.equal(app.state().layout.failure, "network");
  assert.equal(only(app.reads, "layout").length, 1, "a failure must not start a read by itself");

  // Answering the same request again — a badly behaved promise — changes nothing.
  await failing.answer();
  assert.equal(app.state().layout.status, "failed");

  app.dispatch({ scope: scopeA, type: "layoutReset" });
  assert.equal(only(app.reads, "layout").length, 2);
  await last(app.reads, "layout").answer();
  assert.equal(app.state().layout.status, "ready");
});

test("a reader that throws before returning a promise is an ordinary failure", async () => {
  const tracker = createBranchReadTracker();
  const outcomes: string[] = [];
  const attempt = tracker.start<number>({
    onFailed: (failure, at) => { outcomes.push(`failed:${failure}:${at}`); },
    onLoaded: (value, at) => { outcomes.push(`loaded:${String(value)}:${at}`); },
    onLoading: (at) => { outcomes.push(`loading:${at}`); },
    read: () => { throw new MobileRequestError("network"); },
  });

  await drain();
  assert.deepEqual(outcomes, [`loading:${attempt}`, `failed:network:${attempt}`]);
});

test("every attempt is distinct and settles exactly once", async () => {
  const tracker = createBranchReadTracker();
  const settlements: number[] = [];
  let resolveFirst: ((value: number) => void) | undefined;
  const first = tracker.start<number>({
    onFailed: () => { settlements.push(-1); },
    onLoaded: (value) => { settlements.push(value); },
    onLoading: () => undefined,
    read: () => new Promise<number>((resolve) => { resolveFirst = resolve; }),
  });
  const second = tracker.start<number>({
    onFailed: () => { settlements.push(-1); },
    onLoaded: (value) => { settlements.push(value); },
    onLoading: () => undefined,
    read: () => Promise.resolve(2),
  });

  assert.notEqual(first, second);
  resolveFirst?.(1);
  resolveFirst?.(11);
  await drain();
  assert.deepEqual([...settlements].sort((left, right) => left - right), [1, 2]);
});

test("no rejection was left unhandled", async () => {
  await drain();
  assert.deepEqual(unhandled, []);
});
