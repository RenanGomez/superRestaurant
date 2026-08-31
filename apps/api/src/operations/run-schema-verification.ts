import { readFileSync } from "node:fs";

import {
  readSchemaVerificationConfig,
  runSchemaVerification,
  SchemaVerificationError,
} from "./schema-verification.js";

try {
  const config = readSchemaVerificationConfig(process.env);
  const migrationSql = readFileSync(
    new URL("../../../../supabase/migrations/20260830000100_create_tenancy_memberships.sql", import.meta.url),
    "utf8",
  );
  const catalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
    "utf8",
  );
  const summary = await runSchemaVerification({ catalogAuditSql, config, migrationSql });
  console.log(JSON.stringify({ stage: "complete", status: "ok", summary }));
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError
    ? error
    : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
  console.error(JSON.stringify({ code: failure.code, stage: failure.stage, status: "failed" }));
  process.exitCode = 1;
}
