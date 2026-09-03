export const DINING_TABLE_VERIFICATION_CHECKPOINTS = Object.freeze([
  "dining_tables.unauthenticated_create",
  "dining_tables.empty_persistence",
  "dining_tables.manager_create",
  "dining_tables.created_persistence",
  "dining_tables.create_replay",
  "dining_tables.idempotency_conflict",
  "dining_tables.viewer_write_rejected",
  "dining_tables.false_pair_write_rejected",
  "dining_tables.manager_layout_read",
  "dining_tables.manager_layout_response_received",
  "dining_tables.manager_layout_status_verified",
  "dining_tables.manager_layout_cache_verified",
  "dining_tables.manager_layout_json_decoded",
  "dining_tables.manager_layout_parsed",
  "dining_tables.manager_layout_scope_verified",
  "dining_tables.manager_layout_zone_found",
  "dining_tables.manager_layout_table_found",
  "dining_tables.manager_layout_table_matches_created",
  "dining_tables.viewer_layout_read",
  "dining_tables.layout_update",
  "dining_tables.layout_update_replay",
  "dining_tables.stale_update_rejected",
  "dining_tables.updated_persistence",
  "dining_tables.revoked_write_rejected",
  "dining_tables.revoked_persistence",
] as const);

export type DiningTableVerificationCheckpoint = (typeof DINING_TABLE_VERIFICATION_CHECKPOINTS)[number];

export const FIXTURE_VERIFICATION_CHECKPOINTS = Object.freeze([
  "fixtures.operation_lock",
  "fixtures.operation_lock_acquired",
  "fixtures.auth_amber_create",
  "fixtures.auth_amber_created",
  "fixtures.auth_cobalt_create",
  "fixtures.auth_cobalt_created",
  "fixtures.database_begin",
  "fixtures.restaurants_inserted",
  "fixtures.branches_inserted",
  "fixtures.memberships_inserted",
  "fixtures.grants_inserted",
  "fixtures.database_committed",
] as const);

export type FixtureVerificationCheckpoint = (typeof FIXTURE_VERIFICATION_CHECKPOINTS)[number];

export const MENU_CATALOG_VERIFICATION_CHECKPOINTS = Object.freeze([
  "menu_catalog.unauthenticated_write",
  "menu_catalog.empty_persistence",
  "menu_catalog.manager_empty_read",
  "menu_catalog.manager_empty_response_received",
  "menu_catalog.manager_empty_status_verified",
  "menu_catalog.manager_empty_cache_verified",
  "menu_catalog.manager_empty_json_decoded",
  "menu_catalog.manager_empty_parsed",
  "menu_catalog.manager_empty_scope_verified",
  "menu_catalog.manager_empty_catalog_verified",
  "menu_catalog.other_tenant_empty_read",
  "menu_catalog.false_pair_read_rejected",
  "menu_catalog.manager_publish",
  "menu_catalog.manager_publish_response_verified",
  "menu_catalog.published_persistence",
  "menu_catalog.publish_replay",
  "menu_catalog.publish_replay_response_verified",
  "menu_catalog.replay_persistence",
  "menu_catalog.viewer_read",
  "menu_catalog.idempotency_conflict",
  "menu_catalog.conflict_persistence",
  "menu_catalog.viewer_write_rejected",
  "menu_catalog.viewer_write_persistence",
  "menu_catalog.false_pair_write_rejected",
  "menu_catalog.false_pair_write_persistence",
  "menu_catalog.revoked_read_rejected",
  "menu_catalog.revoked_write_rejected",
  "menu_catalog.revoked_persistence",
] as const);

export type MenuCatalogVerificationCheckpoint = (typeof MENU_CATALOG_VERIFICATION_CHECKPOINTS)[number];

export const ORDERS_REALTIME_VERIFICATION_CHECKPOINTS = Object.freeze([
  "orders_realtime.unauthenticated_create_rejected",
  "orders_realtime.empty_persistence",
  "orders_realtime.manager_create",
  "orders_realtime.create_replay",
  "orders_realtime.idempotency_conflict",
  "orders_realtime.viewer_write_rejected",
  "orders_realtime.cross_tenant_write_rejected",
  "orders_realtime.false_pair_write_rejected",
  "orders_realtime.order_opened",
  "orders_realtime.socket_subscribed",
  "orders_realtime.item_added",
  "orders_realtime.notification_received",
  "orders_realtime.duplicate_subscription_rejected",
  "orders_realtime.item_sent",
  "orders_realtime.item_preparing",
  "orders_realtime.item_ready",
  "orders_realtime.item_delivered",
  "orders_realtime.persistence_verified",
  "orders_realtime.cursor_page_verified",
  "orders_realtime.cursor_remainder_verified",
  "orders_realtime.station_isolation_verified",
  "orders_realtime.tenant_isolation_verified",
  "orders_realtime.revoked_recovery_rejected",
  "orders_realtime.revoked_subscription_rejected",
  "orders_realtime.cleanup_verified",
] as const);

