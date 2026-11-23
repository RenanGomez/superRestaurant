import {
  MANUAL_REVIEW_CASE_SCHEMA_VERSION,
  MANUAL_REVIEW_CASE_STATUSES,
  SUPPORTED_SYNC_SCHEMA_VERSIONS,
  SYNC_CATALOG_VERSION,
  SYNC_CLIENT_TYPES,
  SYNC_CONNECTIVITY_STATES,
  SYNC_CURSOR_RESYNC_CODES,
  SYNC_ENTITY_CATALOG_V1,
  SYNC_ENTITY_TYPES,
  SYNC_ENVELOPE_KEYS,
  SYNC_FINANCIAL_ENTITY_TYPES,
  SYNC_OPERATIONS,
  SYNC_OUTBOX_STATES,
  SYNC_PROTOCOL_VERSION,
  SYNC_REVOCATION_CODES,
  SYNC_SCHEMA_VERSION,
  SYNC_SERVER_RESULT_STATUSES,
  getSyncEntityCatalogEntryV1,
  isRfc3339UtcTimestamp,
  isStableSyncCode,
  isSyncEntityOperationAllowedV1,
  isSyncFinancialEntityTypeV1,
  isSyncId,
  isSyncSchemaVersionFormat,
  parseManualReviewCaseV1,
  parseResolveManualReviewCaseCommandV1,
  parseSyncEnvelopeV1,
  parseSyncPullRequestV1,
  parseSyncPullResponseV1,
  parseSyncPushRequestV1,
  parseSyncPushResponseV1,
  parseSyncScopeV1,
  parseSyncSnapshotResyncRequestV1,
  parseSyncSnapshotResyncResponseV1,
  type BranchScope,
  type ManualReviewCaseStatusV1,
  type ManualReviewCaseV1,
  type ResolveManualReviewCaseCommandV1,
  type SyncClientTypeV1,
  type SyncConnectivityStateV1,
  type SyncEntityCatalogEntryV1,
  type SyncEntityTypeV1,
  type SyncEnvelopeV1,
  type SyncEventResultV1,
  type SyncFinancialEntityTypeV1,
  type SyncOperationV1,
  type SyncOutboxStateV1,
  type SyncPullChangeV1,
  type SyncPullRequestV1,
  type SyncPullResponseV1,
  type SyncPushRequestV1,
  type SyncPushResponseV1,
  type SyncServerResultStatusV1,
  type SyncSnapshotEntityV1,
  type SyncSnapshotResyncRequestV1,
  type SyncSnapshotResyncResponseV1,
} from "@super-restaurant/shared-types";
import { fail, ok, type ParseResult } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { asPlainRecord, hasExactKeys, isSafeNonNegativeInteger } from "./json.js";
import { checkPayload, type PayloadMode } from "./payload-guard.js";

export {
  MANUAL_REVIEW_CASE_SCHEMA_VERSION,
  MANUAL_REVIEW_CASE_STATUSES,
  SUPPORTED_SYNC_SCHEMA_VERSIONS,
  SYNC_CATALOG_VERSION,
  SYNC_CLIENT_TYPES,
  SYNC_CONNECTIVITY_STATES,
  SYNC_CURSOR_RESYNC_CODES,
  SYNC_ENTITY_CATALOG_V1,
  SYNC_ENTITY_TYPES,
  SYNC_ENVELOPE_KEYS,
  SYNC_FINANCIAL_ENTITY_TYPES,
  SYNC_OPERATIONS,
  SYNC_OUTBOX_STATES,
  SYNC_PROTOCOL_VERSION,
  SYNC_REVOCATION_CODES,
  SYNC_SCHEMA_VERSION,
  SYNC_SERVER_RESULT_STATUSES,
  getSyncEntityCatalogEntryV1,
  isSyncEntityOperationAllowedV1,
  isSyncFinancialEntityTypeV1,
  isSyncId,
  isSyncSchemaVersionFormat,
  parseManualReviewCaseV1,
  parseResolveManualReviewCaseCommandV1,
  parseSyncEnvelopeV1,
  parseSyncPullRequestV1,
  parseSyncPullResponseV1,
  parseSyncPushRequestV1,
  parseSyncPushResponseV1,
  parseSyncScopeV1,
  parseSyncSnapshotResyncRequestV1,
  parseSyncSnapshotResyncResponseV1,
};

