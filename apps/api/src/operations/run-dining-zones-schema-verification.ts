import { readFileSync } from "node:fs";

import {
  readSchemaVerificationConfig,
  runSchemaVerification,
  SchemaVerificationError,
} from "./schema-verification.js";

try {
  const config = readSchemaVerificationConfig(process.env);
  const migrationSql = readFileSync(
    new URL("../../../../supabase/migrations/20260831000100_create_dining_zones.sql", import.meta.url),
    "utf8",
  );
  const diningZonesCatalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/dining_zones_catalog.sql", import.meta.url),
    "utf8",
  );
  const postDiningZonesRuntimeCatalogAuditSql = readFileSync(
    new URL(
      "../../../../supabase/tests/tenancy_memberships_post_dining_zones_runtime_catalog.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const summary = await runSchemaVerification({
    catalogAuditSql: `${diningZonesCatalogAuditSql}\n${postDiningZonesRuntimeCatalogAuditSql}`,
    config,
    expectedSummary: { policies: 5, securedTables: 7, securityDefinerFunctions: 6 },
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
