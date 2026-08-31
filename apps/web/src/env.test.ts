import assert from "node:assert/strict";
import test from "node:test";

import { WebConfigurationError, readWebServerEnv } from "./env.js";

const validEnvironment = Object.freeze({
  API_BASE_URL: "https://api.example.com",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example-key",
  SUPABASE_URL: "https://example.supabase.co",
  WEB_ORIGIN: "https://app.example.com",
});

test("reads a fully configured, HTTPS-only environment", () => {
  assert.deepEqual(readWebServerEnv(validEnvironment), {
    apiBaseUrl: "https://api.example.com",
    cookiesSecure: true,
    supabasePublishableKey: "sb_publishable_example-key",
    supabaseUrl: "https://example.supabase.co",
    webOrigin: "https://app.example.com",
  });
});

test("allows an insecure cookie flag only for http+localhost WEB_ORIGIN", () => {
  assert.equal(
    readWebServerEnv({ ...validEnvironment, WEB_ORIGIN: "http://localhost:3000" }).cookiesSecure,
    false,
  );
  assert.equal(
    readWebServerEnv({ ...validEnvironment, WEB_ORIGIN: "http://127.0.0.1:3000" }).cookiesSecure,
    false,
  );
});

test("rejects a non-localhost http WEB_ORIGIN", () => {
  assert.throws(
    () => readWebServerEnv({ ...validEnvironment, WEB_ORIGIN: "http://app.example.com" }),
    WebConfigurationError,
  );
});

test("accepts http://localhost or http://127.0.0.1 for API_BASE_URL outside production", () => {
  for (const nodeEnv of [undefined, "development", "test"]) {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      assert.equal(
        readWebServerEnv({ ...validEnvironment, API_BASE_URL: url, NODE_ENV: nodeEnv }).apiBaseUrl,
        url,
      );
    }
  }
});

test("rejects http://localhost for API_BASE_URL when NODE_ENV is production", () => {
  assert.throws(
    () => readWebServerEnv({ ...validEnvironment, API_BASE_URL: "http://localhost:3000", NODE_ENV: "production" }),
    WebConfigurationError,
  );
});

test("rejects a non-localhost http API_BASE_URL regardless of NODE_ENV", () => {
  for (const nodeEnv of [undefined, "development", "production"]) {
    assert.throws(
      () => readWebServerEnv({ ...validEnvironment, API_BASE_URL: "http://api.example.com", NODE_ENV: nodeEnv }),
      WebConfigurationError,
    );
  }
});

test("rejects missing required variables", () => {
  for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "API_BASE_URL", "WEB_ORIGIN"] as const) {
    assert.throws(() => readWebServerEnv({ ...validEnvironment, [key]: undefined }), WebConfigurationError);
  }
});

test("rejects URLs with embedded credentials, query strings, fragments or extra paths", () => {
  for (const invalidUrl of [
    "https://user:pass@api.example.com",
    "https://api.example.com/#token",
    "https://api.example.com/v1",
    "https://api.example.com/?token=sensitive",
    "not-a-url",
  ]) {
    assert.throws(() => readWebServerEnv({ ...validEnvironment, API_BASE_URL: invalidUrl }), WebConfigurationError);
    assert.throws(() => readWebServerEnv({ ...validEnvironment, SUPABASE_URL: invalidUrl }), WebConfigurationError);
  }
});

test("rejects a plain http SUPABASE_URL even for localhost: Supabase is always remote", () => {
  assert.throws(
    () => readWebServerEnv({ ...validEnvironment, SUPABASE_URL: "http://localhost:54321" }),
    WebConfigurationError,
  );
});

test("rejects a legacy or secret Supabase key", () => {
  assert.throws(
    () => readWebServerEnv({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.legacy" }),
    WebConfigurationError,
  );
  assert.throws(
    () => readWebServerEnv({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: "sb_secret_private" }),
    WebConfigurationError,
  );
});

test("re-validates the given environment on every call: nothing is cached across calls", () => {
  const first = readWebServerEnv(validEnvironment);
  const second = readWebServerEnv({ ...validEnvironment, API_BASE_URL: "https://api2.example.com" });
  assert.equal(first.apiBaseUrl, "https://api.example.com");
  assert.equal(second.apiBaseUrl, "https://api2.example.com");
});
