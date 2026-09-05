import assert from "node:assert/strict";
import test from "node:test";

import { MobileRequestError } from "./mobile-client.js";
import {
  activeScope,
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
  authorizedBranchBody,
  diningLayoutBody,
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

const session: MobileSession = Object.freeze({ accessToken: "token-1", email: "operador@example.com" });
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
  return apply(initialMobileState, { session, type: "signedIn" });
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

  assert.deepEqual(state, { ...initialMobileState, notice: "sessionEnded", started: true });
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
