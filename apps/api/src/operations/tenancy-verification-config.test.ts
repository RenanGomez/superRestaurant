import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
  sanitizeTenancyVerificationFailure,
  TenancyVerificationError,
} from "./tenancy-verification-config.js";

const projectRef = "abcdefghijklmnopqrst";
const validEnvironment = Object.freeze({
  DATABASE_CA_CERT_PATH: "C:/private/supabase-root.crt",
  DATABASE_URL: `postgresql://app_api.${projectRef}:app-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public-test-key",
  SUPABASE_URL: `https://${projectRef}.supabase.co`,
  TENANCY_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  TENANCY_VERIFICATION_CONFIRM_ISOLATED_TARGET: "ISOLATED_PRODUCT_SCHEMA",
  TENANCY_VERIFICATION_CONFIRM_PROJECT_REF: projectRef,
  TENANCY_VERIFICATION_RUN: "REMOTE_FIXTURE_WRITE",
  TENANCY_VERIFICATION_SUPABASE_SECRET_KEY: "sb_secret_private-test-key",
});

test("accepts only a fully correlated hosted project with exact destructive opt-ins", () => {
  const config = readTenancyVerificationConfig(validEnvironment, (path) => {
    assert.equal(path, "C:/private/supabase-root.crt");
    return "TEST CA";
  });

  assert.equal(config.expectedProjectRef, projectRef);
  assert.equal(config.supabaseUrl, `https://${projectRef}.supabase.co`);
  assert.equal(new URL(config.appDatabase.connectionString).username, `app_api.${projectRef}`);
  assert.equal(new URL(config.adminDatabase.connectionString).username, `postgres.${projectRef}`);
  assert.equal(new URL(config.appDatabase.connectionString).search, "");
  assert.equal(new URL(config.adminDatabase.connectionString).search, "");
  assert.equal(config.adminDatabase.caCertificate, "TEST CA");
  assert.ok(Object.isFrozen(config));
});

test("accepts correlated direct database endpoints", () => {
  const config = readTenancyVerificationConfig({
    ...validEnvironment,
    DATABASE_URL: `postgresql://app_api:app-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
    TENANCY_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres:admin-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  }, () => "TEST CA");
  assert.equal(new URL(config.appDatabase.connectionString).hostname, `db.${projectRef}.supabase.co`);
  assert.equal(new URL(config.adminDatabase.connectionString).hostname, `db.${projectRef}.supabase.co`);
});

test("rejects missing opt-ins, legacy keys, mismatched targets and weak TLS without leaking configuration", () => {
  const cases: readonly NodeJS.ProcessEnv[] = [
    { ...validEnvironment, TENANCY_VERIFICATION_RUN: "1" },
    { ...validEnvironment, TENANCY_VERIFICATION_CONFIRM_ISOLATED_TARGET: "production" },
    { ...validEnvironment, TENANCY_VERIFICATION_CONFIRM_PROJECT_REF: "otherprojectref00000" },
    { ...validEnvironment, SUPABASE_SERVICE_ROLE_KEY: "legacy-sensitive" },
    { ...validEnvironment, TENANCY_VERIFICATION_SUPABASE_SECRET_KEY: "eyJlegacy" },
    { ...validEnvironment, TENANCY_VERIFICATION_SUPABASE_SECRET_KEY: "sb_secret_" },
    {
      ...validEnvironment,
      TENANCY_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.otherprojectref00000:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    },
    {
      ...validEnvironment,
      TENANCY_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    },
    {
      ...validEnvironment,
      DATABASE_URL: `postgresql://app_api.${projectRef}:app-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    },
    {
      ...validEnvironment,
      SUPABASE_URL: "https://example.invalid",
    },
    {
      ...validEnvironment,
      SUPABASE_URL: "https://cxcnnhafchqslvgvkeye.supabase.co",
      TENANCY_VERIFICATION_CONFIRM_PROJECT_REF: "cxcnnhafchqslvgvkeye",
      DATABASE_URL: "postgresql://app_api.cxcnnhafchqslvgvkeye:app-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full",
      TENANCY_VERIFICATION_ADMIN_DATABASE_URL: "postgresql://postgres.cxcnnhafchqslvgvkeye:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full",
    },
  ];

  for (const environment of cases) {
    assert.throws(() => readTenancyVerificationConfig(environment, () => "TEST CA"), (error: unknown) => {
      assert.ok(error instanceof TenancyVerificationError);
      assert.equal(error.message, "TENANCY_VERIFICATION_CONFIGURATION_REJECTED");
      const serialized = JSON.stringify(error);
      for (const secret of ["admin-password", "app-password", "legacy-sensitive", "sb_secret_private-test-key"]) {
        assert.equal(serialized.includes(secret), false);
      }
      return true;
    });
  }
});

test("sanitizes arbitrary provider and database failures to an allowlisted report", () => {
  const sensitive = "postgresql://postgres:password@host/postgres?token=secret";
  const report = sanitizeTenancyVerificationFailure(new Error(sensitive), "cleanup");
  assert.deepEqual(report, {
    code: "TENANCY_VERIFICATION_CLEANUP_FAILED",
    stage: "cleanup",
    status: "failed",
  });
  assert.equal(formatTenancyVerificationFailure(new Error(sensitive), "cleanup").includes(sensitive), false);

  const known = new TenancyVerificationError("http", "TENANCY_VERIFICATION_ASSERTION_FAILED");
  assert.deepEqual(sanitizeTenancyVerificationFailure(known), {
    code: "TENANCY_VERIFICATION_ASSERTION_FAILED",
    stage: "http",
    status: "failed",
  });

  assert.deepEqual(sanitizeTenancyVerificationFailure(
    new TenancyVerificationError("dining_zones", "TENANCY_VERIFICATION_DINING_ZONES_FAILED"),
  ), {
    code: "TENANCY_VERIFICATION_DINING_ZONES_FAILED",
    stage: "dining_zones",
    status: "failed",
  });
});
