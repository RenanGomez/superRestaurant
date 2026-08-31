import { readFileSync } from "node:fs";

import {
  formatAppApiRecoveryFailure,
  readAppApiRecoveryConfig,
} from "./app-api-recovery-config.js";
import { recoverAppApi } from "./app-api-recovery.js";

try {
  const config = readAppApiRecoveryConfig(process.env, process.argv.slice(2));
  const precheckAuditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
    "utf8",
  );
  const result = await recoverAppApi({ config, precheckAuditSql });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatAppApiRecoveryFailure(error)}\n`);
  process.exitCode = 1;
}
