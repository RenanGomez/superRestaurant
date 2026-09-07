import assert from "node:assert/strict";
import test from "node:test";

import { MobileRequestError, type MobileBranchScope } from "./mobile-client.js";
import {
  activeOrdersReadTarget,
  activeScope,
  canReadBranchData,
  contextReadTarget,
  failureMessage,
  hasNoMemberships,
  initialMobileState,
  layoutReadTarget,
  membershipsReadOperator,
  menuReadTarget,
  mobileScreen,
  noticeMessage,
  ownsContextRead,
  reduceMobileState,
  shiftsReadTarget,
  toMobileFailure,
  type MobileEvent,
  type MobileFailure,
  type MobileState,
} from "./mobile-state.js";
import {
  FIXTURE_TABLE,
  FIXTURE_USER_B,
  activeTableOrderListBody,
  branchOperationalContextBody,
  diningLayoutBody,
  fixtureSession,
  membershipListBody,
  menuCatalogStateBody,
  operationalShiftListBody,
  scopeA,
  scopeB,
} from "./test-fixtures.js";
import type { MobileSession } from "./session.js";

import {
  parseActiveTableOrderListV2,
  parseBranchMembershipListV1,
  parseBranchOperationalContextV1,
  parseDiningLayoutV1,
  parseMenuCatalogStateV1,
  parseOperationalShiftListV1,
  type BranchMembershipSummaryV1,
  type BranchOperationalContextV1,
  type DiningLayoutV1,
} from "@super-restaurant/shared-types";

const session: MobileSession = fixtureSession();
const memberships = parseBranchMembershipListV1(membershipListBody([scopeA, scopeB]))?.memberships ?? [];
const layoutA = parseDiningLayoutV1(diningLayoutBody(scopeA));
const layoutB = parseDiningLayoutV1(diningLayoutBody(scopeB, "Salón"));
const menuA = parseMenuCatalogStateV1(menuCatalogStateBody(scopeA));
const shiftsA = parseOperationalShiftListV1(operationalShiftListBody(scopeA));
const contextA = branchContext(scopeA);
const contextB = branchContext(scopeB);

/** The exact context response, through the shared parser and nothing else. */
function branchContext(scope: MobileBranchScope): BranchOperationalContextV1 {
  const parsed = parseBranchOperationalContextV1(branchOperationalContextBody(scope));
  assert.ok(parsed !== undefined);
  return parsed;
}

/**
 * The three events one branch selection produces: the read is announced, then
 * the server's own context confirms it. The reducer accepts a context only for
 * the operator, pair and attempt that asked, so the announcement is not optional.
 */
function authorized(context: BranchOperationalContextV1, operator: string = session.userId): readonly MobileEvent[] {
  const attempt = nextAttempt();
  return [
    { attempt, operator, scope: context.scope, type: "branchContextRequested" },
    { attempt, context, operator, type: "branchAuthorized" },
  ];
}

/** The same, for a pair the server refuses. */
function rejected(
  scope: MobileBranchScope,
  failure: MobileFailure,
  operator: string = session.userId,
): readonly MobileEvent[] {
  const attempt = nextAttempt();
  return [
    { attempt, operator, scope, type: "branchContextRequested" },
    { attempt, failure, operator, scope, type: "branchRejected" },
  ];
}

function apply(state: MobileState, ...events: readonly MobileEvent[]): MobileState {
  return events.reduce(reduceMobileState, state);
}

/**
 * Stands in for the tracker that allocates a read attempt in the screen. Every
 * answer below is announced by the `loading` of its own attempt, because that
 * is the only way a branch-scoped answer is ever accepted.
 */
let attempts = 0;
function nextAttempt(): number {
  attempts += 1;
  return attempts;
}

/** The two events one complete membership read produces, for one operator. */
function loadedMemberships(
  operator: string,
  list: readonly BranchMembershipSummaryV1[],
): readonly MobileEvent[] {
  const attempt = nextAttempt();
  return [
    { attempt, operator, type: "membershipsLoading" },
    { attempt, memberships: list, operator, type: "membershipsLoaded" },
  ];
}

/** The two events one complete layout read produces, under a single attempt. */
function loadedLayout(scope: MobileBranchScope, layout: DiningLayoutV1): readonly MobileEvent[] {
  const attempt = nextAttempt();
  return [
    { attempt, scope, type: "layoutLoading" },
    { attempt, layout, scope, type: "layoutLoaded" },
  ];
}

function signedIn(): MobileState {
  return apply(initialMobileState, { session, type: "sessionObserved" });
}

