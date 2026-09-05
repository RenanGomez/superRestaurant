import { readFileSync } from "node:fs";

import {
  extractMigrationBody,
  readSchemaVerificationConfig,
  runSchemaVerification,
  SchemaVerificationError,
} from "./schema-verification.js";

try {
  const baselineAudit = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_finance.sql", import.meta.url),
    "utf8",
  );
  const cancellationAudit = readFileSync(
    new URL("../../../../supabase/tests/order_item_cancellations_catalog.sql", import.meta.url),
    "utf8",
  );
  const cancellationMigration = readFileSync(
    new URL("../../../../supabase/migrations/20260905000300_enable_order_item_cancellations.sql", import.meta.url),
    "utf8",
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: cancellationAudit,
    config: readSchemaVerificationConfig(process.env),
    expectedSummary: { policies: 5, securedTables: 23, securityDefinerFunctions: 24 },
    migrationSql: `begin;\n${baselineAudit}\n${extractMigrationBody(cancellationMigration)}\ncommit;`,
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
