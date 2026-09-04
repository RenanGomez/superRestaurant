import { readFileSync } from "node:fs";

import {
  formatAppApiStateVerificationFailure,
  readAppApiStateVerificationConfig,
} from "./app-api-state-verification-config.js";
import { verifyAppApiState } from "./app-api-state-verification.js";

try {
  const config = readAppApiStateVerificationConfig(process.env, process.argv.slice(2));
  const catalogAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_finance.sql", import.meta.url),
    "utf8",
  );
  const result = await verifyAppApiState({
    auditProfile: "post_finance_v1",
    config,
    precheckAuditSql: catalogAuditSql,
    runtimeAuditSql: catalogAuditSql,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "attention") process.exitCode = 2;
} catch (error: unknown) {
  process.stderr.write(`${formatAppApiStateVerificationFailure(error)}\n`);
  process.exitCode = 1;
}
