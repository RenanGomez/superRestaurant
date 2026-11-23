import type { BranchId, BranchScope, RestaurantId } from "./index.js";

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_SCHEMA_VERSION = "1" as const;
export const SYNC_CATALOG_VERSION = 1 as const;
export const MANUAL_REVIEW_CASE_SCHEMA_VERSION = 1 as const;

export const SUPPORTED_SYNC_SCHEMA_VERSIONS: readonly string[] = Object.freeze([SYNC_SCHEMA_VERSION] as const);

export const SYNC_MAX_BATCH_EVENTS = 100 as const;
export const SYNC_MAX_PULL_LIMIT = 500 as const;
export const SYNC_MAX_SNAPSHOT_ENTITIES = 5_000 as const;
export const SYNC_MAX_CURSOR_LENGTH = 2_048 as const;
export const SYNC_MAX_PAYLOAD_DEPTH = 8 as const;
export const SYNC_MAX_PAYLOAD_BYTES = 65_536 as const;

export const SYNC_CONNECTIVITY_STATES = Object.freeze([
  "online",
  "degraded",
  "offline",
  "reconnecting",
  "sync_blocked",
] as const);
export type SyncConnectivityStateV1 = (typeof SYNC_CONNECTIVITY_STATES)[number];

export const SYNC_CLIENT_TYPES = Object.freeze(["web_pos", "mobile", "kds"] as const);
export type SyncClientTypeV1 = (typeof SYNC_CLIENT_TYPES)[number];

export const SYNC_OUTBOX_STATES = Object.freeze([
  "pending",
  "sending",
  "retry_wait",
  "accepted",
  "duplicate",
  "rejected",
  "conflict",
  "manual_review",
] as const);
export type SyncOutboxStateV1 = (typeof SYNC_OUTBOX_STATES)[number];

export const SYNC_SERVER_RESULT_STATUSES = Object.freeze([
  "accepted",
  "duplicate",
  "rejected",
  "conflict",
  "manual_review",
] as const);
export type SyncServerResultStatusV1 = (typeof SYNC_SERVER_RESULT_STATUSES)[number];

export const SYNC_OPERATIONS = Object.freeze([
  "create",
  "update",
  "transition",
  "delete",
  "compensate",
] as const);
export type SyncOperationV1 = (typeof SYNC_OPERATIONS)[number];

export const SYNC_ENTITY_TYPES = Object.freeze([
  "Order",
  "OrderItem",
  "DiningTable",
  "KdsTicket",
  "Payment",
  "CashMovement",
  "CashRegisterSession",
  "Refund",
  "OrderDiscount",
  "MenuCatalog",
  "CaptureDraft",
  "Customer",
] as const);
export type SyncEntityTypeV1 = (typeof SYNC_ENTITY_TYPES)[number];

export const SYNC_FINANCIAL_ENTITY_TYPES = Object.freeze([
  "Payment",
  "CashMovement",
  "CashRegisterSession",
  "Refund",
  "OrderDiscount",
] as const);
export type SyncFinancialEntityTypeV1 = (typeof SYNC_FINANCIAL_ENTITY_TYPES)[number];

export const SYNC_REVOCATION_CODES = Object.freeze(["AUTH_REVOKED", "DEVICE_REVOKED"] as const);
export const SYNC_CURSOR_RESYNC_CODES = Object.freeze([
  "CURSOR_INVALID",
  "CURSOR_EXPIRED",
  "CURSOR_SCOPE_MISMATCH",
] as const);

export const MANUAL_REVIEW_CASE_STATUSES = Object.freeze([
  "open",
  "resolved_compensated",
  "resolved_rejected",
] as const);
export type ManualReviewCaseStatusV1 = (typeof MANUAL_REVIEW_CASE_STATUSES)[number];

export interface SyncEntityCatalogEntryV1 {
  readonly catalogVersion: typeof SYNC_CATALOG_VERSION;
  readonly entityType: SyncEntityTypeV1;
  readonly allowedOperations: readonly SyncOperationV1[];
  readonly financial: boolean;
  readonly allowTombstone: boolean;
  readonly requiresSupervisorForCompensate: boolean;
}

