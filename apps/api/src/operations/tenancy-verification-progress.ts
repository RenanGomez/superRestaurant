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
