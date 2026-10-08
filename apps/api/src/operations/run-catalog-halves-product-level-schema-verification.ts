import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the catalog-halves candidate migration. No env
// URLs/PGHOST, remote configuration, services or global installation. Each invocation owns a
// brand-new disposable cluster and stops it in `finally`; nothing here ever touches Supabase or a
// shared database. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_CATALOG_HALVES_PRODUCT_LEVEL_ONLY";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cache = join(root, ".cache", "postgres-local");
const binaries = join(cache, "pgsql", "bin");
const runId = randomUUID().replaceAll("-", "");
const runDirectory = join(cache, runId);
const data = join(runDirectory, "data");
const passwordFile = join(runDirectory, "password.tmp");
const database = `superrestaurant_catalog_halves_pl_${runId}`;
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

const TABLE_SQL = `select
  (select count(*)::integer from information_schema.columns
    where table_schema='app' and table_name='menu_products'
      and column_name in ('fraction_enabled','fraction_flavor_group_id','fraction_extra_group_id','fraction_excludable_ingredient_ids')) as "productColumns"`;

const SEED_LEGACY_SQL = `do $seed$
declare
  r uuid := gen_random_uuid(); c uuid := gen_random_uuid(); cat uuid := gen_random_uuid();
  b uuid := gen_random_uuid(); m uuid := gen_random_uuid(); actor uuid := (select id from auth.users order by id limit 1);
  p_same uuid := gen_random_uuid(); p_diff uuid := gen_random_uuid(); p_plain uuid := gen_random_uuid();
  gf uuid := gen_random_uuid(); ge uuid := gen_random_uuid();
  gd1 uuid := gen_random_uuid(); gd2 uuid := gen_random_uuid();
  gp uuid := gen_random_uuid();
begin
  insert into app.restaurants(id,name,time_zone) values(r,'rollback-only legacy halves','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(b,r,'rollback-only legacy halves branch');
  insert into app.memberships(id,user_id,restaurant_id,branch_id,granted_by) values(m,actor,r,b,actor);
  insert into app.membership_role_grants(membership_id,role_code,granted_by) values(m,'manager',actor);
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(c,r,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order) values(r,c,cat,'Comida',true,0);
  insert into app.menu_products(restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor)
    values (r,c,p_same,cat,'Same',null,true,0,'kitchen','piece',0),(r,c,p_diff,cat,'Diff',null,true,1,'kitchen','piece',0),
      (r,c,p_plain,cat,'Plain',null,true,2,'kitchen','piece',100);
  insert into app.menu_modifier_groups(restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity)
    values (r,c,gf,p_same,'Sabor',true,0,0,2),(r,c,ge,p_same,'Extras',true,1,0,5),
      (r,c,gd1,p_diff,'Sabor',true,0,0,2),(r,c,gd2,p_diff,'Otro',true,1,0,2),(r,c,gp,p_plain,'Notas',true,0,0,1);
  insert into app.menu_modifier_options(restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active)
    select r,c,g,gen_random_uuid(),'Op',0,true from unnest(array[gf,ge,gd1,gd2,gp]) as g;
  insert into app.menu_product_variants(restaurant_id,catalog_id,product_id,id,name,sku,unit_price_minor,active,display_order,
    fraction_enabled,fraction_flavor_group_id,fraction_extra_group_id,fraction_excludable_ingredient_ids) values
    (r,c,p_same,gen_random_uuid(),'Chica',null,10000,true,0,false,null,null,'{}'),
    (r,c,p_same,gen_random_uuid(),'Familiar',null,30000,true,2,true,gf,ge,array['cebolla','piña']),
    (r,c,p_same,gen_random_uuid(),'Grande',null,20000,true,1,true,gf,ge,array['cebolla','piña']),
    (r,c,p_diff,gen_random_uuid(),'Chica',null,10000,true,0,true,gd1,null,array['z']),
    (r,c,p_diff,gen_random_uuid(),'Grande',null,20000,true,1,true,gd2,null,array['z']),
    (r,c,p_plain,gen_random_uuid(),'Unica',null,100,true,0,false,null,null,'{}');
  insert into app.menu_catalog_heads(restaurant_id,catalog_id,version,updated_at,updated_by) values(r,c,1,now(),actor);
  create temp table legacy_seed(restaurant uuid, branch uuid, catalog uuid, actor uuid, same uuid, diff uuid, plain uuid,
    flavor uuid, extra uuid, diff_flavor uuid) on commit drop;
  insert into legacy_seed values (r, b, c, actor, p_same, p_diff, p_plain, gf, ge, gd1);
end $seed$`;