function catalogEntry(
  entityType: SyncEntityTypeV1,
  allowedOperations: readonly SyncOperationV1[],
  financial: boolean,
  allowTombstone: boolean,
  requiresSupervisorForCompensate: boolean,
): SyncEntityCatalogEntryV1 {
  return Object.freeze({
    catalogVersion: SYNC_CATALOG_VERSION,
    entityType,
    allowedOperations: Object.freeze([...allowedOperations]),
    financial,
    allowTombstone,
    requiresSupervisorForCompensate,
  });
}

/** Versioned Phase 3 sync catalog aligned with OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §2 & §4.2. */
export const SYNC_ENTITY_CATALOG_V1: Readonly<Record<SyncEntityTypeV1, SyncEntityCatalogEntryV1>> = Object.freeze({
  Order: catalogEntry("Order", ["create", "update", "transition", "compensate"], false, false, true),
  OrderItem: catalogEntry("OrderItem", ["create", "update", "transition", "delete", "compensate"], false, true, true),
  DiningTable: catalogEntry("DiningTable", ["create", "update", "transition", "delete"], false, true, false),
  KdsTicket: catalogEntry("KdsTicket", ["create", "transition", "compensate"], false, false, true),
  Payment: catalogEntry("Payment", ["create", "compensate"], true, false, true),
  CashMovement: catalogEntry("CashMovement", ["create", "compensate"], true, false, true),
  CashRegisterSession: catalogEntry("CashRegisterSession", ["create", "transition", "compensate"], true, false, true),
  Refund: catalogEntry("Refund", ["create", "compensate"], true, false, true),
  OrderDiscount: catalogEntry("OrderDiscount", ["create", "compensate"], true, false, true),
  MenuCatalog: catalogEntry("MenuCatalog", ["create", "update", "delete", "compensate"], false, true, false),
  CaptureDraft: catalogEntry("CaptureDraft", ["create", "update", "transition", "delete"], false, true, false),
  Customer: catalogEntry("Customer", ["create", "update", "delete"], false, true, false),
});

export function getSyncEntityCatalogEntryV1(entityType: string): SyncEntityCatalogEntryV1 | undefined {
  if (!Object.hasOwn(SYNC_ENTITY_CATALOG_V1, entityType)) return undefined;
  return SYNC_ENTITY_CATALOG_V1[entityType as SyncEntityTypeV1];
}

export function isSyncEntityOperationAllowedV1(entityType: string, operation: string): boolean {
  const entry = getSyncEntityCatalogEntryV1(entityType);
  if (entry === undefined) return false;
  return (entry.allowedOperations as readonly string[]).includes(operation);
}

export function isSyncFinancialEntityTypeV1(entityType: string): entityType is SyncFinancialEntityTypeV1 {
  const entry = getSyncEntityCatalogEntryV1(entityType);
  return entry?.financial === true;
}

/** Strictly integer-only JSON values: floats, NaN, and Infinity are rejected at runtime. */
export type SyncJsonPrimitive = string | number | boolean | null;
export type SyncJsonValue = SyncJsonPrimitive | readonly SyncJsonValue[] | { readonly [key: string]: SyncJsonValue };
export type SyncJsonObject = { readonly [key: string]: SyncJsonValue };

export const SYNC_ENVELOPE_KEYS = Object.freeze([
  "eventId",
  "idempotencyKey",
  "deviceId",
  "actorId",
  "restaurantId",
  "branchId",
  "entityType",
  "entityId",
  "operation",
  "schemaVersion",
  "localSequence",
  "baseVersion",
  "occurredAt",
  "receivedAt",
  "payload",
  "retryCount",
  "localState",
] as const);

/** The 17-field sync event envelope of OFFLINE_SYNC_CONTRACT §3. */
export interface SyncEnvelopeV1 {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly entityType: SyncEntityTypeV1;
  readonly entityId: string;
  readonly operation: SyncOperationV1;
  readonly schemaVersion: string;
  readonly localSequence: number;
  readonly baseVersion: number | null;
  readonly occurredAt: string;
  readonly receivedAt: string | null;
  readonly payload: SyncJsonObject;
  readonly retryCount: number;
  readonly localState: SyncOutboxStateV1;
}

export interface SyncPushRequestV1 {
  readonly protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  readonly deviceId: string;
  readonly scope: BranchScope;
  readonly events: readonly SyncEnvelopeV1[];
}
export type SyncPushRequest = SyncPushRequestV1;

