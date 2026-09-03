import { readFileSync } from "node:fs";

import { readSchemaVerificationConfig, runSchemaVerification, SchemaVerificationError } from "./schema-verification.js";

try {
  const menuCatalogAudit = readFileSync(
    new URL("../../../../supabase/tests/menu_catalog_catalog.sql", import.meta.url),
    "utf8",
  );
  const globalPostMenuAudit = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_menu_catalog.sql", import.meta.url),
    "utf8",
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: `${menuCatalogAudit}\n${globalPostMenuAudit}`,
    config: readSchemaVerificationConfig(process.env),
    expectedSummary: { policies: 5, securedTables: 16, securityDefinerFunctions: 12 },
    migrationSql: readFileSync(
      new URL("../../../../supabase/migrations/20260902000100_create_menu_catalog.sql", import.meta.url),
      "utf8",
    ),
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", summary })}\n`);
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError
    ? error
    : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
  process.stderr.write(`${JSON.stringify({
    code: failure.code,
    ...(failure.sqlState === undefined ? {} : { sqlState: failure.sqlState }),
    stage: failure.stage,
    ...(failure.statementIndex === undefined ? {} : { statementIndex: failure.statementIndex }),
    status: "failed",
  })}\n`);
  process.exitCode = 1;
}
