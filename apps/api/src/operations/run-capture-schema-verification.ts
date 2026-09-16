import { readFileSync } from "node:fs";

import { verifyCaptureSchema } from "./capture-schema-verification.js";
import { buildCustomerDirectoryCatalogAudit, buildPostBootstrapCatalogAudit, postBootstrapSummary } from "./post-bootstrap-catalog.js";
import { extractMigrationBody, readSchemaVerificationConfig, SchemaVerificationError } from "./schema-verification.js";

try {
  const base = readFileSync(new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url), "utf8");
  const supplement = readFileSync(new URL("../../../../supabase/tests/capture_drafts_catalog.sql", import.meta.url), "utf8");
  const directorySupplement = readFileSync(new URL("../../../../supabase/tests/customer_directory_catalog.sql", import.meta.url), "utf8");
  const attentionMigration = extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000400_create_capture_attention_command.sql", import.meta.url), "utf8"));
  const result = await verifyCaptureSchema({
    config: readSchemaVerificationConfig(process.env),
    baseSummary: postBootstrapSummary,
    baseCatalogAuditSql: buildPostBootstrapCatalogAudit(base),
    targetCatalogAuditSql: buildCustomerDirectoryCatalogAudit(base, supplement, directorySupplement),
    migrationSql: `begin;\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000100_create_capture_drafts.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000200_create_capture_command_journal.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000300_create_capture_draft_command.sql", import.meta.url), "utf8"))}\n${attentionMigration}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000500_create_customer_directory.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000600_create_customer_directory_command.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/migrations/20260916000700_create_customer_directory_search.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/tests/customer_directory_invariants.sql", import.meta.url), "utf8"))}\n${extractMigrationBody(readFileSync(new URL("../../../../supabase/tests/capture_drafts_invariants.sql", import.meta.url), "utf8"))}\ncommit;`,
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
