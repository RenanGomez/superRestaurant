import assert from "node:assert/strict";
import test from "node:test";

import { ApiConfigurationError, readApiConfig } from "./config.js";

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
