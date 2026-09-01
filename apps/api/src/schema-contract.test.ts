import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MEMBERSHIP_ROLE_CODES } from "@super-restaurant/shared-types";

import { RBAC_ROLE_PERMISSIONS_V1 } from "./auth/rbac-policy.js";

const migrationUrl = new URL("../../../supabase/migrations/20260830000100_create_tenancy_memberships.sql", import.meta.url);
const migration = readFileSync(migrationUrl, "utf8").toLowerCase();
const membershipDirectoryMigration = readFileSync(
  new URL("../../../supabase/migrations/20260830000200_list_active_branch_memberships.sql", import.meta.url),
  "utf8",
).toLowerCase();
const diningZonesMigration = readFileSync(
  new URL("../../../supabase/migrations/20260831000100_create_dining_zones.sql", import.meta.url),
  "utf8",
).toLowerCase();
const diningZonesCatalogAudit = readFileSync(
  new URL("../../../supabase/tests/dining_zones_catalog.sql", import.meta.url),
  "utf8",
).toLowerCase();
const diningTablesMigration = readFileSync(
  new URL("../../../supabase/migrations/20260901000100_create_dining_tables_layout.sql", import.meta.url),
  "utf8",
).toLowerCase();
const diningTablesCatalogAudit = readFileSync(
  new URL("../../../supabase/tests/dining_tables_layout_catalog.sql", import.meta.url),
  "utf8",
).toLowerCase();
const catalogAudit = readFileSync(
  new URL("../../../supabase/tests/tenancy_memberships_catalog.sql", import.meta.url),
  "utf8",
).toLowerCase();
const supabaseConfig = readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8").toLowerCase();
const runtimeCatalogAudit = readFileSync(
  new URL("../../../supabase/tests/tenancy_memberships_runtime_catalog.sql", import.meta.url),
  "utf8",
).toLowerCase();
const postDiningZonesCatalogAudit = readFileSync(
  new URL(
    "../../../supabase/tests/tenancy_memberships_post_dining_zones_catalog.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const postDiningZonesRuntimeCatalogAudit = readFileSync(
  new URL(
    "../../../supabase/tests/tenancy_memberships_post_dining_zones_runtime_catalog.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();
const diningZonesRemoteRunner = readFileSync(
  new URL("./operations/run-dining-zones-tenancy-verification.js", import.meta.url),
  "utf8",
).toLowerCase();
const diningTablesRemoteRunner = readFileSync(
  new URL("./operations/run-dining-tables-tenancy-verification.js", import.meta.url),
  "utf8",
).toLowerCase();
const protectedWebSmokeRunner = readFileSync(
  new URL("./operations/run-web-protected-smoke.js", import.meta.url),
  "utf8",
).toLowerCase();
const apiPackage = readFileSync(new URL("../package.json", import.meta.url), "utf8").toLowerCase();

test("product migration is independent from the ADR-010 spike and models exact historical scope", () => {
  assert.equal(migration.includes("adr010_b"), false);
  assert.match(migration, /create table app\.memberships/u);
  assert.match(migration, /foreign key \(restaurant_id, branch_id\)/u);
  assert.match(migration, /where revoked_at is null/u);
  assert.match(migration, /create table app\.membership_role_grants/u);
  for (const role of ["owner", "admin", "manager", "supervisor", "cashier", "waiter", "kitchen", "viewer", "auditor"]) {
    assert.match(migration, new RegExp(`\\('${role}'\\)`, "u"));
  }
});

test("every product table has RLS and FORCE RLS with read-only authenticated grants", () => {
  for (const table of ["roles", "restaurants", "branches", "memberships", "membership_role_grants"]) {
    assert.match(migration, new RegExp(`alter table app\\.${table} enable row level security`, "u"));
    assert.match(migration, new RegExp(`alter table app\\.${table} force row level security`, "u"));
  }
  assert.match(migration, /grant select on app\.roles, app\.restaurants, app\.branches, app\.memberships, app\.membership_role_grants to authenticated/u);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all).* to (anon|authenticated|service_role)/u);
  assert.match(migration, /revoke all on all tables in schema app from public, anon, authenticated, service_role/u);
});

test("private and RLS helpers are hardened and only the dedicated API role can execute the lookup", () => {
  assert.match(migration, /create role app_api nologin[\s\S]*nobypassrls/u);
  assert.match(migration, /if existing_role is not null then[\s\S]*app_api_role_collision/u);
  assert.match(migration, /comment on role app_api is 'superrestaurant dedicated api capability role'/u);
  assert.doesNotMatch(migration, /revoke app_api/u);
  assert.match(migration, /create or replace function app_private\.find_active_branch_membership/u);
  assert.match(migration, /security definer\s+set search_path = ''/u);
  assert.match(migration, /where rolname = 'postgres' and rolbypassrls/u);
  for (const signature of [
    "app_rls.has_active_restaurant_membership\\(uuid\\)",
    "app_rls.has_active_branch_membership\\(uuid, uuid\\)",
    "app_rls.can_read_membership\\(uuid\\)",
    "app_private.find_active_branch_membership\\(uuid, uuid, uuid\\)",
  ]) {
    assert.match(migration, new RegExp(`alter function ${signature} owner to postgres`, "u"));
  }
  assert.match(migration, /revoke all on all functions in schema app_rls, app_private from public, anon, authenticated, service_role/u);
  assert.match(migration, /grant execute on function app_private\.find_active_branch_membership\(uuid, uuid, uuid\) to app_api/u);
  assert.doesNotMatch(migration, /grant execute on function app_private\.find_active_branch_membership[^;]+to (anon|authenticated|service_role)/u);
});

test("Data API exposes app but never app_private or app_rls", () => {
  assert.match(supabaseConfig, /schemas\s*=\s*\["public", "graphql_public", "app"\]/u);
  const exposedSchemas = /^schemas\s*=.*$/gmu.exec(supabaseConfig)?.[0] ?? "";
  assert.equal(exposedSchemas.includes("app_private"), false);
  assert.equal(exposedSchemas.includes("app_rls"), false);
});

test("membership directory migration adds one bounded server-only capability", () => {
  assert.match(membershipDirectoryMigration, /^begin;/u);
  assert.match(membershipDirectoryMigration, /create function app_private\.list_active_branch_memberships\(actor_id uuid\)/u);
  assert.doesNotMatch(membershipDirectoryMigration, /create or replace function/u);
  for (const field of ["restaurant_id uuid", "restaurant_name text", "branch_id uuid", "branch_name text", "roles text[]"]) {
    assert.equal(membershipDirectoryMigration.includes(field), true);
  }
  assert.match(membershipDirectoryMigration, /security definer\s+set search_path = ''/u);
  assert.match(membershipDirectoryMigration, /where m\.user_id = actor_id\s+and m\.revoked_at is null/u);
  assert.match(membershipDirectoryMigration, /r\.disabled_at is null/u);
  assert.match(membershipDirectoryMigration, /b\.restaurant_id = m\.restaurant_id\s+and b\.disabled_at is null/u);
  assert.match(membershipDirectoryMigration, /rg\.revoked_at is null/u);
  assert.match(membershipDirectoryMigration, /array_agg\(distinct rg\.role_code order by rg\.role_code\)/u);
  assert.match(membershipDirectoryMigration, /order by m\.restaurant_id, m\.branch_id\s+limit 501/u);
  assert.match(membershipDirectoryMigration, /alter function app_private\.list_active_branch_memberships\(uuid\) owner to postgres/u);
  assert.match(
    membershipDirectoryMigration,
    /revoke all on function app_private\.list_active_branch_memberships\(uuid\)\s+from public, anon, authenticated, service_role, app_api/u,
  );
  assert.match(
    membershipDirectoryMigration,
    /grant execute on function app_private\.list_active_branch_memberships\(uuid\) to app_api/u,
  );
  assert.doesNotMatch(membershipDirectoryMigration, /grant (?:select|insert|update|delete|all) on/u);
  assert.match(membershipDirectoryMigration, /commit;\s*$/u);
});

test("catalog audits require the exact expanded app_api function surface", () => {
  for (const audit of [catalogAudit, runtimeCatalogAudit]) {
    assert.match(audit, /app_private\.find_active_branch_membership\(uuid,uuid,uuid\)/u);
    assert.match(audit, /app_private\.list_active_branch_memberships\(uuid\)/u);
    assert.match(audit, /array\[lookup_function, directory_function\]::oid\[\]/u);
    assert.match(audit, /app_api_extra_function/u);
    assert.match(audit, /directory_function is null/u);
    assert.match(audit, /secured_functions <> 5/u);
    assert.match(audit, /has_function_privilege\('anon', directory_function, 'execute'\)/u);
    assert.doesNotMatch(audit, /expected_secured_functions/u);
  }
});

test("post-dining-zones audits pin the exact seven-table and six-function surface", () => {
  for (const audit of [postDiningZonesCatalogAudit, postDiningZonesRuntimeCatalogAudit]) {
    assert.match(audit, /\) <> 7/u);
    assert.match(audit, /\) <> 6/u);
    assert.match(audit, /app_private\.create_dining_zone\(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text\)/u);
    assert.match(audit, /dining_zone_audit_events/u);
    assert.match(audit, /app_api_extra_function/u);
    assert.match(audit, /public_execute_rejected/u);
    assert.doesNotMatch(audit, /expected_secured_(?:tables|functions)/u);
  }
  assert.match(postDiningZonesCatalogAudit, /rolcanlogin/u);
  assert.match(postDiningZonesCatalogAudit, /rolpassword is not null/u);
  assert.match(postDiningZonesRuntimeCatalogAudit, /not rolcanlogin/u);
  assert.match(postDiningZonesRuntimeCatalogAudit, /scram-sha-256/u);
});

