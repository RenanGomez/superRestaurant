import assert from "node:assert/strict";
import test from "node:test";

import { classifyLoginError } from "./login-error.js";

test("login distinguishes retryable Auth transport failures from rejected credentials", () => {
  assert.equal(classifyLoginError({ name: "AuthRetryableFetchError", status: 0 }), "service_unavailable");
  assert.equal(classifyLoginError({ name: "AuthApiError", status: 400 }), "invalid_credentials");
});

test("login error classification fails closed for hostile values", () => {
  const hostile = new Proxy({}, { get() { throw new Error("hostile"); } });
  assert.equal(classifyLoginError(hostile), "service_unavailable");
  assert.equal(classifyLoginError(undefined), "invalid_credentials");
});
