import assert from "node:assert/strict";
import test from "node:test";

import { gateMobileAuth, type MobileAuthGate } from "./auth-gate.js";
import type { MobileAuthPort, MobileSignInResult } from "./auth-port.js";
import type { AuthorizedMobileBranch } from "./mobile-client.js";
import {
  initialMobileState,
  mobileScreen,
  reduceMobileState,
  type MobileEvent,
  type MobileNotice,
  type MobileState,
} from "./mobile-state.js";
import { readInitialSession } from "./revalidation.js";
import type { MobileSession } from "./session.js";
import { endMobileSession } from "./sign-out.js";
import { FIXTURE_USER_A, FIXTURE_USER_B, fixtureSession, scopeA } from "./test-fixtures.js";

type SessionHandler = (session: MobileSession | undefined) => void;

const sessionA1 = fixtureSession({ accessToken: "token-a-1", userId: FIXTURE_USER_A });
const sessionA2 = fixtureSession({ accessToken: "token-a-2", userId: FIXTURE_USER_A });
const sessionA3 = fixtureSession({ accessToken: "token-a-3", userId: FIXTURE_USER_A });
const sessionB1 = fixtureSession({ accessToken: "token-b-1", email: "b@example.invalid", userId: FIXTURE_USER_B });

const branchA: AuthorizedMobileBranch = Object.freeze({
  branchId: scopeA.branchId,
  restaurantId: scopeA.restaurantId,
  roles: Object.freeze(["waiter"] as const),
});

/** Lets every pending microtask and one macrotask run. */
function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

interface FakeProvider {
  /** Pushes to the subscriptions the provider still holds. */
  readonly emit: (session: MobileSession | undefined) => void;
  readonly port: MobileAuthPort;
  /** Pushes to every handler ever registered, including released ones. */
  readonly replayToEveryHandler: (session: MobileSession) => void;
  /** Session the next successful sign-in mints, and the outcome it produces. */
  readonly script: { minted: MobileSession; outcome: MobileSignInResult };
}

/**
 * An identity provider double. It deliberately keeps every handler it was ever
 * given, released or not, so a provider that never lets go can be reproduced.
 */
function fakeProvider(overrides: {
  readonly currentSession?: () => Promise<MobileSession | undefined>;
  readonly signIn?: (email: string, password: string) => Promise<MobileSignInResult>;
  readonly signOut?: () => Promise<void>;
} = {}): FakeProvider {
  const live = new Set<SessionHandler>();
  const everRegistered: SessionHandler[] = [];
  const script = { minted: sessionA1, outcome: "ok" as MobileSignInResult };
  let held: MobileSession | undefined;

  const push = (session: MobileSession | undefined): void => {
    for (const handler of [...live]) handler(session);
  };

  const port: MobileAuthPort = Object.freeze({
    currentSession: overrides.currentSession
      ?? ((): Promise<MobileSession | undefined> => Promise.resolve(held)),
    onSessionChange: (handler: SessionHandler): (() => void) => {
      live.add(handler);
      everRegistered.push(handler);
      return (): void => { live.delete(handler); };
    },
    signIn: overrides.signIn ?? ((): Promise<MobileSignInResult> => {
      if (script.outcome !== "ok") return Promise.resolve(script.outcome);
      held = script.minted;
      push(held);
      return Promise.resolve("ok");
    }),
    signOut: overrides.signOut ?? ((): Promise<void> => {
      held = undefined;
      push(undefined);
      return Promise.resolve();
    }),
    startAutoRefresh: (): Promise<void> => Promise.resolve(),
    stopAutoRefresh: (): Promise<void> => Promise.resolve(),
  });

  return Object.freeze({
    emit: push,
    port,
    replayToEveryHandler: (session: MobileSession): void => {
      for (const handler of [...everRegistered]) handler(session);
    },
    script,
  });
}

/**
 * The same wiring the App component uses — gate, subscription, start-up read
 * and local sign-out — without React, so whole authentication cycles can be
 * driven from a test. A divergence here would be a divergence from the screen.
 */
