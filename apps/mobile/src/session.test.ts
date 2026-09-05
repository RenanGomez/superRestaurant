import assert from "node:assert/strict";
import test from "node:test";

import { MOBILE_AUTH_OPTIONS, MOBILE_SIGN_OUT_SCOPE, toMobileSession } from "./session.js";

test("keeps the session in memory: no persistence, no refresh, no storage adapter", () => {
  assert.deepEqual(MOBILE_AUTH_OPTIONS, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  assert.equal(Object.keys(MOBILE_AUTH_OPTIONS.auth).length, 3);
  assert.equal("storage" in MOBILE_AUTH_OPTIONS.auth, false);
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
