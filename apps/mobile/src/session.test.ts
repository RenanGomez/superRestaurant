import assert from "node:assert/strict";
import test from "node:test";

import { MOBILE_AUTH_OPTIONS, MOBILE_SIGN_OUT_SCOPE, isSameOperator, toMobileSession } from "./session.js";
import { FIXTURE_USER_A, FIXTURE_USER_B, fixtureSession } from "./test-fixtures.js";

test("keeps the session in memory: no persistence and no storage adapter", () => {
  assert.deepEqual(MOBILE_AUTH_OPTIONS, {
    auth: { autoRefreshToken: true, detectSessionInUrl: false, persistSession: false },
  });
  assert.equal(MOBILE_AUTH_OPTIONS.auth.persistSession, false);
  assert.equal(Object.keys(MOBILE_AUTH_OPTIONS.auth).length, 3);
  assert.equal("storage" in MOBILE_AUTH_OPTIONS.auth, false);
  assert.equal(Object.isFrozen(MOBILE_AUTH_OPTIONS.auth), true);
});

test("renews the in-memory token instead of letting it expire mid-shift", () => {
  // Renewal and persistence are separate decisions: the token is refreshed while
  // the app is open, and nothing is ever written to the device.
  assert.equal(MOBILE_AUTH_OPTIONS.auth.autoRefreshToken, true);
  assert.equal(MOBILE_AUTH_OPTIONS.auth.persistSession, false);
});

test("signs out only this device", () => {
  assert.equal(MOBILE_SIGN_OUT_SCOPE, "local");
});

test("narrows a Supabase session to the token, the immutable id and the email", () => {
  assert.deepEqual(
    toMobileSession({ access_token: "token-1", user: { email: "operador@example.com", id: FIXTURE_USER_A } }),
    { accessToken: "token-1", email: "operador@example.com", userId: FIXTURE_USER_A },
  );
  assert.deepEqual(
    toMobileSession({ access_token: "token-1", user: { email: null, id: FIXTURE_USER_A.toUpperCase() } }),
    { accessToken: "token-1", email: undefined, userId: FIXTURE_USER_A },
  );
});

test("refuses a session without a valid Supabase user id", () => {
  for (const user of [
    undefined,
    null,
    {},
    { id: "" },
    { id: "not-a-uuid" },
    { id: 42 },
    { id: `${FIXTURE_USER_A} ` },
    { email: "operador@example.com" },
  ]) {
    assert.equal(toMobileSession({ access_token: "token-1", user }), undefined, JSON.stringify(user ?? null));
  }
});

test("identity is the user id, never the email", () => {
  const renewed = fixtureSession({ accessToken: "token-2" });
  const renamed = fixtureSession({ accessToken: "token-3", email: "otro.correo@example.invalid" });
  const other = fixtureSession({ userId: FIXTURE_USER_B });

  assert.equal(isSameOperator(fixtureSession(), renewed), true);
  assert.equal(isSameOperator(fixtureSession(), renamed), true);
  assert.equal(isSameOperator(fixtureSession(), other), false);
  // Same email, different operator: still a different actor.
  assert.equal(isSameOperator(fixtureSession(), fixtureSession({ userId: FIXTURE_USER_B })), false);
});

test("treats an unusable session as signed out", () => {
  for (const value of [
    null,
    undefined,
    "token",
    {},
    { access_token: "" },
    { access_token: " token " },
    { access_token: 42 },
    { access_token: "x".repeat(8_193) },
    { access_token: "token-1" },
  ]) {
    assert.equal(toMobileSession(value), undefined, JSON.stringify(value ?? null));
  }
});
