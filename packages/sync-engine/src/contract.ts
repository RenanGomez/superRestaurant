import { parseBranchScope, type BranchScope } from "@super-restaurant/shared-types";
import { fail, ok, type ParseResult } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { asPlainRecord, hasExactKeys, isSafeNonNegativeInteger, type JsonObject } from "./json.js";
import { checkPayload, type PayloadMode } from "./payload-guard.js";

export const SYNC_PROTOCOL_VERSION = 1;
export const SYNC_SCHEMA_VERSION = "1";
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = [SYNC_SCHEMA_VERSION];

export const OUTBOX_STATES = [
  "pending",
  "sending",
  "retry_wait",
  "accepted",
  "duplicate",
  "rejected",
  "conflict",
  "manual_review",
] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];

export const SERVER_RESULT_STATUSES = ["accepted", "duplicate", "rejected", "conflict", "manual_review"] as const;
export type ServerResultStatus = (typeof SERVER_RESULT_STATUSES)[number];

export const SYNC_OPERATIONS = ["create", "update", "transition", "delete", "compensate"] as const;
export type SyncOperation = (typeof SYNC_OPERATIONS)[number];

export const FINANCIAL_ENTITY_TYPES: readonly string[] = ["Payment", "CashMovement"];
export const REVOCATION_CODES: readonly string[] = ["AUTH_REVOKED", "DEVICE_REVOKED"];
export const CURSOR_RESYNC_CODES: readonly string[] = ["CURSOR_INVALID", "CURSOR_EXPIRED", "CURSOR_SCOPE_MISMATCH"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/iu;
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;
const ENTITY_TYPE = /^[A-Z][A-Za-z0-9]{0,63}$/u;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

export function isSyncId(value: unknown): value is string {
  return typeof value === "string" && (UUID.test(value) || ULID.test(value));
}

export function isStableCode(value: unknown): value is string {
  return typeof value === "string" && STABLE_CODE.test(value);
}

export function isRfc3339Utc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339_UTC.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export interface SyncScopeInput {
  readonly restaurantId: string;
  readonly branchId: string;
}

export function parseSyncScope(value: unknown): ParseResult<BranchScope> {
  const scope = parseBranchScope(value);
  if (scope === undefined || !isSyncId(scope.restaurantId) || !isSyncId(scope.branchId)) {
    return fail("SCOPE_INVALID", "scope");
  }
  return ok(scope);
}

export function scopeKey(scope: SyncScopeInput): string {
  return `${scope.restaurantId}/${scope.branchId}`;
}

/** The 17-field envelope of OFFLINE_SYNC_CONTRACT section 3. */
export interface SyncEnvelope {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: SyncOperation;
  readonly schemaVersion: string;
  readonly localSequence: number;
  readonly baseVersion: number | null;
  readonly occurredAt: string;
  readonly receivedAt: string | null;
  readonly payload: JsonObject;
  readonly retryCount: number;
  readonly localState: OutboxState;
}

export const ENVELOPE_KEYS = [
  "eventId", "idempotencyKey", "deviceId", "actorId", "restaurantId", "branchId", "entityType", "entityId",
  "operation", "schemaVersion", "localSequence", "baseVersion", "occurredAt", "receivedAt", "payload",
  "retryCount", "localState",
] as const;

export function parseSyncEnvelope(value: unknown, mode: PayloadMode = "strict"): ParseResult<SyncEnvelope> {
  const record = asPlainRecord(value);
  if (record === undefined) return fail("ENVELOPE_INVALID", "envelope");
  const badKey = hasExactKeys(record, ENVELOPE_KEYS);
  if (badKey !== undefined) return fail("ENVELOPE_INVALID", badKey);

  const scope = parseSyncScope({ restaurantId: record["restaurantId"], branchId: record["branchId"] });
  if (!scope.ok) return scope;
  for (const field of ["eventId", "deviceId", "actorId", "entityId"] as const) {
    if (!isSyncId(record[field])) return fail("ENVELOPE_INVALID", field);
  }
  const idempotencyKey = record["idempotencyKey"];
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) return fail("ENVELOPE_INVALID", "idempotencyKey");
  const entityType = record["entityType"];
  if (typeof entityType !== "string" || !ENTITY_TYPE.test(entityType)) return fail("ENVELOPE_INVALID", "entityType");
  const operation = record["operation"];
  if (typeof operation !== "string" || !(SYNC_OPERATIONS as readonly string[]).includes(operation)) return fail("ENVELOPE_INVALID", "operation");
  const schemaVersion = record["schemaVersion"];
  if (typeof schemaVersion !== "string") return fail("ENVELOPE_INVALID", "schemaVersion");
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) return fail("SCHEMA_UNSUPPORTED", "schemaVersion");
  const localSequence = record["localSequence"];
  if (!isSafeNonNegativeInteger(localSequence)) return fail("ENVELOPE_INVALID", "localSequence");
  const baseVersion = record["baseVersion"];
  if (baseVersion !== null && !isSafeNonNegativeInteger(baseVersion)) return fail("ENVELOPE_INVALID", "baseVersion");
  if ((operation === "create") !== (baseVersion === null)) return fail("ENVELOPE_INVALID", "baseVersion");
  const occurredAt = record["occurredAt"];
  if (!isRfc3339Utc(occurredAt)) return fail("ENVELOPE_INVALID", "occurredAt");
  const receivedAt = record["receivedAt"];
  if (receivedAt !== null && !isRfc3339Utc(receivedAt)) return fail("ENVELOPE_INVALID", "receivedAt");
  const retryCount = record["retryCount"];
  if (!isSafeNonNegativeInteger(retryCount)) return fail("ENVELOPE_INVALID", "retryCount");
  const localState = record["localState"];
  if (typeof localState !== "string" || !(OUTBOX_STATES as readonly string[]).includes(localState)) return fail("ENVELOPE_INVALID", "localState");
  const payload = checkPayload(record["payload"], mode);
  if (!payload.ok) return payload;

  return ok(deepFreeze({
    eventId: record["eventId"] as string,
    idempotencyKey,
    deviceId: record["deviceId"] as string,
    actorId: record["actorId"] as string,
    restaurantId: scope.value.restaurantId,
    branchId: scope.value.branchId,
    entityType,
    entityId: record["entityId"] as string,
    operation: operation as SyncOperation,
    schemaVersion,
    localSequence,
    baseVersion,
    occurredAt,
    receivedAt,
    payload: payload.value,
    retryCount,
    localState: localState as OutboxState,
  }));
}

