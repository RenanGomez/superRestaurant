import assert from "node:assert/strict";
import test from "node:test";

import { readKdsConfig } from "./config.js";

const valid = {
  VITE_API_BASE_URL: "http://127.0.0.1:3001",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  VITE_SUPABASE_URL: "https://example.supabase.co",
};

test("reads only public, bounded KDS configuration", () => {
  assert.deepEqual(readKdsConfig(valid), {
    apiBaseUrl: "http://127.0.0.1:3001",
    supabasePublishableKey: "sb_publishable_test",
    supabaseUrl: "https://example.supabase.co",
  });
});

test("rejects secret keys, credentials, paths, and remote plaintext API URLs", () => {
  for (const environment of [
    { ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_no" },
    { ...valid, VITE_SUPABASE_URL: "https://user:pass@example.supabase.co" },
    { ...valid, VITE_API_BASE_URL: "http://api.example.com" },
    { ...valid, VITE_API_BASE_URL: "https://api.example.com/v1" },
  ]) assert.throws(() => readKdsConfig(environment), /KDS_CONFIGURATION_INVALID/u);
});
