import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractMigrationBody, validateCatalogAuditSql } from "./schema-verification.js";
import { buildCaptureCatalogAudit, buildPostBootstrapCatalogAudit, postBootstrapSummary } from "./post-bootstrap-catalog.js";

const audit = readFileSync(
  new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url),
  "utf8",
).toLowerCase();
const runner = readFileSync(
  new URL("../../src/operations/run-post-p2-app-api-state-verification.ts", import.meta.url),
  "utf8",
).toLowerCase();
const apiPackage = readFileSync(new URL("../../package.json", import.meta.url), "utf8").toLowerCase();

test("post-bootstrap audit extends the pinned baseline without relaxing security", () => {
  const base = readFileSync(new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url), "utf8");
  const derived = buildPostBootstrapCatalogAudit(base);
  assert.deepEqual(postBootstrapSummary, { securedTables: 27, policies: 5, securityDefinerFunctions: 36 });
  assert.equal(buildPostBootstrapCatalogAudit(base.replaceAll("\n", "\r\n")), derived);
  assert.throws(() => buildPostBootstrapCatalogAudit(`${base}\n`), /BASE_AUDIT_REJECTED/u);
  for (const name of ["is_system_admin", "provision_system_restaurant", "preflight_system_restaurant", "read_system_onboarding_operation", "list_system_restaurants", "disable_system_restaurant"]) {
    assert.equal(derived.split(`pg_catalog.to_regprocedure('app_private.${name}(`).length - 1, 2);
  }
  assert.match(derived, /'system_admins','system_onboarding_operations'/u);
  assert.equal(derived.split(") <> 27").length - 1, 2);
  assert.match(derived, /\) <> 36/u);
  assert.match(derived, /\) <> 38/u);
  assert.match(derived, /expected_security_definer_functions\[28\]/u);
  assert.match(derived, /POST_P2_TABLE_GRANTS_REJECTED/u);
  assert.doesNotMatch(derived, /\) <> (?:25|30|32)\b/u);
  assert.match(base, /\) <> 25/u);
});

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

test("capture target preserves the exact baseline and adds the protected table audit", () => {
  const base = readFileSync(new URL("../../../../supabase/tests/tenancy_memberships_post_p2.sql", import.meta.url), "utf8");
  const supplement = readFileSync(new URL("../../../../supabase/tests/capture_drafts_catalog.sql", import.meta.url), "utf8");
  const target = buildCaptureCatalogAudit(base, supplement);
  assert.equal(target.split(") <> 29").length - 1, 2);
  assert.match(target, /'system_admins','system_onboarding_operations','capture_drafts','capture_command_events'/u);
  assert.match(target, /CAPTURE_CONSTRAINT_SURFACE_REJECTED/u);
  assert.match(target, /CAPTURE_TABLE_GRANTS_REJECTED/u);
  assert.match(target, /\) <> 38/u);
  assert.match(target, /\) <> 40/u);
  assert.doesNotMatch(target, /\) <> 27/u);
  const captureRunner = readFileSync(new URL("../../src/operations/run-capture-schema-verification.ts", import.meta.url), "utf8");
  assert.match(captureRunner, /baseSummary: postBootstrapSummary/u);
  assert.match(captureRunner, /readSchemaVerificationConfig\(process.env\)/u);
  assert.match(apiPackage, /verify:capture-schema:rollback/u);
});