export type {
  ManualReviewCaseStatusV1,
  ManualReviewCaseV1,
  ResolveManualReviewCaseCommandV1,
  SyncClientTypeV1,
  SyncConnectivityStateV1,
  SyncEntityCatalogEntryV1,
  SyncEntityTypeV1,
  SyncEnvelopeV1,
  SyncEventResultV1,
  SyncFinancialEntityTypeV1,
  SyncOperationV1,
  SyncOutboxStateV1,
  SyncPullChangeV1,
  SyncPullRequestV1,
  SyncPullResponseV1,
  SyncPushRequestV1,
  SyncPushResponseV1,
  SyncServerResultStatusV1,
  SyncSnapshotEntityV1,
  SyncSnapshotResyncRequestV1,
  SyncSnapshotResyncResponseV1,
};

export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = SUPPORTED_SYNC_SCHEMA_VERSIONS;
export const OUTBOX_STATES = SYNC_OUTBOX_STATES;
export type OutboxState = SyncOutboxStateV1;
export const SERVER_RESULT_STATUSES = SYNC_SERVER_RESULT_STATUSES;
export type ServerResultStatus = SyncServerResultStatusV1;
export type SyncOperation = SyncOperationV1;
export const FINANCIAL_ENTITY_TYPES: readonly string[] = SYNC_FINANCIAL_ENTITY_TYPES;
export const REVOCATION_CODES: readonly string[] = SYNC_REVOCATION_CODES;
export const CURSOR_RESYNC_CODES: readonly string[] = SYNC_CURSOR_RESYNC_CODES;
export const ENVELOPE_KEYS = SYNC_ENVELOPE_KEYS;

export type SyncEnvelope = SyncEnvelopeV1;
export type SyncPushRequest = SyncPushRequestV1;
export type SyncEventResult = SyncEventResultV1;
export type SyncPushResponse = SyncPushResponseV1;
export type SyncPullRequest = SyncPullRequestV1;
export type SyncPullChange = SyncPullChangeV1;
export type SyncPullResponse = SyncPullResponseV1;
export type SyncSnapshotResyncRequest = SyncSnapshotResyncRequestV1;
export type SyncSnapshotEntity = SyncSnapshotEntityV1;
export type SyncSnapshotResyncResponse = SyncSnapshotResyncResponseV1;

export const isStableCode = isStableSyncCode;
export const isRfc3339Utc = isRfc3339UtcTimestamp;

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/u;

export interface SyncScopeInput {
  readonly restaurantId: string;
  readonly branchId: string;
}

export function parseSyncScope(value: unknown): ParseResult<BranchScope> {
  const scope = parseSyncScopeV1(value);
  if (scope === undefined) return fail("SCOPE_INVALID", "scope");
  return ok(scope);
}

export function scopeKey(scope: SyncScopeInput): string {
  return `${scope.restaurantId}/${scope.branchId}`;
}

export interface ParseEnvelopeOptions {
  readonly mode?: PayloadMode;
  /** Only enabled during durable hydration so schema-migration can upgrade or quarantine legacy entries. */
  readonly allowLegacySchemaVersion?: boolean;
}

