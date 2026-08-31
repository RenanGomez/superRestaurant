import assert from "node:assert/strict";
import test from "node:test";

import {
  AppApiRecoveryError,
  formatAppApiRecoveryFailure,
  readAppApiRecoveryConfig,
} from "./app-api-recovery-config.js";

const projectRef = "abcdefghijklmnopqrst";
const confirmation = [
  `--confirm=DISABLE_APP_API_LOGIN_AFTER_AMBIGUOUS_PROVISIONING_FOR:${projectRef}`,
] as const;
const validEnvironment = Object.freeze({
  APP_API_RECOVERY_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  APP_API_RECOVERY_CONFIRM_PROJECT_REF: projectRef,
  APP_API_RECOVERY_RUN: "REMOTE_ROLE_DISABLE",
  DATABASE_CA_CERT_PATH: "C:/private/supabase-root.crt",
  SUPABASE_URL: `https://${projectRef}.supabase.co`,
});

test("accepts only an exact administrative target and destructive confirmation", () => {
  const config = readAppApiRecoveryConfig(validEnvironment, confirmation, () => "TEST CA");
  assert.equal(config.expectedProjectRef, projectRef);
  assert.equal(config.adminDatabase.caCertificate, "TEST CA");
  assert.equal(new URL(config.adminDatabase.connectionString).search, "");
  assert.ok(Object.isFrozen(config));
});

test("accepts the correlated direct administrative endpoint", () => {
  const config = readAppApiRecoveryConfig({
    ...validEnvironment,
    APP_API_RECOVERY_ADMIN_DATABASE_URL: `postgresql://postgres:admin-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  }, confirmation, () => "TEST CA");
  assert.equal(decodeURIComponent(new URL(config.adminDatabase.connectionString).username), "postgres");
});

test("rejects weak, ambiguous, quoted or forbidden recovery configuration", () => {
  const cases: readonly [NodeJS.ProcessEnv, readonly string[]][] = [
    [{ ...validEnvironment, APP_API_RECOVERY_RUN: "1" }, confirmation],
    [validEnvironment, []],
    [validEnvironment, [...confirmation, "extra"]],
    [validEnvironment, [`--confirm=DISABLE_APP_API_LOGIN_FOR:otherprojectref00000`]],
    [{ ...validEnvironment, SUPABASE_URL: "https://otherprojectref00000.supabase.co" }, confirmation],
    [{
      ...validEnvironment,
      APP_API_RECOVERY_ADMIN_DATABASE_URL: `"${validEnvironment.APP_API_RECOVERY_ADMIN_DATABASE_URL}"`,
    }, confirmation],
    [{
      ...validEnvironment,
      APP_API_RECOVERY_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    }, confirmation],
    [{
      ...validEnvironment,
      APP_API_RECOVERY_ADMIN_DATABASE_URL: "postgresql://postgres.cxcnnhafchqslvgvkeye:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full",
      APP_API_RECOVERY_CONFIRM_PROJECT_REF: "cxcnnhafchqslvgvkeye",
      SUPABASE_URL: "https://cxcnnhafchqslvgvkeye.supabase.co",
    }, ["--confirm=DISABLE_APP_API_LOGIN_AFTER_AMBIGUOUS_PROVISIONING_FOR:cxcnnhafchqslvgvkeye"]],
  ];

  for (const [environment, arguments_] of cases) {
    assert.throws(() => readAppApiRecoveryConfig(environment, arguments_, () => "TEST CA"), (error: unknown) => {
      assert.ok(error instanceof AppApiRecoveryError);
      assert.equal(error.code, "APP_API_RECOVERY_CONFIGURATION_REJECTED");
      assert.equal(JSON.stringify(error).includes("admin-password"), false);
      return true;
    });
  }
});

test("sanitizes arbitrary failures without leaking credentials", () => {
  const output = formatAppApiRecoveryFailure(new Error("admin-password:sensitive-provider-detail"));
  assert.deepEqual(JSON.parse(output), {
    code: "APP_API_RECOVERY_CONFIGURATION_REJECTED",
    stage: "configuration",
    status: "failed",
  });
  assert.equal(output.includes("admin-password"), false);
  assert.equal(output.includes("sensitive-provider-detail"), false);
});
