import assert from "node:assert/strict";
import test from "node:test";

import { createBranchReadTracker } from "./branch-read.js";
import { MobileRequestError, type MobileBranchScope } from "./mobile-client.js";
import {
  initialMobileState,
  contextReadTarget,
  layoutReadTarget,
  membershipsReadOperator,
  menuReadTarget,
  mobileScreen,
  ownsMembershipsRead,
  reduceMobileState,
  shiftsReadTarget,
  type MembershipsRead,
  type MobileEvent,
  type MobileFailure,
  type MobileState,
} from "./mobile-state.js";
import {
  branchOperationalContextBody,
  diningLayoutBody,
  fixtureSession,
  membershipListBody,
  menuCatalogStateBody,
  operationalShiftListBody,
  scopeA,
  scopeB,
  FIXTURE_USER_A,
  FIXTURE_USER_B,
} from "./test-fixtures.js";
import {
  parseBranchMembershipListV1,
  parseBranchOperationalContextV1,
  parseDiningLayoutV1,
  parseMenuCatalogStateV1,
  parseOperationalShiftListV1,
  type BranchMembershipSummaryV1,
  type BranchOperationalContextV1,
  type DiningLayoutV1,
  type MenuCatalogStateV1,
  type OperationalShiftListV1,
} from "@super-restaurant/shared-types";

// Nothing here may leave a rejection nobody handled. The listener also keeps
// node from tearing the process down before the assertion at the end can run.
const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => { unhandled.push(reason); });

/**
 * Two operators with different lists, so an answer can be traced back to the
 * operator it belongs to: A is authorized in both branches, B only in the
 * second one. Nothing but the immutable `userId` distinguishes them.
 */
function membershipsOf(operator: string): readonly BranchMembershipSummaryV1[] {
  const scopes = operator === FIXTURE_USER_A ? [scopeA, scopeB] : [scopeB];
  const parsed = parseBranchMembershipListV1(membershipListBody(scopes));
  assert.ok(parsed !== undefined);
  return parsed.memberships;
}

const memberships = membershipsOf(FIXTURE_USER_A);
const sessionA = fixtureSession();
const sessionB = fixtureSession({ accessToken: "harness-token-b", userId: FIXTURE_USER_B });

