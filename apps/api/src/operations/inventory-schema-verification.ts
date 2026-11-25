import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryRoot } from "./local-postgres.js";
import { extractMigrationBody } from "./schema-verification.js";

export function inventoryInvariantSql(): string {
  return extractMigrationBody(readFileSync(join(repositoryRoot, "supabase", "tests", "inventory_catalog_invariants.sql"), "utf8").replace(/rollback;\s*$/iu, "commit;"));
}

export function inventoryLedgerInvariantSql(): string {
  return extractMigrationBody(readFileSync(join(repositoryRoot, "supabase", "tests", "inventory_ledger_invariants.sql"), "utf8").replace(/rollback;\s*$/iu, "commit;"));
}

export function inventoryRecipeInvariantSql(): string {
  return extractMigrationBody(readFileSync(join(repositoryRoot, "supabase", "tests", "inventory_recipes_invariants.sql"), "utf8").replace(/rollback;\s*$/iu, "commit;"));
}

export function inventoryApiFunctionsInvariantSql(): string {
  return extractMigrationBody(readFileSync(join(repositoryRoot, "supabase", "tests", "inventory_api_functions_invariants.sql"), "utf8").replace(/rollback;\s*$/iu, "commit;"));
}
