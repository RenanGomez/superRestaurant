import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the menu-shared-modifier-groups candidate migration.
// No env URLs/PGHOST, remote configuration, services or global installation. Each invocation owns a
// brand-new disposable cluster and stops it in `finally`; nothing here ever touches Supabase or a
// shared database. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_MENU_SHARED_MODIFIER_GROUPS_ONLY";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cache = join(root, ".cache", "postgres-local");
const binaries = join(cache, "pgsql", "bin");
const runId = randomUUID().replaceAll("-", "");
const runDirectory = join(cache, runId);
const data = join(runDirectory, "data");
const passwordFile = join(runDirectory, "password.tmp");
const database = `superrestaurant_menu_shared_groups_${runId}`;
const candidateName = "20261101000200_menu_shared_modifier_groups.sql";
let clusterCreated = false;
let started = false;
let stopped = true;
let admin: Client | undefined;
let stage = "configuration";
let failed = false;

const SUMMARY_SQL = `select
  (select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity) as "securedTables",
  (select count(*)::integer from pg_catalog.pg_policies where schemaname='app') as policies,
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app_rls','app_private') and p.prosecdef) as "securityDefinerFunctions"`;

// Legacy data written BEFORE the migration: it must be backfilled to exactly its original owner.
const SEED_LEGACY_SQL = `do $seed$
declare
  r uuid := gen_random_uuid(); c uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  actor uuid := (select id from auth.users order by id limit 1);
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
begin
  insert into app.restaurants(id,name,time_zone) values(r,'rollback-only legacy shared groups','America/Hermosillo');
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(r,r,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order) values(r,r,cat,'Comida',true,0);
  insert into app.menu_products(restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor)
    values (r,r,p1,cat,'Uno',null,true,0,'kitchen','piece',100),(r,r,p2,cat,'Dos',null,true,1,'kitchen','piece',100);
  insert into app.menu_modifier_groups(restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity)
    values (r,r,gen_random_uuid(),p1,'A',true,0,0,1),(r,r,gen_random_uuid(),p1,'B',true,1,0,1),(r,r,gen_random_uuid(),p2,'C',true,0,0,1);
end $seed$`;

const CHECK_BACKFILL_SQL = `select
  (select count(*)::integer from app.menu_modifier_groups where product_id is not null) as "legacyGroups",
  (select count(*)::integer from app.menu_product_modifier_groups) as assignments,
  (select count(*)::integer from app.menu_modifier_groups g where g.product_id is not null and not exists (
    select 1 from app.menu_product_modifier_groups a where a.restaurant_id=g.restaurant_id and a.catalog_id=g.catalog_id
      and a.product_id=g.product_id and a.group_id=g.id)) as "unassignedLegacy"`;

function executable(name: string): string {
  const path = realpathSync(join(binaries, `${name}.exe`));
  if (!path.toLowerCase().startsWith(`${realpathSync(cache).toLowerCase()}\\`)) throw new Error("LOCAL_BINARY_PATH_REJECTED");
  return path;
}
function run(name: string, args: readonly string[]): void {
  const result = spawnSync(executable(name), [...args], { windowsHide: true, timeout: 60_000, stdio: "ignore" });
  if (result.status !== 0 || result.error !== undefined) throw new Error("LOCAL_PROCESS_FAILED");
}
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ok); });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("LOCAL_PORT_REJECTED");
  await new Promise<void>((ok, reject) => server.close((error) => error === undefined ? ok() : reject(error)));
  return address.port;
}