function contextOf(scope: MobileBranchScope): BranchOperationalContextV1 {
  const parsed = parseBranchOperationalContextV1(branchOperationalContextBody(scope));
  assert.ok(parsed !== undefined);
  return parsed;
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

type ReadKind = "context" | "layout" | "memberships" | "menu" | "shifts";

/** One request in flight, settled by the test rather than by a timer. */
interface StartedRead {
  readonly answer: () => Promise<void>;
  readonly attempt: number;
  readonly fail: (error: unknown) => Promise<void>;
  readonly kind: ReadKind;
  /** Set for a membership read: the operator it belongs to. */
  readonly operator?: string;
  /** Set for a branch-scoped read: the pair it belongs to. */
  readonly scope?: MobileBranchScope;
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
  /** Operators whose session this screen closed at the identity provider. */
  readonly signOuts: readonly string[];
  readonly state: () => MobileState;
} {
  let state = initialMobileState;
  let tableSelected = false;
  let running = false;
  const tracker = createBranchReadTracker();
  const reads: StartedRead[] = [];
  const signOuts: string[] = [];

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

  function begin<T>(
    read: { readonly kind: ReadKind; readonly operator?: string; readonly scope?: MobileBranchScope },
    value: T,
    events: {
      readonly failed: (failure: MobileFailure, attempt: number) => void;
      readonly loaded: (loadedValue: T, attempt: number) => void;
      readonly loading: (attempt: number) => void;
    },
  ): void {
    let resolve: ((loaded: T) => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const request = new Promise<T>((resolveRequest, rejectRequest) => {
      resolve = resolveRequest;
      reject = rejectRequest;
    });
    const attempt = tracker.start<T>({
      onFailed: events.failed,
      onLoaded: events.loaded,
      onLoading: events.loading,
      read: () => request,
    });
    reads.push({
      answer: async (): Promise<void> => { resolve?.(value); await drain(); },
      attempt,
      fail: async (error: unknown): Promise<void> => { reject?.(error); await drain(); },
      ...read,
    });
  }

  function startOne(): boolean {
    // The membership list is read before any branch exists, so it goes first.
    const operator = membershipsReadOperator(state);
    if (operator !== undefined) {
      begin({ kind: "memberships", operator }, membershipsOf(operator), {
        failed: (failure, attempt) => {
          // Exactly what `src/ui/app.tsx` does: ownership is read before the
          // dispatch, because the dispatch is what ends the session.
          const owned = ownsMembershipsRead(state, { attempt, operator });
          dispatch({ attempt, failure, operator, type: "membershipsFailed" });
          if (owned && failure === "authorization") {
            signOuts.push(operator);
            dispatch({ notice: "sessionEnded", type: "signedOut" });
          }
        },
        loaded: (list, attempt) => {
          dispatch({ attempt, memberships: list, operator, type: "membershipsLoaded" });
        },
        loading: (attempt) => { dispatch({ attempt, operator, type: "membershipsLoading" }); },
      });
      return true;
    }
    // A selected pair is confirmed by its operational context, before any
    // branch-scoped read can start.
    const pending = contextReadTarget(state);
    if (pending !== undefined) {
      const operator = pending.operator;
      const scope = pending.scope;
      begin({ kind: "context", operator, scope }, contextOf(scope), {
        failed: (failure, attempt) => {
          dispatch({ attempt, failure, operator, scope, type: "branchRejected" });
        },
        loaded: (context, attempt) => { dispatch({ attempt, context, operator, type: "branchAuthorized" }); },
        loading: (attempt) => { dispatch({ attempt, operator, scope, type: "branchContextRequested" }); },
      });
      return true;
    }
    const shifts = shiftsReadTarget(state);
    if (shifts !== undefined) {
      begin({ kind: "shifts", scope: shifts }, shiftListOf(shifts), {
        failed: (failure, attempt) => { dispatch({ attempt, failure, scope: shifts, type: "shiftsFailed" }); },
        loaded: (list, attempt) => { dispatch({ attempt, list, scope: shifts, type: "shiftsLoaded" }); },
        loading: (attempt) => { dispatch({ attempt, scope: shifts, type: "shiftsLoading" }); },
      });
      return true;
    }
    const layout = layoutReadTarget(state);
    if (layout !== undefined) {
      begin({ kind: "layout", scope: layout }, layoutOf(layout), {
        failed: (failure, attempt) => { dispatch({ attempt, failure, scope: layout, type: "layoutFailed" }); },
        loaded: (loaded, attempt) => { dispatch({ attempt, layout: loaded, scope: layout, type: "layoutLoaded" }); },
        loading: (attempt) => { dispatch({ attempt, scope: layout, type: "layoutLoading" }); },
      });
      return true;
    }
    const menu = menuReadTarget(state, tableSelected);
    if (menu !== undefined) {
      begin({ kind: "menu", scope: menu }, menuOf(menu), {
        failed: (failure, attempt) => { dispatch({ attempt, failure, scope: menu, type: "menuFailed" }); },
        loaded: (loaded, attempt) => { dispatch({ attempt, menu: loaded, scope: menu, type: "menuLoaded" }); },
        loading: (attempt) => { dispatch({ attempt, scope: menu, type: "menuLoading" }); },
      });
      return true;
    }
    return false;
  }

  return {
    dispatch,
    reads,
    selectTable: (selected: boolean): void => { tableSelected = selected; runReads(); },
    signOuts,
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

/** Signed in as operator A, with the membership list read and answered. */
async function signedIn(): Promise<ReturnType<typeof screen>> {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  await last(app.reads, "memberships").answer();
  return app;
}

/** Signed in, branch A authorized, shift list answered and a shift chosen. */
async function onShift(): Promise<ReturnType<typeof screen>> {
  const app = await signedIn();
  app.dispatch({ scope: scopeA, type: "branchRequested" });
  await last(app.reads, "context").answer();
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
  app.dispatch({ context: contextOf(scopeA), type: "revalidationSucceeded" });

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
  app.dispatch({ context: contextOf(scopeA), type: "revalidationSucceeded" });
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
  assert.equal(underSecondShift.scope?.branchId, underFirstShift.scope?.branchId, "same Restaurant/Branch on purpose");

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
  await last(changingBranch.reads, "context").answer();
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

test("a membership answer of the previous operator never reaches the next one", async () => {
  // A's read is still in flight when B takes over. The list A would have shown
  // is not B's, and the reducer is what refuses it.
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const forA = last(app.reads, "memberships");
  assert.equal(forA.operator, FIXTURE_USER_A);

  app.dispatch({ session: sessionB, type: "sessionObserved" });
  const forB = last(app.reads, "memberships");
  assert.equal(forB.operator, FIXTURE_USER_B);
  assert.notEqual(forB.attempt, forA.attempt);
  assert.equal(only(app.reads, "memberships").length, 2, "B does not wait for A's request");

  await forA.answer();
  assert.equal(app.state().memberships.value, undefined, "A's list is not B's list");
  assert.equal(app.state().memberships.status, "loading");
  assert.equal(app.state().memberships.attempt, forB.attempt);

  await forB.answer();
  assert.equal(app.state().memberships.status, "ready");
  assert.deepEqual(app.state().memberships.value, membershipsOf(FIXTURE_USER_B));
  assert.equal(app.state().session?.userId, FIXTURE_USER_B);
});

test("a membership answer of the previous operator is refused before B even reads", async () => {
  // The same answer, arriving in the window between the operator change and the
  // read B is about to start. `revalidating` keeps that window open here.
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const forA = last(app.reads, "memberships");

  app.dispatch({ session: sessionB, type: "sessionObserved" });
  app.dispatch({ scope: scopeB, type: "branchRequested" });
  await last(app.reads, "context").answer();
  app.dispatch({ type: "revalidationStarted" });
  assert.equal(membershipsReadOperator(app.state()), undefined, "nothing is read while unconfirmed");
  const before = only(app.reads, "memberships").length;

  await forA.answer();
  assert.equal(app.state().memberships.value, undefined);
  assert.equal(only(app.reads, "memberships").length, before);
  assert.equal(app.state().session?.userId, FIXTURE_USER_B);
});

test("a late membership failure of the previous operator does not disturb the next one", async () => {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const forA = last(app.reads, "memberships");

  app.dispatch({ session: sessionB, type: "sessionObserved" });
  const forB = last(app.reads, "memberships");
  await forB.answer();
  assert.equal(app.state().memberships.status, "ready");

  await forA.fail(new MobileRequestError("network"));
  assert.equal(app.state().memberships.status, "ready", "B's list stays on screen");
  assert.equal(app.state().memberships.failure, undefined);
  assert.deepEqual(app.state().memberships.value, membershipsOf(FIXTURE_USER_B));
});

test("a late 401 of the previous operator does not end the next operator's session", async () => {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const forA = last(app.reads, "memberships");

  app.dispatch({ session: sessionB, type: "sessionObserved" });
  const forB = last(app.reads, "memberships");
  await forB.answer();

  await forA.fail(new MobileRequestError(401));
  assert.equal(app.state().session?.userId, FIXTURE_USER_B, "B is still signed in");
  assert.equal(app.state().notice, undefined);
  assert.equal(mobileScreen(app.state()), "branches");
  assert.deepEqual(app.signOuts, [], "the provider was never told to close B's session");
  assert.deepEqual(app.state().memberships.value, membershipsOf(FIXTURE_USER_B));
});

test("a late 401 of the previous operator is refused before B even reads", async () => {
  // The window a serial kept in the screen cannot close: B has taken over but
  // has not started a read yet, so nothing has moved that serial on. Only an
  // identity tied to the operator refuses this answer.
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const forA = last(app.reads, "memberships");

  app.dispatch({ session: sessionB, type: "sessionObserved" });
  app.dispatch({ scope: scopeB, type: "branchRequested" });
  await last(app.reads, "context").answer();
  app.dispatch({ type: "revalidationStarted" });
  assert.equal(membershipsReadOperator(app.state()), undefined, "B has started no read of its own");

  await forA.fail(new MobileRequestError(401));
  assert.equal(app.state().session?.userId, FIXTURE_USER_B, "B's session survives A's 401");
  assert.equal(app.state().notice, undefined);
  assert.deepEqual(app.signOuts, []);

  // And B's own read still completes once the scope is confirmed.
  app.dispatch({ context: contextOf(scopeB), type: "revalidationSucceeded" });
  await last(app.reads, "shifts").answer();
  assert.equal(app.state().shifts.status, "ready");
  assert.equal(app.state().session?.userId, FIXTURE_USER_B);
});

test("a 401 of the read the screen is waiting for does end the session", async () => {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });

  await last(app.reads, "memberships").fail(new MobileRequestError(403));
  assert.equal(app.state().session, undefined);
  assert.equal(app.state().notice, "sessionEnded");
  assert.equal(mobileScreen(app.state()), "signIn");
  assert.deepEqual(app.signOuts, [FIXTURE_USER_A]);
});

test("a hung read of the previous operator does not block the next one", async () => {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const hung = last(app.reads, "memberships");

  app.dispatch({ session: sessionB, type: "sessionObserved" });
  const forB = last(app.reads, "memberships");
  assert.notEqual(forB.attempt, hung.attempt);

  // A's request never settles at all; B's completes on its own.
  await forB.answer();
  assert.equal(app.state().memberships.status, "ready");
  assert.deepEqual(app.state().memberships.value, membershipsOf(FIXTURE_USER_B));
  assert.equal(mobileScreen(app.state()), "branches");
});

test("renewing the token of the same operator reads the list again, and only once", async () => {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const withOldToken = last(app.reads, "memberships");

  app.dispatch({ session: fixtureSession({ accessToken: "harness-token-renewed" }), type: "sessionObserved" });
  // The read started with the replaced token is given up, and the resource is
  // left ready to be read again — never stranded on `loading`.
  const withNewToken = last(app.reads, "memberships");
  assert.equal(only(app.reads, "memberships").length, 2);
  assert.notEqual(withNewToken.attempt, withOldToken.attempt);
  assert.equal(app.state().memberships.attempt, withNewToken.attempt);

  await withOldToken.answer();
  assert.equal(app.state().memberships.status, "loading", "the superseded answer changes nothing");

  await withNewToken.answer();
  assert.equal(app.state().memberships.status, "ready");
  assert.deepEqual(app.state().memberships.value, memberships);
  assert.equal(only(app.reads, "memberships").length, 2, "the answer must not start another read");
  assert.deepEqual(app.signOuts, []);
});

test("signing out while the list is being read leaves nothing behind", async () => {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  const inFlight = last(app.reads, "memberships");

  app.dispatch({ notice: undefined, type: "signedOut" });
  assert.equal(app.state().memberships.status, "idle");

  await inFlight.answer();
  assert.deepEqual(app.state(), { ...initialMobileState, notice: undefined, started: true });

  await inFlight.fail(new MobileRequestError(401));
  assert.equal(app.state().session, undefined);
  assert.deepEqual(app.signOuts, [], "a signed-out device is not signed out again");
});

test("a membership read that rejects or throws synchronously is an ordinary failure", async () => {
  const app = screen();
  app.dispatch({ session: sessionA, type: "sessionObserved" });
  await last(app.reads, "memberships").fail(new MobileRequestError("protocol"));
  assert.equal(app.state().memberships.status, "failed");
  assert.equal(app.state().memberships.failure, "protocol");
  assert.equal(app.state().memberships.attempt, undefined);
  assert.equal(membershipsReadOperator(app.state()), undefined, "a failure is not retried on its own");

  // A retry is a fresh attempt; a reader that throws before returning a promise
  // reaches the same state as one that rejects.
  const tracker = createBranchReadTracker();
  const outcomes: string[] = [];
  const attempt = tracker.start<readonly BranchMembershipSummaryV1[]>({
    onFailed: (failure, at) => { outcomes.push(`failed:${failure}:${at}`); },
    onLoaded: (list, at) => { outcomes.push(`loaded:${list.length}:${at}`); },
    onLoading: (at) => { outcomes.push(`loading:${at}`); },
    read: () => { throw new MobileRequestError(401); },
  });
  await drain();
  assert.deepEqual(outcomes, [`loading:${attempt}`, `failed:authorization:${attempt}`]);
});

test("membership ownership needs both halves of the identity", async () => {
  const app = await signedIn();
  const answered = last(app.reads, "memberships");
  const owned: MembershipsRead = { attempt: answered.attempt, operator: FIXTURE_USER_A };

  // Spent: the resource is `ready`, so it waits for nothing.
  assert.equal(ownsMembershipsRead(app.state(), owned), false);

  const reading = screen();
  reading.dispatch({ session: sessionA, type: "sessionObserved" });
  const current = last(reading.reads, "memberships");
  assert.equal(ownsMembershipsRead(reading.state(), { attempt: current.attempt, operator: FIXTURE_USER_A }), true);
  assert.equal(
    ownsMembershipsRead(reading.state(), { attempt: current.attempt, operator: FIXTURE_USER_B }),
    false,
    "right attempt, wrong operator",
  );
  assert.equal(
    ownsMembershipsRead(reading.state(), { attempt: current.attempt + 1000, operator: FIXTURE_USER_A }),
    false,
    "right operator, wrong attempt",
  );
});

test("no rejection was left unhandled", async () => {
  await drain();
  assert.deepEqual(unhandled, []);
});
