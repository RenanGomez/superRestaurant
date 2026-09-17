import { readFileSync } from "node:fs";
import { verifyCaptureSchema } from "./capture-schema-verification.js";
import { buildCaptureCustomerCatalogAudit, buildCustomerDirectoryCatalogAudit } from "./post-bootstrap-catalog.js";
import { extractMigrationBody, readSchemaVerificationConfig, SchemaVerificationError } from "./schema-verification.js";

try {
  const base = readFileSync(new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url), "utf8");
  const capture = readFileSync(new URL("../../../../supabase/tests/capture_drafts_catalog.sql", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../../../../supabase/tests/customer_directory_catalog.sql", import.meta.url), "utf8");
  const read = (path: string) => extractMigrationBody(readFileSync(new URL(`../../../../supabase/${path}`, import.meta.url), "utf8"));
  // Managed postgres is not a superuser and cannot SET ROLE app_api. Keep
  // real app_api execution in the disposable local harness; remotely audit
  // exact function/table grants and exercise the same security-definer writer.
  const invariants = read("tests/capture_customer_invariants.sql")
    .replaceAll("execute 'set local role app_api';", "")
    .replaceAll("execute 'reset role';", "");
  const result = await verifyCaptureSchema({
    config: readSchemaVerificationConfig(process.env),
    baseSummary: { securedTables: 35, policies: 5, securityDefinerFunctions: 41 },
    targetSummary: { securedTables: 35, policies: 5, securityDefinerFunctions: 42 },
    baseCatalogAuditSql: buildCustomerDirectoryCatalogAudit(base, capture, directory),
    targetCatalogAuditSql: buildCaptureCustomerCatalogAudit(base, capture, directory),
    migrationSql: `begin;\n${read("migrations/20260917000200_link_capture_customer_snapshots.sql")}\n${invariants}\ncommit;`,
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", ...result })}\n`);
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError ? error
    : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
  process.stderr.write(`${JSON.stringify({ code: failure.code, stage: failure.stage, status: "failed",
    ...(failure.sqlState === undefined ? {} : { sqlState: failure.sqlState }),
    ...(failure.statementIndex === undefined ? {} : { statementIndex: failure.statementIndex }) })}\n`);
  process.exitCode = 1;
}