export function parseSyncEnvelope(
  value: unknown,
  modeOrOptions: PayloadMode | ParseEnvelopeOptions = "strict",
): ParseResult<SyncEnvelopeV1> {
  const mode: PayloadMode = typeof modeOrOptions === "string" ? modeOrOptions : (modeOrOptions.mode ?? "strict");
  const allowLegacy = typeof modeOrOptions === "string" ? false : (modeOrOptions.allowLegacySchemaVersion === true);

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
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return fail("ENVELOPE_INVALID", "idempotencyKey");
  }
  const entityType = record["entityType"];
  if (typeof entityType !== "string" || getSyncEntityCatalogEntryV1(entityType) === undefined) {
    return fail("ENVELOPE_INVALID", "entityType");
  }
  const operation = record["operation"];
  if (typeof operation !== "string" || !isSyncEntityOperationAllowedV1(entityType, operation)) {
    return fail("ENVELOPE_INVALID", "operation");
  }
  const schemaVersion = record["schemaVersion"];
  if (typeof schemaVersion !== "string") return fail("ENVELOPE_INVALID", "schemaVersion");
  if (!SUPPORTED_SYNC_SCHEMA_VERSIONS.includes(schemaVersion)) {
    if (!allowLegacy || !isSyncSchemaVersionFormat(schemaVersion)) {
      return fail("SCHEMA_UNSUPPORTED", "schemaVersion");
    }
  }
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
  if (typeof localState !== "string" || !(OUTBOX_STATES as readonly string[]).includes(localState)) {
    return fail("ENVELOPE_INVALID", "localState");
  }
  const payload = checkPayload(record["payload"], mode);
  if (!payload.ok) return payload;

  if (!allowLegacy || SUPPORTED_SYNC_SCHEMA_VERSIONS.includes(schemaVersion)) {
    const canonical = parseSyncEnvelopeV1({
      ...record,
      payload: payload.value,
    });
    if (canonical === undefined) return fail("ENVELOPE_INVALID", "envelope");
    return ok(canonical);
  }

  return ok(deepFreeze({
    eventId: record["eventId"] as string,
    idempotencyKey,
    deviceId: record["deviceId"] as string,
    actorId: record["actorId"] as string,
    restaurantId: scope.value.restaurantId,
    branchId: scope.value.branchId,
    entityType: entityType as SyncEntityTypeV1,
    entityId: record["entityId"] as string,
    operation: operation as SyncOperationV1,
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
export interface OutboxEntry extends SyncEnvelopeV1 {
  readonly leaseUntil: number | null;
  readonly attemptId: string | null;
  readonly nextAttemptAt: number | null;
  readonly lastErrorCode: string | null;
  readonly blockedBy: string | null;
  readonly resolvedBy: string | null;
  readonly outcome: OutboxOutcome | null;
  readonly updatedAt: number;
}

export function toEnvelope(entry: SyncEnvelopeV1): SyncEnvelopeV1 {
  return Object.freeze({
    eventId: entry.eventId,
    idempotencyKey: entry.idempotencyKey,
    deviceId: entry.deviceId,
    actorId: entry.actorId,
    restaurantId: entry.restaurantId,
    branchId: entry.branchId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    operation: entry.operation,
    schemaVersion: entry.schemaVersion,
    localSequence: entry.localSequence,
    baseVersion: entry.baseVersion,
    occurredAt: entry.occurredAt,
    receivedAt: entry.receivedAt,
    payload: entry.payload,
    retryCount: entry.retryCount,
    localState: entry.localState,
  });
}

const ENTRY_META_KEYS = [
  "leaseUntil",
  "attemptId",
  "nextAttemptAt",
  "lastErrorCode",
  "blockedBy",
  "resolvedBy",
  "outcome",
  "updatedAt",
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
  if (record === undefined || hasExactKeys(record, ["code", "canonicalVersion", "auditId"]) !== undefined) {
    return fail("STATE_CORRUPT", "outcome");
  }
  const { code, canonicalVersion, auditId } = record;
  if (!nullableCode(code) || !nullableInt(canonicalVersion) || !(auditId === null || (typeof auditId === "string" && auditId.length <= 128))) {
    return fail("STATE_CORRUPT", "outcome");
  }
  return ok(Object.freeze({ code, canonicalVersion, auditId }));
}

export function parseOutboxEntry(
  value: unknown,
  options: { readonly allowLegacySchemaVersion?: boolean } = {},
): ParseResult<OutboxEntry> {
  const record = asPlainRecord(value);
  if (record === undefined) return fail("STATE_CORRUPT", "outbox");
  const badKey = hasExactKeys(record, [...ENVELOPE_KEYS, ...ENTRY_META_KEYS]);
  if (badKey !== undefined) return fail("STATE_CORRUPT", badKey);
  const envelopeSource: Record<string, unknown> = {};
  for (const key of ENVELOPE_KEYS) envelopeSource[key] = record[key];
  // Hydration trusts what strict enqueue already validated for field names, while enforcing no floats, depth and size.
  const envelope = parseSyncEnvelope(envelopeSource, {
    mode: "inbound",
    allowLegacySchemaVersion: options.allowLegacySchemaVersion === true,
  });
  if (!envelope.ok) return fail("STATE_CORRUPT", envelope.field);
  const outcome = parseOutcome(record["outcome"]);
  if (!outcome.ok) return outcome;
  const { leaseUntil, attemptId, nextAttemptAt, lastErrorCode, blockedBy, resolvedBy, updatedAt } = record;
  if (!nullableInt(leaseUntil) || !nullableInt(nextAttemptAt) || !isSafeNonNegativeInteger(updatedAt)) {
    return fail("STATE_CORRUPT", "timing");
  }
  if (!(attemptId === null || isSyncId(attemptId)) || !nullableCode(lastErrorCode)) {
    return fail("STATE_CORRUPT", "attempt");
  }
  if (!(blockedBy === null || isSyncId(blockedBy)) || !(resolvedBy === null || isSyncId(resolvedBy))) {
    return fail("STATE_CORRUPT", "links");
  }
  if (envelope.value.localState === "sending" && (leaseUntil === null || attemptId === null)) {
    return fail("STATE_CORRUPT", "lease");
  }
  return ok(deepFreeze({
    ...envelope.value,
    leaseUntil,
    attemptId,
    nextAttemptAt,
    lastErrorCode,
    blockedBy,
    resolvedBy,
    outcome: outcome.value,
    updatedAt,
  }));
}

// ---- Wire response parsing (delegated to @super-restaurant/shared-types) -------------------

function sameBranchScope(left: SyncScopeInput, right: SyncScopeInput): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

export function parsePushResponse(value: unknown, expectedScope?: SyncScopeInput): ParseResult<SyncPushResponseV1> {
  const parsed = parseSyncPushResponseV1(value);
  if (parsed === undefined) return fail("PUSH_RESPONSE_INVALID", "response");
  if (expectedScope !== undefined && !sameBranchScope(parsed.scope, expectedScope)) {
    return fail("PUSH_SCOPE_VIOLATION", "scope");
  }
  return ok(parsed);
}

/**
 * Validates a pull response using `@super-restaurant/shared-types`. Distinguishes cross-scope
 * violations (`PULL_SCOPE_VIOLATION`) from structural errors (`PULL_RESPONSE_INVALID`).
 */
export function parsePullResponse(value: unknown, expectedScope?: SyncScopeInput): ParseResult<SyncPullResponseV1> {
  const record = asPlainRecord(value);
  if (record !== undefined && hasExactKeys(record, ["protocolVersion", "scope", "changes", "nextCursor", "hasMore"]) === undefined) {
    const scope = parseSyncScopeV1(record["scope"]);
    if (scope !== undefined) {
      if (expectedScope !== undefined && !sameBranchScope(scope, expectedScope)) {
        return fail("PULL_SCOPE_VIOLATION", "scope");
      }
      const rawChanges = record["changes"];
      if (Array.isArray(rawChanges)) {
        for (const item of rawChanges as readonly unknown[]) {
          const change = asPlainRecord(item);
          if (change === undefined) continue;
          const rest = change["restaurantId"];
          const branch = change["branchId"];
          if (typeof rest === "string" && typeof branch === "string" && (rest !== scope.restaurantId || branch !== scope.branchId)) {
            return fail("PULL_SCOPE_VIOLATION", "changes");
          }
        }
      }
    }
  }
  const parsed = parseSyncPullResponseV1(value);
  if (parsed === undefined) return fail("PULL_RESPONSE_INVALID", "response");
  if (expectedScope !== undefined && !sameBranchScope(parsed.scope, expectedScope)) {
    return fail("PULL_SCOPE_VIOLATION", "scope");
  }
  return ok(parsed);
}

export function parseSnapshotResyncResponse(
  value: unknown,
  expectedScope?: SyncScopeInput,
): ParseResult<SyncSnapshotResyncResponseV1> {
  const record = asPlainRecord(value);
  if (record !== undefined && hasExactKeys(record, ["protocolVersion", "scope", "snapshotCursor", "entities", "generatedAt"]) === undefined) {
    const scope = parseSyncScopeV1(record["scope"]);
    if (scope !== undefined) {
      if (expectedScope !== undefined && !sameBranchScope(scope, expectedScope)) {
        return fail("PULL_SCOPE_VIOLATION", "scope");
      }
      const rawEntities = record["entities"];
      if (Array.isArray(rawEntities)) {
        for (const item of rawEntities as readonly unknown[]) {
          const entity = asPlainRecord(item);
          if (entity === undefined) continue;
          const rest = entity["restaurantId"];
          const branch = entity["branchId"];
          if (typeof rest === "string" && typeof branch === "string" && (rest !== scope.restaurantId || branch !== scope.branchId)) {
            return fail("PULL_SCOPE_VIOLATION", "entities");
          }
        }
      }
    }
  }
  const parsed = parseSyncSnapshotResyncResponseV1(value);
  if (parsed === undefined) return fail("RESYNC_SNAPSHOT_INVALID", "snapshot");
  if (expectedScope !== undefined && !sameBranchScope(parsed.scope, expectedScope)) {
    return fail("PULL_SCOPE_VIOLATION", "scope");
  }
  return ok(parsed);
}