test("capture fixture assertions run inside the rollback migration, never the read-only audit", () => {
  const fixture = readFileSync(new URL("../../../../supabase/tests/capture_drafts_invariants.sql", import.meta.url), "utf8");
  assert.doesNotThrow(() => extractMigrationBody(fixture));
  assert.match(fixture, /get stacked diagnostics actual_constraint = constraint_name/u);
  assert.match(fixture, /checks <> 16/u);
  assert.match(fixture, /journal_checks <> 10/u);
  assert.match(fixture, /CAPTURE_JOURNAL_DUPLICATE_COMMAND_ACCEPTED/u);
  assert.match(fixture, /CAPTURE_JOURNAL_DUPLICATE_VERSION_ACCEPTED/u);
  assert.match(fixture, /CAPTURE_TEST_INVALID_WRITE_ACCEPTED/u);
  assert.match(fixture, /CAPTURE_TEST_POSITIVE_PATH_REJECTED/u);
  assert.match(fixture, /where restaurant_id = \$1 and branch_id = \$2 and id = \$3/u);
  assert.doesNotMatch(fixture, /(?:insert into|update|delete from) auth\./u);
  const captureRunner = readFileSync(new URL("../../src/operations/run-capture-schema-verification.ts", import.meta.url), "utf8");
  assert.match(captureRunner, /migrationSql: `begin;/u);
  assert.match(captureRunner, /extractMigrationBody\(readFileSync\(new URL\("\.\.\/\.\.\/\.\.\/\.\.\/supabase\/tests\/capture_drafts_invariants.sql/u);
  assert.match(captureRunner, /targetCatalogAuditSql: buildCaptureCatalogAudit\(base, supplement\)/u);
});

test("capture journal schema scopes actor and replay history without granting direct writes", () => {
  const migration = readFileSync(new URL("../../../../supabase/migrations/20260916000200_create_capture_command_journal.sql", import.meta.url), "utf8");
  assert.doesNotThrow(() => extractMigrationBody(migration));
  assert.match(migration, /foreign key \(restaurant_id, branch_id, actor_membership_id, actor_id\)/u);
  assert.match(migration, /unique \(actor_id, restaurant_id, branch_id, idempotency_key\)/u);
  assert.match(migration, /unique \(restaurant_id, branch_id, capture_draft_id, result_version\)/u);
  assert.match(migration, /command_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /result_version = expected_version \+ 1/u);
  assert.match(migration, /force row level security/u);
  assert.match(migration, /revoke all on app.capture_command_events from public, anon, authenticated, service_role, app_api/u);
  assert.doesNotMatch(migration, /grant (?:all|select|insert|update|delete)/u);
});

test("private capture creation binds replay, locks authorization and rolls back event collisions", () => {
  const migration = readFileSync(new URL("../../../../supabase/migrations/20260916000300_create_capture_draft_command.sql", import.meta.url), "utf8");
  assert.doesNotThrow(() => extractMigrationBody(migration));
  assert.match(migration, /security definer set search_path = ''/u);
  assert.match(migration, /for share of m, b, r, g/u);
  assert.match(migration, /pg_catalog.sha256\(convert_to\(p_command::text \|\| ':' \|\| p_actor_id::text/u);
  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(migration, /stored.command_fingerprint <> fingerprint/u);
  assert.match(migration, /exception when unique_violation then/u);
  assert.match(migration, /grant execute on function app_private.create_capture_draft\(uuid,jsonb\) to app_api/u);
  assert.match(migration, /revoke all on function app_private.create_capture_draft\(uuid,jsonb\) from public, anon, authenticated, service_role, app_api/u);
});

test("attention writer limits operations and checks CAS plus authoritative lease after row lock", () => {
  const sql = readFileSync(new URL("../../../../supabase/migrations/20260916000400_create_capture_attention_command.sql", import.meta.url), "utf8");
  assert.doesNotThrow(() => extractMigrationBody(sql));
  assert.match(sql, /p_operation not in \('capture.held','capture.claimed','capture.resumed','capture.recovery_preference_changed'\)/u);
  assert.match(sql, /current_capture.version <> expected/u);
  assert.match(sql, /attention_lease_id is distinct from requested_lease/u);
  assert.match(sql, /attention_lease_expires_at <= observed/u);
  assert.ok(sql.indexOf("for update;") < sql.indexOf("observed := greatest"));
  assert.match(sql, /stored.result_capture/u);
  assert.match(sql, /exception when unique_violation then return/u);
  assert.match(sql, /for share of m,b,r,g/u);
  assert.match(sql, /revoke all on function app_private.mutate_capture_attention/u);
});

test("post-P2 state runner uses the pinned profile for both stable lifecycle states", () => {
  assert.match(runner, /auditprofile: "post_p2_v1"/u);
  assert.match(runner, /tenancy_memberships_post_p2\.sql/u);
  assert.match(runner, /precheckauditsql: catalogauditsql/u);
  assert.match(runner, /runtimeauditsql: catalogauditsql/u);
  assert.match(apiPackage, /"verify:post-p2-app-api-state:remote"/u);
  assert.match(apiPackage, /run-post-p2-app-api-state-verification\.js/u);
});