function onBranchA(): MobileState {
  assert.ok(layoutA !== undefined && menuA !== undefined && layoutB !== undefined && shiftsA !== undefined && shiftsA.shifts[0] !== undefined);
  const shifts = nextAttempt();
  const layout = nextAttempt();
  const menu = nextAttempt();
  return apply(
    signedIn(),
    ...loadedMemberships(session.userId, memberships),
    { scope: scopeA, type: "branchRequested" },
    ...authorized(contextA),
    { attempt: shifts, scope: scopeA, type: "shiftsLoading" },
    { attempt: shifts, list: shiftsA, scope: scopeA, type: "shiftsLoaded" },
    { shift: shiftsA.shifts[0], type: "shiftSelected" },
    { attempt: layout, scope: scopeA, type: "layoutLoading" },
    { attempt: layout, layout: layoutA, scope: scopeA, type: "layoutLoaded" },
    { attempt: menu, scope: scopeA, type: "menuLoading" },
    { attempt: menu, menu: menuA, scope: scopeA, type: "menuLoaded" },
  );
}

test("navigation follows the session and the authorized branch, never history", () => {
  assert.equal(mobileScreen(initialMobileState), "starting");
  assert.equal(mobileScreen(apply(initialMobileState, { session: undefined, type: "sessionRestored" })), "signIn");
  assert.equal(mobileScreen(signedIn()), "branches");
  const branchOnly = apply(
    signedIn(),
    { scope: scopeA, type: "branchRequested" },
    ...authorized(contextA),
  );
  assert.equal(mobileScreen(branchOnly), "shifts");
  assert.equal(mobileScreen(onBranchA()), "workspace");
});

test("operational data stays closed until an active shift from the exact branch is selected", () => {
  assert.ok(shiftsA !== undefined && shiftsA.shifts[0] !== undefined);
  const shifts = nextAttempt();
  const branchOnly = apply(
    signedIn(),
    { scope: scopeA, type: "branchRequested" },
    ...authorized(contextA),
    { attempt: shifts, scope: scopeA, type: "shiftsLoading" },
    { attempt: shifts, list: shiftsA, scope: scopeA, type: "shiftsLoaded" },
  );
  assert.equal(canReadBranchData(branchOnly), true);
  assert.equal(mobileScreen(branchOnly), "shifts");
  const selected = apply(branchOnly, { shift: shiftsA.shifts[0], type: "shiftSelected" });
  assert.equal(mobileScreen(selected), "workspace");

  const foreign = parseOperationalShiftListV1(operationalShiftListBody(scopeB));
  assert.ok(foreign !== undefined && foreign.shifts[0] !== undefined);
  assert.equal(apply(branchOnly, { shift: foreign.shifts[0], type: "shiftSelected" }), branchOnly);
});

test("a tab cannot be opened before a branch is authorized", () => {
  const state = apply(signedIn(), { tab: "menu", type: "tabSelected" });
  assert.equal(state.tab, "tables");
  assert.equal(mobileScreen(state), "branches");
  assert.equal(apply(onBranchA(), { tab: "menu", type: "tabSelected" }).tab, "menu");
});

test("an empty membership list is an explicit state, not a silent empty screen", () => {
  const state = apply(signedIn(), ...loadedMemberships(session.userId, []));
  assert.equal(hasNoMemberships(state), true);
  assert.equal(state.memberships.status, "ready");
  assert.equal(mobileScreen(state), "branches");
  assert.equal(hasNoMemberships(signedIn()), false);
});

test("selecting another branch drops the previous branch data in the same transition", () => {
  const switched = apply(onBranchA(), { scope: scopeB, type: "branchRequested" });

  assert.equal(switched.branch, undefined);
  assert.equal(switched.layout.value, undefined);
  assert.equal(switched.menu.value, undefined);
  assert.equal(switched.layout.status, "idle");
  assert.equal(switched.menu.status, "idle");
  assert.equal(mobileScreen(switched), "branches");

  const onB = apply(switched, ...authorized(contextB));
  assert.deepEqual(activeScope(onB), { branchId: scopeB.branchId, restaurantId: scopeB.restaurantId });
  assert.equal(onB.layout.value, undefined);
});

test("a late response for another branch never reaches the active branch", () => {
  assert.ok(layoutB !== undefined);
  const staleA = nextAttempt();
  const onB = apply(
    onBranchA(),
    { attempt: staleA, scope: scopeA, type: "menuLoading" },
    { scope: scopeB, type: "branchRequested" },
    ...authorized(contextB),
    ...loadedLayout(scopeB, layoutB),
    { attempt: staleA, layout: layoutA as NonNullable<typeof layoutA>, scope: scopeA, type: "layoutLoaded" },
    { attempt: staleA, failure: "network", scope: scopeA, type: "menuFailed" },
  );

  assert.equal(onB.layout.value?.scope.branchId, scopeB.branchId);
  assert.equal(onB.layout.value?.zones[0]?.name, "Salón");
  assert.equal(onB.menu.status, "idle");
});

