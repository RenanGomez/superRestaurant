import { readFileSync } from "node:fs";

import {
  CAPTURE_CONTINUITY_SMOKE_API_PORT,
  CAPTURE_CONTINUITY_SMOKE_WEB_ORIGIN,
  createCaptureContinuityProtectedSmokeCoordinator,
} from "./capture-continuity-protected-smoke-coordinator.js";
import { buildCaptureAssignmentCatalogAudit } from "./post-bootstrap-catalog.js";
import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
} from "./tenancy-verification-config.js";
import { runTenancyVerification } from "./tenancy-verification.js";

let coordinator: ReturnType<typeof createCaptureContinuityProtectedSmokeCoordinator> | undefined;
try {
  const config = readTenancyVerificationConfig(process.env);
  coordinator = createCaptureContinuityProtectedSmokeCoordinator(
    process.env,
    config,
    (runId) => {
      process.stdout.write(`${JSON.stringify({ phase: "capture_continuity", runId, status: "waiting_for_browser" })}\n`);
    },
  );
  const read = (path: string) => readFileSync(new URL(`../../../../supabase/tests/${path}`, import.meta.url), "utf8");
  const runtimeCatalogAuditSql = buildCaptureAssignmentCatalogAudit(
    read("tenancy_memberships_post_p2.sql"),
    read("capture_drafts_catalog.sql"),
    read("customer_directory_catalog.sql"),
    read("capture_delivery_order_catalog.sql"),
    read("customer_order_history_catalog.sql"),
    read("capture_repeat_order_catalog.sql"),
    read("capture_repeat_order_workspace_catalog.sql"),
    read("capture_repeat_order_confirmation_catalog.sql"),
    read("capture_assignment_catalog.sql"),
  );
  const summary = await runTenancyVerification({
    apiCorsOrigin: CAPTURE_CONTINUITY_SMOKE_WEB_ORIGIN,
    apiPort: CAPTURE_CONTINUITY_SMOKE_API_PORT,
    config,
    liveFixtureHooks: coordinator.hooks,
    onStart: (runId) => {
      process.stdout.write(`${JSON.stringify({ runId, stage: "start", status: "running" })}\n`);
    },
    onFailure: (failure) => process.stderr.write(`${JSON.stringify(failure)}\n`),
    onFixtureCheckpoint: (checkpoint) => {
      process.stdout.write(`${JSON.stringify({ checkpoint, stage: "fixtures", status: "running" })}\n`);
    },
    onHttpCheckpoint: (checkpoint) => {
      process.stdout.write(`${JSON.stringify({ checkpoint, stage: "http", status: "running" })}\n`);
    },
    runtimeCatalogAuditSql,
    verifyMenuCatalog: true,
    verifyOperationalOrders: true,
  });
  process.stdout.write(`${JSON.stringify({ ...summary, captureContinuityProtectedSmoke: true })}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatTenancyVerificationFailure(error)}\n`);
  process.exitCode = 1;
} finally {
  coordinator?.cleanupArtifacts();
}
