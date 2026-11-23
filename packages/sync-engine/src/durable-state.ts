import {
  getSyncEntityCatalogEntryV1,
  isSyncEntityOperationAllowedV1,
  type BranchId,
  type RestaurantId,
  type SyncEntityTypeV1,
  type SyncOperationV1,
} from "@super-restaurant/shared-types";
import { isSyncId, parseOutboxEntry, parseSyncScope, scopeKey, type OutboxEntry, type SyncScopeInput } from "./contract.js";
import { fail, ok, type ParseResult } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { asPlainRecord, hasExactKeys, isSafeNonNegativeInteger, type JsonObject } from "./json.js";
import { checkPayload } from "./payload-guard.js";

export const SCOPE_STATUSES = ["active", "revoked", "resync_required"] as const;
export type ScopeStatus = (typeof SCOPE_STATUSES)[number];

export interface ScopeState {
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly status: ScopeStatus;
  /** Opaque server cursor; only ever replaced together with an applied pull batch or snapshot resync. */
  readonly pullCursor: string | null;
}

export interface PendingReplicaWrite {
  readonly eventId: string;
  readonly operation: SyncOperationV1;
  readonly snapshot: JsonObject | null;
}

export interface ReplicaEntity {
  readonly restaurantId: RestaurantId;
  readonly branchId: BranchId;
  readonly entityType: SyncEntityTypeV1;
  readonly entityId: string;
  readonly canonicalVersion: number;
  readonly tombstone: boolean;
  readonly snapshot: JsonObject | null;
  /** Latest outbox event whose optimistic local write is reflected in `snapshot`. */
  readonly pendingEventId: string | null;
  /** Confirmed base state before the first entry in `pendingWrites`; restored if all pending writes are rejected. */
  readonly revertTo: ReplicaRevert | null;
  /** Ordered stack of still-unconfirmed local optimistic writes layered on top of `revertTo`. */
  readonly pendingWrites: readonly PendingReplicaWrite[];
}

export interface ReplicaRevert {
  /** False when the entity did not exist locally before the first pending optimistic write (a create). */
  readonly existed: boolean;
  readonly snapshot: JsonObject | null;
  readonly canonicalVersion: number;
}

export interface DurableSyncState {
  readonly stateVersion: 1;
  readonly deviceId: string;
  /** Single sequence per device, shared by every scope. Never decreases, even after compaction. */
  readonly lastLocalSequence: number;
  readonly scopes: readonly ScopeState[];
  readonly outbox: readonly OutboxEntry[];
  readonly replica: readonly ReplicaEntity[];
}

export function createEmptyState(deviceId: string): DurableSyncState {
  return deepFreeze({ stateVersion: 1, deviceId, lastLocalSequence: 0, scopes: [], outbox: [], replica: [] });
}

export function sameScope(item: SyncScopeInput, scope: SyncScopeInput): boolean {
  return item.restaurantId === scope.restaurantId && item.branchId === scope.branchId;
}

export function findReplica(state: DurableSyncState, scope: SyncScopeInput, entityType: string, entityId: string): ReplicaEntity | undefined {
  return state.replica.find((item) => sameScope(item, scope) && item.entityType === entityType && item.entityId === entityId);
}

function parseScopeState(value: unknown): ParseResult<ScopeState> {
  const record = asPlainRecord(value);
  if (record === undefined || hasExactKeys(record, ["restaurantId", "branchId", "status", "pullCursor"]) !== undefined) {
    return fail("STATE_CORRUPT", "scope");
  }
  const scope = parseSyncScope({ restaurantId: record["restaurantId"], branchId: record["branchId"] });
  const status = record["status"];
  const cursor = record["pullCursor"];
  if (!scope.ok || typeof status !== "string" || !(SCOPE_STATUSES as readonly string[]).includes(status)) {
    return fail("STATE_CORRUPT", "scope");
  }
  if (!(cursor === null || (typeof cursor === "string" && cursor.length > 0 && cursor.length <= 2048))) {
    return fail("STATE_CORRUPT", "pullCursor");
  }
  return ok({
    restaurantId: scope.value.restaurantId,
    branchId: scope.value.branchId,
    status: status as ScopeStatus,
    pullCursor: cursor,
  });
}