test("an authorization answer for a pair that is no longer pending is ignored", () => {
  const state = apply(
    signedIn(),
    { scope: scopeA, type: "branchRequested" },
    { scope: scopeB, type: "branchRequested" },
    ...authorized(contextA),
  );

  assert.equal(state.branch, undefined);
  assert.deepEqual(state.pendingScope, { branchId: scopeB.branchId, restaurantId: scopeB.restaurantId });
});

test("a revoked branch returns to selection with an explicit notice", () => {
  const state = apply(
    onBranchA(),
    { scope: scopeA, type: "branchRequested" },
    ...rejected(scopeA, "authorization"),
  );

  assert.equal(mobileScreen(state), "branches");
  assert.equal(state.branch, undefined);
  assert.equal(state.branchFailure, "authorization");
  assert.equal(state.notice, "branchRevoked");
  assert.equal(state.layout.value, undefined);
  assert.equal(state.menu.value, undefined);
});

test("a branch revoked mid-session drops its data and forces a fresh membership read", () => {
  const state = apply(onBranchA(), { type: "accessRevoked" });

  assert.equal(mobileScreen(state), "branches");
  assert.equal(state.notice, "branchRevoked");
  assert.equal(state.branchFailure, "authorization");
  assert.equal(state.layout.value, undefined);
  assert.equal(state.menu.value, undefined);
  assert.equal(state.memberships.status, "idle");
  assert.equal(state.session, session);
});

test("signing out locally clears every branch-scoped value", () => {
  const state = apply(onBranchA(), { notice: "sessionEnded", type: "signedOut" });

  // Nothing of the closed session survives: the state is the initial one plus
  // the reason to explain it. Refusing late provider events is the gate's job.
  assert.deepEqual(state, { ...initialMobileState, notice: "sessionEnded", started: true });
  assert.equal(state.session, undefined);
  assert.equal(state.memberships.value, undefined);
  assert.equal(mobileScreen(state), "signIn");
});

test("nothing is accepted after sign-out, including a response already in flight", () => {
  const attempt = nextAttempt();
  const inFlight = apply(onBranchA(), { attempt, scope: scopeA, type: "layoutLoading" });
  const signedOut = apply(inFlight, { notice: undefined, type: "signedOut" });
  const late = apply(
    signedOut,
    ...loadedMemberships(session.userId, memberships),
    { attempt, layout: layoutA as NonNullable<typeof layoutA>, scope: scopeA, type: "layoutLoaded" },
    ...authorized(contextA),
  );

  assert.deepEqual(late, signedOut);
});

test("loading, failure and retry are explicit for every read", () => {
  const attempt = nextAttempt();
  const loading = apply(onBranchA(), { attempt, scope: scopeA, type: "layoutLoading" });
  assert.equal(loading.layout.status, "loading");
  assert.equal(loading.layout.attempt, attempt);

  const failed = apply(loading, { attempt, failure: "network", scope: scopeA, type: "layoutFailed" });
  assert.equal(failed.layout.status, "failed");
  assert.equal(failed.layout.failure, "network");
  assert.equal(failed.layout.value, undefined);
  assert.equal(failed.layout.attempt, undefined);

  const reset = apply(failed, { scope: scopeA, type: "layoutReset" });
  assert.equal(reset.layout.status, "idle");
  assert.equal(reset.layout.failure, undefined);
  assert.equal(apply(failed, { scope: scopeB, type: "layoutReset" }).layout.status, "failed");

  const retry = nextAttempt();
  const retried = apply(
    reset,
    { attempt: retry, scope: scopeA, type: "layoutLoading" },
    { attempt: retry, layout: layoutA as NonNullable<typeof layoutA>, scope: scopeA, type: "layoutLoaded" },
  );
  assert.equal(retried.layout.status, "ready");
  assert.equal(retried.layout.failure, undefined);

  const menuReset = apply(onBranchA(), { scope: scopeA, type: "menuReset" });
  assert.equal(menuReset.menu.status, "idle");

  const membershipsAttempt = nextAttempt();
  const failing = apply(
    signedIn(),
    { attempt: membershipsAttempt, operator: session.userId, type: "membershipsLoading" },
    { attempt: membershipsAttempt, failure: "unavailable", operator: session.userId, type: "membershipsFailed" },
  );
  assert.equal(failing.memberships.status, "failed");
  assert.equal(hasNoMemberships(failing), false);
});

