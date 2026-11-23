import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiConfigurationError,
  DEFAULT_RATE_LIMIT_POLICY,
  readApiConfig,
  readRateLimitPolicy,
} from "./config.js";

const validEnvironment = Object.freeze({
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example-key",
  SUPABASE_URL: "https://example.supabase.co",
});

test("reads only the public Supabase Auth configuration and a bounded port", () => {
  assert.deepEqual(readApiConfig({ ...validEnvironment, PORT: "4100" }), {
    port: 4100,
    supabasePublishableKey: "sb_publishable_example-key",
    supabaseUrl: "https://example.supabase.co",
  });
});

test("rejects missing, legacy or secret-key configuration", () => {
  assert.throws(() => readApiConfig({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: undefined }), ApiConfigurationError);
  assert.throws(() => readApiConfig({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.legacy" }), ApiConfigurationError);
  assert.throws(() => readApiConfig({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: "sb_secret_private" }), ApiConfigurationError);
});

test("requires an HTTPS URL without embedded credentials or fragments", () => {
  for (const invalidUrl of [
    "http://example.supabase.co",
    "https://user:password@example.supabase.co",
    "https://example.supabase.co/#token",
    "https://example.supabase.co/project-path",
    "https://example.supabase.co/?token=sensitive",
    "not-a-url",
  ]) {
    assert.throws(() => readApiConfig({ ...validEnvironment, SUPABASE_URL: invalidUrl }), ApiConfigurationError);
  }
});

test("rejects ambiguous or out-of-range ports", () => {
  for (const invalidPort of ["0", "65536", "3.5", " 3000", "3000 ", "abc"]) {
    assert.throws(() => readApiConfig({ ...validEnvironment, PORT: invalidPort }), ApiConfigurationError);
  }
});

test("rejects malformed or unbounded publishable keys", () => {
  for (const invalidKey of [
    "sb_publishable_contains whitespace",
    "sb_publishable_contains.dot",
    `sb_publishable_${"a".repeat(1_100)}`,
  ]) {
    assert.throws(() => readApiConfig({ ...validEnvironment, SUPABASE_PUBLISHABLE_KEY: invalidKey }), ApiConfigurationError);
  }
});

test("rate limit policy defaults to bounded, non-proxy-trusting login metering", () => {
  const policy = readRateLimitPolicy({});
  assert.deepEqual(policy, DEFAULT_RATE_LIMIT_POLICY);
  assert.equal(Object.isFrozen(policy), true);
});

test("rate limit policy accepts explicit bounded overrides", () => {
  assert.deepEqual(readRateLimitPolicy({
    RATE_LIMIT_LOGIN_MAX: "5",
    RATE_LIMIT_LOGIN_WINDOW_MS: "30000",
    RATE_LIMIT_MAX_KEYS: "500",
    RATE_LIMIT_TRUST_FORWARDED_FOR: "TRUE",
  }), {
    loginMax: 5,
    loginWindowMs: 30_000,
    maxTrackedKeys: 500,
    trustForwardedFor: true,
  });
});

test("rate limit policy rejects malformed or out-of-range values instead of guessing", () => {
  const invalid: NodeJS.ProcessEnv[] = [
    { RATE_LIMIT_LOGIN_MAX: "0" },
    { RATE_LIMIT_LOGIN_MAX: "10001" },
    { RATE_LIMIT_LOGIN_MAX: "3.5" },
    { RATE_LIMIT_LOGIN_WINDOW_MS: "999" },
    { RATE_LIMIT_LOGIN_WINDOW_MS: "3600001" },
    { RATE_LIMIT_MAX_KEYS: "99" },
    { RATE_LIMIT_MAX_KEYS: "1000001" },
    { RATE_LIMIT_TRUST_FORWARDED_FOR: "yes" },
  ];
  for (const environment of invalid) {
    assert.throws(() => readRateLimitPolicy(environment), ApiConfigurationError);
  }
});
