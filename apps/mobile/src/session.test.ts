import assert from "node:assert/strict";
import test from "node:test";

import { MOBILE_AUTH_OPTIONS, MOBILE_SIGN_OUT_SCOPE, toMobileSession } from "./session.js";

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

test("narrows a Supabase session to the token and the operator email", () => {
  assert.deepEqual(toMobileSession({ access_token: "token-1", user: { email: "operador@example.com" } }), {
    accessToken: "token-1",
    email: "operador@example.com",
  });
  assert.deepEqual(toMobileSession({ access_token: "token-1", user: { email: null } }), {
    accessToken: "token-1",
    email: undefined,
  });
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
  ]) {
    assert.equal(toMobileSession(value), undefined, JSON.stringify(value ?? null));
  }
});