test("transport failures map to operational states with Spanish messages", () => {
  assert.equal(toMobileFailure(new MobileRequestError("network")), "network");
  assert.equal(toMobileFailure(new MobileRequestError("protocol")), "protocol");
  assert.equal(toMobileFailure(new MobileRequestError(401)), "authorization");
  assert.equal(toMobileFailure(new MobileRequestError(403)), "authorization");
  assert.equal(toMobileFailure(new MobileRequestError(503)), "unavailable");
  assert.equal(toMobileFailure(new Error("boom")), "unavailable");

  for (const failure of ["authorization", "network", "protocol", "unavailable"] as const) {
    assert.match(failureMessage(failure), /^[A-ZÁÉÍÓÚÑ].+\.$/u);
  }
  for (const notice of ["branchRevoked", "sessionEnded"] as const) {
    assert.match(noticeMessage(notice), /^[A-ZÁÉÍÓÚÑ].+\.$/u);
  }
});

test("the same operator renewing a token keeps the branch, its memberships and its data", () => {
  const renewed = apply(onBranchA(), { session: fixtureSession({ accessToken: "token-2" }), type: "sessionObserved" });

  assert.equal(renewed.session?.accessToken, "token-2");
  assert.equal(renewed.session?.userId, session.userId);
  assert.equal(renewed.branch?.branchId, scopeA.branchId);
  assert.equal(renewed.memberships.status, "ready");
  assert.equal(renewed.layout.status, "ready");
  assert.equal(renewed.menu.status, "ready");
});

test("a different operator with the same email starts from a clean state", () => {
  const impostor = apply(onBranchA(), {
    session: fixtureSession({ accessToken: "token-3", userId: FIXTURE_USER_B }),
    type: "sessionObserved",
  });

  assert.equal(impostor.session?.userId, FIXTURE_USER_B);
  assert.equal(impostor.session?.email, session.email, "same email on purpose");
  assert.equal(impostor.branch, undefined);
  assert.equal(impostor.layout.value, undefined);
  assert.equal(impostor.menu.value, undefined);
  assert.equal(impostor.memberships.value, undefined);
  assert.equal(mobileScreen(impostor), "branches");
});

test("the same operator with a changed email is still the same operator", () => {
  const renamed = apply(onBranchA(), {
    session: fixtureSession({ accessToken: "token-4", email: "correo.nuevo@example.invalid" }),
    type: "sessionObserved",
  });

  assert.equal(renamed.branch?.branchId, scopeA.branchId);
  assert.equal(renamed.layout.status, "ready");
});

test("returning to the foreground drops the loaded branch data before revalidating", () => {
  const revalidating = apply(onBranchA(), { type: "revalidationStarted" });

  assert.equal(revalidating.revalidating, true);
  assert.equal(revalidating.layout.value, undefined);
  assert.equal(revalidating.menu.value, undefined);
  assert.equal(revalidating.layout.status, "idle");
  assert.equal(revalidating.menu.status, "idle");
  assert.equal(canReadBranchData(revalidating), false);
  // The scope is still known, so it can be revalidated; only its data is gone.
  assert.deepEqual(activeScope(revalidating), { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId });
});

test("repeated foreground events never start a second revalidation", () => {
  const first = apply(onBranchA(), { type: "revalidationStarted" });
  const second = apply(first, { type: "revalidationStarted" });
  const third = apply(second, { type: "revalidationStarted" });

  assert.equal(second, first);
  assert.equal(third, first);
});

test("a valid revalidation restores the branch and requires a fresh open-shift selection", () => {
  const confirmed = apply(
    onBranchA(),
    { type: "revalidationStarted" },
    { context: contextA, type: "revalidationSucceeded" },
  );

  assert.equal(confirmed.revalidating, false);
  assert.equal(confirmed.revalidationFailure, undefined);
  assert.equal(canReadBranchData(confirmed), true);
  assert.equal(mobileScreen(confirmed), "shifts");
  assert.equal(confirmed.shift, undefined);
  assert.equal(confirmed.layout.status, "idle");
});

test("loaded, backgrounded, revoked, foregrounded: no data survives the revocation", () => {
  const revoked = apply(
    onBranchA(),
    { type: "revalidationStarted" },
    { failure: "authorization", type: "revalidationFailed" },
  );

  assert.equal(mobileScreen(revoked), "branches");
  assert.equal(revoked.branch, undefined);
  assert.equal(revoked.notice, "branchRevoked");
  assert.equal(revoked.branchFailure, "authorization");
  assert.equal(revoked.layout.value, undefined);
  assert.equal(revoked.menu.value, undefined);
  assert.equal(revoked.memberships.status, "idle");
  assert.equal(revoked.revalidating, false);
  assert.equal(canReadBranchData(revoked), false);
});

