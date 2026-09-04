import { readFileSync } from "node:fs";

import { runFullPosFlowTenancyVerification } from "./full-pos-flow-tenancy-verification.js";
import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
} from "./tenancy-verification-config.js";

try {
  const config = readTenancyVerificationConfig(process.env);
  const runtimeCatalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_finance.sql", import.meta.url),
    "utf8",
  );
  const summary = await runFullPosFlowTenancyVerification({
    config,
    onFailure: (failure) => process.stderr.write(`${JSON.stringify(failure)}\n`),
    onFixtureCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "fixtures", status: "running" })}\n`,
    ),
    onFullPosFlowCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "full_pos_flow", status: "running" })}\n`,
    ),
    onKdsTicketCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "kds_tickets", status: "running" })}\n`,
    ),
    onMenuCatalogCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "menu_catalog", status: "running" })}\n`,
    ),
    onOrdersRealtimeCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "orders_realtime", status: "running" })}\n`,
    ),
    onStart: (runId) => process.stdout.write(
      `${JSON.stringify({ runId, stage: "start", status: "running" })}\n`,
    ),
    runtimeCatalogAuditSql,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatTenancyVerificationFailure(error)}\n`);
  process.exitCode = 1;
}
