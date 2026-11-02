import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the menu-locked-ingredients candidate migration. No env
// URLs/PGHOST, remote configuration, services or global installation. Each invocation owns a
// brand-new disposable cluster and stops it in `finally`; nothing here ever touches Supabase or a
// shared database. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_MENU_LOCKED_INGREDIENTS_ONLY";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cache = join(root, ".cache", "postgres-local");
const binaries = join(cache, "pgsql", "bin");
const runId = randomUUID().replaceAll("-", "");
const runDirectory = join(cache, runId);
const data = join(runDirectory, "data");
const passwordFile = join(runDirectory, "password.tmp");
const database = `superrestaurant_menu_locked_ingredients_${runId}`;
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
    where table_schema='app' and table_name in ('menu_products','menu_product_variants')
      and column_name='fraction_locked_ingredient_option_ids') as "lockedColumns",
  (select count(*)::integer from pg_catalog.pg_constraint
    where conname in ('menu_products_fraction_locked_valid','menu_product_variants_fraction_locked_valid')) as "lockedChecks"`;

// These rows deliberately use the schema that existed immediately before the candidate. The
// candidate must migrate them; inserting equivalent fixtures after it would only test a copy of the
// backfill query. Fixed UUIDs make the expected option arrays explicit and stable.
const SEED_LEGACY_SQL = `do $seed$
declare
  actor uuid := (select id from auth.users where deleted_at is null order by id limit 1);
  r constant uuid := '10000000-0000-4000-8000-000000000001';
  b constant uuid := '10000000-0000-4000-8000-000000000002';
  c constant uuid := '10000000-0000-4000-8000-000000000003';
  category constant uuid := '10000000-0000-4000-8000-000000000004';
  confirmed_order constant uuid := '10000000-0000-4000-8000-000000000005';
begin
  if actor is null then raise exception 'LOCAL_LEGACY_ACTOR_REQUIRED'; end if;
  insert into app.restaurants(id,name,time_zone) values(r,'rollback-only legacy locked ingredients','America/Hermosillo');
  insert into app.branches(id,restaurant_id,name) values(b,r,'rollback-only legacy branch');
  insert into app.menu_catalogs(id,restaurant_id,version,currency,published_by) values(c,r,1,'MXN',actor);
  insert into app.menu_categories(restaurant_id,catalog_id,id,name,active,display_order)
    values(r,c,category,'Pizzas',true,0);
  insert into app.menu_products(
    restaurant_id,catalog_id,id,category_id,name,sku,active,display_order,station_id,unit,unit_price_minor,
    fraction_extra_group_id,fraction_excludable_ingredient_ids
  ) values
    (r,c,'20000000-0000-4000-8000-000000000001',category,'Mapeable',null,true,0,'kitchen','piece',100,
      '30000000-0000-4000-8000-000000000001',array['Cebolla']),
    (r,c,'20000000-0000-4000-8000-000000000002',category,'No mapeable',null,true,1,'kitchen','piece',100,
      '30000000-0000-4000-8000-000000000002',array['Fantasma']),
    (r,c,'20000000-0000-4000-8000-000000000003',category,'Ambigua',null,true,2,'kitchen','piece',100,
      '30000000-0000-4000-8000-000000000003',array['Cebolla']),
    (r,c,'20000000-0000-4000-8000-000000000004',category,'Lista vacia',null,true,3,'kitchen','piece',100,
      '30000000-0000-4000-8000-000000000004','{}'::text[]);
  insert into app.menu_modifier_groups(
    restaurant_id,catalog_id,id,product_id,name,active,display_order,minimum_quantity,maximum_quantity
  ) values
    (r,c,'30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Ingredientes',true,0,0,5),
    (r,c,'30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Ingredientes',true,0,0,5),
    (r,c,'30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','Ingredientes',true,0,0,5),
    (r,c,'30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004','Ingredientes',true,0,0,5);
  insert into app.menu_modifier_options(restaurant_id,catalog_id,group_id,id,name,unit_price_minor,active) values
    (r,c,'30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Cebolla',0,true),
    (r,c,'30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','Jamon',0,true),
    (r,c,'30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','Cebolla',0,true),
    (r,c,'30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000004','Jamon',0,true),
    (r,c,'30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000005','Cebolla',0,true),
    (r,c,'30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000006',' cebolla ',0,true),
    (r,c,'30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000007','Jamon',0,true),
    (r,c,'30000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000008','Cebolla',0,true),
    (r,c,'30000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000009','Jamon',0,true);
  insert into app.menu_product_variants(
    restaurant_id,catalog_id,product_id,id,name,sku,unit_price_minor,active,display_order,
    fraction_extra_group_id,fraction_excludable_ingredient_ids
  ) values(r,c,'20000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000001',
    'Grande',null,150,true,0,'30000000-0000-4000-8000-000000000004','{}'::text[]);
  insert into app.orders(id,restaurant_id,branch_id,channel,status,aggregate,version,created_by,updated_by)
  values(confirmed_order,r,b,'counter','open',pg_catalog.jsonb_build_object(
    'schemaVersion',1,'orderId',confirmed_order::text,'restaurantId',r::text,'branchId',b::text,
    'channel','counter','status','open','currency','MXN','timeZone','America/Hermosillo',
    'items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'orderItemId','60000000-0000-4000-8000-000000000001','snapshot',pg_catalog.jsonb_build_object(
        'catalogVersion',c::text,'productId','20000000-0000-4000-8000-000000000001','name','Pizza congelada',
        'stationId','kitchen','unit','piece','unitPrice',pg_catalog.jsonb_build_object('amountMinor',100,'currency','MXN'),
        'modifiers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'modifierId','exclude:half-a:Cebolla','name','Sin Cebolla','unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency','MXN'))),
        'geometry','halves','fractionBreakdown',pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('fraction','half-a','flavorName','Pepperoni','amountMinor',100,'extras','[]'::jsonb,'exclusions',pg_catalog.jsonb_build_array('Cebolla')),
          pg_catalog.jsonb_build_object('fraction','half-b','flavorName','Hawaiana','amountMinor',100,'extras','[]'::jsonb,'exclusions','[]'::jsonb)
        )
      ),'quantity',1,'restaurantId',r::text,'branchId',b::text,'status','pending','note',null
    ))
  ),1,actor,actor);
