import assert from "node:assert/strict";
import test from "node:test";

import {
  initialMobileState,
  mobileScreen,
  reduceMobileState,
  type MobileEvent,
  type MobileState,
} from "./mobile-state.js";
import { endMobileSession } from "./sign-out.js";
import { fixtureSession } from "./test-fixtures.js";

const session = fixtureSession();

/** Applies to the reducer exactly what the app dispatches, in order. */
function recorder(): { readonly dispatch: (event: MobileEvent) => void; readonly events: MobileEvent[]; state: MobileState } {
  const events: MobileEvent[] = [];
  const sink = {
    dispatch: (event: MobileEvent): void => {
      events.push(event);
      sink.state = reduceMobileState(sink.state, event);
    },
    events,
    state: initialMobileState,
  };
  return sink;
}

function signedInOnBranchA(sink: ReturnType<typeof recorder>): void {
  sink.dispatch({ session, type: "sessionObserved" });
  sink.dispatch({ memberships: [], type: "membershipsLoaded" });
  sink.dispatch({ scope: { branchId: "22222222-2222-4222-8222-222222222222", restaurantId: "11111111-1111-4111-8111-111111111111" }, type: "branchRequested" });
  sink.dispatch({
    branch: {
      branchId: "22222222-2222-4222-8222-222222222222",
      restaurantId: "11111111-1111-4111-8111-111111111111",
      roles: ["waiter"],
    },
    type: "branchAuthorized",
  });
}

test("a sign-out that never resolves still closes the screen immediately", async () => {
  const sink = recorder();
  signedInOnBranchA(sink);
  assert.equal(mobileScreen(sink.state), "workspace");

  let settled = false;
  // Never settles: the provider is unreachable or hanging.
  const pending = new Promise<void>(() => undefined);
  void pending.then(() => { settled = true; }, () => { settled = true; });

  endMobileSession({ dispatch: sink.dispatch, notice: undefined, signOut: () => pending });

  // Synchronously, before any microtask could run.
  assert.equal(mobileScreen(sink.state), "signIn");
  assert.equal(sink.state.session, undefined);
  assert.equal(sink.state.branch, undefined);

  // Still closed after the event loop turns, with the call still in flight.
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  assert.equal(settled, false);
  assert.equal(mobileScreen(sink.state), "signIn");
});

test("a sign-out that rejects leaves the session closed and raises nothing", async () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => { rejections.push(reason); };
  process.on("unhandledRejection", onRejection);

  try {
    const sink = recorder();
    signedInOnBranchA(sink);
    endMobileSession({
      dispatch: sink.dispatch,
      notice: "sessionEnded",
      signOut: () => Promise.reject(new Error("SIGN_OUT_FAILED")),
    });

    assert.equal(mobileScreen(sink.state), "signIn");
    assert.equal(sink.state.notice, "sessionEnded");

    // Let every microtask and one macrotask run: the rejection must be absorbed.
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    assert.deepEqual(rejections, []);
    assert.equal(mobileScreen(sink.state), "signIn");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("a port that throws synchronously does not break the local sign-out", () => {
  const sink = recorder();
  signedInOnBranchA(sink);
  endMobileSession({
    dispatch: sink.dispatch,
    notice: undefined,
    signOut: () => { throw new Error("SIGN_OUT_THREW"); },
  });

  assert.equal(mobileScreen(sink.state), "signIn");
});

test("a late notification carrying the closed session restores nothing", () => {
  const sink = recorder();
  signedInOnBranchA(sink);
  const beforeSignOut = sink.state;
  assert.notEqual(beforeSignOut.branch, undefined);

  endMobileSession({ dispatch: sink.dispatch, notice: "sessionEnded", signOut: () => new Promise<void>(() => undefined) });
  const closed = sink.state;

  // The provider notifies late with the very session that was closed.
  sink.dispatch({ session, type: "sessionObserved" });

  assert.equal(sink.state, closed);
  assert.equal(mobileScreen(sink.state), "signIn");
  assert.equal(sink.state.session, undefined);
  assert.equal(sink.state.branch, undefined);
  assert.equal(sink.state.memberships.value, undefined);
  assert.equal(sink.state.layout.value, undefined);
  assert.equal(sink.state.menu.value, undefined);
});

test("signing in again after a local sign-out works and starts clean", () => {
  const sink = recorder();
  signedInOnBranchA(sink);
  endMobileSession({ dispatch: sink.dispatch, notice: undefined, signOut: () => Promise.resolve() });

  // A new sign-in always carries a newly issued token.
  const fresh = fixtureSession({ accessToken: "harness-token-2" });
  sink.dispatch({ session: fresh, type: "sessionObserved" });

  assert.equal(mobileScreen(sink.state), "branches");
  assert.deepEqual(sink.state.session, fresh);
  assert.equal(sink.state.branch, undefined);
  assert.equal(sink.state.memberships.status, "idle");

  // The closed token stays refused even after the new sign-in: no downgrade.
  const afterSignIn = sink.state;
  sink.dispatch({ session, type: "sessionObserved" });
  assert.equal(sink.state, afterSignIn);
  assert.equal(sink.state.session?.accessToken, "harness-token-2");
});