function parsePendingWrite(value: unknown, entityType: SyncEntityTypeV1): ParseResult<PendingReplicaWrite> {
  const record = asPlainRecord(value);
  if (record === undefined || hasExactKeys(record, ["eventId", "operation", "snapshot"]) !== undefined) {
    return fail("STATE_CORRUPT", "pendingWrites");
  }
  const { eventId, operation, snapshot } = record;
  if (!isSyncId(eventId) || typeof operation !== "string" || !isSyncEntityOperationAllowedV1(entityType, operation)) {
    return fail("STATE_CORRUPT", "pendingWrites");
  }
  if (snapshot === null) {
    return ok({ eventId, operation: operation as SyncOperationV1, snapshot: null });
  }
  const checked = checkPayload(snapshot, "inbound");
  if (!checked.ok) return fail("STATE_CORRUPT", "pendingWrites");
  return ok({ eventId, operation: operation as SyncOperationV1, snapshot: checked.value });
}

function parseReplicaEntity(value: unknown): ParseResult<ReplicaEntity> {
  const record = asPlainRecord(value);
  const keys = [
    "restaurantId",
    "branchId",
    "entityType",
    "entityId",
    "canonicalVersion",
    "tombstone",
    "snapshot",
    "pendingEventId",
    "revertTo",
    "pendingWrites",
  ];
  if (record === undefined || hasExactKeys(record, keys) !== undefined) return fail("STATE_CORRUPT", "replica");
  const scope = parseSyncScope({ restaurantId: record["restaurantId"], branchId: record["branchId"] });
  const { entityType, entityId, canonicalVersion, tombstone, snapshot, pendingEventId, pendingWrites: rawPendingWrites } = record;
  const catalog = typeof entityType === "string" ? getSyncEntityCatalogEntryV1(entityType) : undefined;
  if (!scope.ok || catalog === undefined || !isSyncId(entityId)) return fail("STATE_CORRUPT", "replica");
  if (!isSafeNonNegativeInteger(canonicalVersion) || typeof tombstone !== "boolean") return fail("STATE_CORRUPT", "replica");
  if (tombstone && !catalog.allowTombstone) return fail("STATE_CORRUPT", "replica");
  if (!(pendingEventId === null || isSyncId(pendingEventId))) return fail("STATE_CORRUPT", "replica");

  let parsedSnapshot: JsonObject | null = null;
  if (snapshot !== null) {
    const checked = checkPayload(snapshot, "inbound");
    if (!checked.ok) return fail("STATE_CORRUPT", "snapshot");
    parsedSnapshot = checked.value;
  }

  const revert = parseRevert(record["revertTo"]);
  if (!revert.ok) return revert;

  if (!Array.isArray(rawPendingWrites)) return fail("STATE_CORRUPT", "pendingWrites");
  const pendingWrites: PendingReplicaWrite[] = [];
  const seenWriteIds = new Set<string>();
  for (const item of rawPendingWrites as readonly unknown[]) {
    const parsedWrite = parsePendingWrite(item, catalog.entityType);
    if (!parsedWrite.ok) return parsedWrite;
    if (seenWriteIds.has(parsedWrite.value.eventId)) return fail("STATE_CORRUPT", "pendingWrites");
    seenWriteIds.add(parsedWrite.value.eventId);
    pendingWrites.push(parsedWrite.value);
  }

  const expectedLatest = pendingWrites.length === 0 ? null : pendingWrites[pendingWrites.length - 1]!.eventId;
  if (pendingEventId !== expectedLatest) return fail("STATE_CORRUPT", "pendingEventId");

  return ok({
    restaurantId: scope.value.restaurantId,
    branchId: scope.value.branchId,
    entityType: catalog.entityType,
    entityId,
    canonicalVersion,
    tombstone,
    snapshot: parsedSnapshot,
    pendingEventId,
    revertTo: revert.value,
    pendingWrites,
  });
}

