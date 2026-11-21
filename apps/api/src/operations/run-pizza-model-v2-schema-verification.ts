import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres, repositoryRoot } from "./local-postgres.js";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the pizza model V2 migrations. Unlike the older
// per-migration runners this one applies EVERY migration (the pizza files build on the whole
// history), then runs each invariant file in its own BEGIN ... ROLLBACK transaction and checks
// that the schema summary is unchanged afterwards. Each invocation owns a brand-new disposable
// cluster and stops it in `finally`; nothing here ever touches Supabase or a shared database.
const marker = "LOCAL_PIZZA_MODEL_V2_ONLY";
const local = new LocalPostgres({ marker, databasePrefix: "superrestaurant_pizza_v2", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
const runId = local.runId;
let stage = "configuration";
let failed = false;

const INVARIANT_FILES = [
  "pizza_model_v2_invariants.sql",
  "capture_selection_plan_probe_v2_invariants.sql",
] as const;

const SUMMARY_SQL = `select
  (select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity) as "securedTables",
  (select count(*)::integer from pg_catalog.pg_policies where schemaname='app') as policies,
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app_rls','app_private') and p.prosecdef) as "securityDefinerFunctions",
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private') as "privateFunctions"`;

let failureMessage: string | undefined;
let failureFile: string | undefined;

try {
  assertLocalConfirmation();
  await local.start((next) => { stage = next; });
  const admin = local.admin;
  const names = listMigrationNames();
  for (const required of ["20261120000100_pizza_model_v2.sql", "20261120000200_capture_selection_plan_probe_v2.sql"]) {
    if (!names.includes(required)) throw new Error("LOCAL_PIZZA_MIGRATION_MISSING");
  }
  stage = "apply_all_migrations";
  await local.applyMigrations(names);
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-pizza-v2@invalid.test')", [randomUUID()]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try { baseline = (await admin.query(SUMMARY_SQL)).rows[0]; } finally { await admin.query("ROLLBACK"); }

  const executed: string[] = [];
  let migrationFailure: unknown;
  for (const file of INVARIANT_FILES) {
    stage = `invariants:${file}`;
    const sql = readFileSync(join(repositoryRoot, "supabase", "tests", file), "utf8");
    await admin.query("BEGIN");
    try {
      await admin.query(extractMigrationBody(sql));
      executed.push(file);
    } catch (error: unknown) {
      migrationFailure = error;
      failureFile = file;
    } finally { await admin.query("ROLLBACK"); }
    if (migrationFailure !== undefined) break;
  }

  stage = "postcheck";
  await admin.query("BEGIN READ ONLY");
  let postcheck;
  try { postcheck = (await admin.query(SUMMARY_SQL)).rows[0]; } finally { await admin.query("ROLLBACK"); }

  if (migrationFailure !== undefined) { stage = `invariants:${failureFile ?? "?"}`; throw migrationFailure; }
  assert.deepEqual(baseline, postcheck);
  assert.deepEqual(executed, [...INVARIANT_FILES]);

  process.stdout.write(`${JSON.stringify({
    stage: "pizza_model_v2_rollback", status: "ok", runId,
    migrationsApplied: names.length, invariantFiles: executed, baseline, postcheck,
  })}\n`);
} catch (error: unknown) {
  failed = true;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : undefined;
  // Postgres messages (RAISE EXCEPTION text, constraint names) are safe diagnostics here: the
  // cluster is disposable and holds only synthetic fixtures. Strip anything that could carry a URL.
  const where = typeof error === "object" && error !== null && "where" in error && typeof error.where === "string" ? ` @ ${error.where}` : "";
  failureMessage = message === undefined ? undefined : `${message}${where}`.replace(/postgres(ql)?:\/\/\S+/giu, "[url]").slice(0, 800);
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_PIZZA_MODEL_V2_FAILED",
    ...(typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? { sqlState: code } : {}),
    ...(failureMessage === undefined ? {} : { message: failureMessage }) })}\n`);
} finally {
  const cleanup = await local.stop();
  if (cleanup.failed) failed = true;
  process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: failed ? "failed" : "ok", stopped: cleanup.stopped, runId, marker })}\n`);
  if (failed) process.exitCode = 1;
}
