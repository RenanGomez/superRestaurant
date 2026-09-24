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

export function buildCaptureCustomerCatalogAudit(baseSql: string, captureSupplementSql: string, directorySupplementSql: string): string {
  const base = buildCustomerDirectoryCatalogAudit(baseSql, captureSupplementSql, directorySupplementSql);
  const tail = "pg_catalog.to_regprocedure('app_private.read_customer_directory(uuid,jsonb)')";
  const migrated = base.replaceAll(tail, `${tail},\n    pg_catalog.to_regprocedure('app_private.set_capture_customer(uuid,jsonb)')`)
    .replace(") <> 43", ") <> 44").replace(") <> 41", ") <> 42")
    .replace("where conrelid = target and convalidated) <> 17", "where conrelid = target and convalidated) <> 19");
  return validateCatalogAuditSql(`${migrated}\ndo $capture_customer_catalog$ begin
    if (select count(*) from pg_catalog.pg_constraint where conrelid=pg_catalog.to_regclass('app.capture_drafts')
      and conname in ('capture_customer_snapshot_scope_fk','capture_customer_snapshot_pair_valid')) <> 2
    then raise exception 'CAPTURE_CUSTOMER_SCOPE_REJECTED'; end if;
  end $capture_customer_catalog$;`);
}

export function buildCaptureFulfillmentCatalogAudit(baseSql: string, captureSupplementSql: string, directorySupplementSql: string): string {
  const base = buildCaptureCustomerCatalogAudit(baseSql, captureSupplementSql, directorySupplementSql);
  const tail = "pg_catalog.to_regprocedure('app_private.set_capture_customer(uuid,jsonb)')";
  const migrated = base.replaceAll(tail, `${tail},\n    pg_catalog.to_regprocedure('app_private.set_capture_fulfillment(uuid,jsonb)')`)
    .replace(") <> 44", ") <> 45").replace(") <> 42", ") <> 43")
    .replace("where conrelid = target and convalidated) <> 19", "where conrelid = target and convalidated) <> 21");
  return validateCatalogAuditSql(`${migrated}\ndo $capture_fulfillment_catalog$ begin
    if (select count(*) from pg_catalog.pg_constraint where conrelid=pg_catalog.to_regclass('app.capture_drafts')
      and conname in ('capture_fulfillment_snapshot_scope_fk','capture_fulfillment_snapshot_pair_valid')) <> 2
    then raise exception 'CAPTURE_FULFILLMENT_SCOPE_REJECTED'; end if;
  end $capture_fulfillment_catalog$;`);
}

export function buildCaptureTrayCatalogAudit(baseSql: string, captureSupplementSql: string, directorySupplementSql: string): string {
  const base = buildCaptureFulfillmentCatalogAudit(baseSql, captureSupplementSql, directorySupplementSql);
  const tail = "pg_catalog.to_regprocedure('app_private.set_capture_fulfillment(uuid,jsonb)')";
  return validateCatalogAuditSql(base.replaceAll(tail,
    `${tail},\n    pg_catalog.to_regprocedure('app_private.list_capture_work_tray(uuid,jsonb)')`)
    .replace(") <> 45", ") <> 46").replace(") <> 43", ") <> 44"));
}

export function buildCaptureContinuityCatalogAudit(baseSql: string, captureSupplementSql: string, directorySupplementSql: string): string {
  const base = buildCaptureTrayCatalogAudit(baseSql, captureSupplementSql, directorySupplementSql);
  const tail = "pg_catalog.to_regprocedure('app_private.list_capture_work_tray(uuid,jsonb)')";
  return validateCatalogAuditSql(base.replaceAll(tail,
    `${tail},\n    pg_catalog.to_regprocedure('app_private.autosave_capture_draft(uuid,jsonb)'),\n    pg_catalog.to_regprocedure('app_private.read_capture_workspace(uuid,jsonb)')`)
    .replace(") <> 46", ") <> 48").replace(") <> 44", ") <> 46"));
}

