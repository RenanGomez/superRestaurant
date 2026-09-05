import assert from "node:assert/strict";
import test from "node:test";

import { readMobileConfig } from "./config.js";

const valid = {
  EXPO_PUBLIC_API_BASE_URL: "http://127.0.0.1:4312",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
};

test("reads only public, bounded mobile configuration", () => {
  assert.deepEqual(readMobileConfig(valid), {
    apiBaseUrl: "http://127.0.0.1:4312",
    supabasePublishableKey: "sb_publishable_test",
    supabaseUrl: "https://example.supabase.co",
  });
});

test("accepts a TLS API origin", () => {
  assert.equal(
    readMobileConfig({ ...valid, EXPO_PUBLIC_API_BASE_URL: "https://api.example.com" }).apiBaseUrl,
    "https://api.example.com",
  );
});

test("rejects secret, service-role and JWT keys", () => {
  for (const key of [
    "sb_secret_abc",
    "sb_publishable_service_role_abc",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role.signature",
    "SB_SECRET_ABC",
    "sb_publishable_",
  ]) {
    assert.throws(
      () => readMobileConfig({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }),
      /MOBILE_CONFIGURATION_INVALID/u,
      key,
    );
  }
});

test("rejects missing, malformed, credentialed and plaintext remote configuration", () => {
  for (const environment of [
    {},
    { ...valid, EXPO_PUBLIC_SUPABASE_URL: undefined },
    { ...valid, EXPO_PUBLIC_API_BASE_URL: undefined },
    { ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    { ...valid, EXPO_PUBLIC_SUPABASE_URL: "http://example.supabase.co" },
    { ...valid, EXPO_PUBLIC_SUPABASE_URL: "https://user:pass@example.supabase.co" },
    { ...valid, EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co/auth" },
    { ...valid, EXPO_PUBLIC_SUPABASE_URL: " https://example.supabase.co " },
    { ...valid, EXPO_PUBLIC_API_BASE_URL: "http://api.example.com" },
    { ...valid, EXPO_PUBLIC_API_BASE_URL: "https://api.example.com/api/v1" },
    { ...valid, EXPO_PUBLIC_API_BASE_URL: "https://api.example.com/?token=x" },
    { ...valid, EXPO_PUBLIC_API_BASE_URL: "not-a-url" },
  ]) {
    assert.throws(() => readMobileConfig(environment), /MOBILE_CONFIGURATION_INVALID/u, JSON.stringify(environment));
  }
});

test("ignores variables that Expo would not expose to the client", () => {
  const config = readMobileConfig({ ...valid, SUPABASE_SECRET_KEY: "sb_secret_should_be_ignored" });
  assert.equal(config.supabasePublishableKey, "sb_publishable_test");
  assert.equal(Object.keys(config).length, 3);
});