export interface OutboxOutcome {
  readonly code: string | null;
  readonly canonicalVersion: number | null;
  readonly auditId: string | null;
}

/** Durable outbox record: the immutable intent plus local delivery metadata (times are epoch ms). */
export interface OutboxEntry extends SyncEnvelope {
  readonly leaseUntil: number | null;
  readonly attemptId: string | null;
  readonly nextAttemptAt: number | null;
  readonly lastErrorCode: string | null;
  readonly blockedBy: string | null;
  readonly resolvedBy: string | null;
  readonly outcome: OutboxOutcome | null;
  readonly updatedAt: number;
}

export function toEnvelope(entry: SyncEnvelope): SyncEnvelope {
  return Object.freeze({
    eventId: entry.eventId, idempotencyKey: entry.idempotencyKey, deviceId: entry.deviceId, actorId: entry.actorId,
    restaurantId: entry.restaurantId, branchId: entry.branchId, entityType: entry.entityType, entityId: entry.entityId,
    operation: entry.operation, schemaVersion: entry.schemaVersion, localSequence: entry.localSequence,
    baseVersion: entry.baseVersion, occurredAt: entry.occurredAt, receivedAt: entry.receivedAt, payload: entry.payload,
    retryCount: entry.retryCount, localState: entry.localState,
  });
}

const ENTRY_META_KEYS = [
  "leaseUntil", "attemptId", "nextAttemptAt", "lastErrorCode", "blockedBy", "resolvedBy", "outcome", "updatedAt",
] as const;

