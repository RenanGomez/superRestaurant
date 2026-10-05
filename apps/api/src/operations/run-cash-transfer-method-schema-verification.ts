import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres, readMigration, repositoryRoot } from "./local-postgres.js";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the cash-transfer-method candidate migration. No env
// URLs/PGHOST, remote configuration, services or global installation. Each invocation owns a
// brand-new disposable cluster and stops it in `finally`; nothing here ever touches Supabase or a
// shared database. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_CASH_TRANSFER_METHOD_ONLY";
const root = repositoryRoot;
const local = new LocalPostgres({ marker, databasePrefix: "superrestaurant_cash_transfer_method", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
const runId = local.runId;
let stopped = true;
let stage = "configuration";
let failed = false;

const SUMMARY_SQL = `select
  (select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity) as "securedTables",
  (select count(*)::integer from pg_catalog.pg_policies where schemaname='app') as policies,
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('app_rls','app_private') and p.prosecdef) as "securityDefinerFunctions"`;

const COLLECT_SIGNATURE = "app_private.collect_simple_payment(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)";
const REPORT_SIGNATURE = "app_private.read_cash_register_operational_report(uuid,uuid,uuid,uuid,uuid,uuid)";
const REGPROC_SQL = `select
  to_regprocedure('${COLLECT_SIGNATURE}') is not null as "hasCollect",
  to_regprocedure('${REPORT_SIGNATURE}') is not null as "hasReport"`;

try {
  assertLocalConfirmation();
  await local.start((next) => { stage = next; });
  const admin = local.admin;
  const names = listMigrationNames();
  const candidateName = "20261007000200_payments_transfer_method.sql";
  const candidateIndex = names.indexOf(candidateName);
  if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
  const priorNames = names.slice(0, candidateIndex);
  if (names[candidateIndex - 1] !== "20261007000100_branch_order_work_tray_delivery_state.sql") throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  const actorId = randomUUID();
  stage = "apply_prior_migrations";
  await local.applyMigrations(priorNames);
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-cash-transfer-method@invalid.test')", [actorId]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try {
    baseline = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  const candidateSql = readMigration(candidateName);
  const invariantsSql = readFileSync(join(root, "supabase", "tests", "cash_transfer_method_invariants.sql"), "utf8");
  // Regression: the cash/card/change/tip invariants and the delivery guard must still hold on the replaced core.
  const regressionSql = ["cash_collect_change_invariants.sql", "order_deliveries_invariants.sql"]
    .map((name) => readFileSync(join(root, "supabase", "tests", name), "utf8"));

  stage = "migrated";
  await admin.query("BEGIN");
  let migrated;
  let migrationFailure: unknown;
  try {
    await admin.query(extractMigrationBody(candidateSql));
    migrated = (await admin.query(SUMMARY_SQL)).rows[0];
    const regprocs = (await admin.query(REGPROC_SQL)).rows[0];
    assert.deepEqual(regprocs, { hasCollect: true, hasReport: true });
    const malformed = await admin.query(
      "select app_private.collect_simple_payment($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::bigint,$7::bigint) as result",
      [actorId, JSON.stringify({ schemaVersion: 1 }), "{}", "{}", "{}", 1, 0],
    );
    assert.deepEqual(malformed.rows[0]?.result, { status: "conflict" });
    // CREATE OR REPLACE must keep the narrow grants: only app_api executes the replaced functions.
    const privileges = await admin.query(
      `select
        has_function_privilege('app_api',$1,'EXECUTE') as collect_api,
        has_function_privilege('authenticated',$1,'EXECUTE') as collect_authenticated,
        has_function_privilege('app_api',$2,'EXECUTE') as report_api,
        has_function_privilege('authenticated',$2,'EXECUTE') as report_authenticated`,
      [COLLECT_SIGNATURE, REPORT_SIGNATURE],
    );
    assert.deepEqual(privileges.rows[0], {
      collect_api: true, collect_authenticated: false,
      report_api: true, report_authenticated: false,
    });
    const core = await admin.query(
      `select has_function_privilege('app_api','app_private.collect_simple_payment_core(uuid,jsonb,jsonb,jsonb,jsonb,bigint,bigint)','EXECUTE') as core_api`);
    assert.deepEqual(core.rows[0], { core_api: false });
    // Each file defines its own pg_temp helpers: isolate them with a savepoint so names cannot collide.
    for (const sql of [invariantsSql, ...regressionSql]) {
      await admin.query("SAVEPOINT invariant_file");
      await admin.query(extractMigrationBody(sql));
      await admin.query("ROLLBACK TO SAVEPOINT invariant_file");
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
  // This candidate only alters existing tables and replaces two existing SECURITY DEFINER
  // functions, so it adds no function, table or policy: `migrated` and `postcheck` equal `baseline`.
  assert.deepEqual(baseline, postcheck);
  assert.deepEqual(migrated, baseline);

  process.stdout.write(`${JSON.stringify({
    stage: "cash_transfer_method_rollback", status: "ok", runId,
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
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", code: "LOCAL_CASH_TRANSFER_METHOD_FAILED",
    ...(typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? { sqlState: code } : {}),
    ...(localInvariant === undefined ? {} : { invariant: localInvariant }),
    detail, constraint, message, where: typeof error === "object" && error !== null && "where" in error ? error.where : undefined, position: typeof error === "object" && error !== null && "position" in error ? error.position : undefined })}\n`);
} finally {
  const cleanup = await local.stop();
  stopped = cleanup.stopped;
  if (cleanup.failed) failed = true;
  process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: failed ? "failed" : "ok", stopped, runId, marker })}\n`);
  if (failed) process.exitCode = 1;
}
