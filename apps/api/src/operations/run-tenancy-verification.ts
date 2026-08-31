import { readFileSync } from "node:fs";

import {
  formatTenancyVerificationFailure,
  readTenancyVerificationConfig,
} from "./tenancy-verification-config.js";
import { runTenancyVerification } from "./tenancy-verification.js";

try {
  const config = readTenancyVerificationConfig(process.env);
  const runtimeCatalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_runtime_catalog.sql", import.meta.url),
    "utf8",
  );
  const summary = await runTenancyVerification({
    config,
    onStart: (runId) => {
      console.log(JSON.stringify({ runId, stage: "start", status: "running" }));
    },
    runtimeCatalogAuditSql,
  });
  console.log(JSON.stringify(summary));
} catch (error: unknown) {
  console.error(formatTenancyVerificationFailure(error));
  process.exitCode = 1;
}