test("loaded, backgrounded, session expired, foregrounded: back to sign-in", () => {
  const expired = apply(
    onBranchA(),
    { type: "revalidationStarted" },
    { notice: "sessionEnded", type: "signedOut" },
  );

  assert.deepEqual(expired, { ...initialMobileState, notice: "sessionEnded", started: true });
  assert.equal(mobileScreen(expired), "signIn");
});

test("a revalidation that cannot complete blocks every branch read until retried", () => {
  const failed = apply(
    onBranchA(),
    { type: "revalidationStarted" },
    { failure: "network", type: "revalidationFailed" },
  );

  assert.equal(failed.revalidationFailure, "network");
  assert.equal(canReadBranchData(failed), false);
  assert.equal(failed.layout.value, undefined);
  assert.equal(failed.menu.value, undefined);
  assert.equal(mobileScreen(failed), "workspace");

  const retried = apply(failed, { type: "revalidationStarted" }, { context: contextA, type: "revalidationSucceeded" });
  assert.equal(canReadBranchData(retried), true);
  assert.equal(mobileScreen(retried), "shifts");
});

test("a revalidation answer for another branch, or with none pending, is ignored", () => {
  const running = apply(onBranchA(), { type: "revalidationStarted" });
  assert.equal(apply(running, { context: contextB, type: "revalidationSucceeded" }), running);

  const settled = apply(running, { context: contextA, type: "revalidationSucceeded" });
  assert.equal(apply(settled, { context: contextA, type: "revalidationSucceeded" }), settled);
  assert.equal(apply(settled, { failure: "network", type: "revalidationFailed" }), settled);
});

test("only the attempt the resource is waiting for may settle it", () => {
  assert.ok(layoutA !== undefined);
  const attempt = nextAttempt();
  const loading = apply(onBranchA(), { attempt, scope: scopeA, type: "layoutLoading" });

  // Same session, same Restaurant/Branch, different read: nothing is applied.
  const other = attempt + 1000;
  assert.equal(apply(loading, { attempt: other, layout: layoutA, scope: scopeA, type: "layoutLoaded" }), loading);
  assert.equal(apply(loading, { attempt: other, failure: "network", scope: scopeA, type: "layoutFailed" }), loading);
  assert.equal(
    apply(loading, { attempt: other, failure: "authorization", scope: scopeA, type: "layoutFailed" }),
    loading,
    "a 401 from a read nobody is waiting for must not revoke the branch",
  );

  const settled = apply(loading, { attempt, layout: layoutA, scope: scopeA, type: "layoutLoaded" });
  assert.equal(settled.layout.status, "ready");
  // The attempt is spent: the same answer twice cannot be applied twice.
  assert.equal(apply(settled, { attempt, layout: layoutA, scope: scopeA, type: "layoutLoaded" }), settled);
});

test("an authorization failure for the current read revokes the branch", () => {
  const attempt = nextAttempt();
  const revoked = apply(
    onBranchA(),
    { attempt, scope: scopeA, type: "shiftsLoading" },
    { attempt, failure: "authorization", scope: scopeA, type: "shiftsFailed" },
  );

  assert.equal(mobileScreen(revoked), "branches");
  assert.equal(revoked.branch, undefined);
  assert.equal(revoked.notice, "branchRevoked");
  assert.equal(revoked.memberships.status, "idle");
});

test("a renewed token gives up the reads in flight and keeps what already answered", () => {
  const attempt = nextAttempt();
  const reading = apply(onBranchA(), { attempt, scope: scopeA, type: "shiftsLoading" });
  const renewed = apply(reading, { session: fixtureSession({ accessToken: "token-9" }), type: "sessionObserved" });

  // The list read with the old token is given up, and left ready to be started
  // again with the new one — never stranded on `loading`.
  assert.equal(renewed.shifts.status, "idle");
  assert.equal(renewed.shifts.attempt, undefined);
  assert.deepEqual(shiftsReadTarget(renewed), { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId });
  // What had already answered is untouched: it is the same operator and branch.
  assert.equal(renewed.layout.status, "ready");
  assert.equal(renewed.menu.status, "ready");
  assert.equal(renewed.shift?.shiftId, shiftsA?.shifts[0]?.shiftId);

  // The old token's answer — including its 401 — cannot reach the state.
  assert.equal(apply(renewed, { attempt, failure: "authorization", scope: scopeA, type: "shiftsFailed" }), renewed);
  assert.equal(renewed.session?.accessToken, "token-9");
});

