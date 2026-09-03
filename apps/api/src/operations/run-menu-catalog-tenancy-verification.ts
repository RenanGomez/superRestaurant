import { readFileSync } from "node:fs";

import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
} from "./tenancy-verification-config.js";
import { runTenancyVerification } from "./tenancy-verification.js";

try {
  const config = readTenancyVerificationConfig(process.env);
  const runtimeCatalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_menu_catalog.sql", import.meta.url),
    "utf8",
  );
  const summary = await runTenancyVerification({
    config,
    onFailure: (failure) => process.stderr.write(`${JSON.stringify(failure)}\n`),
    onFixtureCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "fixtures", status: "running" })}\n`,
    ),
    onMenuCatalogCheckpoint: (checkpoint) => process.stdout.write(
      `${JSON.stringify({ checkpoint, stage: "menu_catalog", status: "running" })}\n`,
    ),
    onMenuCatalogDiagnostic: (diagnostic) => process.stdout.write(
      `${JSON.stringify({ diagnostic, stage: "menu_catalog.manager_empty", status: "diagnostic" })}\n`,
    ),
    onStart: (runId) => process.stdout.write(`${JSON.stringify({ runId, stage: "start", status: "running" })}\n`),
    runtimeCatalogAuditSql,
    verifyMenuCatalog: true,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatTenancyVerificationFailure(error)}\n`);
  process.exitCode = 1;
}
