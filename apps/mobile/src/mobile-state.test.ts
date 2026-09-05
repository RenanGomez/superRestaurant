import assert from "node:assert/strict";
import test from "node:test";

import { MobileRequestError } from "./mobile-client.js";
import {
  activeScope,
  canReadBranchData,
  failureMessage,
  hasNoMemberships,
  initialMobileState,
  mobileScreen,
  noticeMessage,
  reduceMobileState,
  toMobileFailure,
  type MobileEvent,
  type MobileState,
} from "./mobile-state.js";
import {
  FIXTURE_USER_B,
  authorizedBranchBody,
  diningLayoutBody,
  fixtureSession,
  membershipListBody,
  menuCatalogStateBody,
  scopeA,
  scopeB,
} from "./test-fixtures.js";
import type { MobileSession } from "./session.js";

import {
  parseBranchMembershipListV1,
  parseDiningLayoutV1,
  parseMenuCatalogStateV1,
} from "@super-restaurant/shared-types";

const session: MobileSession = fixtureSession();
const memberships = parseBranchMembershipListV1(membershipListBody([scopeA, scopeB]))?.memberships ?? [];
const layoutA = parseDiningLayoutV1(diningLayoutBody(scopeA));
const layoutB = parseDiningLayoutV1(diningLayoutBody(scopeB, "Salón"));
const menuA = parseMenuCatalogStateV1(menuCatalogStateBody(scopeA));
const branchA = authorizedBranchBody(scopeA) as { branchId: string; restaurantId: string; roles: readonly "waiter"[] };
const branchB = authorizedBranchBody(scopeB) as { branchId: string; restaurantId: string; roles: readonly "waiter"[] };

function apply(state: MobileState, ...events: readonly MobileEvent[]): MobileState {
  return events.reduce(reduceMobileState, state);
}

function signedIn(): MobileState {
  return apply(initialMobileState, { session, type: "sessionObserved" });
}

function onBranchA(): MobileState {
  assert.ok(layoutA !== undefined && menuA !== undefined && layoutB !== undefined);
  return apply(
    signedIn(),
    { memberships, type: "membershipsLoaded" },
    { scope: scopeA, type: "branchRequested" },
    { branch: branchA, type: "branchAuthorized" },
    { layout: layoutA, scope: scopeA, type: "layoutLoaded" },
    { menu: menuA, scope: scopeA, type: "menuLoaded" },
  );
}

test("navigation follows the session and the authorized branch, never history", () => {
  assert.equal(mobileScreen(initialMobileState), "starting");
  assert.equal(mobileScreen(apply(initialMobileState, { session: undefined, type: "sessionRestored" })), "signIn");
  assert.equal(mobileScreen(signedIn()), "branches");
  assert.equal(mobileScreen(onBranchA()), "workspace");
});

test("a tab cannot be opened before a branch is authorized", () => {
  const state = apply(signedIn(), { tab: "menu", type: "tabSelected" });
  assert.equal(state.tab, "tables");
  assert.equal(mobileScreen(state), "branches");
  assert.equal(apply(onBranchA(), { tab: "menu", type: "tabSelected" }).tab, "menu");
});

test("an empty membership list is an explicit state, not a silent empty screen", () => {
  const state = apply(signedIn(), { memberships: [], type: "membershipsLoaded" });
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

  const onB = apply(switched, { branch: branchB, type: "branchAuthorized" });
  assert.deepEqual(activeScope(onB), { branchId: scopeB.branchId, restaurantId: scopeB.restaurantId });
  assert.equal(onB.layout.value, undefined);
});

test("a late response for another branch never reaches the active branch", () => {
  assert.ok(layoutB !== undefined);
  const onB = apply(
    onBranchA(),
    { scope: scopeB, type: "branchRequested" },
    { branch: branchB, type: "branchAuthorized" },
    { layout: layoutB, scope: scopeB, type: "layoutLoaded" },
    { layout: layoutA as NonNullable<typeof layoutA>, scope: scopeA, type: "layoutLoaded" },
    { failure: "network", scope: scopeA, type: "menuFailed" },
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
    { branch: branchA, type: "branchAuthorized" },
  );

  assert.equal(state.branch, undefined);
  assert.deepEqual(state.pendingScope, { branchId: scopeB.branchId, restaurantId: scopeB.restaurantId });
});

