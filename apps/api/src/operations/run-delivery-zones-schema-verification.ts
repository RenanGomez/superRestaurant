import { readFileSync } from "node:fs";

import { verifyDeliveryZonesSchema } from "./delivery-zones-schema-verification.js";
import {
  extractMigrationBody,
  readSchemaVerificationConfig,
  SchemaVerificationError,
} from "./schema-verification.js";

try {
  const read = (path: string) => readFileSync(new URL(`../../../../supabase/${path}`, import.meta.url), "utf8");
  const migrationSql = read("migrations/20260927000100_delivery_zones.sql");
  const baseCatalogAuditSql = read("tests/delivery_zones_pre_catalog.sql");
  const targetCatalogAuditSql = read("tests/delivery_zones_catalog.sql");
  const invariants = extractMigrationBody(read("tests/delivery_zones_invariants.sql"));

  const result = await verifyDeliveryZonesSchema({
    baseCatalogAuditSql,
    config: readSchemaVerificationConfig(process.env),
    migrationSql,
    targetCatalogAuditSql,
    verifyWithinTransaction: async (session) => {
      await session.query(invariants);
    },
  });
  process.stdout.write(`${JSON.stringify({ stage: "complete", status: "ok", ...result })}\n`);
} catch (error: unknown) {
  const failure = error instanceof SchemaVerificationError
    ? error
    : new SchemaVerificationError("configuration", "SCHEMA_VERIFICATION_CONFIGURATION_REJECTED");
  process.stderr.write(`${JSON.stringify({
    code: failure.code,
    stage: failure.stage,
    status: "failed",
    ...(failure.sqlState === undefined ? {} : { sqlState: failure.sqlState }),
    ...(failure.statementIndex === undefined ? {} : { statementIndex: failure.statementIndex }),
  })}\n`);
  process.exitCode = 1;
}
