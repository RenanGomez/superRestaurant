import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTenancyFixtureRecoveryFailure,
  readTenancyFixtureRecoveryConfig,
  sanitizeTenancyFixtureRecoveryFailure,
  TenancyFixtureRecoveryError,
} from "./tenancy-fixture-recovery-config.js";

const projectRef = "abcdefghijklmnopqrst";
const runId = "11111111-1111-4111-8111-111111111111";
const arguments_ = [
  `--run-id=${runId}`,
  `--confirm=DELETE_TENANCY_E2E_FIXTURES_FOR_RUN:${runId}`,
] as const;
const validEnvironment = Object.freeze({
  DATABASE_CA_CERT_PATH: "C:/private/supabase-root.crt",
  SUPABASE_URL: `https://${projectRef}.supabase.co`,
  TENANCY_FIXTURE_RECOVERY_RUN: "REMOTE_FIXTURE_DELETE",
  TENANCY_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  TENANCY_VERIFICATION_CONFIRM_ISOLATED_TARGET: "ISOLATED_PRODUCT_SCHEMA",
  TENANCY_VERIFICATION_CONFIRM_PROJECT_REF: projectRef,
  TENANCY_VERIFICATION_SUPABASE_SECRET_KEY: "sb_secret_private-test-key",
});

test("accepts exact run-scoped deletion confirmation without application credentials", () => {
  const config = readTenancyFixtureRecoveryConfig(validEnvironment, arguments_, (path) => {
    assert.equal(path, "C:/private/supabase-root.crt");
    return "TEST CA";
  });

  assert.equal(config.runId, runId);
  assert.equal(config.expectedProjectRef, projectRef);
  assert.equal(new URL(config.adminDatabase.connectionString).username, `postgres.${projectRef}`);
  assert.equal(config.adminDatabase.caCertificate, "TEST CA");
  assert.ok(Object.isFrozen(config));
});

test("rejects weak, ambiguous or mismatched destructive configuration", () => {
  const cases: readonly [NodeJS.ProcessEnv, readonly string[]][] = [
    [{ ...validEnvironment, TENANCY_FIXTURE_RECOVERY_RUN: "1" }, arguments_],
    [validEnvironment, [`--run-id=${runId}`]],
    [validEnvironment, [arguments_[0], "--confirm=DELETE_ALL_FIXTURES"]],
    [validEnvironment, ["--run-id=not-a-uuid", arguments_[1]]],
    [{ ...validEnvironment, SUPABASE_SERVICE_ROLE_KEY: "legacy-sensitive" }, arguments_],
    [{ ...validEnvironment, TENANCY_VERIFICATION_SUPABASE_SECRET_KEY: "eyJlegacy" }, arguments_],
    [{
      ...validEnvironment,
      TENANCY_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    }, arguments_],
    [{
      ...validEnvironment,
      SUPABASE_URL: "https://cxcnnhafchqslvgvkeye.supabase.co",
      TENANCY_VERIFICATION_CONFIRM_PROJECT_REF: "cxcnnhafchqslvgvkeye",
      TENANCY_VERIFICATION_ADMIN_DATABASE_URL: "postgresql://postgres.cxcnnhafchqslvgvkeye:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full",
    }, arguments_],
  ];

  for (const [environment, argumentsForCase] of cases) {
    assert.throws(
      () => readTenancyFixtureRecoveryConfig(environment, argumentsForCase, () => "TEST CA"),
      (error: unknown) => {
        assert.ok(error instanceof TenancyFixtureRecoveryError);
        assert.equal(error.code, "TENANCY_FIXTURE_RECOVERY_CONFIGURATION_REJECTED");
        const serialized = JSON.stringify(error);
        for (const secret of ["admin-password", "legacy-sensitive", "sb_secret_private-test-key"]) {
          assert.equal(serialized.includes(secret), false);
        }
        return true;
      },
    );
  }
});

test("sanitizes arbitrary failures to an allowlisted report", () => {
  const sensitive = "postgresql://postgres:password@host/postgres?token=secret";
  assert.deepEqual(sanitizeTenancyFixtureRecoveryFailure(new Error(sensitive)), {
    code: "TENANCY_FIXTURE_RECOVERY_CONFIGURATION_REJECTED",
    stage: "configuration",
    status: "failed",
  });
  assert.equal(formatTenancyFixtureRecoveryFailure(new Error(sensitive)).includes(sensitive), false);
});