test("a revoked branch returns to selection with an explicit notice", () => {
  const state = apply(
    onBranchA(),
    { scope: scopeA, type: "branchRequested" },
    { failure: "authorization", scope: scopeA, type: "branchRejected" },
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

  // The only thing kept is the identity of the closed session, so a late
  // notification carrying it cannot bring the operator back.
  assert.equal(state.closedSessionKey, `${session.userId}|${session.accessToken}`);
  assert.deepEqual(state, {
    ...initialMobileState,
    closedSessionKey: state.closedSessionKey,
    notice: "sessionEnded",
    started: true,
  });
  assert.equal(state.session, undefined);
  assert.equal(state.memberships.value, undefined);
  assert.equal(mobileScreen(state), "signIn");
});

test("nothing is accepted after sign-out, including a response already in flight", () => {
  const signedOut = apply(onBranchA(), { notice: undefined, type: "signedOut" });
  const late = apply(
    signedOut,
    { memberships, type: "membershipsLoaded" },
    { layout: layoutA as NonNullable<typeof layoutA>, scope: scopeA, type: "layoutLoaded" },
    { branch: branchA, type: "branchAuthorized" },
  );

  assert.deepEqual(late, signedOut);
});

test("loading, failure and retry are explicit for every read", () => {
  const loading = apply(onBranchA(), { scope: scopeA, type: "layoutLoading" });
  assert.equal(loading.layout.status, "loading");

  const failed = apply(loading, { failure: "network", scope: scopeA, type: "layoutFailed" });
  assert.equal(failed.layout.status, "failed");
  assert.equal(failed.layout.failure, "network");
  assert.equal(failed.layout.value, undefined);

  const reset = apply(failed, { scope: scopeA, type: "layoutReset" });
  assert.equal(reset.layout.status, "idle");
  assert.equal(reset.layout.failure, undefined);
  assert.equal(apply(failed, { scope: scopeB, type: "layoutReset" }).layout.status, "failed");

  const retried = apply(reset, { layout: layoutA as NonNullable<typeof layoutA>, scope: scopeA, type: "layoutLoaded" });
  assert.equal(retried.layout.status, "ready");
  assert.equal(retried.layout.failure, undefined);

  const menuReset = apply(onBranchA(), { scope: scopeA, type: "menuReset" });
  assert.equal(menuReset.menu.status, "idle");

  const failing = apply(signedIn(), { type: "membershipsLoading" }, { failure: "unavailable", type: "membershipsFailed" });
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

test("a valid revalidation restores the branch and lets the reads run again", () => {
  const confirmed = apply(
    onBranchA(),
    { type: "revalidationStarted" },
    { branch: branchA, type: "revalidationSucceeded" },
  );

  assert.equal(confirmed.revalidating, false);
  assert.equal(confirmed.revalidationFailure, undefined);
  assert.equal(canReadBranchData(confirmed), true);
  assert.equal(mobileScreen(confirmed), "workspace");
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
  assert.equal(canReadBranchData(revoked), true);
});

test("loaded, backgrounded, session expired, foregrounded: back to sign-in", () => {
  const expired = apply(
    onBranchA(),
    { type: "revalidationStarted" },
    { notice: "sessionEnded", type: "signedOut" },
  );

  assert.deepEqual(expired, {
    ...initialMobileState,
    closedSessionKey: expired.closedSessionKey,
    notice: "sessionEnded",
    started: true,
  });
  assert.equal(expired.closedSessionKey, `${session.userId}|${session.accessToken}`);
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

  const retried = apply(failed, { type: "revalidationStarted" }, { branch: branchA, type: "revalidationSucceeded" });
  assert.equal(canReadBranchData(retried), true);
});

test("a revalidation answer for another branch, or with none pending, is ignored", () => {
  const running = apply(onBranchA(), { type: "revalidationStarted" });
  assert.equal(apply(running, { branch: branchB, type: "revalidationSucceeded" }), running);

  const settled = apply(running, { branch: branchA, type: "revalidationSucceeded" });
  assert.equal(apply(settled, { branch: branchA, type: "revalidationSucceeded" }), settled);
  assert.equal(apply(settled, { failure: "network", type: "revalidationFailed" }), settled);
});

test("selecting a branch clears any pending revalidation state", () => {
  const failed = apply(onBranchA(), { type: "revalidationStarted" }, { failure: "network", type: "revalidationFailed" });
  const selecting = apply(failed, { scope: scopeB, type: "branchRequested" });

  assert.equal(selecting.revalidating, false);
  assert.equal(selecting.revalidationFailure, undefined);
  assert.equal(canReadBranchData(selecting), true);
});
