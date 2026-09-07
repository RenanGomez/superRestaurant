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
import { branchOperationalContextBody, fixtureSession } from "./test-fixtures.js";
import { parseBranchOperationalContextV1 } from "@super-restaurant/shared-types";

const session = fixtureSession();

/** Every path inside the state whose value contains `needle`. */
function carriers(value: unknown, needle: string, path = "state"): readonly string[] {
  if (typeof value === "string") return value.includes(needle) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => carriers(item, needle, `${path}[${index}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => carriers(item, needle, `${path}.${key}`));
  }
  return [];
}

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
  // One complete membership read: the reducer only accepts an answer for the
  // attempt and operator the resource is waiting for.
  sink.dispatch({ attempt: 1, operator: session.userId, type: "membershipsLoading" });
  sink.dispatch({ attempt: 1, memberships: [], operator: session.userId, type: "membershipsLoaded" });
  const scope = {
    branchId: "22222222-2222-4222-8222-222222222222",
    restaurantId: "11111111-1111-4111-8111-111111111111",
  };
  sink.dispatch({ scope, type: "branchRequested" });
  // A branch is confirmed by its operational context, announced first so the
  // reducer knows which read the answer belongs to.
  const context = parseBranchOperationalContextV1(branchOperationalContextBody(scope));
  assert.ok(context !== undefined);
  sink.dispatch({ attempt: 2, operator: session.userId, scope, type: "branchContextRequested" });
  sink.dispatch({ attempt: 2, context, operator: session.userId, type: "branchAuthorized" });
}

test("a sign-out that never resolves still closes the screen immediately", async () => {
  const sink = recorder();
  signedInOnBranchA(sink);
  assert.equal(mobileScreen(sink.state), "shifts");

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

test("the closed state keeps no bearer and nothing branch-scoped", () => {
  const sink = recorder();
  signedInOnBranchA(sink);
  assert.equal(carriers(sink.state, session.accessToken).length, 1, "the token is held while signed in");

  endMobileSession({ dispatch: sink.dispatch, notice: "sessionEnded", signOut: () => new Promise<void>(() => undefined) });

  // No field of the state — not even a derived key — carries the bearer, and
  // no field was added to hold one.
  assert.deepEqual(carriers(sink.state, session.accessToken), []);
  assert.deepEqual(Object.keys(sink.state).sort(), Object.keys(initialMobileState).sort());
  assert.deepEqual(sink.state, { ...initialMobileState, notice: "sessionEnded", started: true });
  assert.equal(mobileScreen(sink.state), "signIn");
  assert.equal(sink.state.branch, undefined);
  assert.equal(sink.state.memberships.value, undefined);
  assert.equal(sink.state.layout.value, undefined);
  assert.equal(sink.state.menu.value, undefined);
});

test("a session accepted after a local sign-out starts clean", () => {
  const sink = recorder();
  signedInOnBranchA(sink);
  endMobileSession({ dispatch: sink.dispatch, notice: undefined, signOut: () => Promise.resolve() });

  // Which sessions may be accepted at all is decided by the gate
  // (`src/auth-gate.test.ts`); one that gets through starts from nothing.
  const fresh = fixtureSession({ accessToken: "harness-token-2" });
  sink.dispatch({ session: fresh, type: "sessionObserved" });

  assert.equal(mobileScreen(sink.state), "branches");
  assert.deepEqual(sink.state.session, fresh);
  assert.equal(sink.state.branch, undefined);
  assert.equal(sink.state.memberships.status, "idle");
});
