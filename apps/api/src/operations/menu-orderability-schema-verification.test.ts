import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyMenuOrderabilitySchema,
  type MenuOrderabilitySchemaVerificationDependencies,
} from "./menu-orderability-schema-verification.js";
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
  migrationSql: "begin; create trigger menu_modifier_groups_command_limit; commit;",
  targetCatalogAuditSql: "select 'target';",
});

test("audits the exact base, verifies the migration body, then postchecks the base", async () => {
  const calls: string[] = [];
  const dependencies: MenuOrderabilitySchemaVerificationDependencies = {
    runReadOnlyAudit: async (options: RunReadOnlySchemaAuditOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`read:${options.catalogAuditSql}`);
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 23, securityDefinerFunctions: 22 });
      return options.expectedSummary;
    },
    runRollbackVerification: async (options: RunSchemaVerificationOptions): Promise<SchemaVerificationSummary> => {
      calls.push(`migration:${options.catalogAuditSql}`);
      assert.equal(options.migrationSql, input.migrationSql);
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 23, securityDefinerFunctions: 22 });
      return options.expectedSummary as SchemaVerificationSummary;
    },
  };

  const result = await verifyMenuOrderabilitySchema(input, dependencies);
  assert.deepEqual(calls, ["read:select 'base';", "migration:select 'target';", "read:select 'base';"]);
  assert.deepEqual(result.base, result.migrated);
  assert.deepEqual(result.postcheck, result.base);
});

test("always performs the read-only postcheck after a rollback verification failure", async () => {
  const calls: string[] = [];
  const migrationFailure = new SchemaVerificationError("migration", "SCHEMA_VERIFICATION_MIGRATION_FAILED");
  await assert.rejects(
    verifyMenuOrderabilitySchema(input, {
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

test("does not attempt the migration when the exact base audit fails", async () => {
  let migrationAttempted = false;
  const baseFailure = new SchemaVerificationError("catalog_audit", "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED");
  await assert.rejects(
    verifyMenuOrderabilitySchema(input, {
      runReadOnlyAudit: async () => { throw baseFailure; },
      runRollbackVerification: async () => {
        migrationAttempted = true;
        return { policies: 5, securedTables: 23, securityDefinerFunctions: 22 };
      },
    }),
    baseFailure,
  );
  assert.equal(migrationAttempted, false);
});