export interface SyncEventResultV1 {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly status: SyncServerResultStatusV1;
  readonly code: string | null;
  readonly canonicalVersion: number | null;
  readonly auditId: string | null;
}
export type SyncEventResult = SyncEventResultV1;

export interface SyncPushResponseV1 {
  readonly protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  readonly scope: BranchScope;
  readonly results: readonly SyncEventResultV1[];
}
export type SyncPushResponse = SyncPushResponseV1;

export interface SyncPullRequestV1 {
  readonly deviceId: string;
  readonly protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  readonly scope: BranchScope;
  readonly cursor: string | null;
  readonly limit: number;
}
export type SyncPullRequest = SyncPullRequestV1;

export interface SyncPullChangeV1 {
  readonly entityType: SyncEntityTypeV1;
  readonly entityId: string;
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly canonicalVersion: number;
  readonly tombstone: boolean;
  readonly snapshot: SyncJsonObject | null;
}
export type SyncPullChange = SyncPullChangeV1;

export interface SyncPullResponseV1 {
  readonly protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  readonly scope: BranchScope;
  readonly changes: readonly SyncPullChangeV1[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
export type SyncPullResponse = SyncPullResponseV1;

export interface SyncSnapshotResyncRequestV1 {
  readonly protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  readonly scope: BranchScope;
}

export type SyncSnapshotEntityV1 = SyncPullChangeV1;

export interface SyncSnapshotResyncResponseV1 {
  readonly protocolVersion: typeof SYNC_PROTOCOL_VERSION;
  readonly scope: BranchScope;
  readonly snapshotCursor: string;
  readonly entities: readonly SyncSnapshotEntityV1[];
  readonly generatedAt: string;
}

export interface ManualReviewCaseV1 {
  readonly factsAvailable?: boolean;
  readonly schemaVersion: typeof MANUAL_REVIEW_CASE_SCHEMA_VERSION;
  readonly caseId: string;
  readonly scope: BranchScope;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly entityType: SyncEntityTypeV1;
  readonly entityId: string;
  readonly operation: SyncOperationV1;
  readonly reasonCode: string;
  readonly financial: boolean;
  readonly status: ManualReviewCaseStatusV1;
  readonly baseVersion: number | null;
  readonly canonicalVersion: number | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedByActorId: string | null;
  readonly resolutionReason: string | null;
  readonly compensatingEventId: string | null;
  readonly auditId: string | null;
}

export interface ResolveManualReviewCaseCommandV1 {
  readonly schemaVersion: typeof MANUAL_REVIEW_CASE_SCHEMA_VERSION;
  readonly scope: BranchScope;
  readonly caseId: string;
  readonly decision: "compensate" | "reject";
  readonly reason: string;
  readonly compensatingEventId: string | null;
  readonly idempotencyKey: string;
  readonly deviceId: string;
  readonly occurredAt: string;
}

// ---- Low-level validators ------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/iu;
const RFC3339_UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/u;
const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SCHEMA_VERSION_PATTERN = /^\d+(?:\.\d+){0,2}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const CONTROL_CHAR_PATTERN = /[\p{Cc}\p{Cf}]/u;

export function isSyncId(value: unknown): value is string {
  return typeof value === "string" && (UUID_PATTERN.test(value) || ULID_PATTERN.test(value));
}

export function isStableSyncCode(value: unknown): value is string {
  return typeof value === "string" && STABLE_CODE_PATTERN.test(value);
}

export function isSyncSchemaVersionFormat(value: unknown): value is string {
  return typeof value === "string" && SCHEMA_VERSION_PATTERN.test(value);
}

export function isRfc3339UtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339_UTC_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

function isOpaqueCursor(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= SYNC_MAX_CURSOR_LENGTH
    && value === value.trim()
    && !CONTROL_CHAR_PATTERN.test(value);
}

function isAuditId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && value === value.trim()
    && !CONTROL_CHAR_PATTERN.test(value);
}

function isReasonText(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 500
    && value === value.trim()
    && !CONTROL_CHAR_PATTERN.test(value);
}

type PlainRecord = Readonly<Record<string, unknown>>;

function exactRecord(value: unknown, keys: readonly string[]): PlainRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length) return undefined;
    for (const key of keys) {
      if (!ownKeys.includes(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    }
    return value as PlainRecord;
  } catch {
    return undefined;
  }
}