test("choosing a shift gives up an operational read started under the previous one", () => {
  assert.ok(layoutA !== undefined && shiftsA?.shifts[0] !== undefined);
  const stale = nextAttempt();
  const reselected = apply(
    onBranchA(),
    { scope: scopeA, type: "layoutReset" },
    { attempt: stale, scope: scopeA, type: "layoutLoading" },
    { type: "shiftReleased" },
    { shift: shiftsA.shifts[0], type: "shiftSelected" },
  );

  assert.equal(reselected.layout.status, "idle");
  assert.deepEqual(layoutReadTarget(reselected), { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId });
  assert.equal(apply(reselected, { attempt: stale, layout: layoutA, scope: scopeA, type: "layoutLoaded" }), reselected);
});

test("what may be read is decided by the state alone", () => {
  const idle = apply(onBranchA(), { scope: scopeA, type: "layoutReset" }, { scope: scopeA, type: "menuReset" });
  const pair = { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId };

  assert.deepEqual(layoutReadTarget(idle), pair);
  assert.equal(menuReadTarget(idle, false), undefined, "the catalog is not read from the tables tab alone");
  assert.deepEqual(menuReadTarget(idle, true), pair, "a selected table is what the composer needs it for");
  assert.deepEqual(menuReadTarget(apply(idle, { tab: "menu", type: "tabSelected" }), false), pair);
  assert.equal(shiftsReadTarget(idle), undefined, "the shift list already answered");

  // Nothing is read while the scope is unconfirmed, or after a revalidation
  // that could not complete.
  const revalidating = apply(idle, { type: "revalidationStarted" });
  assert.equal(shiftsReadTarget(revalidating), undefined);
  assert.equal(layoutReadTarget(revalidating), undefined);
  assert.equal(menuReadTarget(revalidating, true), undefined);

  const blocked = apply(revalidating, { failure: "network", type: "revalidationFailed" });
  assert.equal(shiftsReadTarget(blocked), undefined);
  assert.equal(layoutReadTarget(blocked), undefined);

  // No shift, no operational read; the shift list itself is still read.
  const confirmed = apply(revalidating, { context: contextA, type: "revalidationSucceeded" });
  assert.deepEqual(shiftsReadTarget(confirmed), pair);
  assert.equal(layoutReadTarget(confirmed), undefined);
  assert.equal(menuReadTarget(confirmed, true), undefined);
  assert.equal(shiftsReadTarget(signedIn()), undefined, "no branch, no branch-scoped read");
});

test("a membership list belongs to the operator that asked for it", () => {
  const attempt = nextAttempt();
  const reading = apply(
    signedIn(),
    { attempt, operator: session.userId, type: "membershipsLoading" },
  );
  assert.equal(reading.memberships.status, "loading");
  assert.equal(reading.memberships.attempt, attempt);

  // The coordinator's regression: the operator changes while the read is in
  // flight, and the answer of the previous one arrives afterwards.
  const onB = apply(reading, {
    session: fixtureSession({ accessToken: "token-b", userId: FIXTURE_USER_B }),
    type: "sessionObserved",
  });
  assert.equal(onB.memberships.status, "idle");
  assert.equal(onB.memberships.attempt, undefined);
  assert.equal(membershipsReadOperator(onB), FIXTURE_USER_B, "B may read its own list at once");

  const late = apply(onB, { attempt, memberships, operator: session.userId, type: "membershipsLoaded" });
  assert.equal(late, onB);
  assert.equal(late.memberships.value, undefined);

  // Neither does a failure, nor the 401 that would otherwise end the session.
  assert.equal(apply(onB, { attempt, failure: "network", operator: session.userId, type: "membershipsFailed" }), onB);
  assert.equal(
    apply(onB, { attempt, failure: "authorization", operator: session.userId, type: "membershipsFailed" }),
    onB,
    "a 401 nobody is waiting for must not end the session of the operator in place",
  );
  // Not even the `loading` of a read started for the operator who left.
  assert.equal(apply(onB, { attempt: nextAttempt(), operator: session.userId, type: "membershipsLoading" }), onB);
});

test("a 401 on the current membership read ends the session on this device", () => {
  const attempt = nextAttempt();
  const ended = apply(
    signedIn(),
    { attempt, operator: session.userId, type: "membershipsLoading" },
    { attempt, failure: "authorization", operator: session.userId, type: "membershipsFailed" },
  );

  assert.deepEqual(ended, { ...initialMobileState, notice: "sessionEnded", started: true });
  assert.equal(mobileScreen(ended), "signIn");
});

