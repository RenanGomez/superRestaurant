import { isSyncId, parseOutboxEntry, parseSyncScope, scopeKey, type OutboxEntry, type SyncScopeInput } from "./contract.js";
import { fail, ok, type ParseResult } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { asPlainRecord, hasExactKeys, isSafeNonNegativeInteger, type JsonObject } from "./json.js";
import { checkPayload } from "./payload-guard.js";

export const SCOPE_STATUSES = ["active", "revoked", "resync_required"] as const;
export type ScopeStatus = (typeof SCOPE_STATUSES)[number];

export interface ScopeState {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly status: ScopeStatus;
  /** Opaque server cursor; only ever replaced together with an applied pull batch. */
  readonly pullCursor: string | null;
}

export interface ReplicaEntity {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly canonicalVersion: number;
  readonly tombstone: boolean;
  readonly snapshot: JsonObject | null;
  /** Outbox event whose optimistic local write is still reflected in `snapshot`. */
  readonly pendingEventId: string | null;
}

export interface DurableSyncState {
  readonly stateVersion: 1;
  readonly deviceId: string;
  /** Single sequence per device, shared by every scope. */
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
  if (record === undefined || hasExactKeys(record, ["restaurantId", "branchId", "status", "pullCursor"]) !== undefined) return fail("STATE_CORRUPT", "scope");
  const scope = parseSyncScope({ restaurantId: record["restaurantId"], branchId: record["branchId"] });
  const status = record["status"];
  const cursor = record["pullCursor"];
  if (!scope.ok || typeof status !== "string" || !(SCOPE_STATUSES as readonly string[]).includes(status)) return fail("STATE_CORRUPT", "scope");
  if (!(cursor === null || (typeof cursor === "string" && cursor.length > 0 && cursor.length <= 2048))) return fail("STATE_CORRUPT", "pullCursor");
  return ok({ restaurantId: scope.value.restaurantId, branchId: scope.value.branchId, status: status as ScopeStatus, pullCursor: cursor });
}

function parseReplicaEntity(value: unknown): ParseResult<ReplicaEntity> {
  const record = asPlainRecord(value);
  const keys = ["restaurantId", "branchId", "entityType", "entityId", "canonicalVersion", "tombstone", "snapshot", "pendingEventId"];
  if (record === undefined || hasExactKeys(record, keys) !== undefined) return fail("STATE_CORRUPT", "replica");
  const scope = parseSyncScope({ restaurantId: record["restaurantId"], branchId: record["branchId"] });
  const { entityType, entityId, canonicalVersion, tombstone, snapshot, pendingEventId } = record;
  if (!scope.ok || typeof entityType !== "string" || entityType.length === 0 || !isSyncId(entityId)) return fail("STATE_CORRUPT", "replica");
  if (!isSafeNonNegativeInteger(canonicalVersion) || typeof tombstone !== "boolean") return fail("STATE_CORRUPT", "replica");
  if (!(pendingEventId === null || isSyncId(pendingEventId))) return fail("STATE_CORRUPT", "replica");
  let parsedSnapshot: JsonObject | null = null;
  if (snapshot !== null) {
    const checked = checkPayload(snapshot);
    if (!checked.ok) return fail("STATE_CORRUPT", "snapshot");
    parsedSnapshot = checked.value;
  }
  return ok({
    restaurantId: scope.value.restaurantId, branchId: scope.value.branchId, entityType, entityId,
    canonicalVersion, tombstone, snapshot: parsedSnapshot, pendingEventId,
  });
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

/**
 * Runtime parser for hydrated state. Rejects repeated or regressed `localSequence`,
 * entries from another device, duplicate identities and records outside a known scope.
 */
export function parseDurableState(value: unknown, deviceId: string): ParseResult<DurableSyncState> {
  const record = asPlainRecord(value);
  if (record === undefined || hasExactKeys(record, ["stateVersion", "deviceId", "lastLocalSequence", "scopes", "outbox", "replica"]) !== undefined) {
    return fail("STATE_CORRUPT", "state");
  }
  if (record["stateVersion"] !== 1 || record["deviceId"] !== deviceId) return fail("STATE_CORRUPT", "deviceId");
  const lastLocalSequence = record["lastLocalSequence"];
  if (!isSafeNonNegativeInteger(lastLocalSequence)) return fail("STATE_CORRUPT", "lastLocalSequence");
  const scopes = parseList(record["scopes"], parseScopeState, "scopes");
  if (!scopes.ok) return scopes;
  const outbox = parseList(record["outbox"], parseOutboxEntry, "outbox");
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
    if (entry.localSequence <= previous || entry.localSequence > lastLocalSequence) return fail("SEQUENCE_REGRESSION", "localSequence");
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
    stateVersion: 1 as const, deviceId, lastLocalSequence, scopes: scopes.value, outbox: outbox.value, replica: replica.value,
  }));
}