export type OrdersRealtimeVerificationCheckpoint = (typeof ORDERS_REALTIME_VERIFICATION_CHECKPOINTS)[number];

export const KDS_TICKET_VERIFICATION_CHECKPOINTS = Object.freeze([
  "kds_tickets.unauthenticated_list_rejected",
  "kds_tickets.empty_list_verified",
  "kds_tickets.pending_item_excluded",
  "kds_tickets.sent_ticket_verified",
  "kds_tickets.station_isolation_verified",
  "kds_tickets.branch_isolation_verified",
  "kds_tickets.tenant_isolation_verified",
  "kds_tickets.preparing_ticket_verified",
  "kds_tickets.ready_ticket_verified",
  "kds_tickets.delivered_ticket_removed",
  "kds_tickets.revoked_list_rejected",
] as const);

export type KdsTicketVerificationCheckpoint = (typeof KDS_TICKET_VERIFICATION_CHECKPOINTS)[number];

export type MenuCatalogReadOutcome =
  | "fetch_failed"
  | "unexpected_status"
  | "cache_control_invalid"
  | "invalid_json"
  | "contract_invalid"
  | "scope_mismatch"
  | "catalog_mismatch"
  | "ok";

export interface MenuCatalogReadObservation {
  readonly cacheControlValid?: boolean;
  readonly catalogMatches?: boolean;
  readonly contractValid?: boolean;
  readonly fetchSucceeded: boolean;
  readonly httpStatus?: number;
  readonly jsonDecoded?: boolean;
  readonly scopeMatches?: boolean;
  readonly transportFailure?: DiningLayoutTransportFailure;
}

export interface MenuCatalogReadDiagnostic {
  readonly cacheControlValid: boolean | null;
  readonly catalogMatches: boolean | null;
  readonly contractValid: boolean | null;
  readonly httpStatus: number | null;
  readonly jsonDecoded: boolean | null;
  readonly outcome: MenuCatalogReadOutcome;
  readonly scopeMatches: boolean | null;
  readonly transportFailure: DiningLayoutTransportFailure | null;
}

export type DiningLayoutReadOutcome =
  | "fetch_failed"
  | "unexpected_status"
  | "cache_control_invalid"
  | "invalid_json"
  | "contract_invalid"
  | "scope_mismatch"
  | "zone_missing"
  | "table_missing"
  | "table_mismatch"
  | "ok";

export type DiningLayoutTransportFailure =
  | "connection_refused"
  | "connection_reset"
  | "socket_closed"
  | "timeout"
  | "network_unreachable"
  | "other";

export interface DiningLayoutReadObservation {
  readonly cacheControlValid?: boolean;
  readonly contractValid?: boolean;
  readonly fetchSucceeded: boolean;
  readonly httpStatus?: number;
  readonly jsonDecoded?: boolean;
  readonly scopeMatches?: boolean;
  readonly tableFound?: boolean;
  readonly tableMatches?: boolean;
  readonly transportFailure?: DiningLayoutTransportFailure;
  readonly zoneFound?: boolean;
}

export interface DiningLayoutReadDiagnostic {
  readonly cacheControlValid: boolean | null;
  readonly contractValid: boolean | null;
  readonly httpStatus: number | null;
  readonly jsonDecoded: boolean | null;
  readonly outcome: DiningLayoutReadOutcome;
  readonly scopeMatches: boolean | null;
  readonly tableFound: boolean | null;
  readonly tableMatches: boolean | null;
  readonly transportFailure: DiningLayoutTransportFailure | null;
  readonly zoneFound: boolean | null;
}

