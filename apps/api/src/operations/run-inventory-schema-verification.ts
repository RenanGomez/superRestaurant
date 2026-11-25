import assert from "node:assert/strict";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "./local-postgres.js";
import { inventoryInvariantSql } from "./inventory-schema-verification.js";

const local = new LocalPostgres({ marker: "LOCAL_INVENTORY_SCHEMA_ONLY", databasePrefix: "superrestaurant_inventory" });
let stage = "configuration";
let failed = false;
try {
  assertLocalConfirmation();
  await local.start((next) => { stage = next; });
  const names = listMigrationNames();
  if (!names.includes("20261126000100_inventory_catalog.sql")) throw new Error("INVENTORY_MIGRATION_MISSING");
  stage = "migrations";
  await local.applyMigrations(names);
  const summary = "select (select count(*) from app.inventory_items)::int as items, (select count(*) from app.inventory_warehouses)::int as warehouses, (select count(*)::int from pg_catalog.pg_policies where schemaname='app' and tablename in ('inventory_items','inventory_warehouses')) as policies";
  const baseline = (await local.admin.query(summary)).rows[0];
  stage = "invariants";
  await local.admin.query("BEGIN");
  let invariantFailure: unknown;
  try { await local.admin.query(inventoryInvariantSql()); } catch (error: unknown) { invariantFailure = error; } finally { await local.admin.query("ROLLBACK"); }
  stage = "postcheck";
  assert.deepEqual((await local.admin.query(summary)).rows[0], baseline);
  if (invariantFailure !== undefined) { stage = "invariants"; throw invariantFailure; }
  process.stdout.write(`${JSON.stringify({ stage: "inventory_schema_rollback", status: "ok", migrationsApplied: names.length, baseline })}\n`);
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
