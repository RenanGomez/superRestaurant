import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyP2MobileSchema,
  type P2MobileSchemaVerificationDependencies,
} from "./p2-mobile-schema-verification.js";
import {
  SchemaVerificationError,
  type SchemaVerificationConfig,
  type SchemaVerificationSummary,
} from "./schema-verification.js";

const config: SchemaVerificationConfig = Object.freeze({
  caCertificate: "TEST CA",
  connectionString: "postgresql://redacted.invalid/postgres",
  expectedProjectRef: "abcdefghijklmnopqrst",
});
const migrationSqls = Object.freeze([
  "begin; select 'shift'; commit;",
  "begin; select 'order-link'; commit;",
  "begin; select 'cancellation'; commit;",
  "begin; select 'orderability'; commit;",
  "begin; select 'time-zone'; commit;",
] as const);
const input = Object.freeze({
  baseCatalogAuditSql: "select 'base';",
  config,
  migrationSqls,
  targetCatalogAuditSql: "select 'target';",
});

test("verifies all five P2 migrations in order and postchecks the unchanged base", async () => {
  const calls: string[] = [];
  const dependencies: P2MobileSchemaVerificationDependencies = {
    runReadOnlyAudit: async (options): Promise<SchemaVerificationSummary> => {
      calls.push(`read:${options.catalogAuditSql}`);
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 23, securityDefinerFunctions: 22 });
      return options.expectedSummary;
    },
    runRollbackVerification: async (options): Promise<SchemaVerificationSummary> => {
      calls.push(`migration:${options.catalogAuditSql}`);
      assert.equal(
        options.migrationSql,
        "begin;\nselect 'shift';\nselect 'order-link';\nselect 'cancellation';\nselect 'orderability';\nselect 'time-zone';\ncommit;",
      );
      assert.deepEqual(options.expectedSummary, { policies: 5, securedTables: 25, securityDefinerFunctions: 30 });
      return options.expectedSummary;
    },
  };

  const result = await verifyP2MobileSchema(input, dependencies);
  assert.deepEqual(calls, ["read:select 'base';", "migration:select 'target';", "read:select 'base';"]);
  assert.deepEqual(result.postcheck, result.base);
});

test("always performs the read-only postcheck after a combined rollback failure", async () => {
  const calls: string[] = [];
  const failure = new SchemaVerificationError("migration", "SCHEMA_VERIFICATION_MIGRATION_FAILED");
  await assert.rejects(
    verifyP2MobileSchema(input, {
      runReadOnlyAudit: async (options) => {
        calls.push("read");
        return options.expectedSummary;
      },
      runRollbackVerification: async () => {
        calls.push("migration");
        throw failure;
      },
    }),
    failure,
  );
  assert.deepEqual(calls, ["read", "migration", "read"]);
});

test("does not attempt the combined migration when the exact base audit fails", async () => {
  let migrationAttempted = false;
  const failure = new SchemaVerificationError("catalog_audit", "SCHEMA_VERIFICATION_CATALOG_AUDIT_FAILED");
  await assert.rejects(
    verifyP2MobileSchema(input, {
      runReadOnlyAudit: async () => { throw failure; },
      runRollbackVerification: async () => {
        migrationAttempted = true;
        return { policies: 5, securedTables: 25, securityDefinerFunctions: 30 };
      },
    }),
    failure,
  );
  assert.equal(migrationAttempted, false);
});
