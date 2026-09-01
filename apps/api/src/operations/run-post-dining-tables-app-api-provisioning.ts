import { readFileSync } from "node:fs";

import { formatAppApiProvisioningFailure, readAppApiProvisioningConfig } from "./app-api-provisioning-config.js";
import { provisionAppApi } from "./app-api-provisioning.js";

try {
  const config = readAppApiProvisioningConfig(process.env, process.argv.slice(2));
  const auditSql = readFileSync(
    new URL("../../../../supabase/tests/tenancy_memberships_post_dining_tables_catalog.sql", import.meta.url),
    "utf8",
  );
  const result = await provisionAppApi({
    auditProfile: "post_dining_tables_v1",
    config,
    precheckAuditSql: auditSql,
    runtimeAuditSql: auditSql,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatAppApiProvisioningFailure(error)}\n`);
  process.exitCode = 1;
}