try {
  if (process.platform !== "win32" || process.argv.slice(2).join(" ") !== "--local-disposable-only") throw new Error("LOCAL_CONFIRMATION_REQUIRED");
  const version = spawnSync(executable("postgres"), ["--version"], { windowsHide: true, encoding: "utf8", timeout: 5000 });
  if (version.status !== 0 || !/^postgres \(PostgreSQL\) 17\./u.test(version.stdout.trim())) throw new Error("LOCAL_PG17_REQUIRED");
  mkdirSync(runDirectory, { recursive: true });
  const password = randomBytes(32).toString("base64url");
  writeFileSync(passwordFile, password, { flag: "wx" });
  const port = await availablePort();
  stage = "initdb";
  run("initdb", ["-D", data, "-U", "postgres", "--auth-host=scram-sha-256", "--auth-local=scram-sha-256",
    "--pwfile", passwordFile, "--encoding=UTF8", "--locale=C"]);
  clusterCreated = true;
  unlinkSync(passwordFile);
  stage = "start";
  stopped = false;
  run("pg_ctl", ["-D", data, "-l", join(runDirectory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30", "start"]);
  started = true;
  const config = { host: "127.0.0.1" as const, port, user: "postgres", password,
    connectionTimeoutMillis: 5000, query_timeout: 30_000, statement_timeout: 30_000 };
  stage = "bootstrap";
  admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();
  admin = new Client({ ...config, database });
  await admin.connect();
  await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';`);
  const migrations = join(root, "supabase", "migrations");
  const names = readdirSync(migrations).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name)).sort();
  const candidateIndex = names.indexOf(candidateName);
  if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
  if (names[candidateIndex - 1] !== "20261101000100_menu_category_appearance.sql") throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  const priorNames = names.slice(0, candidateIndex);
  const actorId = randomUUID();
  stage = "apply_prior_migrations";
  for (const name of priorNames) await admin.query(readFileSync(join(migrations, name), "utf8"));
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-menu-shared-groups@invalid.test')", [actorId]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try {
    baseline = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  const candidateSql = readFileSync(join(migrations, candidateName), "utf8");
  const tests = join(root, "supabase", "tests");
  const invariantsSql = readFileSync(join(tests, "menu_shared_modifier_groups_invariants.sql"), "utf8");
  // Regression: the half-and-half suites insert groups with the legacy owner and must keep passing.
  const regressionSql = [
    "catalog_halves_invariants.sql",
    "catalog_halves_product_level_invariants.sql",
  ].map((name) => readFileSync(join(tests, name), "utf8"));

  stage = "migrated";
  await admin.query("BEGIN");
  let migrated;
  let backfill;
  let migrationFailure: unknown;
  try {
    await admin.query(SEED_LEGACY_SQL);
    await admin.query(extractMigrationBody(candidateSql));
    migrated = (await admin.query(SUMMARY_SQL)).rows[0];
    backfill = (await admin.query(CHECK_BACKFILL_SQL)).rows[0];
    assert.deepEqual(backfill, { legacyGroups: 3, assignments: 3, unassignedLegacy: 0 });
    await admin.query(extractMigrationBody(invariantsSql));
    for (const sql of regressionSql) await admin.query(extractMigrationBody(sql));
  } catch (error: unknown) {
    migrationFailure = error;
  } finally { await admin.query("ROLLBACK"); }

  stage = "postcheck";
  await admin.query("BEGIN READ ONLY");
  let postcheck;
  try {
    postcheck = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  if (migrationFailure !== undefined) { stage = "migrated"; throw migrationFailure; }
  // Exactly one new RLS-forced table (deny-by-default, no policy) and two SECURITY DEFINER trigger functions.
  assert.deepEqual(baseline, postcheck);
  assert.equal(migrated.securedTables, baseline.securedTables + 1);
  assert.equal(migrated.policies, baseline.policies);
  assert.equal(migrated.securityDefinerFunctions, baseline.securityDefinerFunctions + 2);

  process.stdout.write(`${JSON.stringify({
    stage: "menu_shared_modifier_groups_rollback", status: "ok", runId,
    priorMigrationsApplied: priorNames.length, baseline, migrated, postcheck, backfill,
  })}\n`);
} catch (error: unknown) {
  failed = true;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const localInvariant = typeof error === "object" && error !== null && "message" in error
    && typeof error.message === "string" && /^[A-Z_0-9]+$/u.test(error.message) ? error.message : undefined;
  const detail = typeof error === "object" && error !== null && "detail" in error ? error.detail : undefined;
  const constraint = typeof error === "object" && error !== null && "constraint" in error ? error.constraint : undefined;
  const message = error instanceof Error ? error.message : undefined;
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_MENU_SHARED_GROUPS_FAILED",
    ...(typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? { sqlState: code } : {}),
    ...(localInvariant === undefined ? {} : { invariant: localInvariant }),
    detail, constraint, message })}\n`);
} finally {
  try { await admin?.end(); } catch { failed = true; }
  if (clusterCreated) {
    try { run("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "30", "stop"]); started = false; stopped = true; }
    catch { if (started || stage === "start") failed = true; }
  }
  try { if (existsSync(passwordFile)) unlinkSync(passwordFile); } catch { failed = true; }
  process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: failed ? "failed" : "ok", stopped, runId, marker })}\n`);
  if (failed) process.exitCode = 1;
}
