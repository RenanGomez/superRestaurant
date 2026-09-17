import { readFileSync } from "node:fs";

import { verifyCaptureSchema } from "./capture-schema-verification.js";
import { buildCustomerDirectoryCatalogAudit } from "./post-bootstrap-catalog.js";
import { extractMigrationBody, readSchemaVerificationConfig, SchemaVerificationError } from "./schema-verification.js";

const expectedSummary = { securedTables: 35, policies: 5, securityDefinerFunctions: 41 } as const;

try {
  const base = readFileSync(new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url), "utf8");
  const capture = readFileSync(new URL("../../../../supabase/tests/capture_drafts_catalog.sql", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../../../../supabase/tests/customer_directory_catalog.sql", import.meta.url), "utf8");
  const catalogAuditSql = buildCustomerDirectoryCatalogAudit(base, capture, directory);
  const result = await verifyCaptureSchema({
    config: readSchemaVerificationConfig(process.env),
    baseSummary: expectedSummary,
    targetSummary: expectedSummary,
    baseCatalogAuditSql: catalogAuditSql,
    targetCatalogAuditSql: catalogAuditSql,
    migrationSql: `begin;\n${extractMigrationBody(readFileSync(new URL(
      "../../../../supabase/migrations/20260917000100_reject_incomplete_customer_address_validation.sql",
      import.meta.url,
    ), "utf8"))}\n${extractMigrationBody(readFileSync(new URL(
      "../../../../supabase/tests/customer_directory_invariants.sql",
      import.meta.url,
    ), "utf8"))}\ncommit;`,
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", ...result })}\n`);
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError
    ? error
    : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
  process.stderr.write(`${JSON.stringify({
    code: failure.code,
    stage: failure.stage,
    status: "failed",
    ...(failure.sqlState === undefined ? {} : { sqlState: failure.sqlState }),
    ...(failure.statementIndex === undefined ? {} : { statementIndex: failure.statementIndex }),
  })}\n`);
  process.exitCode = 1;
}
