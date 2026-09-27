import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_ZONES_BASE_SUMMARY,
  DELIVERY_ZONES_TARGET_SUMMARY,
  verifyDeliveryZonesSchema,
  type DeliveryZonesSchemaVerificationDependencies,
} from "./delivery-zones-schema-verification.js";
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
  migrationSql: "begin; create table app.delivery_zones(); commit;",
  targetCatalogAuditSql: "select 'target';",
});

test("audits the exact pre-migration baseline, verifies the migration, then postchecks zero residual", async () => {
  const calls: string[] = [];
  const dependencies: DeliveryZonesSchemaVerificationDependencies = {
    runReadOnlyAudit: async (options: RunReadOnlySchemaAuditOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`read:${options.catalogAuditSql}`);
      assert.deepEqual(options.expectedSummary, DELIVERY_ZONES_BASE_SUMMARY);
      return options.expectedSummary;
    },
    runRollbackVerification: async (options: RunSchemaVerificationOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`migration:${options.catalogAuditSql}`);
      assert.equal(options.migrationSql, input.migrationSql);
      assert.deepEqual(options.expectedSummary, DELIVERY_ZONES_TARGET_SUMMARY);
      assert.equal(typeof options.verifyWithinTransaction, "function");
      return options.expectedSummary as SchemaVerificationSummary;
    },
  };

  const result = await verifyDeliveryZonesSchema({ ...input, verifyWithinTransaction: async () => {} }, dependencies);
  assert.deepEqual(calls, ["read:select 'base';", "migration:select 'target';", "read:select 'base';"]);
  assert.deepEqual(result.base, DELIVERY_ZONES_BASE_SUMMARY);
  assert.deepEqual(result.migrated, DELIVERY_ZONES_TARGET_SUMMARY);
  assert.deepEqual(result.postcheck, DELIVERY_ZONES_BASE_SUMMARY);
});

test("always performs the read-only postcheck after a rollback verification failure, and rethrows it", async () => {
  const calls: string[] = [];
  const migrationFailure = new SchemaVerificationError("catalog_audit", "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED");
  await assert.rejects(
    verifyDeliveryZonesSchema(input, {
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

test("does not attempt the migration when the exact baseline audit fails", async () => {
  let migrationAttempted = false;
  const baseFailure = new SchemaVerificationError("catalog_audit", "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED");
  await assert.rejects(
    verifyDeliveryZonesSchema(input, {
      runReadOnlyAudit: async () => { throw baseFailure; },
      runRollbackVerification: async () => {
        migrationAttempted = true;
        return DELIVERY_ZONES_TARGET_SUMMARY;
      },
    }),
    baseFailure,
  );
  assert.equal(migrationAttempted, false);
});

test("rejects when the rollback verification resolves without ever assigning a result", async () => {
  await assert.rejects(
    verifyDeliveryZonesSchema(input, {
      runReadOnlyAudit: async (options) => options.expectedSummary,
      runRollbackVerification: async () => undefined as unknown as SchemaVerificationSummary,
    }),
    /DELIVERY_ZONES_SCHEMA_VERIFICATION_INCOMPLETE/u,
  );
});