test("remote dining-zone E2E reuses the marked tenancy harness and post-migration audit", () => {
  assert.match(diningZonesRemoteRunner, /runtenancyverification/u);
  assert.match(diningZonesRemoteRunner, /tenancy_memberships_post_dining_zones_runtime_catalog\.sql/u);
  assert.match(diningZonesRemoteRunner, /verifydiningzones: true/u);
  assert.match(apiPackage, /"verify:dining-zones:remote"/u);
  assert.match(apiPackage, /run-dining-zones-tenancy-verification\.js/u);
});

test("protected web smoke reuses marked fixtures, post-migration audit and cleanup", () => {
  assert.match(protectedWebSmokeRunner, /runtenancyverification/u);
  assert.match(
    protectedWebSmokeRunner,
    /tenancy_memberships_post_dining_zones_runtime_catalog\.sql/u,
  );
  assert.match(protectedWebSmokeRunner, /createwebprotectedsmokecoordinator/u);
  assert.match(protectedWebSmokeRunner, /verifydiningzones:\s*true/u);
  assert.match(apiPackage, /"verify:web-protected-smoke:remote"/u);
  assert.match(apiPackage, /run-web-protected-smoke\.js/u);
});

test("runtime audit permits only the provisioned app_api login capability", () => {
  assert.match(runtimeCatalogAudit, /not rolcanlogin/u);
  for (const forbiddenAttribute of [
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolinherit",
    "rolreplication",
    "rolbypassrls",
  ]) {
    assert.match(runtimeCatalogAudit, new RegExp(forbiddenAttribute, "u"));
  }
  assert.match(runtimeCatalogAudit, /pg_auth_members/u);
  assert.match(runtimeCatalogAudit, /grantor_role\.rolname = 'supabase_admin'/u);
  assert.match(runtimeCatalogAudit, /not membership\.inherit_option/u);
  assert.match(runtimeCatalogAudit, /not membership\.set_option/u);
  assert.match(runtimeCatalogAudit, /runtime_audit_app_api_extra_function/u);
  assert.match(runtimeCatalogAudit, /runtime_audit_app_api_table_grants/u);
  assert.match(runtimeCatalogAudit, /owner\.rolname = 'postgres'/u);
  assert.match(runtimeCatalogAudit, /owner\.rolbypassrls/u);
  assert.match(runtimeCatalogAudit, /rolpassword not like 'scram-sha-256\$%'/u);
  assert.match(runtimeCatalogAudit, /rolvaliduntil is distinct from 'infinity'/u);
  assert.match(runtimeCatalogAudit, /rolconnlimit <> -1/u);
  assert.match(runtimeCatalogAudit, /rolconfig is not null/u);
  assert.match(runtimeCatalogAudit, /pg_stat_activity where usename = 'app_api'/u);
  assert.match(runtimeCatalogAudit, /runtime_audit_app_api_owns_objects/u);
});