export function diagnoseDiningLayoutRead(
  observation: DiningLayoutReadObservation,
): DiningLayoutReadDiagnostic {
  const outcome = diningLayoutReadOutcome(observation);
  return Object.freeze({
    cacheControlValid: optionalBoolean(observation.cacheControlValid),
    contractValid: optionalBoolean(observation.contractValid),
    httpStatus: Number.isInteger(observation.httpStatus) && (observation.httpStatus ?? -1) >= 0
      && (observation.httpStatus ?? 600) <= 599
      ? observation.httpStatus ?? null
      : null,
    jsonDecoded: optionalBoolean(observation.jsonDecoded),
    outcome,
    scopeMatches: optionalBoolean(observation.scopeMatches),
    tableFound: optionalBoolean(observation.tableFound),
    tableMatches: optionalBoolean(observation.tableMatches),
    transportFailure: observation.transportFailure ?? null,
    zoneFound: optionalBoolean(observation.zoneFound),
  });
}

export function diagnoseMenuCatalogRead(
  observation: MenuCatalogReadObservation,
): MenuCatalogReadDiagnostic {
  return Object.freeze({
    cacheControlValid: optionalBoolean(observation.cacheControlValid),
    catalogMatches: optionalBoolean(observation.catalogMatches),
    contractValid: optionalBoolean(observation.contractValid),
    httpStatus: Number.isInteger(observation.httpStatus) && (observation.httpStatus ?? -1) >= 0
      && (observation.httpStatus ?? 600) <= 599
      ? observation.httpStatus ?? null
      : null,
    jsonDecoded: optionalBoolean(observation.jsonDecoded),
    outcome: menuCatalogReadOutcome(observation),
    scopeMatches: optionalBoolean(observation.scopeMatches),
    transportFailure: observation.transportFailure ?? null,
  });
}

export function classifyDiningLayoutFetchFailure(error: unknown): DiningLayoutTransportFailure {
  const code = safeErrorCode(error) ?? safeErrorCode(safeErrorCause(error));
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ECONNRESET") return "connection_reset";
  if (code === "UND_ERR_SOCKET") return "socket_closed";
  if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code ?? "")) return "timeout";
  if (["ENETUNREACH", "EHOSTUNREACH"].includes(code ?? "")) return "network_unreachable";
  return "other";
}

export function requiredDiningTableAuditEventIds(
  progress: Readonly<{ created: boolean; updated: boolean }>,
  createdEventId: string,
  updatedEventId: string,
): readonly string[] {
  if (progress.updated && !progress.created) throw new Error("TENANCY_DINING_TABLE_PROGRESS_INVALID");
  if (!progress.created) return Object.freeze([]);
  return Object.freeze([
    createdEventId,
    ...(progress.updated ? [updatedEventId] : []),
  ]);
}

function diningLayoutReadOutcome(observation: DiningLayoutReadObservation): DiningLayoutReadOutcome {
  if (!observation.fetchSucceeded) return "fetch_failed";
  if (observation.httpStatus !== 200) return "unexpected_status";
  if (observation.cacheControlValid !== true) return "cache_control_invalid";
  if (observation.jsonDecoded !== true) return "invalid_json";
  if (observation.contractValid !== true) return "contract_invalid";
  if (observation.scopeMatches !== true) return "scope_mismatch";
  if (observation.zoneFound !== true) return "zone_missing";
  if (observation.tableFound !== true) return "table_missing";
  if (observation.tableMatches !== true) return "table_mismatch";
  return "ok";
}

function menuCatalogReadOutcome(observation: MenuCatalogReadObservation): MenuCatalogReadOutcome {
  if (!observation.fetchSucceeded) return "fetch_failed";
  if (observation.httpStatus !== 200) return "unexpected_status";
  if (observation.cacheControlValid !== true) return "cache_control_invalid";
  if (observation.jsonDecoded !== true) return "invalid_json";
  if (observation.contractValid !== true) return "contract_invalid";
  if (observation.scopeMatches !== true) return "scope_mismatch";
  if (observation.catalogMatches !== true) return "catalog_mismatch";
  return "ok";
}

function optionalBoolean(value: boolean | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function safeErrorCause(error: unknown): unknown {
  try {
    return typeof error === "object" && error !== null ? Reflect.get(error, "cause") : undefined;
  } catch {
    return undefined;
  }
}

function safeErrorCode(error: unknown): string | undefined {
  try {
    const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
    return typeof code === "string" && code.length <= 64 ? code : undefined;
  } catch {
    return undefined;
  }
}
