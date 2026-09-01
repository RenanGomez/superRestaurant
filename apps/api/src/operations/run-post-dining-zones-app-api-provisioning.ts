import { readFileSync } from "node:fs";

import {
  formatAppApiProvisioningFailure,
  readAppApiProvisioningConfig,
} from "./app-api-provisioning-config.js";
import { provisionAppApi } from "./app-api-provisioning.js";

try {
  const config = readAppApiProvisioningConfig(process.env, process.argv.slice(2));
  const precheckAuditSql = readFileSync(
    new URL(
      "../../../../supabase/tests/tenancy_memberships_post_dining_zones_catalog.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const runtimeAuditSql = readFileSync(
    new URL(
      "../../../../supabase/tests/tenancy_memberships_post_dining_zones_runtime_catalog.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const result = await provisionAppApi({
    auditProfile: "post_dining_zones_v1",
    config,
    precheckAuditSql,
    runtimeAuditSql,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error: unknown) {
  process.stderr.write(`${formatAppApiProvisioningFailure(error)}\n`);
  process.exitCode = 1;
}
