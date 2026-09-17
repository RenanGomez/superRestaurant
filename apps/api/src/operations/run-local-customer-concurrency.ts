import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { verifyCustomerDirectoryConcurrency } from "./customer-directory-concurrency-verification.js";
import { verifyCaptureConcurrency } from "./capture-concurrency-verification.js";

// No env URLs/PGHOST, remote configuration, services or global installation.
// Each invocation owns a new cluster and stops it in finally; files stay ignored
// for inspection. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_CUSTOMER_CONCURRENCY_ONLY";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cache = join(root, ".cache", "postgres-local");
const binaries = join(cache, "pgsql", "bin");
const runId = randomUUID().replaceAll("-", "");
const runDirectory = join(cache, runId);
const data = join(runDirectory, "data");
const passwordFile = join(runDirectory, "password.tmp");
const database = `superrestaurant_concurrency_${runId}`;
let clusterCreated = false;
let started = false;
let stopped = true;
let admin: Client | undefined;
let stage = "configuration";
let failed = false;

function executable(name: string): string {
  const path = realpathSync(join(binaries, `${name}.exe`));
  if (!path.toLowerCase().startsWith(`${realpathSync(cache).toLowerCase()}\\`)) throw new Error("LOCAL_BINARY_PATH_REJECTED");
  return path;
}
function run(name: string, args: readonly string[]): void {
  // Ignore inherited pipes: on Windows a started postgres child can keep the
  // pg_ctl stdout/stderr pipe open after pg_ctl itself exits.
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
  // Reject the wrong binary major before creating any cluster.
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
  if (names.length !== 24 || !names.at(-1)?.startsWith("20260916000800_")) throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  for (const name of names) await admin.query(readFileSync(join(migrations, name), "utf8"));
  await admin.query("CREATE TABLE app_private.local_concurrency_guard(marker text PRIMARY KEY)");
  await admin.query("INSERT INTO app_private.local_concurrency_guard VALUES($1)", [marker]);
  const actorId = randomUUID(), restaurantId = randomUUID(), branchId = randomUUID(), membershipId = randomUUID();
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-concurrency@invalid.test')", [actorId]);
  await admin.query("INSERT INTO app.restaurants(id,name,time_zone) VALUES($1,'local concurrency','America/Hermosillo')", [restaurantId]);
  await admin.query("INSERT INTO app.branches(id,restaurant_id,name) VALUES($1,$2,'local concurrency')", [branchId, restaurantId]);
  await admin.query("INSERT INTO app.memberships(id,user_id,restaurant_id,branch_id,granted_by) VALUES($1,$2,$3,$4,$2)", [membershipId, actorId, restaurantId, branchId]);
  await admin.query("INSERT INTO app.membership_role_grants(membership_id,role_code,granted_by) VALUES($1,'cashier',$2)", [membershipId, actorId]);
  stage = "concurrency";
  const result = await verifyCustomerDirectoryConcurrency({ ...config, database, marker, actorId, restaurantId, branchId });
  process.stdout.write(`${JSON.stringify({ stage: "customer_concurrency", status: "ok", runId, ...result })}\n`);
  stage = "capture_concurrency";
  const captures = await verifyCaptureConcurrency({ ...config, database, marker, actorId, restaurantId, branchId });
  process.stdout.write(`${JSON.stringify({ stage, status: "ok", runId, ...captures })}\n`);
} catch (error: unknown) {
  failed = true;
  // Driver errors may contain PII or connection data. Only bounded SQLSTATE is emitted.
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_CUSTOMER_CONCURRENCY_FAILED",
    ...(typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? { sqlState: code } : {}) })}\n`);
} finally {
  try { await admin?.end(); } catch { failed = true; }
  // pg_ctl stop is attempted even if start had an ambiguous result.
  if (clusterCreated) {
    try { run("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "30", "stop"]); started = false; stopped = true; }
    catch { if (started || stage === "start") failed = true; }
  }
  try { if (existsSync(passwordFile)) unlinkSync(passwordFile); } catch { failed = true; }
  process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: failed ? "failed" : "ok", stopped, runId })}\n`);
  if (failed) process.exitCode = 1;
}
