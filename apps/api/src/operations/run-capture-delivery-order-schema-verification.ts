import { readFileSync } from "node:fs";

import { verifyCaptureSchema } from "./capture-schema-verification.js";
import {
  buildCaptureContinuityCatalogAudit,
  buildCaptureDeliveryOrderCatalogAudit,
} from "./post-bootstrap-catalog.js";
import {
  extractMigrationBody,
  readSchemaVerificationConfig,
  SchemaVerificationError,
} from "./schema-verification.js";

const baseSummary = { securedTables: 35, policies: 5, securityDefinerFunctions: 46 } as const;
const targetSummary = { securedTables: 36, policies: 5, securityDefinerFunctions: 50 } as const;

try {
  const read = (path: string) => readFileSync(new URL(`../../../../supabase/${path}`, import.meta.url), "utf8");
  const base = read("tests/tenancy_memberships_post_p2.sql");
  const capture = read("tests/capture_drafts_catalog.sql");
  const directory = read("tests/customer_directory_catalog.sql");
  const deliveryOrder = read("tests/capture_delivery_order_catalog.sql");
  const invariants = extractMigrationBody(read("tests/capture_delivery_order_invariants.sql"))
    .replaceAll("execute 'set local role app_api';", "")
    .replaceAll("execute 'reset role';", "");
  const migrationSql = `begin;\n${[
    "migrations/20260922000100_capture_delivery_instructions.sql",
    "migrations/20260922000200_confirm_capture_order.sql",
  ].map((path) => extractMigrationBody(read(path))).join("\n")}\ncommit;`;
  const result = await verifyCaptureSchema({
    baseCatalogAuditSql: buildCaptureContinuityCatalogAudit(base, capture, directory),
    baseSummary,
    config: readSchemaVerificationConfig(process.env),
    migrationSql,
    targetCatalogAuditSql: buildCaptureDeliveryOrderCatalogAudit(base, capture, directory, deliveryOrder),
    targetSummary,
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
