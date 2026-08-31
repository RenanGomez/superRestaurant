import assert from "node:assert/strict";
import test from "node:test";

import {
  AppApiStateVerificationError,
  formatAppApiStateVerificationFailure,
  readAppApiStateVerificationConfig,
} from "./app-api-state-verification-config.js";

const projectRef = "abcdefghijklmnopqrst";
const validEnvironment = Object.freeze({
  APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  APP_API_STATE_VERIFICATION_PROJECT_REF: projectRef,
  DATABASE_CA_CERT_PATH: "C:/private/supabase-root.crt",
  SUPABASE_URL: `https://${projectRef}.supabase.co`,
});

test("accepts correlated pooler and direct read-only administrative targets", () => {
  const pooler = readAppApiStateVerificationConfig({
    ...validEnvironment,
    APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}&sslrootcert=C%3A%2Fprivate%2Fsupabase-root.crt`,
  }, [], () => "TEST CA");
  assert.equal(pooler.expectedProjectRef, projectRef);
  assert.equal(pooler.adminDatabase.caCertificate, "TEST CA");
  assert.equal(new URL(pooler.adminDatabase.connectionString).search, "");
  const direct = readAppApiStateVerificationConfig({
    ...validEnvironment,
    APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres:admin-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  }, [], () => "TEST CA");
  assert.equal(decodeURIComponent(new URL(direct.adminDatabase.connectionString).username), "postgres");
});

test("rejects arguments, quoted URLs, weak TLS and mismatched or forbidden refs", () => {
  const cases: readonly [NodeJS.ProcessEnv, readonly string[]][] = [
    [validEnvironment, ["unexpected"]],
    [{ ...validEnvironment, APP_API_STATE_VERIFICATION_PROJECT_REF: "otherprojectref00000" }, []],
    [{ ...validEnvironment, SUPABASE_URL: "https://otherprojectref00000.supabase.co" }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `"${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}"`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}&sslrootcert=`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}&sslrootcert=one&sslrootcert=two`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}&sslmode=verify-full`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}&sslrootcert=unsafe%00path`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}&sslrootcert=${"a".repeat(1_025)}`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: `${validEnvironment.APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL}&application_name=unexpected`,
    }, []],
    [{
      ...validEnvironment,
      APP_API_STATE_VERIFICATION_ADMIN_DATABASE_URL: "postgresql://postgres.cxcnnhafchqslvgvkeye:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full",
      APP_API_STATE_VERIFICATION_PROJECT_REF: "cxcnnhafchqslvgvkeye",
      SUPABASE_URL: "https://cxcnnhafchqslvgvkeye.supabase.co",
    }, []],
  ];
  for (const [environment, arguments_] of cases) {
    assert.throws(
      () => readAppApiStateVerificationConfig(environment, arguments_, () => "TEST CA"),
      (error: unknown) => {
        assert.ok(error instanceof AppApiStateVerificationError);
        assert.equal(error.code, "APP_API_STATE_CONFIGURATION_REJECTED");
        assert.equal(JSON.stringify(error).includes("admin-password"), false);
        return true;
      },
    );
  }
});

test("sanitizes arbitrary failures", () => {
  const output = formatAppApiStateVerificationFailure(new Error("admin-password:sensitive"));
  assert.deepEqual(JSON.parse(output), {
    code: "APP_API_STATE_CONFIGURATION_REJECTED",
    stage: "configuration",
    status: "failed",
  });
  assert.equal(output.includes("admin-password"), false);
  assert.equal(output.includes("sensitive"), false);
});
