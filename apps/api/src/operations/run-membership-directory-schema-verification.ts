import { readFileSync } from "node:fs";

import {
  readSchemaVerificationConfig,
  runSchemaVerification,
  SchemaVerificationError,
} from "./schema-verification.js";

try {
  const config = readSchemaVerificationConfig(process.env);
  const migrationSql = readFileSync(
    new URL(
      "../../../../supabase/migrations/20260830000200_list_active_branch_memberships.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const catalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
    "utf8",
  );
  const summary = await runSchemaVerification({
    catalogAuditSql,
    config,
    expectedSecurityDefinerFunctions: 5,
    migrationSql,
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", summary })}\n`);
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError
    ? error
    : new SchemaVerificationError(
      "configuration",
      "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED",
    );
  process.stderr.write(`${JSON.stringify({
    code: failure.code,
    stage: failure.stage,
    status: "failed",
  })}\n`);
  process.exitCode = 1;
}
