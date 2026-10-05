import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres, readMigration, repositoryRoot } from "./local-postgres.js";
import { extractMigrationBody } from "./schema-verification.js";

// Rollback-only, fully local verification of the capture-selection-plan candidate migration.
// No env URLs/PGHOST, remote configuration, services or global installation. Each invocation
// owns a brand-new disposable cluster and stops it in `finally`; nothing here ever touches
// Supabase or a shared database. No recursive deletion, DROP DATABASE or remote migrations.
const marker = "LOCAL_CAPTURE_SELECTION_PLAN_ONLY";
const root = repositoryRoot;
const local = new LocalPostgres({ marker, databasePrefix: "superrestaurant_selection_plan" });
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

const REGPROC_SQL = `select
  to_regprocedure('app_private.replace_capture_selection_plan(uuid,jsonb,jsonb)') is not null as "hasReplace",
  to_regprocedure('app_private.probe_capture_selection_plan_replace(uuid,jsonb,jsonb)') is not null as "hasProbe",
  to_regprocedure('app_private.read_capture_selection_plan(uuid,jsonb)') is not null as "hasReader",
  to_regprocedure('app_private.confirm_capture_draft_v3(uuid,jsonb,jsonb,jsonb)') is not null as "hasConfirmV3",
  to_regprocedure('app_private.read_capture_workspace_v3(uuid,jsonb)') is not null as "hasWorkspaceV3",
  to_regprocedure('app_private.read_capture_workspace_v4(uuid,jsonb)') is not null as "hasWorkspaceV4"`;

try {
  assertLocalConfirmation();
  await local.start((next) => { stage = next; });
  const admin = local.admin;
  const names = listMigrationNames();
  const candidateName = "20260928000100_capture_selection_plan.sql";
  const candidateIndex = names.indexOf(candidateName);
  if (candidateIndex < 1) throw new Error("LOCAL_CANDIDATE_MIGRATION_REJECTED");
  const priorNames = names.slice(0, candidateIndex);
  if (names[candidateIndex - 1] !== "20260927000100_delivery_zones.sql") throw new Error("LOCAL_MIGRATION_SET_REJECTED");
  const actorId = randomUUID();
  stage = "apply_prior_migrations";
  await local.applyMigrations(priorNames);
  await admin.query("INSERT INTO auth.users(id,email) VALUES($1,'local-selection-plan@invalid.test')", [actorId]);

  stage = "baseline";
  await admin.query("BEGIN READ ONLY");
  let baseline;
  try {
    baseline = (await admin.query(SUMMARY_SQL)).rows[0];
  } finally { await admin.query("ROLLBACK"); }

  const candidateSql = readMigration(candidateName);
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
  const cleanup = await local.stop();
  stopped = cleanup.stopped;
  if (cleanup.failed) failed = true;
  process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: failed ? "failed" : "ok", stopped, runId, marker })}\n`);
  if (failed) process.exitCode = 1;
}
