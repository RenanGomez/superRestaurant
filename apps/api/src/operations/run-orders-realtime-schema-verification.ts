import { readFileSync } from "node:fs";

import { readSchemaVerificationConfig, runSchemaVerification, SchemaVerificationError } from "./schema-verification.js";

try {
  const specificAudit = readFileSync(
    new URL("../../../../supabase/tests/orders_realtime_catalog.sql", import.meta.url),
    "utf8",
  );
  const globalAudit = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_orders_realtime.sql", import.meta.url),
    "utf8",
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: `${specificAudit}\n${globalAudit}`,
    config: readSchemaVerificationConfig(process.env),
    expectedSummary: { policies: 5, securedTables: 19, securityDefinerFunctions: 15 },
    migrationSql: readFileSync(
      new URL("../../../../supabase/migrations/20260902000200_create_orders_realtime.sql", import.meta.url),
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
