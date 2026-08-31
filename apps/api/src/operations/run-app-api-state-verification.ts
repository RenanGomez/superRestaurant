import { readFileSync } from "node:fs";

import {
  formatAppApiStateVerificationFailure,
  readAppApiStateVerificationConfig,
} from "./app-api-state-verification-config.js";
import { verifyAppApiState } from "./app-api-state-verification.js";

try {
  const config = readAppApiStateVerificationConfig(process.env, process.argv.slice(2));
  const precheckAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
    "utf8",
  );
  const runtimeAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_runtime_catalog.sql", import.meta.url),
    "utf8",
  );
  const result = await verifyAppApiState({ config, precheckAuditSql, runtimeAuditSql });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "attention") process.exitCode = 2;
} catch (error: unknown) {
  process.stderr.write(`${formatAppApiStateVerificationFailure(error)}\n`);
  process.exitCode = 1;
}
