import { createHash } from "node:crypto";

import { validateCatalogAuditSql } from "./schema-verification.js";

const baseHash = "2c9a10c6560301b3b3544912a84073957180339864c2d195a18af7577a21f33a";
const bootstrapFunctions = [
  "app_private.is_system_admin(uuid)",
  "app_private.provision_system_restaurant(uuid,uuid,text,uuid,text,text,text,text,text,text)",
  "app_private.preflight_system_restaurant(uuid,uuid,text,text)",
  "app_private.read_system_onboarding_operation(uuid,uuid)",
  "app_private.list_system_restaurants(uuid)",
  "app_private.disable_system_restaurant(uuid,uuid,text)",
] as const;

// Derived from versioned migrations, not observed remotely. Keep the prior audit immutable.
export const postBootstrapSummary = Object.freeze({
  securedTables: 27,
  policies: 5,
  securityDefinerFunctions: 36,
});

export function buildPostBootstrapCatalogAudit(baseSql: string): string {
  let sql = baseSql.replaceAll("\r\n", "\n");
  if (createHash("sha256").update(sql).digest("hex") !== baseHash) {
    throw new Error("POST_BOOTSTRAP_BASE_AUDIT_REJECTED");
  }
  sql = sql.replace(
    "'operational_shifts','order_operational_shifts'",
    "'operational_shifts','order_operational_shifts','system_admins','system_onboarding_operations'",
  );
  const terminalFunction = "pg_catalog.to_regprocedure('app_private.read_branch_operational_context(uuid,uuid,uuid)')";
  const additions = bootstrapFunctions.map((signature) => `pg_catalog.to_regprocedure('${signature}')`).join(",\n    ");
  // Append to both arrays: preserve existing indexed RLS and trigger functions.
  sql = sql.replaceAll(terminalFunction, `${terminalFunction},\n    ${additions}`);
  sql = sql.replaceAll(") <> 25", ") <> 27").replace(") <> 30", ") <> 36").replace(") <> 32", ") <> 38");
  sql = sql.replace("after the five P2 migrations.", "after P2 and administrative bootstrap (20260908000100).");
  validateCatalogAuditSql(sql);
  return sql;
}

export function buildCaptureCatalogAudit(baseSql: string, captureSupplementSql: string): string {
  const base = buildPostBootstrapCatalogAudit(baseSql);
  const tail = "pg_catalog.to_regprocedure('app_private.disable_system_restaurant(uuid,uuid,text)')";
  const migrated = base.replace(
    "'system_admins','system_onboarding_operations'",
    "'system_admins','system_onboarding_operations','capture_drafts','capture_command_events'",
  ).replaceAll(") <> 27", ") <> 29")
    .replaceAll(tail, `${tail},\n    pg_catalog.to_regprocedure('app_private.create_capture_draft(uuid,jsonb)'),\n    pg_catalog.to_regprocedure('app_private.mutate_capture_attention(uuid,text,jsonb)')`)
    .replace(") <> 38", ") <> 40").replace(") <> 36", ") <> 38");
  return validateCatalogAuditSql(`${migrated}\n${captureSupplementSql}`);
}

export function buildCustomerDirectoryCatalogAudit(baseSql: string, captureSupplementSql: string, directorySupplementSql: string): string {
  const capture = buildCaptureCatalogAudit(baseSql, captureSupplementSql);
  const functionTail = "pg_catalog.to_regprocedure('app_private.mutate_capture_attention(uuid,text,jsonb)')";
  const migrated = capture.replace(
    "'capture_drafts','capture_command_events'",
    "'capture_drafts','capture_command_events','customers','customer_phones','customer_addresses','customer_party_snapshots','customer_fulfillment_snapshots','customer_command_events'",
  ).replaceAll(") <> 29", ") <> 35")
    .replaceAll(functionTail, `${functionTail},\n    pg_catalog.to_regprocedure('app_private.mutate_customer_directory(uuid,text,jsonb)'),\n    pg_catalog.to_regprocedure('app_private.search_customer_directory(uuid,jsonb)'),\n    pg_catalog.to_regprocedure('app_private.read_customer_directory(uuid,jsonb)')`)
    .replace(") <> 40", ") <> 43").replace(") <> 38", ") <> 41");
  return validateCatalogAuditSql(`${migrated}\n${directorySupplementSql}`);
}