const CHECK_LEGACY_SQL = `do $check$
declare seed legacy_seed%rowtype; st jsonb; payload jsonb; save_status text;
begin
  select * into seed from legacy_seed;
  if not exists (
    select 1 from app.menu_products p
    where p.id = seed.same and p.fraction_enabled and p.fraction_flavor_group_id = seed.flavor
      and p.fraction_extra_group_id = seed.extra and p.fraction_excludable_ingredient_ids = array['cebolla','piña']
  ) then raise exception 'LEGACY_FRACTION_NOT_LIFTED_FROM_SIZES'; end if;
  -- Lifted sizes are disabled (one source) but keep their group columns.
  if exists (select 1 from app.menu_product_variants v where v.product_id = seed.same and v.fraction_enabled)
    or not exists (select 1 from app.menu_product_variants v where v.product_id = seed.same and v.fraction_flavor_group_id = seed.flavor)
  then raise exception 'LIFTED_SIZES_NOT_DISABLED_OR_COLUMNS_LOST'; end if;
  -- Sizes with differing setups stay untouched on legacy.
  if not exists (
    select 1 from app.menu_products p where p.id = seed.diff and not p.fraction_enabled and p.fraction_flavor_group_id is null
  ) or (select pg_catalog.count(*) from app.menu_product_variants v where v.product_id = seed.diff and v.fraction_enabled) <> 2
  then raise exception 'DIFFERING_SIZES_WERE_MIGRATED'; end if;
  -- Round trip: read the migrated state and save it as-is; it must be accepted.
  st := app_private.build_menu_catalog_state(seed.restaurant, seed.branch, seed.catalog, false);
  payload := pg_catalog.jsonb_build_object('categories', st#>'{catalog,categories}',
    'products', st#>'{catalog,products}', 'modifierGroups', st#>'{catalog,modifierGroups}');
  execute 'set local role app_api';
  select s.status into save_status from app_private.save_menu_catalog(seed.actor, seed.restaurant, seed.branch,
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now(), 1, gen_random_uuid(), 'MXN', payload) s;
  execute 'reset role';
  if save_status is distinct from 'saved' then raise exception 'MIGRATED_STATE_SAVE_AS_IS_REJECTED_%', save_status; end if;
  if not exists (
    select 1 from app.menu_products p
    where p.id = seed.plain and not p.fraction_enabled and p.fraction_flavor_group_id is null
      and p.fraction_extra_group_id is null and pg_catalog.cardinality(p.fraction_excludable_ingredient_ids) = 0
  ) then raise exception 'PRODUCT_WITHOUT_LEGACY_FRACTION_CHANGED'; end if;
end $check$`;

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
  // Minimal LOCAL Auth shim supplies FK targets only; no Auth provider is simulated. No Storage
  // extension schema either: the storage.* half of the candidate migration/invariants is a no-op
  // here by design (see header comment) and is verified only against a real Supabase project.
  await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';`);
  const migrations = join(root, "supabase", "migrations");
  const names = readdirSync(migrations).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name)).sort();
  const candidateName = "20261008000200_catalog_halves_product_level.sql";
  const candidateIndex = names.indexOf(candidateName);
  if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
  const priorNames = names.slice(0, candidateIndex);
  if (names[candidateIndex - 1] !== "20261008000100_dining_table_details.sql") throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  const actorId = randomUUID();
  stage = "apply_prior_migrations";
  for (const name of priorNames) await admin.query(readFileSync(join(migrations, name), "utf8"));
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-catalog-halves-pl@invalid.test')", [actorId]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try {
    baseline = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  const candidateSql = readFileSync(join(migrations, candidateName), "utf8");
  const invariantsSql = readFileSync(join(root, "supabase", "tests", "catalog_halves_product_level_invariants.sql"), "utf8");
  // The earlier halves invariants (legacy per-size setup) must keep passing on the new schema.
  const legacyInvariantsSql = readFileSync(join(root, "supabase", "tests", "catalog_halves_invariants.sql"), "utf8");

  stage = "migrated";
  await admin.query("BEGIN");
  let migrated;
  let productColumns;
  let migrationFailure: unknown;
  try {
    // Legacy data the migration must lift to the product: the FIRST enabled size (display order) donates.
    await admin.query(SEED_LEGACY_SQL);
    await admin.query(extractMigrationBody(candidateSql));
    migrated = (await admin.query(SUMMARY_SQL)).rows[0];
    productColumns = (await admin.query(TABLE_SQL)).rows[0];
    assert.deepEqual(productColumns, { productColumns: 4 });
    await admin.query(CHECK_LEGACY_SQL);
    await admin.query(extractMigrationBody(invariantsSql));
    await admin.query(extractMigrationBody(legacyInvariantsSql));
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
  // This candidate adds exactly one RLS-forced table (no policy: deny-by-default, API-only through
  // SECURITY DEFINER functions) and replaces existing functions, so it adds no new SECURITY DEFINER
  // function. The post-rollback `postcheck` must equal `baseline` exactly.
  assert.deepEqual(baseline, postcheck);
  assert.deepEqual(migrated, baseline);

  process.stdout.write(`${JSON.stringify({
    stage: "catalog_halves_product_level_rollback", status: "ok", runId,
    priorMigrationsApplied: priorNames.length, baseline, migrated, postcheck,
  })}\n`);
} catch (error: unknown) {
  failed = true;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const localInvariant = typeof error === "object" && error !== null && "message" in error
    && typeof error.message === "string" && /^[A-Z_]+$/u.test(error.message) ? error.message : undefined;
  const detail = typeof error === "object" && error !== null && "detail" in error ? error.detail : undefined;
  const constraint = typeof error === "object" && error !== null && "constraint" in error ? error.constraint : undefined;
  const message = error instanceof Error ? error.message : undefined;
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_CATALOG_HALVES_PL_FAILED",
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
