import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL("../../../supabase/migrations/20260830000100_create_tenancy_memberships.sql", import.meta.url);
const migration = readFileSync(migrationUrl, "utf8").toLowerCase();
const membershipDirectoryMigration = readFileSync(
  new URL("../../../supabase/migrations/20260830000200_list_active_branch_memberships.sql", import.meta.url),
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

test("catalog audits accept only the old or exact expanded app_api function surface", () => {
  for (const audit of [catalogAudit, runtimeCatalogAudit]) {
    assert.match(audit, /app_private\.find_active_branch_membership\(uuid,uuid,uuid\)/u);
    assert.match(audit, /app_private\.list_active_branch_memberships\(uuid\)/u);
    assert.match(audit, /array\[lookup_function, directory_function\]::oid\[\]/u);
    assert.match(audit, /app_api_extra_function/u);
    assert.match(audit, /expected_secured_functions := expected_secured_functions \+ 1/u);
  }
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
