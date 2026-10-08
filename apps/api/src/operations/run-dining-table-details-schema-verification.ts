import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the dining-table-details candidate migration. No env
// URLs/PGHOST, remote configuration, services or global installation. Each invocation owns a
// brand-new disposable cluster and stops it in `finally`; nothing here ever touches Supabase or a
// shared database. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_DINING_TABLE_DETAILS_ONLY";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cache = join(root, ".cache", "postgres-local");
const binaries = join(cache, "pgsql", "bin");
const runId = randomUUID().replaceAll("-", "");
const runDirectory = join(cache, runId);
const data = join(runDirectory, "data");
const passwordFile = join(runDirectory, "password.tmp");
const database = `superrestaurant_dining_table_details_${runId}`;
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

const DETAILS_SIGNATURE = "app_private.update_dining_table_details(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,text,integer,text)";
const REGPROC_SQL = `select to_regprocedure('${DETAILS_SIGNATURE}') is not null as "hasDetails"`;
const OPERATION_CHECK_SQL = `select pg_catalog.pg_get_constraintdef(c.oid) as def from pg_catalog.pg_constraint c
  where c.conrelid='app.dining_table_audit_events'::regclass and c.conname='dining_table_audit_operation_valid'`;

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
  // Minimal LOCAL Auth shim supplies FK targets only; no Auth provider is simulated.
  await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';`);
  const migrations = join(root, "supabase", "migrations");
  const names = readdirSync(migrations).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name)).sort();
  const candidateName = "20261008000100_dining_table_details.sql";
  const candidateIndex = names.indexOf(candidateName);
  if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
  const priorNames = names.slice(0, candidateIndex);
  if (names[candidateIndex - 1] !== "20261007000700_cancellation_actor_and_summary.sql") throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  const actorId = randomUUID();
  stage = "apply_prior_migrations";
  for (const name of priorNames) await admin.query(readFileSync(join(migrations, name), "utf8"));
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-dining-table-details@invalid.test')", [actorId]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try {
    baseline = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  const candidateSql = readFileSync(join(migrations, candidateName), "utf8");
  const invariantsSql = readFileSync(join(root, "supabase", "tests", "dining_table_details_invariants.sql"), "utf8");

  stage = "migrated";
  await admin.query("BEGIN");
  let migrated;
  let migrationFailure: unknown;
  try {
    await admin.query(extractMigrationBody(candidateSql));
    migrated = (await admin.query(SUMMARY_SQL)).rows[0];
    assert.deepEqual((await admin.query(REGPROC_SQL)).rows[0], { hasDetails: true });
    assert.match(String((await admin.query(OPERATION_CHECK_SQL)).rows[0]?.def), /details_updated/u);
    // The new function is reachable only by app_api; clients cannot execute it.
    const privileges = await admin.query(
      `select has_function_privilege('app_api',$1,'EXECUTE') as api,
        has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,
        has_function_privilege('anon',$1,'EXECUTE') as anon,
        has_function_privilege('service_role',$1,'EXECUTE') as service`,
      [DETAILS_SIGNATURE],
    );
    assert.deepEqual(privileges.rows[0], { api: true, authenticated: false, anon: false, service: false });
    await admin.query(extractMigrationBody(invariantsSql));
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
  // The candidate adds exactly one SECURITY DEFINER function and no table or policy; the rollback
  // leaves the catalog identical to the baseline.
  assert.deepEqual(baseline, postcheck);
  assert.deepEqual({ ...migrated, securityDefinerFunctions: migrated.securityDefinerFunctions - 1 }, baseline);

  process.stdout.write(`${JSON.stringify({
    stage: "dining_table_details_rollback", status: "ok", runId,
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
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_DINING_TABLE_DETAILS_FAILED",
    ...(typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? { sqlState: code } : {}),
    ...(localInvariant === undefined ? {} : { invariant: localInvariant }),
    detail, constraint, message, where: typeof error === "object" && error !== null && "where" in error ? error.where : undefined, position: typeof error === "object" && error !== null && "position" in error ? error.position : undefined })}\n`);
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