test("dining-zone migration is atomic, scoped, idempotent, audited and server-only", () => {
  assert.deepEqual(
    MEMBERSHIP_ROLE_CODES.filter((role) => RBAC_ROLE_PERMISSIONS_V1[role].includes("tables.manage")),
    ["owner", "admin", "manager"],
  );
  assert.match(diningZonesMigration, /^begin;/u);
  assert.match(diningZonesMigration, /create table app\.dining_zones/u);
  assert.match(diningZonesMigration, /foreign key \(restaurant_id, branch_id\)[\s\S]*references app\.branches/u);
  assert.match(diningZonesMigration, /unique \(restaurant_id, branch_id, name_key\)/u);
  assert.match(diningZonesMigration, /create table app\.dining_zone_audit_events/u);
  assert.match(diningZonesMigration, /unique \(actor_id, restaurant_id, branch_id, idempotency_key\)/u);
  assert.match(diningZonesMigration, /create function app_private\.create_dining_zone/u);
  assert.match(diningZonesMigration, /rg\.role_code in \('owner', 'admin', 'manager'\)/u);
  assert.match(diningZonesMigration, /pg_advisory_xact_lock/u);
  assert.match(diningZonesMigration, /on conflict do nothing/u);
  assert.match(diningZonesMigration, /security definer\s+set search_path = ''/u);
  assert.match(diningZonesMigration, /owner to postgres/u);
  assert.match(diningZonesMigration, /grant execute on function app_private\.create_dining_zone[\s\S]*to app_api/u);
  assert.doesNotMatch(diningZonesMigration, /grant (?:select|insert|update|delete|all) on app\.dining/u);
  for (const table of ["dining_zones", "dining_zone_audit_events"]) {
    assert.match(diningZonesMigration, new RegExp(`alter table app\\.${table} enable row level security`, "u"));
    assert.match(diningZonesMigration, new RegExp(`alter table app\\.${table} force row level security`, "u"));
  }
  assert.match(diningZonesMigration, /commit;\s*$/u);
});

