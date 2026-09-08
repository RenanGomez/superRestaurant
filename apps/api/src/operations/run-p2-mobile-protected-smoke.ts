import { readFileSync } from "node:fs";

import { runFullPosFlowTenancyVerification } from "./full-pos-flow-tenancy-verification.js";
import {
  createKdsProtectedSmokeCoordinator,
  KDS_PROTECTED_SMOKE_API_PORT,
} from "./kds-protected-smoke-coordinator.js";
import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
} from "./tenancy-verification-config.js";

const MOBILE_WEB_ORIGIN = "http://127.0.0.1:8082";
const MOBILE_BROWSER_WAIT_TIMEOUT_MS = 30 * 60 * 1_000;

let coordinator: ReturnType<typeof createKdsProtectedSmokeCoordinator> | undefined;
try {
  const config = readTenancyVerificationConfig(process.env);
  coordinator = createKdsProtectedSmokeCoordinator(
    {
      KDS_PROTECTED_SMOKE_CONFIRM_PROJECT_REF:
        process.env.P2_MOBILE_PROTECTED_SMOKE_CONFIRM_PROJECT_REF,
      KDS_PROTECTED_SMOKE_RUN: process.env.P2_MOBILE_PROTECTED_SMOKE_RUN,
    },
    config.expectedProjectRef,
    (phase, runId) => process.stdout.write(
      `${JSON.stringify({ phase, runId, status: "waiting_for_mobile_browser" })}\n`,
    ),
    MOBILE_BROWSER_WAIT_TIMEOUT_MS,
  );
  const runtimeCatalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url),
    "utf8",
  );
  const summary = await runFullPosFlowTenancyVerification({
    apiCorsOrigin: MOBILE_WEB_ORIGIN,
    apiPort: KDS_PROTECTED_SMOKE_API_PORT,
    browserHooks: coordinator.hooks,
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
  process.stdout.write(`${JSON.stringify({ ...summary, protectedP2MobileSmoke: true })}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatTenancyVerificationFailure(error)}\n`);
  process.exitCode = 1;
} finally {
  coordinator?.cleanup();
}
