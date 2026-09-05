import assert from "node:assert/strict";
import test from "node:test";

import { MobileRequestError, type AuthorizedMobileBranch, type MobileBranchScope } from "./mobile-client.js";
import { readInitialSession, revalidateAccess } from "./revalidation.js";
import type { MobileSession } from "./session.js";
import { fixtureSession, scopeA } from "./test-fixtures.js";

const session = fixtureSession();
const branch: AuthorizedMobileBranch = Object.freeze({
  branchId: scopeA.branchId,
  restaurantId: scopeA.restaurantId,
  roles: Object.freeze(["waiter" as const]),
});

function rejectingSession(): () => Promise<MobileSession | undefined> {
  return () => Promise.reject(new Error("SESSION_PORT_FAILED"));
}

function neverAuthorize(): (session: MobileSession, scope: MobileBranchScope) => Promise<AuthorizedMobileBranch> {
  return () => { throw new Error("authorizeScope must not be called"); };
}

test("a session port that rejects at start-up reads as no session", async () => {
  assert.equal(await readInitialSession(rejectingSession()), undefined);
  assert.equal(await readInitialSession(() => Promise.resolve(undefined)), undefined);
  assert.deepEqual(await readInitialSession(() => Promise.resolve(session)), session);
});

test("a session port that rejects during revalidation ends the session", async () => {
  const outcome = await revalidateAccess({
    authorizeScope: neverAuthorize(),
    currentSession: rejectingSession(),
    scope: scopeA,
  });

  assert.deepEqual(outcome, { kind: "sessionLost" });
});

test("an absent session never revalidates the branch", async () => {
  const outcome = await revalidateAccess({
    authorizeScope: neverAuthorize(),
    currentSession: () => Promise.resolve(undefined),
    scope: scopeA,
  });

  assert.deepEqual(outcome, { kind: "sessionLost" });
});

test("without an active branch the session alone is confirmed", async () => {
  const outcome = await revalidateAccess({
    authorizeScope: neverAuthorize(),
    currentSession: () => Promise.resolve(session),
    scope: undefined,
  });

  assert.deepEqual(outcome, { branch: undefined, kind: "confirmed", session });
});

test("the branch is revalidated with the freshly read session, never a stale token", async () => {
  const renewed = fixtureSession({ accessToken: "token-renewed" });
  const seen: string[] = [];
  const outcome = await revalidateAccess({
    authorizeScope: (current, scope) => {
      seen.push(current.accessToken);
      assert.deepEqual(scope, scopeA);
      return Promise.resolve(branch);
    },
    currentSession: () => Promise.resolve(renewed),
    scope: scopeA,
  });

  assert.deepEqual(outcome, { branch, kind: "confirmed", session: renewed });
  assert.deepEqual(seen, ["token-renewed"]);
});

test("a rejected authorization becomes an explicit failure, never a hang", async () => {
  for (const [error, failure] of [
    [new MobileRequestError(403), "authorization"],
    [new MobileRequestError(401), "authorization"],
    [new MobileRequestError("network"), "network"],
    [new MobileRequestError("protocol"), "protocol"],
    [new Error("boom"), "unavailable"],
  ] as const) {
    const outcome = await revalidateAccess({
      authorizeScope: () => Promise.reject(error),
      currentSession: () => Promise.resolve(session),
      scope: scopeA,
    });

    assert.deepEqual(outcome, { failure, kind: "failed", session }, failure);
  }
});
