import { readFileSync } from "node:fs";

import { verifyP2MobileSchema } from "./p2-mobile-schema-verification.js";
import { readSchemaVerificationConfig, SchemaVerificationError } from "./schema-verification.js";

const migration = (name: string): string => readFileSync(
  new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
  "utf8",
);

try {
  const result = await verifyP2MobileSchema({
    baseCatalogAuditSql: readFileSync(
      new URL("../../../../supabase/tests/tenancy_memberships_post_finance.sql", import.meta.url),
      "utf8",
    ),
    config: readSchemaVerificationConfig(process.env),
    migrationSqls: [
      migration("20260905000100_create_operational_shifts.sql"),
      migration("20260905000200_link_operational_shifts_to_orders.sql"),
      migration("20260905000300_enable_order_item_cancellations.sql"),
      migration("20260906000100_enforce_orderable_menu_modifier_groups.sql"),
      migration("20260906000200_add_authoritative_restaurant_time_zone.sql"),
    ],
    targetCatalogAuditSql: readFileSync(
      new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url),
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
