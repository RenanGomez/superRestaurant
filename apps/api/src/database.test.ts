import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseConfigurationError, readDatabaseConfig } from "./database.js";

const projectRef = "abcdefghijklmnopqrst";
const validEnvironment = Object.freeze({
  DATABASE_CA_CERT_PATH: "C:/private/prod-ca.crt",
  DATABASE_URL: `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  SUPABASE_URL: `https://${projectRef}.supabase.co`,
});

test("requires a dedicated app_api Supabase connection and strips the driver ssl query", () => {
  const config = readDatabaseConfig(validEnvironment, (path) => {
    assert.equal(path, "C:/private/prod-ca.crt");
    return "TEST CA";
  });

  assert.equal(config.connectionString, `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres`);
  assert.equal(config.caCertificate, "TEST CA");
  assert.ok(Object.isFrozen(config));
});

test("accepts only direct or pooler hosts bound to the configured project ref", () => {
  const direct = readDatabaseConfig({
    ...validEnvironment,
    DATABASE_URL: `postgresql://app_api:private-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
  }, () => "TEST CA");
  assert.equal(new URL(direct.connectionString).hostname, `db.${projectRef}.supabase.co`);

  for (const databaseUrl of [
    `postgresql://postgres.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    `postgresql://app_api.otherprojectref00000:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    `postgresql://app_api.${projectRef}:private-password@pooler.supabase.com.evil.test:5432/postgres?sslmode=verify-full`,
    `postgresql://app_api:private-password@db.otherprojectref00000.supabase.co:5432/postgres?sslmode=verify-full`,
  ]) {
    assert.throws(() => readDatabaseConfig({ ...validEnvironment, DATABASE_URL: databaseUrl }, () => "TEST CA"), DatabaseConfigurationError);
  }
});

test("rejects weaker TLS, unexpected URL capabilities and missing private credentials", () => {
  for (const databaseUrl of [
    `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require`,
    `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres`,
    `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full&application_name=attacker`,
    `postgresql://app_api.${projectRef}@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/other?sslmode=verify-full`,
    `postgresql://app_api.${projectRef}:private-password@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=verify-full#fragment`,
  ]) {
    assert.throws(() => readDatabaseConfig({ ...validEnvironment, DATABASE_URL: databaseUrl }, () => "TEST CA"), DatabaseConfigurationError);
  }
});

test("fails closed when the CA cannot be loaded or validated", () => {
  assert.throws(() => readDatabaseConfig(validEnvironment, () => { throw new Error("private path"); }), (error: unknown) => {
    assert.ok(error instanceof DatabaseConfigurationError);
    assert.equal(error.message, "DATABASE_CONFIGURATION_REJECTED");
    assert.equal(error.message.includes("private"), false);
    return true;
  });
  assert.throws(() => readDatabaseConfig(validEnvironment, () => ""), DatabaseConfigurationError);
});
