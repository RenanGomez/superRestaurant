import { readFileSync } from "node:fs";

import { verifyCaptureSchema } from "./capture-schema-verification.js";
import {
  buildCaptureContinuityCatalogAudit,
  buildCaptureRepeatOrderConfirmationCatalogAudit,
} from "./post-bootstrap-catalog.js";
import {
  extractMigrationBody,
  readSchemaVerificationConfig,
  SchemaVerificationError,
} from "./schema-verification.js";

const baseSummary = { securedTables: 35, policies: 5, securityDefinerFunctions: 46 } as const;
const targetSummary = { securedTables: 37, policies: 5, securityDefinerFunctions: 55 } as const;

try {
  const read = (path: string) => readFileSync(new URL(`../../../../supabase/${path}`, import.meta.url), "utf8");
  const base = read("tests/tenancy_memberships_post_p2.sql");
  const capture = read("tests/capture_drafts_catalog.sql");
  const directory = read("tests/customer_directory_catalog.sql");
  const deliveryOrder = read("tests/capture_delivery_order_catalog.sql");
  const history = read("tests/customer_order_history_catalog.sql");
  const repeatOrder = read("tests/capture_repeat_order_catalog.sql");
  const repeatOrderWorkspace = read("tests/capture_repeat_order_workspace_catalog.sql");
  const repeatOrderConfirmation = read("tests/capture_repeat_order_confirmation_catalog.sql");
  const invariants = [
    "tests/capture_delivery_order_invariants.sql",
    "tests/customer_order_history_invariants.sql",
    "tests/capture_repeat_order_invariants.sql",
    "tests/capture_repeat_order_workspace_invariants.sql",
    "tests/capture_repeat_order_confirmation_invariants.sql",
  ].map((path) => extractMigrationBody(read(path))
    .replaceAll("execute 'set local role app_api';", "")
    .replaceAll("execute 'reset role';", "")).join("\n");
  const migrationSql = `begin;\n${[
    "migrations/20260922000100_capture_delivery_instructions.sql",
    "migrations/20260922000200_confirm_capture_order.sql",
    "migrations/20260923000100_customer_recent_order_history.sql",
    "migrations/20260923000200_capture_repeat_order_plan.sql",
    "migrations/20260923000300_capture_repeat_order_workspace.sql",
    "migrations/20260924000100_confirm_capture_repeat_order.sql",
  ].map((path) => extractMigrationBody(read(path))).join("\n")}\ncommit;`;
  const result = await verifyCaptureSchema({
    baseCatalogAuditSql: buildCaptureContinuityCatalogAudit(base, capture, directory),
    baseSummary,
    config: readSchemaVerificationConfig(process.env),
    migrationSql,
    targetCatalogAuditSql: buildCaptureRepeatOrderConfirmationCatalogAudit(
      base,
      capture,
      directory,
      deliveryOrder,
      history,
      repeatOrder,
      repeatOrderWorkspace,
      repeatOrderConfirmation,
    ),
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