end $seed$`;

const CHECK_BACKFILL_SQL = `select pg_catalog.jsonb_build_object(
  'mapped',(select pg_catalog.to_jsonb(p.fraction_locked_ingredient_option_ids) from app.menu_products p
    where p.id='20000000-0000-4000-8000-000000000001'),
  'unmapped',(select pg_catalog.to_jsonb(p.fraction_locked_ingredient_option_ids) from app.menu_products p
    where p.id='20000000-0000-4000-8000-000000000002'),
  'ambiguous',(select pg_catalog.to_jsonb(p.fraction_locked_ingredient_option_ids) from app.menu_products p
    where p.id='20000000-0000-4000-8000-000000000003'),
  'emptyProduct',(select pg_catalog.to_jsonb(p.fraction_locked_ingredient_option_ids) from app.menu_products p
    where p.id='20000000-0000-4000-8000-000000000004'),
  'emptyVariant',(select pg_catalog.to_jsonb(v.fraction_locked_ingredient_option_ids) from app.menu_product_variants v
    where v.id='50000000-0000-4000-8000-000000000001'),
  'snapshotUnchanged',(select o.aggregate#>'{items,0,snapshot}' = pg_catalog.jsonb_build_object(
    'catalogVersion','10000000-0000-4000-8000-000000000003','productId','20000000-0000-4000-8000-000000000001','name','Pizza congelada',
    'stationId','kitchen','unit','piece','unitPrice',pg_catalog.jsonb_build_object('amountMinor',100,'currency','MXN'),
    'modifiers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'modifierId','exclude:half-a:Cebolla','name','Sin Cebolla','unitPrice',pg_catalog.jsonb_build_object('amountMinor',0,'currency','MXN'))),
    'geometry','halves','fractionBreakdown',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('fraction','half-a','flavorName','Pepperoni','amountMinor',100,'extras','[]'::jsonb,'exclusions',pg_catalog.jsonb_build_array('Cebolla')),
      pg_catalog.jsonb_build_object('fraction','half-b','flavorName','Hawaiana','amountMinor',100,'extras','[]'::jsonb,'exclusions','[]'::jsonb)
    )) from app.orders o where o.id='10000000-0000-4000-8000-000000000005')
) as verification`;

const EXPECTED_BACKFILL = {
  mapped: ["40000000-0000-4000-8000-000000000002"],
  unmapped: ["40000000-0000-4000-8000-000000000003", "40000000-0000-4000-8000-000000000004"],
  ambiguous: ["40000000-0000-4000-8000-000000000007"],
  emptyProduct: ["40000000-0000-4000-8000-000000000008", "40000000-0000-4000-8000-000000000009"],
  emptyVariant: ["40000000-0000-4000-8000-000000000008", "40000000-0000-4000-8000-000000000009"],
  snapshotUnchanged: true,
};

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
  const candidateName = "20261102000100_menu_locked_ingredients.sql";
  const candidateIndex = names.indexOf(candidateName);
  if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
  const priorNames = names.slice(0, candidateIndex);
  if (names[candidateIndex - 1] !== "20261101000200_menu_shared_modifier_groups.sql") throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  const actorId = randomUUID();
  stage = "apply_prior_migrations";
  for (const name of priorNames) await admin.query(readFileSync(join(migrations, name), "utf8"));
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-menu-locked-ingredients@invalid.test')", [actorId]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try {
    baseline = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  const candidateSql = readFileSync(join(migrations, candidateName), "utf8");
  const invariantsSql = readFileSync(join(root, "supabase", "tests", "menu_locked_ingredients_invariants.sql"), "utf8");
  const regressionSql = [
    "menu_shared_modifier_groups_invariants.sql",
    "catalog_halves_product_level_invariants.sql",
    "catalog_halves_invariants.sql",
  ].map((name) => readFileSync(join(root, "supabase", "tests", name), "utf8"));

  stage = "migrated";
  await admin.query("BEGIN");
  let migrated;
  let lockedShape;
  let backfill;
  let migrationFailure: unknown;
  try {
    await admin.query(SEED_LEGACY_SQL);
    await admin.query(extractMigrationBody(candidateSql));
    migrated = (await admin.query(SUMMARY_SQL)).rows[0];
    lockedShape = (await admin.query(TABLE_SQL)).rows[0];
    assert.deepEqual(lockedShape, { lockedColumns: 2, lockedChecks: 2 });
    backfill = (await admin.query(CHECK_BACKFILL_SQL)).rows[0]?.verification;
    assert.deepEqual(backfill, EXPECTED_BACKFILL);
    // The invariants file opens with BEGIN and ends with ROLLBACK; the outer transaction is ours.
    if (!/^\s*(--[^\n]*\n\s*)*begin;/iu.test(invariantsSql) || !/rollback;\s*$/iu.test(invariantsSql) || /commit;/iu.test(invariantsSql)) {
      throw new Error("LOCAL_INVARIANTS_SHAPE_REJECTED");
    }
    await admin.query(invariantsSql.replace(/^(\s*(?:--[^\n]*\n\s*)*)begin;/iu, "$1").replace(/rollback;\s*$/iu, ""));

    // Run regression suites
    for (const sql of regressionSql) {
      if (/^\s*(--[^\n]*\n\s*)*begin;/iu.test(sql) && /rollback;\s*$/iu.test(sql)) {
        await admin.query(sql.replace(/^(\s*(?:--[^\n]*\n\s*)*)begin;/iu, "$1").replace(/rollback;\s*$/iu, ""));
      } else {
        await admin.query(extractMigrationBody(sql));
      }
    }
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
  // This candidate adds two columns and two CHECKs and replaces functions, so postcheck === baseline.
  assert.deepEqual(baseline, postcheck);
  assert.deepEqual(migrated, baseline);

  process.stdout.write(`${JSON.stringify({
    stage: "menu_locked_ingredients_rollback", status: "ok", runId,
    priorMigrationsApplied: priorNames.length, baseline, migrated, postcheck, backfill,
  })}\n`);
} catch (error: unknown) {
  failed = true;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const localInvariant = typeof error === "object" && error !== null && "message" in error
    && typeof error.message === "string" && /^[A-Z_]+$/u.test(error.message) ? error.message : undefined;
  const detail = typeof error === "object" && error !== null && "detail" in error ? error.detail : undefined;
  const constraint = typeof error === "object" && error !== null && "constraint" in error ? error.constraint : undefined;
  const message = error instanceof Error ? error.message : undefined;
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_MENU_LOCKED_INGREDIENTS_FAILED",
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
