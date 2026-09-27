import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the capture-selection-plan candidate migration.
// No env URLs/PGHOST, remote configuration, services or global installation. Each invocation
// owns a brand-new disposable cluster and stops it in `finally`; nothing here ever touches
// Supabase or a shared database. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_CAPTURE_SELECTION_PLAN_ONLY";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cache = join(root, ".cache", "postgres-local");
const binaries = join(cache, "pgsql", "bin");
const runId = randomUUID().replaceAll("-", "");
const runDirectory = join(cache, runId);
const data = join(runDirectory, "data");
const passwordFile = join(runDirectory, "password.tmp");
const database = `superrestaurant_selection_plan_${runId}`;
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

const REGPROC_SQL = `select
  to_regprocedure('app_private.replace_capture_selection_plan(uuid,jsonb,jsonb)') is not null as "hasReplace",
  to_regprocedure('app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb)') is not null as "hasProbe",
  to_regprocedure('app_private.read_capture_selection_plan(uuid,jsonb)') is not null as "hasReader",
  to_regprocedure('app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)') is not null as "hasConfirmV3",
  to_regprocedure('app_private.read_capture_workspace_v3(uuid,jsonb)') is not null as "hasWorkspaceV3",
  to_regprocedure('app_private.read_capture_workspace_v4(uuid,jsonb)') is not null as "hasWorkspaceV4"`;

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
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, deleted_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';`);
  const migrations = join(root, "supabase", "migrations");
  const names = readdirSync(migrations).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name)).sort();
  const candidateName = "20260928000100_capture_selection_plan.sql";
  const candidateIndex = names.indexOf(candidateName);
  if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
  const priorNames = names.slice(0, candidateIndex);
  if (names[candidateIndex - 1] !== "20260927000100_delivery_zones.sql") throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  const actorId = randomUUID();
  stage = "apply_prior_migrations";
  for (const name of priorNames) await admin.query(readFileSync(join(migrations, name), "utf8"));
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-selection-plan@invalid.test')", [actorId]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try {
    baseline = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  const candidateSql = readFileSync(join(migrations, candidateName), "utf8");
  const invariantsSql = readFileSync(join(root, "supabase", "tests", "capture_selection_plan_invariants.sql"), "utf8");

  stage = "migrated";
  await admin.query("BEGIN");
  let migrated;
  let migrationFailure: unknown;
  try {
    await admin.query(extractMigrationBody(candidateSql));
    migrated = (await admin.query(SUMMARY_SQL)).rows[0];
    const regprocs = (await admin.query(REGPROC_SQL)).rows[0];
    assert.deepEqual(regprocs, { hasReplace: true, hasProbe: true, hasReader: true, hasConfirmV3: true, hasWorkspaceV3: true, hasWorkspaceV4: true });
    await admin.query(extractMigrationBody(invariantsSql));
  } catch (error: unknown) {
    migrationFailure = error;
  } finally { await admin.query("ROLLBACK"); }

  stage = "postcheck";
  await admin.query("BEGIN READ ONLY");
  let postcheck;
  try {
    postcheck = (await admin.query(SUMMARY_SQL)).rows[0];
    const removed = (await admin.query(`select
      to_regprocedure('app_private.replace_capture_selection_plan(uuid,jsonb,jsonb)') is null as "replaceAbsent",
      to_regprocedure('app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb)') is null as "probeAbsent",
      to_regprocedure('app_private.read_capture_selection_plan(uuid,jsonb)') is null as "readerAbsent",
      (select count(*)::integer from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid=a.attrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='app' and c.relname='capture_repeat_order_plans' and a.attname='plan_kind'
          and a.attnum>0 and not a.attisdropped) as "planKindColumns"`)).rows[0];
    assert.deepEqual(removed, { replaceAbsent: true, probeAbsent: true, readerAbsent: true, planKindColumns: 0 });
  } finally { await admin.query("ROLLBACK"); }

  if (migrationFailure !== undefined) { stage = "migrated"; throw migrationFailure; }
  assert.deepEqual(baseline, postcheck);
  assert.equal(baseline.securedTables, migrated.securedTables);
  assert.equal(baseline.policies, migrated.policies);
  assert.equal(migrated.securityDefinerFunctions - baseline.securityDefinerFunctions, 4);

  process.stdout.write(`${JSON.stringify({
    stage: "capture_selection_plan_rollback", status: "ok", runId,
    priorMigrationsApplied: priorNames.length, baseline, migrated, postcheck,
  })}\n`);
} catch (error: unknown) {
  failed = true;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const localInvariant = typeof error === "object" && error !== null && "message" in error
    && typeof error.message === "string" && /^[A-Z_]+$/u.test(error.message) ? error.message : undefined;
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_CAPTURE_SELECTION_PLAN_FAILED",
    ...(typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? { sqlState: code } : {}),
    ...(localInvariant === undefined ? {} : { invariant: localInvariant }) })}\n`);
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
