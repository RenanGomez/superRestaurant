import assert from "node:assert/strict";
import test from "node:test";

import {
  AppApiProvisioningError,
  formatAppApiProvisioningFailure,
  readAppApiProvisioningConfig,
} from "./app-api-provisioning-config.js";

const projectRef = "abcdefghijklmnopqrst";
const password = "A-strong-private-password-1234567890!";
const confirmation = [`--confirm=PROVISION_APP_API_LOGIN_FOR:${projectRef}`] as const;
const validEnvironment = Object.freeze({
  APP_API_PROVISIONING_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  APP_API_PROVISIONING_CONFIRM_PROJECT_REF: projectRef,
  APP_API_PROVISIONING_PASSWORD: password,
  APP_API_PROVISIONING_RUN: "REMOTE_ROLE_LOGIN_CHANGE",
  DATABASE_CA_CERT_PATH: "C:/private/supabase-root.crt",
  SUPABASE_URL: `https://${projectRef}.supabase.co`,
});

test("derives a private app_api URL from an exact administrative target", () => {
  const config = readAppApiProvisioningConfig(validEnvironment, confirmation, () => "TEST CA");
  const appUrl = new URL(config.appDatabase.connectionString);
  assert.equal(decodeURIComponent(appUrl.username), `app_api.${projectRef}`);
  assert.equal(decodeURIComponent(appUrl.password), password);
  assert.equal(appUrl.search, "");
  assert.equal(new URL(config.adminDatabase.connectionString).search, "");
  assert.equal(config.adminDatabase.caCertificate, "TEST CA");
  assert.ok(Object.isFrozen(config));
});

test("supports the correlated direct database endpoint", () => {
  const config = readAppApiProvisioningConfig({
    ...validEnvironment,
    APP_API_PROVISIONING_ADMIN_DATABASE_URL: `postgresql://postgres:admin-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  }, confirmation, () => "TEST CA");
  assert.equal(decodeURIComponent(new URL(config.appDatabase.connectionString).username), "app_api");
});

test("rejects missing opt-ins, weak passwords, weak TLS and mismatched or forbidden targets", () => {
  const cases: readonly [NodeJS.ProcessEnv, readonly string[]][] = [
    [{ ...validEnvironment, APP_API_PROVISIONING_RUN: "1" }, confirmation],
    [validEnvironment, []],
    [validEnvironment, [`--confirm=PROVISION_APP_API_LOGIN_FOR:otherprojectref00000`]],
    [{ ...validEnvironment, APP_API_PROVISIONING_PASSWORD: "short" }, confirmation],
    [{ ...validEnvironment, APP_API_PROVISIONING_PASSWORD: "a".repeat(64) }, confirmation],
    [{
      ...validEnvironment,
      APP_API_PROVISIONING_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    }, confirmation],
    [{
      ...validEnvironment,
      APP_API_PROVISIONING_ADMIN_DATABASE_URL: `postgresql://postgres.${projectRef}:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    }, confirmation],
    [{ ...validEnvironment, SUPABASE_URL: "https://otherprojectref00000.supabase.co" }, confirmation],
    [{
      ...validEnvironment,
      APP_API_PROVISIONING_ADMIN_DATABASE_URL: "postgresql://postgres.cxcnnhafchqslvgvkeye:admin-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full",
      APP_API_PROVISIONING_CONFIRM_PROJECT_REF: "cxcnnhafchqslvgvkeye",
      SUPABASE_URL: "https://cxcnnhafchqslvgvkeye.supabase.co",
    }, ["--confirm=PROVISION_APP_API_LOGIN_FOR:cxcnnhafchqslvgvkeye"]],
  ];

  for (const [environment, arguments_] of cases) {
    assert.throws(() => readAppApiProvisioningConfig(environment, arguments_, () => "TEST CA"), (error: unknown) => {
      assert.ok(error instanceof AppApiProvisioningError);
      assert.equal(error.code, "APP_API_PROVISIONING_CONFIGURATION_REJECTED");
      const serialized = JSON.stringify(error);
      for (const secret of [password, "admin-password"]) assert.equal(serialized.includes(secret), false);
      return true;
    });
  }
});

test("sanitizes arbitrary provider failures without leaking credentials", () => {
  const output = formatAppApiProvisioningFailure(new Error(`${password}:admin-password`));
  assert.deepEqual(JSON.parse(output), {
    code: "APP_API_PROVISIONING_CONFIGURATION_REJECTED",
    stage: "configuration",
    status: "failed",
  });
  assert.equal(output.includes(password), false);
  assert.equal(output.includes("admin-password"), false);
});