function device(provider: FakeProvider): {
  readonly dispatch: (event: MobileEvent) => void;
  readonly gate: MobileAuthGate;
  readonly restore: () => Promise<void>;
  readonly signIn: (session: MobileSession) => Promise<MobileSignInResult>;
  readonly signOut: (notice: MobileNotice | undefined) => void;
  readonly state: () => MobileState;
} {
  const gate = gateMobileAuth(provider.port);
  let state = initialMobileState;
  let identified = false;
  let pendingNotice: MobileNotice | undefined;

  const dispatch = (event: MobileEvent): void => {
    state = reduceMobileState(state, event);
    identified = state.session !== undefined;
  };

  gate.onSessionChange((session) => {
    if (session === undefined) {
      if (identified) gate.closeGeneration();
      dispatch({ notice: pendingNotice, type: "signedOut" });
      return;
    }
    pendingNotice = undefined;
    dispatch({ session, type: "sessionObserved" });
  });

  return Object.freeze({
    dispatch,
    gate,
    restore: async (): Promise<void> => {
      const session = await readInitialSession(gate.currentSession);
      dispatch({ session, type: "sessionRestored" });
    },
    signIn: (session: MobileSession): Promise<MobileSignInResult> => {
      provider.script.minted = session;
      return gate.signIn(session.email ?? "operador@example.invalid", "cualquiera");
    },
    signOut: (notice: MobileNotice | undefined): void => {
      pendingNotice = notice;
      endMobileSession({ dispatch, notice, signOut: gate.signOut });
    },
    state: (): MobileState => state,
  });
}

test("a sign-out closes the generation before the provider answers anything", async () => {
  const provider = fakeProvider({ signOut: (): Promise<void> => new Promise<void>(() => undefined) });
  const app = device(provider);
  await app.signIn(sessionA1);
  const opened = app.gate.generation();
  assert.equal(mobileScreen(app.state()), "branches");

  app.signOut(undefined);

  // Synchronously, with the provider call still in flight and unanswerable.
  assert.equal(app.gate.generation(), opened + 1);
  assert.equal(mobileScreen(app.state()), "signIn");

  // Everything the provider says about a session from now on is refused.
  provider.emit(sessionA1);
  provider.emit(sessionA2);
  await settle();
  assert.equal(mobileScreen(app.state()), "signIn");
  assert.equal(app.state().session, undefined);
});

test("a sign-out that rejects, and one that throws synchronously, still close the gate", async () => {
  const rejecting = device(fakeProvider({ signOut: (): Promise<void> => Promise.reject(new Error("SIGN_OUT_FAILED")) }));
  await rejecting.signIn(sessionA1);
  const rejectingGeneration = rejecting.gate.generation();
  rejecting.signOut("sessionEnded");
  assert.equal(rejecting.gate.generation(), rejectingGeneration + 1);
  assert.equal(mobileScreen(rejecting.state()), "signIn");
  assert.equal(rejecting.state().notice, "sessionEnded");

  const throwing = device(fakeProvider({ signOut: (): Promise<void> => { throw new Error("SIGN_OUT_THREW"); } }));
  await throwing.signIn(sessionA1);
  const throwingGeneration = throwing.gate.generation();
  throwing.signOut(undefined);
  assert.equal(throwing.gate.generation(), throwingGeneration + 1);
  assert.equal(mobileScreen(throwing.state()), "signIn");

  await settle();
  for (const app of [rejecting, throwing]) {
    assert.equal(mobileScreen(app.state()), "signIn");
    assert.equal(app.state().session, undefined);
  }
});

test("A signs in and out, B signs in and out, and a late notification from A changes nothing", async () => {
  const provider = fakeProvider();
  const app = device(provider);

  await app.signIn(sessionA1);
  assert.equal(app.state().session?.userId, FIXTURE_USER_A);
  app.dispatch({ scope: scopeA, type: "branchRequested" });
  app.dispatch({ branch: branchA, type: "branchAuthorized" });
  assert.equal(mobileScreen(app.state()), "workspace");

  app.signOut(undefined);
  await settle();
  assert.equal(mobileScreen(app.state()), "signIn");

  await app.signIn(sessionB1);
  assert.equal(app.state().session?.userId, FIXTURE_USER_B);
  assert.equal(mobileScreen(app.state()), "branches");

  app.signOut(undefined);
  await settle();
  const closed = app.state();
  assert.equal(mobileScreen(closed), "signIn");

  // Two full cycles later the provider finally reports the first session — on
  // the live subscription and on every handler it never released.
  provider.emit(sessionA1);
  provider.replayToEveryHandler(sessionA1);
  provider.replayToEveryHandler(sessionB1);
  await settle();

  assert.equal(app.state(), closed);
  assert.equal(mobileScreen(app.state()), "signIn");
  assert.equal(app.state().session, undefined);
  assert.equal(app.state().branch, undefined);
});

test("a start-up session read that answers after the close restores nothing", async () => {
  let answer: (session: MobileSession | undefined) => void = () => undefined;
  const provider = fakeProvider({
    currentSession: (): Promise<MobileSession | undefined> => new Promise((resolve) => { answer = resolve; }),
  });
  const app = device(provider);

  // The start-up read is issued and stays in flight; the provider announces the
  // session by notification first, as it does when a sign-in completes.
  const restoring = app.restore();
  provider.emit(sessionA1);
  assert.equal(mobileScreen(app.state()), "branches");

  app.signOut("sessionEnded");
  await settle();
  assert.equal(mobileScreen(app.state()), "signIn");

  // Only now does the read issued in the previous generation answer.
  answer(sessionA1);
  await restoring;
  await settle();

  assert.equal(mobileScreen(app.state()), "signIn");
  assert.equal(app.state().session, undefined);
  assert.equal(app.state().notice, "sessionEnded");
});