function parseRevert(value: unknown): ParseResult<ReplicaRevert | null> {
  if (value === null) return ok(null);
  const record = asPlainRecord(value);
  if (record === undefined || hasExactKeys(record, ["existed", "snapshot", "canonicalVersion"]) !== undefined) {
    return fail("STATE_CORRUPT", "revertTo");
  }
  const { existed, snapshot, canonicalVersion } = record;
  if (typeof existed !== "boolean" || !isSafeNonNegativeInteger(canonicalVersion)) return fail("STATE_CORRUPT", "revertTo");
  if (snapshot === null) return ok({ existed, snapshot: null, canonicalVersion });
  const checked = checkPayload(snapshot, "inbound");
  return checked.ok ? ok({ existed, snapshot: checked.value, canonicalVersion }) : fail("STATE_CORRUPT", "revertTo");
}

function parseList<T>(value: unknown, parse: (item: unknown) => ParseResult<T>, field: string): ParseResult<readonly T[]> {
  if (!Array.isArray(value)) return fail("STATE_CORRUPT", field);
  const items: T[] = [];
  for (const raw of value as readonly unknown[]) {
    const parsed = parse(raw);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }
  return ok(items);
}

export interface ParseDurableStateOptions {
  readonly allowLegacySchemaVersion?: boolean;
}

/**
 * Runtime parser for hydrated state. Rejects repeated or regressed `localSequence`,
 * entries from another device, duplicate identities and records outside a known scope.
 */
export function parseDurableState(
  value: unknown,
  deviceId: string,
  options: ParseDurableStateOptions = {},
): ParseResult<DurableSyncState> {
  const record = asPlainRecord(value);
  if (record === undefined || hasExactKeys(record, ["stateVersion", "deviceId", "lastLocalSequence", "scopes", "outbox", "replica"]) !== undefined) {
    return fail("STATE_CORRUPT", "state");
  }
  if (record["stateVersion"] !== 1 || record["deviceId"] !== deviceId) return fail("STATE_CORRUPT", "deviceId");
  const lastLocalSequence = record["lastLocalSequence"];
  if (!isSafeNonNegativeInteger(lastLocalSequence)) return fail("STATE_CORRUPT", "lastLocalSequence");
  const scopes = parseList(record["scopes"], parseScopeState, "scopes");
  if (!scopes.ok) return scopes;
  const outbox = parseList(
    record["outbox"],
    (item) => parseOutboxEntry(item, { allowLegacySchemaVersion: options.allowLegacySchemaVersion === true }),
    "outbox",
  );
  if (!outbox.ok) return outbox;
  const replica = parseList(record["replica"], parseReplicaEntity, "replica");
  if (!replica.ok) return replica;

  const known = new Set<string>();
  for (const scope of scopes.value) {
    if (known.has(scopeKey(scope))) return fail("STATE_CORRUPT", "scopes");
    known.add(scopeKey(scope));
  }
  let previous = 0;
  const eventIds = new Set<string>();
  const intents = new Set<string>();
  for (const entry of outbox.value) {
    if (entry.localSequence <= previous || entry.localSequence > lastLocalSequence) {
      return fail("SEQUENCE_REGRESSION", "localSequence");
    }
    previous = entry.localSequence;
    const intent = `${scopeKey(entry)}|${entry.idempotencyKey}`;
    if (entry.deviceId !== deviceId || !known.has(scopeKey(entry)) || eventIds.has(entry.eventId) || intents.has(intent)) {
      return fail("STATE_CORRUPT", "outbox");
    }
    eventIds.add(entry.eventId);
    intents.add(intent);
  }
  const replicaKeys = new Set<string>();
  for (const entity of replica.value) {
    const key = `${scopeKey(entity)}|${entity.entityType}|${entity.entityId}`;
    if (!known.has(scopeKey(entity)) || replicaKeys.has(key)) return fail("STATE_CORRUPT", "replica");
    replicaKeys.add(key);
  }
  return ok(deepFreeze({
    stateVersion: 1 as const,
    deviceId,
    lastLocalSequence,
    scopes: scopes.value,
    outbox: outbox.value,
    replica: replica.value,
  }));
}