function nullableCode(value: unknown): value is string | null {
  return value === null || isStableCode(value);
}

function nullableInt(value: unknown): value is number | null {
  return value === null || isSafeNonNegativeInteger(value);
}

function parseOutcome(value: unknown): ParseResult<OutboxOutcome | null> {
  if (value === null) return ok(null);
  const record = asPlainRecord(value);
  if (record === undefined || hasExactKeys(record, ["code", "canonicalVersion", "auditId"]) !== undefined) return fail("STATE_CORRUPT", "outcome");
  const { code, canonicalVersion, auditId } = record;
  if (!nullableCode(code) || !nullableInt(canonicalVersion) || !(auditId === null || (typeof auditId === "string" && auditId.length <= 128))) {
    return fail("STATE_CORRUPT", "outcome");
  }
  return ok(Object.freeze({ code, canonicalVersion, auditId }));
}

export function parseOutboxEntry(value: unknown): ParseResult<OutboxEntry> {
  const record = asPlainRecord(value);
  if (record === undefined) return fail("STATE_CORRUPT", "outbox");
  const badKey = hasExactKeys(record, [...ENVELOPE_KEYS, ...ENTRY_META_KEYS]);
  if (badKey !== undefined) return fail("STATE_CORRUPT", badKey);
  const envelopeSource: Record<string, unknown> = {};
  for (const key of ENVELOPE_KEYS) envelopeSource[key] = record[key];
  // Hydration trusts what strict enqueue already validated: shape, depth and size only.
  const envelope = parseSyncEnvelope(envelopeSource, "inbound");
  if (!envelope.ok) return fail("STATE_CORRUPT", envelope.field);
  const outcome = parseOutcome(record["outcome"]);
  if (!outcome.ok) return outcome;
  const { leaseUntil, attemptId, nextAttemptAt, lastErrorCode, blockedBy, resolvedBy, updatedAt } = record;
  if (!nullableInt(leaseUntil) || !nullableInt(nextAttemptAt) || !isSafeNonNegativeInteger(updatedAt)) return fail("STATE_CORRUPT", "timing");
  if (!(attemptId === null || isSyncId(attemptId)) || !nullableCode(lastErrorCode)) return fail("STATE_CORRUPT", "attempt");
  if (!(blockedBy === null || isSyncId(blockedBy)) || !(resolvedBy === null || isSyncId(resolvedBy))) return fail("STATE_CORRUPT", "links");
  if (envelope.value.localState === "sending" && (leaseUntil === null || attemptId === null)) return fail("STATE_CORRUPT", "lease");
  return ok(deepFreeze({
    ...envelope.value, leaseUntil, attemptId, nextAttemptAt, lastErrorCode, blockedBy, resolvedBy, outcome: outcome.value, updatedAt,
  }));
}

// ---- Wire contract -------------------------------------------------------------------------

export interface SyncPushRequest {
  readonly protocolVersion: number;
  readonly deviceId: string;
  readonly scope: BranchScope;
  readonly events: readonly SyncEnvelope[];
}

export interface SyncEventResult {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly status: ServerResultStatus;
  readonly code: string | null;
  readonly canonicalVersion: number | null;
  readonly auditId: string | null;
}

export interface SyncPushResponse {
  readonly results: readonly SyncEventResult[];
}

export interface SyncPullRequest {
  readonly protocolVersion: number;
  readonly scope: BranchScope;
  /** Opaque, scoped cursor. `null` starts the first scoped load. Never decoded or compared by the client. */
  readonly cursor: string | null;
  readonly limit: number;
}

export interface SyncPullChange {
  readonly entityType: string;
  readonly entityId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly canonicalVersion: number;
  readonly tombstone: boolean;
  readonly snapshot: JsonObject | null;
}

