import assert from "node:assert/strict";
import test from "node:test";
import { verifyCaptureSchema } from "./capture-schema-verification.js";

test("capture verification uses the caller's audited baseline and postchecks even after undefined failure", async () => {
  const calls: string[] = [];
  const baseSummary = { policies: 5, securedTables: 26, securityDefinerFunctions: 33 };
  const captureInput = { ...input, baseSummary };
  const result = await verifyCaptureSchema(captureInput, {
    runReadOnlyAudit: async (options) => { calls.push("read"); assert.deepEqual(options.expectedSummary, baseSummary); return baseSummary; },
    runRollbackVerification: async (options) => { calls.push("rollback"); assert.deepEqual(options.expectedSummary, { ...baseSummary, securedTables: 27 }); return options.expectedSummary!; },
  });
  assert.deepEqual(calls, ["read", "rollback", "read"]);
  assert.deepEqual(result.postcheck, result.base);
  calls.length = 0;
  let failed = false;
  try {
    await verifyCaptureSchema(captureInput, {
      runReadOnlyAudit: async () => { calls.push("read"); return baseSummary; },
      runRollbackVerification: async () => { calls.push("rollback"); throw undefined; },
    });
  } catch { failed = true; }
  assert.equal(failed, true);
  assert.deepEqual(calls, ["read", "rollback", "read"]);
});

import {
  verifyRestaurantTimeZoneSchema,
  type RestaurantTimeZoneSchemaVerificationDependencies,
} from "./restaurant-time-zone-schema-verification.js";
import {
  SchemaVerificationError,
  type RunReadOnlySchemaAuditOptions,
  type RunSchemaVerificationOptions,
  type SchemaVerificationConfig,
  type SchemaVerificationSummary,
} from "./schema-verification.js";

const config: SchemaVerificationConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://redacted.invalid/postgres",
  expectedProjectRef: "abcdefghijklmnopqrst",
});

const input = Object.freeze({
  baseCatalogAuditSql: "select 'base';",
  config,
  migrationSql: "begin; alter table app.restaurants add column time_zone text; commit;",
  targetCatalogAuditSql: "select 'target';",
});

test("audits the exact base first, verifies the migration rollback-only, then postchecks the base", async () => {
  const calls: string[] = [];
  const dependencies: RestaurantTimeZoneSchemaVerificationDependencies = {
    runReadOnlyAudit: async (options: RunReadOnlySchemaAuditOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`read:${options.catalogAuditSql}`);
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 23, securityDefinerFunctions: 22 });
      return options.expectedSummary;
    },
    runRollbackVerification: async (options: RunSchemaVerificationOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`migration:${options.catalogAuditSql}`);
      assert.equal(options.migrationSql, input.migrationSql);
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 23, securityDefinerFunctions: 25 });
      return options.expectedSummary as SchemaVerificationSummary;
    },
  };

  const result = await verifyRestaurantTimeZoneSchema(input, dependencies);
  assert.deepEqual(calls, ["read:select 'base';", "migration:select 'target';", "read:select 'base';"]);
  assert.deepEqual(result.base, { policies: 5, securedTables: 23, securityDefinerFunctions: 22 });
  assert.deepEqual(result.migrated, { policies: 5, securedTables: 23, securityDefinerFunctions: 25 });
  assert.deepEqual(result.postcheck, result.base);
});

test("always performs the read-only postcheck after migration failure", async () => {
  const calls: string[] = [];
  const failure = new SchemaVerificationError("migration", "SCHEMA_VERIFICATION_MIGRATION_FAILED");
  await assert.rejects(verifyRestaurantTimeZoneSchema(input, {
    runReadOnlyAudit: async (options) => {
      calls.push(`read:${options.catalogAuditSql}`);
      return options.expectedSummary;
    },
    runRollbackVerification: async () => {
      calls.push("migration");
      throw failure;
    },
  }), failure);
  assert.deepEqual(calls, ["read:select 'base';", "migration", "read:select 'base';"]);
});

test("does not attempt the migration when the exact base audit fails", async () => {
  let migrationAttempted = false;
  const failure = new SchemaVerificationError("catalog_audit", "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED");
  await assert.rejects(verifyRestaurantTimeZoneSchema(input, {
    runReadOnlyAudit: async () => { throw failure; },
    runRollbackVerification: async () => {
      migrationAttempted = true;
      return { policies: 5, securedTables: 23, securityDefinerFunctions: 25 };
    },
  }), failure);
  assert.equal(migrationAttempted, false);
});
