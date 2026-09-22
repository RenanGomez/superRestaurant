import { readFileSync } from "node:fs";

import { verifyCaptureSchema } from "./capture-schema-verification.js";
import { buildCaptureContinuityCatalogAudit, buildCaptureTrayCatalogAudit } from "./post-bootstrap-catalog.js";
import { extractMigrationBody, readSchemaVerificationConfig, SchemaVerificationError } from "./schema-verification.js";

const baseSummary = { securedTables: 35, policies: 5, securityDefinerFunctions: 44 } as const;
const targetSummary = { securedTables: 35, policies: 5, securityDefinerFunctions: 46 } as const;

try {
  const read = (path: string) => readFileSync(new URL(`../../../../supabase/${path}`, import.meta.url), "utf8");
  const base = read("tests/tenancy_memberships_post_p2.sql");
  const capture = read("tests/capture_drafts_catalog.sql");
  const directory = read("tests/customer_directory_catalog.sql");
  const result = await verifyCaptureSchema({
    baseCatalogAuditSql: buildCaptureTrayCatalogAudit(base, capture, directory),
    baseSummary,
    config: readSchemaVerificationConfig(process.env),
    migrationSql: `begin;\n${extractMigrationBody(read("migrations/20260920000200_capture_continuity_autosave.sql"))}\ncommit;`,
    targetCatalogAuditSql: buildCaptureContinuityCatalogAudit(base, capture, directory),
    targetSummary,
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", ...result })}\n`);
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError
    ? error
    : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
  process.stderr.write(`${JSON.stringify({ code: failure.code, stage: failure.stage, status: "failed",
    ...(failure.sqlState === undefined ? {} : { sqlState: failure.sqlState }),
    ...(failure.statementIndex === undefined ? {} : { statementIndex: failure.statementIndex }) })}\n`);
  process.exitCode = 1;
}