test("a deliberate sign-in re-opens the gate, and the operator in place can renew a token", async () => {
  const provider = fakeProvider();
  const app = device(provider);

  await app.signIn(sessionA1);
  app.signOut(undefined);
  await settle();
  assert.equal(mobileScreen(app.state()), "signIn");

  // Entering again is accepted, and starts from nothing.
  await app.signIn(sessionA2);
  assert.equal(mobileScreen(app.state()), "branches");
  assert.equal(app.state().session?.accessToken, "token-a-2");
  assert.equal(app.state().branch, undefined);
  assert.equal(app.state().memberships.status, "idle");

  app.dispatch({ scope: scopeA, type: "branchRequested" });
  app.dispatch({ branch: branchA, type: "branchAuthorized" });
  assert.equal(mobileScreen(app.state()), "workspace");

  // A renewed token of the operator in place keeps the branch and its data.
  provider.emit(sessionA3);
  await settle();
  assert.equal(app.state().session?.accessToken, "token-a-3");
  assert.equal(app.state().branch, branchA);
  assert.equal(mobileScreen(app.state()), "workspace");
});

test("a sign-in that fails leaves no gate open behind it", async () => {
  const provider = fakeProvider();
  const app = device(provider);
  await app.signIn(sessionA1);
  app.signOut(undefined);
  await settle();

  provider.script.outcome = "rejected";
  assert.equal(await app.signIn(sessionA2), "rejected");

  // The attempt opened a generation; the refusal closed it again.
  provider.emit(sessionA2);
  await settle();
  assert.equal(mobileScreen(app.state()), "signIn");

  provider.script.outcome = "ok";
  assert.equal(await app.signIn(sessionA3), "ok");
  assert.equal(mobileScreen(app.state()), "branches");
  assert.equal(app.state().session?.accessToken, "token-a-3");
});

test("a provider that keeps a released listener is ignored once the generation moves", async () => {
  const provider = fakeProvider();
  const gate = gateMobileAuth(provider.port);
  const seen: (MobileSession | undefined)[] = [];
  gate.onSessionChange((session) => { seen.push(session); });

  provider.script.minted = sessionA1;
  await gate.signIn("a@example.invalid", "cualquiera");
  assert.deepEqual(seen, [sessionA1]);

  await gate.signOut();
  // The provider replays the closed session on the handler it was told to
  // release, and on the one bound to the generation that is now closed.
  provider.replayToEveryHandler(sessionA1);
  assert.deepEqual(seen, [sessionA1, undefined]);
});

test("a whole cycle of failing provider calls raises no unhandled rejection", async () => {
  const raised: unknown[] = [];
  const onRejection = (reason: unknown): void => { raised.push(reason); };
  process.on("unhandledRejection", onRejection);

  try {
    const hanging = device(fakeProvider({ signOut: (): Promise<void> => new Promise<void>(() => undefined) }));
    await hanging.signIn(sessionA1);
    hanging.signOut(undefined);

    const rejecting = device(fakeProvider({ signOut: (): Promise<void> => Promise.reject(new Error("SIGN_OUT_FAILED")) }));
    await rejecting.signIn(sessionA1);
    rejecting.signOut("sessionEnded");

    const throwing = device(fakeProvider({ signOut: (): Promise<void> => { throw new Error("SIGN_OUT_THREW"); } }));
    await throwing.signIn(sessionA1);
    throwing.signOut(undefined);

    // The sign-in form absorbs a rejected port exactly like the access screen.
    const broken = device(fakeProvider({
      signIn: (): Promise<MobileSignInResult> => Promise.reject(new Error("SIGN_IN_FAILED")),
    }));
    const outcome = await broken.signIn(sessionA1).catch((): MobileSignInResult => "unavailable");
    assert.equal(outcome, "unavailable");

    // A start-up read that rejects is "no session", never an unhandled error.
    const unreadable = device(fakeProvider({
      currentSession: (): Promise<MobileSession | undefined> => Promise.reject(new Error("SESSION_UNREADABLE")),
    }));
    await unreadable.restore();
    assert.equal(mobileScreen(unreadable.state()), "signIn");

    await settle();
    await settle();
    assert.deepEqual(raised, []);
    for (const app of [hanging, rejecting, throwing]) {
      assert.equal(mobileScreen(app.state()), "signIn");
      assert.equal(app.state().session, undefined);
    }
    // The rejected sign-in never produced a session, so that device is still on
    // the start-up screen — with no session and no generation left open.
    assert.equal(broken.state().session, undefined);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});
