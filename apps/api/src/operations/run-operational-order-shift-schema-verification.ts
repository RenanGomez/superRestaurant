import { readFileSync } from "node:fs";

import { verifyOperationalOrderShiftSchema } from "./operational-order-shift-schema-verification.js";
import {
  readSchemaVerificationConfig,
  SchemaVerificationError,
} from "./schema-verification.js";

try {
  const result = await verifyOperationalOrderShiftSchema({
    baseCatalogAuditSql: readFileSync(
      new URL("../../../../supabase/tests/tenancy_memberships_post_finance.sql", import.meta.url),
      "utf8",
    ),
    config: readSchemaVerificationConfig(process.env),
    operationalOrderMigrationSql: readFileSync(
      new URL("../../../../supabase/migrations/20260905000200_link_operational_shifts_to_orders.sql", import.meta.url),
      "utf8",
    ),
    operationalShiftMigrationSql: readFileSync(
      new URL("../../../../supabase/migrations/20260905000100_create_operational_shifts.sql", import.meta.url),
      "utf8",
    ),
    targetCatalogAuditSql: readFileSync(
      new URL("../../../../supabase/tests/operational_order_shift_catalog.sql", import.meta.url),
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
