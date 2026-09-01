import { readFileSync } from "node:fs";

import { readSchemaVerificationConfig, runSchemaVerification, SchemaVerificationError } from "./schema-verification.js";

try {
  const diningTablesAuditSql = readFileSync(
    new URL("../../../../supabase/tests/dining_tables_layout_catalog.sql", import.meta.url),
    "utf8",
  );
  const globalAuditSql = readFileSync(
    new URL(
      "../../../../supabase/tests/tenancy_memberships_post_dining_tables_catalog.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: `${diningTablesAuditSql}\n${globalAuditSql}`,
    config: readSchemaVerificationConfig(process.env),
    expectedSummary: { policies: 5, securedTables: 9, securityDefinerFunctions: 9 },
    migrationSql: readFileSync(new URL("../../../../supabase/migrations/20260901000100_create_dining_tables_layout.sql", import.meta.url), "utf8"),
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", summary })}\n`);
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError
    ? error
    : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
  process.stderr.write(`${JSON.stringify({ code: failure.code, stage: failure.stage, status: "failed" })}\n`);
  process.exitCode = 1;
}
