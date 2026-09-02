import { readFileSync } from "node:fs";

import { formatTenancyVerificationFailure, readTenancyVerificationConfig } from "./tenancy-verification-config.js";
import { runTenancyVerification } from "./tenancy-verification.js";

try {
  const config = readTenancyVerificationConfig(process.env);
  const runtimeCatalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_dining_tables_catalog.sql", import.meta.url),
    "utf8",
  );
  const summary = await runTenancyVerification({
    config,
    onCheckpoint: (checkpoint) => console.log(JSON.stringify({ checkpoint, stage: "dining_tables", status: "running" })),
    onDiningLayoutDiagnostic: (diagnostic) => console.log(JSON.stringify({ diagnostic, stage: "dining_tables.manager_layout", status: "diagnostic" })),
    onFailure: (failure) => console.error(JSON.stringify(failure)),
    onStart: (runId) => console.log(JSON.stringify({ runId, stage: "start", status: "running" })),
    runtimeCatalogAuditSql,
    verifyDiningTables: true,
  });
  console.log(JSON.stringify(summary));
} catch (error: unknown) {
  console.error(formatTenancyVerificationFailure(error));
  process.exitCode = 1;
}
