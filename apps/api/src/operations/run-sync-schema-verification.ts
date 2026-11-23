import assert from "node:assert/strict";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "./local-postgres.js";
import { syncInvariantSql } from "./sync-schema-verification.js";

const local = new LocalPostgres({ marker: "LOCAL_SYNC_SCHEMA_ONLY", databasePrefix: "superrestaurant_sync", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
let stage = "configuration";
let failed = false;
try {
  assertLocalConfirmation();
  await local.start((next) => { stage = next; });
  const names = listMigrationNames();
  if (!names.includes("20261123000300_sync_ledger.sql")) throw new Error("SYNC_MIGRATION_MISSING");
  stage = "migrations";
  await local.applyMigrations(names);
  const summary = "select (select count(*) from app.sync_devices)::int as devices, (select count(*) from app.sync_event_ledger)::int as ledger, (select count(*) from app.sync_event_receipts)::int as receipts, (select count(*) from app.sync_changelog)::int as changes, (select count(*) from app.sync_manual_review_cases)::int as cases, (select value from app_private.sync_cursor_counter)::text as cursor";
  const baseline = (await local.admin.query(summary)).rows[0];
  stage = "invariants";
  await local.admin.query("BEGIN");
  let invariantFailure: unknown;
  try { await local.admin.query(syncInvariantSql()); } catch (error: unknown) { invariantFailure = error; } finally { await local.admin.query("ROLLBACK"); }
  stage = "postcheck";
  assert.deepEqual((await local.admin.query(summary)).rows[0], baseline);
  if (invariantFailure !== undefined) { stage = "invariants"; throw invariantFailure; }
  process.stdout.write(`${JSON.stringify({ stage: "sync_schema_rollback", status: "ok", migrationsApplied: names.length, baseline })}\n`);
} catch (error: unknown) {
  failed = true;
  const message = error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/giu, "[url]") : "unknown";
  process.stderr.write(`${JSON.stringify({ stage, status: "failed", message })}\n`);
} finally {
  const cleanup = await local.stop();
  if (cleanup.failed) failed = true;
  process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: failed ? "failed" : "ok", stopped: cleanup.stopped })}\n`);
  if (failed) process.exitCode = 1;
}
