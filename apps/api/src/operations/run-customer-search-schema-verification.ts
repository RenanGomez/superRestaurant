import { readFileSync } from "node:fs";

import { verifyCaptureSchema } from "./capture-schema-verification.js";
import { buildCaptureTrayCatalogAudit } from "./post-bootstrap-catalog.js";
import { extractMigrationBody, readSchemaVerificationConfig, SchemaVerificationError } from "./schema-verification.js";

const expectedSummary = { securedTables: 35, policies: 5, securityDefinerFunctions: 44 } as const;

try {
  const read = (path: string) => readFileSync(new URL(`../../../../supabase/${path}`, import.meta.url), "utf8");
  const catalogAuditSql = buildCaptureTrayCatalogAudit(
    read("tests/tenancy_memberships_post_p2.sql"),
    read("tests/capture_drafts_catalog.sql"),
    read("tests/customer_directory_catalog.sql"),
  );
  const result = await verifyCaptureSchema({
    config: readSchemaVerificationConfig(process.env),
    baseSummary: expectedSummary,
    targetSummary: expectedSummary,
    baseCatalogAuditSql: catalogAuditSql,
    targetCatalogAuditSql: catalogAuditSql,
    migrationSql: `begin;\n${extractMigrationBody(read("migrations/20260920000100_improve_customer_directory_search.sql"))}\n${extractMigrationBody(read("tests/customer_directory_invariants.sql"))}\ncommit;`,
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