test("dining-zone catalog audit pins RLS, owner, search_path and grants", () => {
  assert.match(diningZonesCatalogAudit, /dining_zones_audit_table_missing/u);
  assert.match(diningZonesCatalogAudit, /c\.relrowsecurity/u);
  assert.match(diningZonesCatalogAudit, /c\.relforcerowsecurity/u);
  assert.match(diningZonesCatalogAudit, /p\.prosecdef/u);
  assert.match(diningZonesCatalogAudit, /p\.provolatile = 'v'/u);
  assert.match(diningZonesCatalogAudit, /owner\.rolname = 'postgres'/u);
  assert.match(diningZonesCatalogAudit, /has_function_privilege\('app_api', function_oid, 'execute'\)/u);
  assert.match(diningZonesCatalogAudit, /has_table_privilege\(grantee_name, table_name, privilege_name\)/u);
});

test("remote dining-table E2E reuses the recoverable tenancy harness and global audit", () => {
  assert.match(diningTablesRemoteRunner, /runtenancyverification/u);
  assert.match(diningTablesRemoteRunner, /tenancy_memberships_post_dining_tables_catalog\.sql/u);
  assert.match(diningTablesRemoteRunner, /verifydiningtables: true/u);
  assert.match(apiPackage, /"verify:dining-tables:remote"/u);
  assert.match(apiPackage, /run-dining-tables-tenancy-verification\.js/u);
});