function ownPlainRecord(value: unknown): PlainRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
      if (typeof key !== "string" || key === "__proto__") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    }
    return value as PlainRecord;
  } catch {
    return undefined;
  }
}

function ownValue(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const symbol of text) {
    const code = symbol.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function cloneAndValidateJsonValue(value: unknown, depth: number): SyncJsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (depth + 1 > SYNC_MAX_PAYLOAD_DEPTH) return undefined;
    try {
      const items: SyncJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (descriptor === undefined || !("value" in descriptor)) return undefined;
        const child = cloneAndValidateJsonValue(descriptor.value, depth + 1);
        if (child === undefined) return undefined;
        items.push(child);
      }
      return Object.freeze(items);
    } catch {
      return undefined;
    }
  }
  const record = ownPlainRecord(value);
  if (record === undefined || depth + 1 > SYNC_MAX_PAYLOAD_DEPTH) return undefined;
  return cloneAndValidateJsonRecord(record, depth + 1);
}

function cloneAndValidateJsonRecord(record: PlainRecord, depth: number): SyncJsonObject | undefined {
  const copy: Record<string, SyncJsonValue> = {};
  for (const key of Object.keys(record)) {
    const child = cloneAndValidateJsonValue(ownValue(record, key), depth);
    if (child === undefined) return undefined;
    copy[key] = child;
  }
  return Object.freeze(copy);
}

// ---- Public runtime parsers ----------------------------------------------------------------

/** Validates a JSON object payload: exact plain objects, NO floats, depth <= 8, UTF-8 size <= 64 KiB. */
export function parseSyncJsonObjectV1(value: unknown): SyncJsonObject | undefined {
  const record = ownPlainRecord(value);
  if (record === undefined) return undefined;
  const parsed = cloneAndValidateJsonRecord(record, 1);
  if (parsed === undefined) return undefined;
  if (utf8ByteLength(JSON.stringify(parsed)) > SYNC_MAX_PAYLOAD_BYTES) return undefined;
  return parsed;
}

export function parseSyncScopeV1(value: unknown): BranchScope | undefined {
  const record = exactRecord(value, ["restaurantId", "branchId"]);
  if (record === undefined) return undefined;
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  if (!isSyncId(restaurantId) || !isSyncId(branchId)) return undefined;
  return Object.freeze({
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
  });
}

export function parseSyncEnvelopeV1(value: unknown): SyncEnvelopeV1 | undefined {
  const record = exactRecord(value, SYNC_ENVELOPE_KEYS);
  if (record === undefined) return undefined;

  const eventId = ownValue(record, "eventId");
  const idempotencyKey = ownValue(record, "idempotencyKey");
  const deviceId = ownValue(record, "deviceId");
  const actorId = ownValue(record, "actorId");
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  const entityType = ownValue(record, "entityType");
  const entityId = ownValue(record, "entityId");
  const operation = ownValue(record, "operation");
  const schemaVersion = ownValue(record, "schemaVersion");
  const localSequence = ownValue(record, "localSequence");
  const baseVersion = ownValue(record, "baseVersion");
  const occurredAt = ownValue(record, "occurredAt");
  const receivedAt = ownValue(record, "receivedAt");
  const retryCount = ownValue(record, "retryCount");
  const localState = ownValue(record, "localState");

  if (
    !isSyncId(eventId)
    || !isIdempotencyKey(idempotencyKey)
    || !isSyncId(deviceId)
    || !isSyncId(actorId)
    || !isSyncId(restaurantId)
    || !isSyncId(branchId)
    || typeof entityType !== "string"
    || !isSyncId(entityId)
    || typeof operation !== "string"
    || !isSyncEntityOperationAllowedV1(entityType, operation)
    || typeof schemaVersion !== "string"
    || !SUPPORTED_SYNC_SCHEMA_VERSIONS.includes(schemaVersion)
    || !isNonNegativeInt(localSequence)
    || (baseVersion !== null && !isNonNegativeInt(baseVersion))
    || (operation === "create") !== (baseVersion === null)
    || !isRfc3339UtcTimestamp(occurredAt)
    || (receivedAt !== null && !isRfc3339UtcTimestamp(receivedAt))
    || !isNonNegativeInt(retryCount)
    || typeof localState !== "string"
    || !(SYNC_OUTBOX_STATES as readonly string[]).includes(localState)
  ) {
    return undefined;
  }

  const payload = parseSyncJsonObjectV1(ownValue(record, "payload"));
  if (payload === undefined) return undefined;

  return Object.freeze({
    eventId,
    idempotencyKey,
    deviceId,
    actorId,
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
    entityType: entityType as SyncEntityTypeV1,
    entityId,
    operation: operation as SyncOperationV1,
    schemaVersion,
    localSequence,
    baseVersion,
    occurredAt,
    receivedAt,
    payload,
    retryCount,
    localState: localState as SyncOutboxStateV1,
  });
}

