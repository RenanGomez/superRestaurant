import { readFileSync } from "node:fs";

import { verifyRestaurantTimeZoneSchema } from "./restaurant-time-zone-schema-verification.js";
import { readSchemaVerificationConfig, SchemaVerificationError } from "./schema-verification.js";

try {
  const result = await verifyRestaurantTimeZoneSchema({
    baseCatalogAuditSql: readFileSync(
      new URL("../../../../supabase/tests/tenancy_memberships_post_finance.sql", import.meta.url),
      "utf8",
    ),
    config: readSchemaVerificationConfig(process.env),
    migrationSql: readFileSync(
      new URL("../../../../supabase/migrations/20260906000200_add_authoritative_restaurant_time_zone.sql", import.meta.url),
      "utf8",
    ),
    targetCatalogAuditSql: readFileSync(
      new URL("../../../../supabase/tests/restaurant_time_zone_catalog.sql", import.meta.url),
      "utf8",
    ),
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", ...result })}\n`);
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
