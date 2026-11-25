import assert from "node:assert/strict";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "./local-postgres.js";
import { inventoryApiFunctionsInvariantSql, inventoryInvariantSql, inventoryLedgerInvariantSql, inventoryLineCancelInvariantSql, inventoryPurchasingInvariantSql, inventoryRecipeInvariantSql, inventorySaleConsumptionInvariantSql } from "./inventory-schema-verification.js";

const local = new LocalPostgres({ marker: "LOCAL_INVENTORY_SCHEMA_ONLY", databasePrefix: "superrestaurant_inventory", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
let stage = "configuration";
let failed = false;
try {
  assertLocalConfirmation();
  await local.start((next) => { stage = next; });
  const names = listMigrationNames();
  if (!names.includes("20261126000100_inventory_catalog.sql")) throw new Error("INVENTORY_MIGRATION_MISSING");
  if (!names.includes("20261126000200_inventory_ledger.sql")) throw new Error("INVENTORY_LEDGER_MIGRATION_MISSING");
  if (!names.includes("20261126000300_inventory_recipes.sql")) throw new Error("INVENTORY_RECIPES_MIGRATION_MISSING");
  if (!names.includes("20261126000600_inventory_api_functions.sql")) throw new Error("INVENTORY_API_FUNCTIONS_MIGRATION_MISSING");
  if (!names.includes("20261126000400_inventory_purchasing.sql")) throw new Error("INVENTORY_PURCHASING_MIGRATION_MISSING");
  if (!names.includes("20261126000500_inventory_sale_consumption.sql")) throw new Error("INVENTORY_SALE_CONSUMPTION_MIGRATION_MISSING");
  if (!names.includes("20261126000700_inventory_line_cancel.sql")) throw new Error("INVENTORY_LINE_CANCEL_MIGRATION_MISSING");
  stage = "migrations";
  await local.applyMigrations(names);
  const summary = "select (select count(*) from app.inventory_items)::int as items, (select count(*) from app.inventory_warehouses)::int as warehouses, (select count(*) from app.inventory_movements)::int as movements, (select count(*) from app.inventory_balances)::int as balances, (select count(*) from app.inventory_recipes)::int as recipes, (select count(*) from app.inventory_recipe_lines)::int as recipe_lines, (select count(*) from app.inventory_suppliers)::int as suppliers, (select count(*) from app.inventory_purchase_orders)::int as purchase_orders, (select count(*) from app.inventory_purchase_order_lines)::int as purchase_order_lines, (select count(*) from app.inventory_consumptions)::int as consumptions, (select count(*)::int from pg_catalog.pg_policies where schemaname='app' and tablename in ('inventory_items','inventory_warehouses','inventory_movements','inventory_balances','inventory_recipes','inventory_recipe_lines','inventory_suppliers','inventory_purchase_orders','inventory_purchase_order_lines','inventory_consumptions')) as policies";
  const baseline = (await local.admin.query(summary)).rows[0];
  stage = "invariants";
  let invariantFailure: { readonly label: string; readonly error: unknown } | undefined;
  const invariants: readonly (readonly [string, string])[] = [
    ["catalog", inventoryInvariantSql()],
    ["ledger", inventoryLedgerInvariantSql()],
    ["recipes", inventoryRecipeInvariantSql()],
    ["api-functions", inventoryApiFunctionsInvariantSql()],
    ["purchasing", inventoryPurchasingInvariantSql()],
    ["sale-consumption", inventorySaleConsumptionInvariantSql()],
    ["line-cancel", inventoryLineCancelInvariantSql()],
  ];
  for (const [label, sql] of invariants) {
    await local.admin.query("BEGIN");
    try { await local.admin.query(sql); } catch (error: unknown) { invariantFailure ??= { label, error }; } finally { await local.admin.query("ROLLBACK"); }
  }
  stage = "postcheck";
  assert.deepEqual((await local.admin.query(summary)).rows[0], baseline);
  if (invariantFailure !== undefined) { stage = `invariants:${invariantFailure.label}`; throw invariantFailure.error; }
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