test("renewing a token gives up the membership read in flight, not the list on screen", () => {
  const attempt = nextAttempt();
  const rereading = apply(
    onBranchA(),
    { attempt, operator: session.userId, type: "membershipsLoading" },
    { session: fixtureSession({ accessToken: "token-renewed" }), type: "sessionObserved" },
  );

  assert.equal(rereading.memberships.status, "idle", "never left loading");
  assert.equal(membershipsReadOperator(rereading), session.userId);
  assert.equal(apply(rereading, { attempt, memberships, operator: session.userId, type: "membershipsLoaded" }), rereading);

  // A read that had already answered is untouched by the renewal.
  const settled = apply(onBranchA(), { session: fixtureSession({ accessToken: "token-renewed" }), type: "sessionObserved" });
  assert.equal(settled.memberships.status, "ready");
  assert.equal(membershipsReadOperator(settled), undefined);
});

test("whose membership list may be read is decided by the state alone", () => {
  assert.equal(membershipsReadOperator(initialMobileState), undefined, "no session, no read");
  assert.equal(membershipsReadOperator(signedIn()), session.userId);
  assert.equal(membershipsReadOperator(onBranchA()), undefined, "the list already answered");

  const revalidating = apply(onBranchA(), { type: "revalidationStarted" });
  assert.equal(membershipsReadOperator(revalidating), undefined);
  const blocked = apply(revalidating, { failure: "network", type: "revalidationFailed" });
  assert.equal(membershipsReadOperator(blocked), undefined);

  // A revocation forces a fresh read, for the operator still in place.
  const revoked = apply(onBranchA(), { type: "accessRevoked" });
  assert.equal(membershipsReadOperator(revoked), session.userId);
});

test("a branch is confirmed by its own operational context, and only by it", () => {
  const attempt = nextAttempt();
  const selecting = apply(signedIn(), { scope: scopeA, type: "branchRequested" });
  assert.deepEqual(contextReadTarget(selecting), {
    attempt: 0,
    operator: session.userId,
    scope: { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId },
  });

  const reading = apply(selecting, { attempt, operator: session.userId, scope: scopeA, type: "branchContextRequested" });
  assert.equal(contextReadTarget(reading), undefined, "one read at a time");
  assert.equal(ownsContextRead(reading, { attempt, operator: session.userId, scope: scopeA }), true);

  const confirmed = apply(reading, { attempt, context: contextA, operator: session.userId, type: "branchAuthorized" });
  assert.equal(confirmed.branch?.branchId, scopeA.branchId);
  assert.equal(confirmed.branch?.timeZone, contextA.timeZone, "the zone comes from the server, never the device");
  assert.deepEqual(confirmed.branch?.roles, contextA.roles);
  assert.equal(confirmed.pendingScope, undefined);
  assert.equal(confirmed.contextRead, undefined);
  assert.equal(mobileScreen(confirmed), "shifts");
});

test("a context answer needs the operator, the pending pair and the attempt", () => {
  const attempt = nextAttempt();
  const reading = apply(
    signedIn(),
    { scope: scopeA, type: "branchRequested" },
    { attempt, operator: session.userId, scope: scopeA, type: "branchContextRequested" },
  );

  for (const [read, why] of [
    [{ attempt, operator: FIXTURE_USER_B, scope: scopeA }, "another operator"],
    [{ attempt: attempt + 1_000, operator: session.userId, scope: scopeA }, "another attempt"],
    [{ attempt, operator: session.userId, scope: scopeB }, "another pair"],
  ] as const) {
    assert.equal(ownsContextRead(reading, read), false, why);
  }

  // A context for a pair that is not the pending one confirms nothing.
  assert.equal(apply(reading, { attempt, context: contextB, operator: session.userId, type: "branchAuthorized" }), reading);
  // Nor does one for the previous operator.
  assert.equal(apply(reading, { attempt, context: contextA, operator: FIXTURE_USER_B, type: "branchAuthorized" }), reading);
  // Nor a refusal from a read nobody is waiting for.
  assert.equal(
    apply(reading, { attempt: attempt + 1_000, failure: "authorization", operator: session.userId, scope: scopeA, type: "branchRejected" }),
    reading,
  );

  const refused = apply(reading, { attempt, failure: "authorization", operator: session.userId, scope: scopeA, type: "branchRejected" });
  assert.equal(refused.branchFailure, "authorization");
  assert.equal(refused.notice, "branchRevoked");
  assert.equal(refused.pendingScope, undefined);
  assert.equal(refused.contextRead, undefined);
});