export function buildCaptureDeliveryOrderCatalogAudit(
  baseSql: string,
  captureSupplementSql: string,
  directorySupplementSql: string,
  deliveryOrderSupplementSql: string,
): string {
  const base = buildCaptureContinuityCatalogAudit(baseSql, captureSupplementSql, directorySupplementSql);
  const definerTail = "pg_catalog.to_regprocedure('app_private.read_capture_workspace(uuid,jsonb)')";
  const helperTail = "pg_catalog.to_regprocedure('app_private.enforce_menu_modifier_group_command_limit()')";
  const definers = [
    "app_private.set_capture_delivery_instructions(uuid,jsonb)",
    "app_private.read_capture_workspace_v2(uuid,jsonb)",
    "app_private.list_capture_delivery_instruction_suggestions(uuid,jsonb)",
    "app_private.confirm_capture_draft(uuid,jsonb,jsonb,jsonb)",
  ] as const;
  const additions = definers.map((signature) => `pg_catalog.to_regprocedure('${signature}')`).join(",\n    ");
  const migrated = base
    .replace("'customer_command_events'", "'customer_command_events','order_fulfillment_snapshots'")
    .replaceAll(definerTail, `${definerTail},\n    ${additions}`)
    .replace(helperTail, `${helperTail},\n    pg_catalog.to_regprocedure('app_private.clear_capture_delivery_instructions_for_channel()')`)
    .replaceAll(") <> 35", ") <> 36")
    .replace(") <> 48", ") <> 53")
    .replace(") <> 46", ") <> 50")
    .replace("where conrelid = target and convalidated) <> 21", "where conrelid = target and convalidated) <> 22");
  return validateCatalogAuditSql(`${migrated}\n${deliveryOrderSupplementSql}`);
}

export function buildCustomerOrderHistoryCatalogAudit(
  baseSql: string,
  captureSupplementSql: string,
  directorySupplementSql: string,
  deliveryOrderSupplementSql: string,
  historySupplementSql: string,
): string {
  const base = buildCaptureDeliveryOrderCatalogAudit(
    baseSql,
    captureSupplementSql,
    directorySupplementSql,
    deliveryOrderSupplementSql,
  );
  const tail = "pg_catalog.to_regprocedure('app_private.confirm_capture_draft(uuid,jsonb,jsonb,jsonb)')";
  const migrated = base.replaceAll(tail,
    `${tail},\n    pg_catalog.to_regprocedure('app_private.list_customer_recent_orders(uuid,jsonb)')`)
    .replace(") <> 53", ") <> 54")
    .replace(") <> 50", ") <> 51");
  return validateCatalogAuditSql(`${migrated}\n${historySupplementSql}`);
}

export function buildCaptureRepeatOrderCatalogAudit(
  baseSql: string,
  captureSupplementSql: string,
  directorySupplementSql: string,
  deliveryOrderSupplementSql: string,
  historySupplementSql: string,
  repeatOrderSupplementSql: string,
): string {
  const base = buildCustomerOrderHistoryCatalogAudit(
    baseSql,
    captureSupplementSql,
    directorySupplementSql,
    deliveryOrderSupplementSql,
    historySupplementSql,
  );
  const definerTail = "pg_catalog.to_regprocedure('app_private.list_customer_recent_orders(uuid,jsonb)')";
  const helperTail = "pg_catalog.to_regprocedure('app_private.clear_capture_delivery_instructions_for_channel()')";
  const migrated = base
    .replace("'order_fulfillment_snapshots'", "'order_fulfillment_snapshots','capture_repeat_order_plans'")
    .replaceAll(definerTail,
      `${definerTail},\n    pg_catalog.to_regprocedure('app_private.repeat_customer_order_into_capture(uuid,jsonb,jsonb)')`)
    .replace(helperTail,
      `${helperTail},\n    pg_catalog.to_regprocedure('app_private.clear_capture_repeat_order_plan_for_context()')`)
    .replaceAll(") <> 36", ") <> 37")
    .replace(") <> 54", ") <> 56")
    .replace(") <> 51", ") <> 52");
  return validateCatalogAuditSql(`${migrated}\n${repeatOrderSupplementSql}`);
}