export interface SyncPullResponse {
  readonly scope: BranchScope;
  readonly changes: readonly SyncPullChange[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

function parseEventResult(value: unknown): ParseResult<SyncEventResult> {
  const record = asPlainRecord(value);
  if (record === undefined) return fail("PUSH_RESPONSE_INVALID", "result");
  const { eventId, idempotencyKey, status, code, canonicalVersion, auditId } = record;
  if (!isSyncId(eventId) || typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) return fail("PUSH_RESPONSE_INVALID", "identity");
  if (typeof status !== "string" || !(SERVER_RESULT_STATUSES as readonly string[]).includes(status)) return fail("PUSH_RESPONSE_INVALID", "status");
  const stableCode = code ?? null;
  const version = canonicalVersion ?? null;
  if (!nullableCode(stableCode) || !nullableInt(version)) return fail("PUSH_RESPONSE_INVALID", "outcome");
  if (!(auditId === undefined || auditId === null || (typeof auditId === "string" && auditId.length <= 128))) return fail("PUSH_RESPONSE_INVALID", "auditId");
  return ok(Object.freeze({
    eventId, idempotencyKey, status: status as ServerResultStatus,
    code: stableCode, canonicalVersion: version, auditId: auditId ?? null,
  }));
}

export function parsePushResponse(value: unknown): ParseResult<SyncPushResponse> {
  const record = asPlainRecord(value);
  const raw = record?.["results"];
  if (record === undefined || !Array.isArray(raw)) return fail("PUSH_RESPONSE_INVALID", "results");
  const results: SyncEventResult[] = [];
  for (const item of raw as readonly unknown[]) {
    const result = parseEventResult(item);
    if (!result.ok) return result;
    results.push(result.value);
  }
  return ok(Object.freeze({ results: Object.freeze(results) }));
}

function parseChange(value: unknown): ParseResult<SyncPullChange> {
  const record = asPlainRecord(value);
  if (record === undefined) return fail("PULL_RESPONSE_INVALID", "change");
  const { entityType, entityId, restaurantId, branchId, canonicalVersion, tombstone, snapshot } = record;
  if (typeof entityType !== "string" || !ENTITY_TYPE.test(entityType) || !isSyncId(entityId)) return fail("PULL_RESPONSE_INVALID", "entity");
  if (typeof restaurantId !== "string" || typeof branchId !== "string") return fail("PULL_RESPONSE_INVALID", "scope");
  if (!isSafeNonNegativeInteger(canonicalVersion) || typeof tombstone !== "boolean") return fail("PULL_RESPONSE_INVALID", "version");
  let parsedSnapshot: JsonObject | null = null;
  if (snapshot !== null && snapshot !== undefined) {
    const checked = checkPayload(snapshot, "inbound");
    if (!checked.ok) return fail("PULL_RESPONSE_INVALID", "snapshot");
    parsedSnapshot = checked.value;
  }
  return ok(Object.freeze({
    entityType, entityId, restaurantId, branchId, canonicalVersion, tombstone, snapshot: tombstone ? null : parsedSnapshot,
  }));
}

/** Shape-checks a pull response. Scope equality with the *requested* scope is enforced by the engine. */
export function parsePullResponse(value: unknown): ParseResult<SyncPullResponse> {
  const record = asPlainRecord(value);
  if (record === undefined) return fail("PULL_RESPONSE_INVALID", "response");
  const scope = parseBranchScope(record["scope"]);
  const changes = record["changes"];
  const nextCursor = record["nextCursor"];
  const hasMore = record["hasMore"];
  if (scope === undefined) return fail("PULL_RESPONSE_INVALID", "scope");
  if (!Array.isArray(changes)) return fail("PULL_RESPONSE_INVALID", "changes");
  if (!(nextCursor === null || (typeof nextCursor === "string" && nextCursor.length > 0 && nextCursor.length <= 2048))) return fail("PULL_RESPONSE_INVALID", "nextCursor");
  if (typeof hasMore !== "boolean") return fail("PULL_RESPONSE_INVALID", "hasMore");
  const parsed: SyncPullChange[] = [];
  for (const item of changes as readonly unknown[]) {
    const change = parseChange(item);
    if (!change.ok) return change;
    parsed.push(change.value);
  }
  return ok(Object.freeze({ scope, changes: Object.freeze(parsed), nextCursor, hasMore }));
}
