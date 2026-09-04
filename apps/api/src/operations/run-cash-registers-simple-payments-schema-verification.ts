import { readFileSync } from "node:fs";

import { readSchemaVerificationConfig, runSchemaVerification, SchemaVerificationError } from "./schema-verification.js";

try {
  const summary = await runSchemaVerification({
    catalogAuditSql: readFileSync(
      new URL("../../../../supabase/tests/cash_registers_simple_payments_catalog.sql", import.meta.url),
      "utf8",
    ),
    config: readSchemaVerificationConfig(process.env),
    expectedSummary: { policies: 5, securedTables: 23, securityDefinerFunctions: 21 },
    migrationSql: readFileSync(
      new URL("../../../../supabase/migrations/20260903000200_create_cash_registers_simple_payments.sql", import.meta.url),
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
