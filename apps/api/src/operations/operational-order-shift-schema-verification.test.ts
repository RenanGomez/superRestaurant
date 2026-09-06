import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyOperationalOrderShiftSchema,
  type OperationalOrderShiftSchemaVerificationDependencies,
} from "./operational-order-shift-schema-verification.js";
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
  operationalOrderMigrationSql: "begin; create table app.order_operational_shifts(id uuid); commit;",
  operationalShiftMigrationSql: "begin; create table app.operational_shifts(id uuid); commit;",
  targetCatalogAuditSql: "select 'target';",
});

test("audits the exact base first, verifies both migration bodies, then postchecks the base", async () => {
  const calls: string[] = [];
  const dependencies: OperationalOrderShiftSchemaVerificationDependencies = {
    runReadOnlyAudit: async (options: RunReadOnlySchemaAuditOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`read:${options.catalogAuditSql}`);
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 23, securityDefinerFunctions: 22 });
      return options.expectedSummary;
    },
    runRollbackVerification: async (options: RunSchemaVerificationOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`migration:${options.catalogAuditSql}`);
      assert.match(options.migrationSql, /^begin;\ncreate table app\.operational_shifts/u);
      assert.match(options.migrationSql, /create table app\.order_operational_shifts/u);
      assert.match(options.migrationSql, /\ncommit;$/u);
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 25, securityDefinerFunctions: 25 });
      return options.expectedSummary as SchemaVerificationSummary;
    },
  };

  const result = await verifyOperationalOrderShiftSchema(input, dependencies);
  assert.deepEqual(calls, ["read:select 'base';", "migration:select 'target';", "read:select 'base';"]);
  assert.deepEqual(result.base, { policies: 5, securedTables: 23, securityDefinerFunctions: 22 });
  assert.deepEqual(result.migrated, { policies: 5, securedTables: 25, securityDefinerFunctions: 25 });
  assert.deepEqual(result.postcheck, result.base);
});

test("always performs the read-only postcheck after a rollback verification failure", async () => {
  const calls: string[] = [];
  const migrationFailure = new SchemaVerificationError("migration", "SCHEMA_VERIFICATION_MIGRATION_FAILED");
  await assert.rejects(
    verifyOperationalOrderShiftSchema(input, {
      runReadOnlyAudit: async (options) => {
        calls.push(`read:${options.catalogAuditSql}`);
        return options.expectedSummary;
      },
      runRollbackVerification: async () => {
        calls.push("migration");
        throw migrationFailure;
      },
    }),
    migrationFailure,
  );
  assert.deepEqual(calls, ["read:select 'base';", "migration", "read:select 'base';"]);
});

test("does not attempt a migration when the exact base audit fails", async () => {
  let migrationAttempted = false;
  const baseFailure = new SchemaVerificationError("catalog_audit", "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED");
  await assert.rejects(
    verifyOperationalOrderShiftSchema(input, {
      runReadOnlyAudit: async () => { throw baseFailure; },
      runRollbackVerification: async () => {
        migrationAttempted = true;
        return { policies: 5, securedTables: 25, securityDefinerFunctions: 25 };
      },
    }),
    baseFailure,
  );
  assert.equal(migrationAttempted, false);
});