export function parseSyncPushRequestV1(value: unknown): SyncPushRequestV1 | undefined {
  const record = exactRecord(value, ["protocolVersion", "deviceId", "scope", "events"]);
  if (record === undefined || ownValue(record, "protocolVersion") !== SYNC_PROTOCOL_VERSION) return undefined;
  const deviceId = ownValue(record, "deviceId");
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  const rawEvents = ownValue(record, "events");
  if (
    !isSyncId(deviceId)
    || scope === undefined
    || !Array.isArray(rawEvents)
    || rawEvents.length < 1
    || rawEvents.length > SYNC_MAX_BATCH_EVENTS
  ) {
    return undefined;
  }

  const events: SyncEnvelopeV1[] = [];
  const seenEventIds = new Set<string>();
  let previousSequence = -1;
  for (let index = 0; index < rawEvents.length; index += 1) {
    if (!Object.hasOwn(rawEvents, index)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(rawEvents, index);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const envelope = parseSyncEnvelopeV1(descriptor.value);
    if (
      envelope === undefined
      || envelope.deviceId !== deviceId
      || envelope.restaurantId !== scope.restaurantId
      || envelope.branchId !== scope.branchId
      || seenEventIds.has(envelope.eventId)
      || envelope.localSequence <= previousSequence
    ) {
      return undefined;
    }
    seenEventIds.add(envelope.eventId);
    previousSequence = envelope.localSequence;
    events.push(envelope);
  }

  return Object.freeze({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId,
    scope,
    events: Object.freeze(events),
  });
}
export const parseSyncPushRequest = parseSyncPushRequestV1;

export function parseSyncEventResultV1(value: unknown): SyncEventResultV1 | undefined {
  const record = exactRecord(value, [
    "eventId",
    "idempotencyKey",
    "status",
    "code",
    "canonicalVersion",
    "auditId",
  ]);
  if (record === undefined) return undefined;

  const eventId = ownValue(record, "eventId");
  const idempotencyKey = ownValue(record, "idempotencyKey");
  const status = ownValue(record, "status");
  const code = ownValue(record, "code");
  const canonicalVersion = ownValue(record, "canonicalVersion");
  const auditId = ownValue(record, "auditId");

  if (
    !isSyncId(eventId)
    || !isIdempotencyKey(idempotencyKey)
    || typeof status !== "string"
    || !(SYNC_SERVER_RESULT_STATUSES as readonly string[]).includes(status)
    || (code !== null && !isStableSyncCode(code))
    || (canonicalVersion !== null && !isNonNegativeInt(canonicalVersion))
    || (auditId !== null && !isAuditId(auditId))
  ) {
    return undefined;
  }

  return Object.freeze({
    eventId,
    idempotencyKey,
    status: status as SyncServerResultStatusV1,
    code,
    canonicalVersion,
    auditId,
  });
}

export function parseSyncPushResponseV1(value: unknown): SyncPushResponseV1 | undefined {
  const record = exactRecord(value, ["protocolVersion", "scope", "results"]);
  if (record === undefined || ownValue(record, "protocolVersion") !== SYNC_PROTOCOL_VERSION) return undefined;
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  const rawResults = ownValue(record, "results");
  if (scope === undefined || !Array.isArray(rawResults) || rawResults.length > SYNC_MAX_BATCH_EVENTS) return undefined;

  const results: SyncEventResultV1[] = [];
  const seenEventIds = new Set<string>();
  for (let index = 0; index < rawResults.length; index += 1) {
    if (!Object.hasOwn(rawResults, index)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(rawResults, index);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const parsed = parseSyncEventResultV1(descriptor.value);
    if (parsed === undefined || seenEventIds.has(parsed.eventId)) return undefined;
    seenEventIds.add(parsed.eventId);
    results.push(parsed);
  }

  return Object.freeze({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    scope,
    results: Object.freeze(results),
  });
}
export const parseSyncPushResponse = parseSyncPushResponseV1;

export function parseSyncPullRequestV1(value: unknown): SyncPullRequestV1 | undefined {
  const record = exactRecord(value, ["protocolVersion", "scope", "cursor", "limit", "deviceId"]);
  if (record === undefined || ownValue(record, "protocolVersion") !== SYNC_PROTOCOL_VERSION) return undefined;
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  const cursor = ownValue(record, "cursor");
  const deviceId = ownValue(record, "deviceId");
  const limit = ownValue(record, "limit");
  if (
    scope === undefined
    || !isSyncId(deviceId)
    || (cursor !== null && !isOpaqueCursor(cursor))
    || !isPositiveInt(limit, SYNC_MAX_PULL_LIMIT)
  ) {
    return undefined;
  }
  return Object.freeze({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    scope,
    deviceId,
    cursor,
    limit,
  });
}
export const parseSyncPullRequest = parseSyncPullRequestV1;

export function parseSyncPullChangeV1(value: unknown): SyncPullChangeV1 | undefined {
  const record = exactRecord(value, [
    "entityType",
    "entityId",
    "restaurantId",
    "branchId",
    "canonicalVersion",
    "tombstone",
    "snapshot",
  ]);
  if (record === undefined) return undefined;

  const entityType = ownValue(record, "entityType");
  const entityId = ownValue(record, "entityId");
  const restaurantId = ownValue(record, "restaurantId");
  const branchId = ownValue(record, "branchId");
  const canonicalVersion = ownValue(record, "canonicalVersion");
  const tombstone = ownValue(record, "tombstone");
  const rawSnapshot = ownValue(record, "snapshot");

  if (
    typeof entityType !== "string"
    || !isSyncId(entityId)
    || !isSyncId(restaurantId)
    || !isSyncId(branchId)
    || !isPositiveInt(canonicalVersion)
    || typeof tombstone !== "boolean"
  ) {
    return undefined;
  }

  const catalog = getSyncEntityCatalogEntryV1(entityType);
  if (catalog === undefined) return undefined;
  if (tombstone && (!catalog.allowTombstone || rawSnapshot !== null)) return undefined;

  const snapshot = rawSnapshot === null ? null : parseSyncJsonObjectV1(rawSnapshot);
  if (snapshot === undefined) return undefined;

  return Object.freeze({
    entityType: catalog.entityType,
    entityId,
    restaurantId: restaurantId as RestaurantId,
    branchId: branchId as BranchId,
    canonicalVersion,
    tombstone,
    snapshot,
  });
}

export function parseSyncPullResponseV1(value: unknown): SyncPullResponseV1 | undefined {
  const record = exactRecord(value, ["protocolVersion", "scope", "changes", "nextCursor", "hasMore"]);
  if (record === undefined || ownValue(record, "protocolVersion") !== SYNC_PROTOCOL_VERSION) return undefined;
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  const rawChanges = ownValue(record, "changes");
  const nextCursor = ownValue(record, "nextCursor");
  const hasMore = ownValue(record, "hasMore");

  if (
    scope === undefined
    || !Array.isArray(rawChanges)
    || rawChanges.length > SYNC_MAX_PULL_LIMIT
    || (nextCursor !== null && !isOpaqueCursor(nextCursor))
    || typeof hasMore !== "boolean"
    || (hasMore && nextCursor === null)
  ) {
    return undefined;
  }

  const changes: SyncPullChangeV1[] = [];
  for (let index = 0; index < rawChanges.length; index += 1) {
    if (!Object.hasOwn(rawChanges, index)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(rawChanges, index);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const change = parseSyncPullChangeV1(descriptor.value);
    if (
      change === undefined
      || change.restaurantId !== scope.restaurantId
      || change.branchId !== scope.branchId
    ) {
      return undefined;
    }
    changes.push(change);
  }

  return Object.freeze({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    scope,
    changes: Object.freeze(changes),
    nextCursor,
    hasMore,
  });
}
export const parseSyncPullResponse = parseSyncPullResponseV1;

export function parseSyncSnapshotResyncRequestV1(value: unknown): SyncSnapshotResyncRequestV1 | undefined {
  const record = exactRecord(value, ["protocolVersion", "scope"]);
  if (record === undefined || ownValue(record, "protocolVersion") !== SYNC_PROTOCOL_VERSION) return undefined;
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  if (scope === undefined) return undefined;
  return Object.freeze({ protocolVersion: SYNC_PROTOCOL_VERSION, scope });
}

export function parseSyncSnapshotResyncResponseV1(value: unknown): SyncSnapshotResyncResponseV1 | undefined {
  const record = exactRecord(value, ["protocolVersion", "scope", "snapshotCursor", "entities", "generatedAt"]);
  if (record === undefined || ownValue(record, "protocolVersion") !== SYNC_PROTOCOL_VERSION) return undefined;
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  const snapshotCursor = ownValue(record, "snapshotCursor");
  const rawEntities = ownValue(record, "entities");
  const generatedAt = ownValue(record, "generatedAt");
  if (
    scope === undefined
    || !isOpaqueCursor(snapshotCursor)
    || !Array.isArray(rawEntities)
    || rawEntities.length > SYNC_MAX_SNAPSHOT_ENTITIES
    || !isRfc3339UtcTimestamp(generatedAt)
  ) {
    return undefined;
  }

  const entities: SyncSnapshotEntityV1[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawEntities.length; index += 1) {
    if (!Object.hasOwn(rawEntities, index)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(rawEntities, index);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const entity = parseSyncPullChangeV1(descriptor.value);
    if (
      entity === undefined
      || entity.restaurantId !== scope.restaurantId
      || entity.branchId !== scope.branchId
    ) {
      return undefined;
    }
    const key = `${entity.entityType}|${entity.entityId}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    entities.push(entity);
  }

  return Object.freeze({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    scope,
    snapshotCursor,
    entities: Object.freeze(entities),
    generatedAt,
  });
}

export function parseManualReviewCaseV1(value: unknown): ManualReviewCaseV1 | undefined {
  const keys = [
    "schemaVersion",
    "caseId",
    "scope",
    "eventId",
    "idempotencyKey",
    "deviceId",
    "actorId",
    "entityType",
    "entityId",
    "operation",
    "reasonCode",
    "financial",
    "status",
    "baseVersion",
    "canonicalVersion",
    "amountMinor",
    "currency",
    "openedAt",
    "resolvedAt",
    "resolvedByActorId",
    "resolutionReason",
    "compensatingEventId",
    "auditId",
  ] as const;
  const record = exactRecord(value, keys) ?? exactRecord(value, [...keys, "factsAvailable"]);
  if (record === undefined || ownValue(record, "schemaVersion") !== MANUAL_REVIEW_CASE_SCHEMA_VERSION) return undefined;

  const factsAvailable = ownValue(record, "factsAvailable");
  const caseId = ownValue(record, "caseId");
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  const eventId = ownValue(record, "eventId");
  const idempotencyKey = ownValue(record, "idempotencyKey");
  const deviceId = ownValue(record, "deviceId");
  const actorId = ownValue(record, "actorId");
  const entityType = ownValue(record, "entityType");
  const entityId = ownValue(record, "entityId");
  const operation = ownValue(record, "operation");
  const reasonCode = ownValue(record, "reasonCode");
  const financial = ownValue(record, "financial");
  const status = ownValue(record, "status");
  const baseVersion = ownValue(record, "baseVersion");
  const canonicalVersion = ownValue(record, "canonicalVersion");
  const amountMinor = ownValue(record, "amountMinor");
  const currency = ownValue(record, "currency");
  const openedAt = ownValue(record, "openedAt");
  const resolvedAt = ownValue(record, "resolvedAt");
  const resolvedByActorId = ownValue(record, "resolvedByActorId");
  const resolutionReason = ownValue(record, "resolutionReason");
  const compensatingEventId = ownValue(record, "compensatingEventId");
  const auditId = ownValue(record, "auditId");

  if (
    (factsAvailable !== undefined && typeof factsAvailable !== "boolean")
    || !isSyncId(caseId)
    || scope === undefined
    || !isSyncId(eventId)
    || !isIdempotencyKey(idempotencyKey)
    || !isSyncId(deviceId)
    || !isSyncId(actorId)
    || typeof entityType !== "string"
    || !isSyncId(entityId)
    || typeof operation !== "string"
    || !isSyncEntityOperationAllowedV1(entityType, operation)
    || !isStableSyncCode(reasonCode)
    || typeof financial !== "boolean"
    || (isSyncFinancialEntityTypeV1(entityType) && !financial)
    || typeof status !== "string"
    || !(MANUAL_REVIEW_CASE_STATUSES as readonly string[]).includes(status)
    || (baseVersion !== null && !isNonNegativeInt(baseVersion))
    || (factsAvailable !== false && (operation === "create") !== (baseVersion === null))
    || (factsAvailable === false && (baseVersion !== null || amountMinor !== null || currency !== null))
    || (canonicalVersion !== null && !isNonNegativeInt(canonicalVersion))
    || (amountMinor !== null && !(typeof amountMinor === "number" && Number.isSafeInteger(amountMinor)))
    || (currency !== null && !(typeof currency === "string" && CURRENCY_PATTERN.test(currency)))
    || (amountMinor === null) !== (currency === null)
    || !isRfc3339UtcTimestamp(openedAt)
    || (auditId !== null && !isAuditId(auditId))
  ) {
    return undefined;
  }

  if (status === "open") {
    if (
      resolvedAt !== null
      || resolvedByActorId !== null
      || resolutionReason !== null
      || compensatingEventId !== null
    ) {
      return undefined;
    }
  } else {
    if (
      !isRfc3339UtcTimestamp(resolvedAt)
      || !isSyncId(resolvedByActorId)
      || !isReasonText(resolutionReason)
    ) {
      return undefined;
    }
    if (status === "resolved_compensated") {
      if (!isSyncId(compensatingEventId)) return undefined;
    } else if (compensatingEventId !== null) {
      return undefined;
    }
  }

  return Object.freeze({
    schemaVersion: MANUAL_REVIEW_CASE_SCHEMA_VERSION,
    ...(factsAvailable === undefined ? {} : { factsAvailable }),
    caseId,
    scope,
    eventId,
    idempotencyKey,
    deviceId,
    actorId,
    entityType: entityType as SyncEntityTypeV1,
    entityId,
    operation: operation as SyncOperationV1,
    reasonCode,
    financial,
    status: status as ManualReviewCaseStatusV1,
    baseVersion,
    canonicalVersion,
    amountMinor,
    currency,
    openedAt,
    resolvedAt: resolvedAt as string | null,
    resolvedByActorId: resolvedByActorId as string | null,
    resolutionReason: resolutionReason as string | null,
    compensatingEventId: compensatingEventId as string | null,
    auditId,
  });
}

export function parseResolveManualReviewCaseCommandV1(value: unknown): ResolveManualReviewCaseCommandV1 | undefined {
  const record = exactRecord(value, [
    "schemaVersion",
    "scope",
    "caseId",
    "decision",
    "reason",
    "compensatingEventId",
    "idempotencyKey",
    "deviceId",
    "occurredAt",
  ]);
  if (record === undefined || ownValue(record, "schemaVersion") !== MANUAL_REVIEW_CASE_SCHEMA_VERSION) return undefined;
  const scope = parseSyncScopeV1(ownValue(record, "scope"));
  const caseId = ownValue(record, "caseId");
  const decision = ownValue(record, "decision");
  const reason = ownValue(record, "reason");
  const compensatingEventId = ownValue(record, "compensatingEventId");
  const idempotencyKey = ownValue(record, "idempotencyKey");
  const deviceId = ownValue(record, "deviceId");
  const occurredAt = ownValue(record, "occurredAt");

  if (
    scope === undefined
    || !isSyncId(caseId)
    || (decision !== "compensate" && decision !== "reject")
    || !isReasonText(reason)
    || (decision === "compensate" ? !isSyncId(compensatingEventId) : compensatingEventId !== null)
    || !isIdempotencyKey(idempotencyKey)
    || !isSyncId(deviceId)
    || !isRfc3339UtcTimestamp(occurredAt)
  ) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: MANUAL_REVIEW_CASE_SCHEMA_VERSION,
    scope,
    caseId,
    decision,
    reason,
    compensatingEventId: compensatingEventId as string | null,
    idempotencyKey,
    deviceId,
    occurredAt,
  });
}
