import { readFileSync } from "node:fs";

import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
} from "./tenancy-verification-config.js";
import { runTenancyVerification } from "./tenancy-verification.js";
import {
  createWebProtectedSmokeCoordinator,
  WEB_PROTECTED_SMOKE_API_PORT,
} from "./web-protected-smoke-coordinator.js";

let coordinator: ReturnType<typeof createWebProtectedSmokeCoordinator> | undefined;
try {
  const config = readTenancyVerificationConfig(process.env);
  coordinator = createWebProtectedSmokeCoordinator(
    process.env,
    config.expectedProjectRef,
    (phase, runId) => {
      process.stdout.write(`${JSON.stringify({ phase, runId, status: "waiting_for_browser" })}\n`);
    },
  );
  const runtimeCatalogAuditSql = readFileSync(
    new URL(
      "../../../../supabase/tests/tenancy_memberships_post_dining_zones_runtime_catalog.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const summary = await runTenancyVerification({
    apiPort: WEB_PROTECTED_SMOKE_API_PORT,
    config,
    liveFixtureHooks: coordinator.hooks,
    onStart: (runId) => {
      process.stdout.write(`${JSON.stringify({ runId, stage: "start", status: "running" })}\n`);
    },
    runtimeCatalogAuditSql,
    verifyDiningZones: true,
  });
  process.stdout.write(`${JSON.stringify({ ...summary, protectedWebSmoke: true })}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatTenancyVerificationFailure(error)}\n`);
  process.exitCode = 1;
} finally {
  coordinator?.cleanup();
}
