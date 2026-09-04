import { readFileSync } from "node:fs";

import {
  extractMigrationBody,
  readSchemaVerificationConfig,
  runSchemaVerification,
  SchemaVerificationError,
} from "./schema-verification.js";

try {
  const financialMigration = readFileSync(
    new URL("../../../../supabase/migrations/20260903000200_create_cash_registers_simple_payments.sql", import.meta.url),
    "utf8",
  );
  const reportingMigration = readFileSync(
    new URL("../../../../supabase/migrations/20260903000300_create_cash_register_operational_reporting.sql", import.meta.url),
    "utf8",
  );
  const financialAudit = readFileSync(
    new URL("../../../../supabase/tests/cash_registers_simple_payments_catalog.sql", import.meta.url),
    "utf8",
  );
  const reportingAudit = readFileSync(
    new URL("../../../../supabase/tests/cash_register_operational_reporting_catalog.sql", import.meta.url),
    "utf8",
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: `${financialAudit}\n${reportingAudit}`,
    config: readSchemaVerificationConfig(process.env),
    expectedSummary: { policies: 5, securedTables: 23, securityDefinerFunctions: 22 },
    migrationSql: `begin;\n${extractMigrationBody(financialMigration)}\n${extractMigrationBody(reportingMigration)}\ncommit;`,
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
