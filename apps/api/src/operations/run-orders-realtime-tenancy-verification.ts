import { readFileSync } from "node:fs";

import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
} from "./tenancy-verification-config.js";
import { runOrdersRealtimeTenancyVerification } from "./orders-realtime-tenancy-verification.js";

try {
  const config = readTenancyVerificationConfig(process.env);
  const runtimeCatalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_orders_realtime.sql", import.meta.url),
    "utf8",
  );
  const summary = await runOrdersRealtimeTenancyVerification({
    config,
    onFailure: (failure) => process.stderr.write(`${JSON.stringify(failure)}\n`),
    onFixtureCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "fixtures", status: "running" })}\n`,
    ),
    onMenuCatalogCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "menu_catalog", status: "running" })}\n`,
    ),
    onOrdersRealtimeCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "orders_realtime", status: "running" })}\n`,
    ),
    onStart: (runId) => process.stdout.write(`${JSON.stringify({ runId, stage: "start", status: "running" })}\n`),
    runtimeCatalogAuditSql,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatTenancyVerificationFailure(error)}\n`);
  process.exitCode = 1;
}
