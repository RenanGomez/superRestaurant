import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  readSupabaseDirectReadConfig,
  requiredSupabaseDirectReadEnvironmentNames,
  requireSupabaseDirectReadOptIn,
  SupabaseDirectReadConfigurationError,
} from "./config.js";
import { SupabaseDirectReadClient } from "./read-client.js";

const optionRoot = path.resolve(process.cwd(), "options", "c-supabase-direct");
const readOnlyHardeningMigrationPath = path.resolve(
  process.cwd(),
  "options",
  "b-supabase-nest",
  "supabase",
  "migrations",
  "20260826000100_adr010_c_read_only_hardening.sql",
);
const bootstrapRlsHardeningMigrationPath = path.resolve(
  process.cwd(),
  "options",
  "b-supabase-nest",
  "supabase",
  "migrations",
  "20260827000100_adr010_b_bootstrap_rls_hardening.sql",
);

test("[preflight/non-evidence] option C requires only URL and publishable key", () => {
  assert.deepEqual(requiredSupabaseDirectReadEnvironmentNames, [
    "ADR010_SUPABASE_URL",
    "ADR010_SUPABASE_PUBLISHABLE_KEY",
  ]);
  assert.deepEqual(readSupabaseDirectReadConfig({
    ADR010_SUPABASE_URL: "https://example.supabase.co",
    ADR010_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
  }), {
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_placeholder",
  });
});

test("[preflight/non-evidence] option C rejects secret and legacy keys disguised as publishable config", () => {
  for (const forbiddenKey of ["sb_secret_must_not_ship", "legacy-jwt-shaped-key"]) {
    assert.throws(() => readSupabaseDirectReadConfig({
      ADR010_SUPABASE_URL: "https://example.supabase.co",
      ADR010_SUPABASE_PUBLISHABLE_KEY: forbiddenKey,
    }), SupabaseDirectReadConfigurationError);
  }
});

test("[preflight/non-evidence] unrelated privileged variables are neither accepted nor requested", () => {
  const withPrivilegedNoise = readSupabaseDirectReadConfig({
    ADR010_SUPABASE_URL: "https://example.supabase.co",
    ADR010_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
    ADR010_SUPABASE_SECRET_KEY: "must-be-ignored",
    ADR010_DATABASE_URL: "must-be-ignored",
  });
  assert.deepEqual(Object.keys(withPrivilegedNoise).sort(), ["publishableKey", "url"]);
});

test("[preflight/non-evidence] remote reads require explicit opt-in", () => {
  assert.throws(() => requireSupabaseDirectReadOptIn({
    ADR010_SUPABASE_URL: "https://example.supabase.co",
    ADR010_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
  }), SupabaseDirectReadConfigurationError);
});

test("[preflight/non-evidence] read client has no critical or generic mutation methods", () => {
  for (const forbiddenMethod of [
    "createOrder",
    "createPayment",
    "applyPayment",
    "recordCashMovement",
    "insert",
    "update",
    "delete",
    "upsert",
    "migrateFromEmpty",
    "backup",
    "restore",
  ]) {
    assert.equal(forbiddenMethod in SupabaseDirectReadClient.prototype, false, forbiddenMethod);
  }
  assert.equal(typeof SupabaseDirectReadClient.prototype.readOrders, "function");
  assert.equal(typeof SupabaseDirectReadClient.prototype.readKdsEvents, "function");
  const instance = new SupabaseDirectReadClient({
    url: "https://example.supabase.co",
    publishableKey: "sb_publishable_placeholder",
  });
  assert.equal("client" in instance, false, "the underlying mutation-capable SDK client must be runtime-private");
  assert.deepEqual(Object.keys(instance), []);
});

test("[preflight/non-evidence] source uses public configuration and SQL revokes generic writes", async () => {
  const [configSource, clientSource, runnerSource, sql, bootstrapHardening] = await Promise.all([
    readFile(path.join(optionRoot, "src", "config.ts"), "utf8"),
    readFile(path.join(optionRoot, "src", "read-client.ts"), "utf8"),
    readFile(path.join(optionRoot, "src", "run-read-probe.ts"), "utf8"),
    readFile(readOnlyHardeningMigrationPath, "utf8"),
    readFile(bootstrapRlsHardeningMigrationPath, "utf8"),
  ]);
  assert.ok(clientSource.includes("createClient(config.url, config.publishableKey"));
  assert.ok(clientSource.includes("#client"));
  assert.equal(/config\.(secretKey|serviceRoleKey|databaseUrl)/u.test(clientSource), false);
  for (const runtimeSource of [configSource, clientSource, runnerSource]) {
    assert.equal(/ADR010_(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL)/u.test(runtimeSource), false);
  }
  assert.ok(runnerSource.includes("requireSupabaseDirectReadOptIn"));
  assert.equal(runnerSource.includes("runCommonGates"), false);
  assert.equal(runnerSource.includes("score"), false);
  assert.ok(sql.includes("revoke all privileges on all tables in schema adr010_b from anon, authenticated, service_role"));
  assert.ok(sql.includes("revoke all privileges on function adr010_b_private.adr010_b_create_order(jsonb)"));
  assert.equal(sql.includes("adr010_b.adr010_b_create_order"), false);
  assert.ok(sql.includes("grant select on table"));
  assert.equal(sql.includes("grant select on all tables"), false);
  assert.equal(/grant\s+(insert|update|delete|truncate)/iu.test(sql), false);
  assert.ok(bootstrapHardening.includes("alter table adr010_b.bootstrap_users enable row level security"));
  assert.ok(bootstrapHardening.includes("alter table adr010_b.bootstrap_users force row level security"));
  assert.ok(bootstrapHardening.includes("revoke all privileges on table adr010_b.bootstrap_users"));
  assert.equal(/create\s+policy/iu.test(bootstrapHardening), false);
  assert.equal(/grant\s+/iu.test(bootstrapHardening), false);
});