test("dining-table layout migration is scoped, optimistic, idempotent and server-only", () => {
  assert.match(diningTablesMigration, /^begin;/u);
  assert.match(diningTablesMigration, /create table app\.dining_tables/u);
  assert.match(diningTablesMigration, /references app\.dining_zones \(restaurant_id, branch_id, id\)/u);
  assert.match(diningTablesMigration, /layout_x \+ layout_width <= 24/u);
  assert.match(diningTablesMigration, /create table app\.dining_table_audit_events/u);
  assert.match(diningTablesMigration, /unique \(actor_id, restaurant_id, branch_id, idempotency_key\)/u);
  assert.match(diningTablesMigration, /create function app_private\.list_dining_layout/u);
  assert.match(diningTablesMigration, /create function app_private\.create_dining_table/u);
  assert.match(diningTablesMigration, /create function app_private\.update_dining_table_layout/u);
  assert.match(diningTablesMigration, /version=p_expected_version/u);
  assert.match(diningTablesMigration, /pg_advisory_xact_lock/u);
  assert.match(diningTablesMigration, /security definer set search_path = ''/u);
  assert.match(diningTablesMigration, /grant execute on function app_private\.list_dining_layout[\s\S]*to app_api/u);
  assert.doesNotMatch(diningTablesMigration, /grant (?:select|insert|update|delete|all) on app\.dining/u);
  for (const table of ["dining_tables", "dining_table_audit_events"]) {
    assert.match(diningTablesMigration, new RegExp(`alter table app\\.${table} enable row level security`, "u"));
    assert.match(diningTablesMigration, new RegExp(`alter table app\\.${table} force row level security`, "u"));
  }
  assert.match(diningTablesMigration, /commit;\s*$/u);
  assert.match(diningTablesCatalogAudit, /dining_tables_audit_table_missing/u);
  assert.match(diningTablesCatalogAudit, /dining_tables_audit_function_rejected/u);
  assert.match(apiPackage, /verify:dining-tables-layout-schema:rollback/u);
});

test("post-dining-tables catalog audit pins the exact global table and function surface", () => {
  const audit = readFileSync(
    new URL("../../../supabase/tests/tenancy_memberships_post_dining_tables_catalog.sql", import.meta.url),
    "utf8",
  );
  assert.match(audit, /POST_DINING_TABLES_REQUIRED_OBJECT_MISSING/u);
  assert.match(audit, /\) <> 9/u);
  assert.match(audit, /dining_table_audit_events/u);
  assert.match(audit, /app_private\.update_dining_table_layout/u);
  assert.match(audit, /POST_DINING_TABLES_APP_API_EXTRA_FUNCTION/u);
});

test("dining-table lint fix qualifies replay and optimistic-update columns", () => {
  const migration = readFileSync(
    new URL("../../../supabase/migrations/20260901000200_qualify_dining_table_function_columns.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /select audit\.\* into existing_audit/u);
  assert.match(migration, /audit\.restaurant_id=p_restaurant_id/u);
  assert.match(migration, /dining_table\.version=p_expected_version/u);
  assert.doesNotMatch(migration, /where actor_id=p_actor_id/u);
});
