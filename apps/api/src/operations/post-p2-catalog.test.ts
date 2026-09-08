import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateCatalogAuditSql } from "./schema-verification.js";

const audit = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url),
  "utf8",
).toLowerCase();
const runner = readFileSync(
  new URL("../../src/operations/run-post-p2-app-api-state-verification.ts", import.meta.url),
  "utf8",
).toLowerCase();
const apiPackage = readFileSync(new URL("../../package.json", import.meta.url), "utf8").toLowerCase();

test("post-P2 audit is catalog-only and pins the exact global surface", () => {
  assert.doesNotThrow(() => validateCatalogAuditSql(audit));
  assert.match(audit, /post_p2_required_object_missing/u);
  assert.match(audit, /\) <> 25/u);
  assert.match(audit, /\) <> 5/u);
  assert.match(audit, /\) <> 30/u);
  assert.match(audit, /\) <> 32/u);
  assert.match(audit, /post_p2_table_grants_rejected/u);
  assert.match(audit, /post_p2_policy_surface_rejected/u);
  assert.match(audit, /post_p2_function_security_rejected/u);
  assert.match(audit, /post_p2_app_api_surface_rejected/u);
  assert.match(audit, /post_p2_schema_grants_rejected/u);
  assert.match(audit, /menu_modifier_groups_command_limit/u);
  assert.match(audit, /restaurants_time_zone_iana/u);
  assert.match(audit, /orders_restaurant_time_zone/u);
  assert.doesNotMatch(
    audit,
    /\b(?:insert|update|delete|alter|create|drop|truncate|grant|revoke)\s+(?:into|table|role|schema|function|policy|trigger|on|all)\b/u,
  );
  assert.doesNotMatch(audit, /supabase_migrations|schema_migrations/u);
});

test("post-P2 state runner uses the pinned profile for both stable lifecycle states", () => {
  assert.match(runner, /auditprofile: "post_p2_v1"/u);
  assert.match(runner, /tenancy_memberships_post_p2\.sql/u);
  assert.match(runner, /precheckauditsql: catalogauditsql/u);
  assert.match(runner, /runtimeauditsql: catalogauditsql/u);
  assert.match(apiPackage, /"verify:post-p2-app-api-state:remote"/u);
  assert.match(apiPackage, /run-post-p2-app-api-state-verification\.js/u);
});