test("renewing a token gives up a context read in flight and keeps the selection", () => {
  const attempt = nextAttempt();
  const reading = apply(
    signedIn(),
    { scope: scopeA, type: "branchRequested" },
    { attempt, operator: session.userId, scope: scopeA, type: "branchContextRequested" },
  );
  const renewed = apply(reading, { session: fixtureSession({ accessToken: "token-renewed" }), type: "sessionObserved" });

  // The pair the operator chose survives, so the screen reads it again at once
  // instead of dropping them back to the branch list.
  assert.deepEqual(renewed.pendingScope, { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId });
  assert.equal(renewed.contextRead, undefined);
  assert.equal(contextReadTarget(renewed)?.operator, session.userId);
  // And the answer of the read started with the replaced token cannot confirm.
  assert.equal(apply(renewed, { attempt, context: contextA, operator: session.userId, type: "branchAuthorized" }), renewed);
});

test("the active orders of a table belong to the scope, the table and the attempt", () => {
  assert.ok(shiftsA?.shifts[0] !== undefined);
  const onTable = onBranchA();
  assert.deepEqual(activeOrdersReadTarget(onTable, FIXTURE_TABLE), {
    branchId: scopeA.branchId,
    restaurantId: scopeA.restaurantId,
  });
  assert.equal(activeOrdersReadTarget(onTable, undefined), undefined, "no table, no read");

  const attempt = nextAttempt();
  const loading = apply(onTable, { attempt, scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersLoading" });
  assert.equal(loading.activeOrders.status, "loading");
  assert.equal(activeOrdersReadTarget(loading, FIXTURE_TABLE), undefined, "one read at a time");

  const list = parseActiveTableOrderListV2(activeTableOrderListBody({ orders: [{}, { shiftId: null }], scope: scopeA }));
  assert.ok(list !== undefined);
  const ready = apply(loading, { attempt, list, scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersLoaded" });
  assert.equal(ready.activeOrders.value?.orders.length, 2, "a table may carry more than one active order");
  assert.equal(ready.activeOrders.value?.orders[1]?.shiftId, null, "a historic order without a shift is kept");

  // An answer for another attempt, another scope or another table changes nothing.
  assert.equal(apply(loading, { attempt: attempt + 1_000, list, scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersLoaded" }), loading);
  assert.equal(apply(loading, { attempt, list, scope: scopeB, tableId: FIXTURE_TABLE, type: "activeOrdersLoaded" }), loading);
  const otherTable = parseActiveTableOrderListV2(activeTableOrderListBody({
    scope: scopeA,
    tableId: "66666666-6666-4666-8666-666666666667",
  }));
  assert.ok(otherTable !== undefined);
  assert.equal(
    apply(loading, { attempt, list: otherTable, scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersLoaded" }).activeOrders.value,
    undefined,
    "an answer about another table is not this table's",
  );
});

test("changing shift, branch or access drops the active orders with everything else", () => {
  const attempt = nextAttempt();
  const list = parseActiveTableOrderListV2(activeTableOrderListBody({ orders: [{}], scope: scopeA }));
  assert.ok(list !== undefined);
  const withOrders = apply(
    onBranchA(),
    { attempt, scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersLoading" },
    { attempt, list, scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersLoaded" },
  );
  assert.equal(withOrders.activeOrders.status, "ready");

  for (const [event, why] of [
    [{ type: "shiftReleased" } as const, "another shift"],
    [{ scope: scopeB, type: "branchRequested" } as const, "another branch"],
    [{ type: "branchReleased" } as const, "no branch"],
    [{ type: "revalidationStarted" } as const, "an unconfirmed scope"],
    [{ type: "accessRevoked" } as const, "a revoked access"],
  ] as const) {
    const after = apply(withOrders, event);
    assert.equal(after.activeOrders.status, "idle", why);
    assert.equal(after.activeOrders.value, undefined, why);
  }

  // A 401 on the current read revokes, exactly like the other branch reads.
  const revoked = apply(
    apply(withOrders, { scope: scopeA, type: "activeOrdersReset" }),
    { attempt: attempt + 1, scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersLoading" },
    { attempt: attempt + 1, failure: "authorization", scope: scopeA, tableId: FIXTURE_TABLE, type: "activeOrdersFailed" },
  );
  assert.equal(mobileScreen(revoked), "branches");
  assert.equal(revoked.notice, "branchRevoked");
});

test("selecting a branch clears any pending revalidation state", () => {
  const failed = apply(onBranchA(), { type: "revalidationStarted" }, { failure: "network", type: "revalidationFailed" });
  const selecting = apply(failed, { scope: scopeB, type: "branchRequested" });

  assert.equal(selecting.revalidating, false);
  assert.equal(selecting.revalidationFailure, undefined);
  assert.equal(canReadBranchData(selecting), false);
});
