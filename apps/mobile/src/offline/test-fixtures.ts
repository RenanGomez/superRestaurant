/**
 * Shared doubles for the offline-store suites. Named `test-fixtures.ts` on
 * purpose: `bundle-isolation.test.ts` treats that name as test-only and keeps it
 * out of the distributable graph.
 */
import {
  parseDurableState,
  parseOutboxEntry,
  parseSyncScope,
  type DurableSyncState,
  type OutboxEntry,
} from "@super-restaurant/sync-engine";

import {
  MobileSqliteSyncStorage,
  type MobileSyncDatabasePort,
  type MobileSyncStoredMeta,
  type MobileSyncTransactionPort,
} from "./sync-store.js";

export const DEVICE = "00000000-0000-4000-8000-00000000d1d1";
export const OTHER_DEVICE = "00000000-0000-4000-8000-00000000d2d2";
export const ACTOR = "00000000-0000-4000-8000-00000000acac";
export const RESTAURANT = "00000000-0000-4000-8000-00000000a0a0";
export const BRANCH = "00000000-0000-4000-8000-00000000a1a1";
const parsedScope = parseSyncScope({ branchId: BRANCH, restaurantId: RESTAURANT });
if (!parsedScope.ok) throw new Error("fixture scope invalid");
export const SCOPE = parsedScope.value;

export function testId(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

/**
 * In-memory stand-in for expo-sqlite. Each `withExclusiveTransaction` works on a
 * copy of both tables and publishes it only on success, so a throw at any point
 * behaves exactly like SQLite's rollback.
 */
export class FakeSyncDatabase implements MobileSyncDatabasePort {
  public snapshots = new Map<string, string>();
  public metas = new Map<string, MobileSyncStoredMeta>();
  public transactions = 0;
  public closes = 0;
  /** Throws after the snapshot was written but before metadata publishes (simulated crash). */
  public failNextCommitAfterSnapshot = 0;
  /** Throws on writeMeta before anything publishes. */
  public failNextMetaWrite = 0;
  /** Throws on the next snapshot write with a quota-style error. */
  public failNextSnapshotWrite = 0;

  public withExclusiveTransaction<T>(work: (transaction: MobileSyncTransactionPort) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const snapshots = new Map(this.snapshots);
    const metas = new Map(this.metas);
    const transaction: MobileSyncTransactionPort = {
      deleteMeta: (deviceId: string): Promise<void> => {
        metas.delete(deviceId);
        return Promise.resolve();
      },
      deleteSnapshot: (deviceId: string): Promise<void> => {
        snapshots.delete(deviceId);
        return Promise.resolve();
      },
      readMeta: (deviceId: string): Promise<MobileSyncStoredMeta | null> => Promise.resolve(metas.get(deviceId) ?? null),
      readSnapshot: (deviceId: string): Promise<string | null> => Promise.resolve(snapshots.get(deviceId) ?? null),
      writeMeta: (meta: MobileSyncStoredMeta): Promise<void> => {
        if (this.failNextMetaWrite > 0) {
          this.failNextMetaWrite -= 1;
          return Promise.reject(new Error("simulated meta failure"));
        }
        if (this.failNextCommitAfterSnapshot > 0) {
          this.failNextCommitAfterSnapshot -= 1;
          return Promise.reject(new Error("simulated crash before commit"));
        }
        metas.set(meta.deviceId, meta);
        return Promise.resolve();
      },
      writeSnapshot: (deviceId: string, stateJson: string): Promise<void> => {
        if (this.failNextSnapshotWrite > 0) {
          this.failNextSnapshotWrite -= 1;
          return Promise.reject(new Error("SQLITE_FULL: database or disk is full"));
        }
        snapshots.set(deviceId, stateJson);
        return Promise.resolve();
      },
    };
    return work(transaction).then(
      (result) => {
        this.snapshots = snapshots;
        this.metas = metas;
        return result;
      },
      (error: unknown) => {
        // Nothing publishes: the caller sees the same failure SQLite would report.
        void snapshots;
        void metas;
        throw error;
      },
    );
  }

  public closeDatabase(): Promise<void> {
    this.closes += 1;
    return Promise.resolve();
  }

  public rawSnapshot(deviceId: string): string | undefined {
    return this.snapshots.get(deviceId);
  }

  public meta(deviceId: string): MobileSyncStoredMeta | undefined {
    return this.metas.get(deviceId);
  }
}

/** Deterministic stand-in for expo-crypto's SHA-256 (the tests only need stability). */
export function fakeSha256(text: string): Promise<string> {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return Promise.resolve(hash.toString(16).padStart(8, "0"));
}

export function storageFor(database: MobileSyncDatabasePort, deviceId = DEVICE): MobileSqliteSyncStorage {
  return new MobileSqliteSyncStorage({
    database,
    deviceId,
    keyVersion: 1,
    nowMs: () => Date.UTC(2026, 10, 23, 12, 0, 0),
    sha256Hex: fakeSha256,
  });
}

interface EntryOverrides {
  readonly eventId?: string;
  readonly idempotencyKey?: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly localSequence?: number;
  readonly localState?: string;
  readonly blockedBy?: string | null;
  readonly completed?: boolean;
}

export function entry(overrides: EntryOverrides = {}): OutboxEntry {
  const parsed = parseOutboxEntry({
    actorId: ACTOR,
    attemptId: null,
    baseVersion: null,
    blockedBy: overrides.blockedBy ?? null,
    branchId: BRANCH,
    deviceId: DEVICE,
    entityId: overrides.entityId ?? testId(0x2001),
    entityType: overrides.entityType ?? "Order",
    eventId: overrides.eventId ?? testId(0x1001),
    idempotencyKey: overrides.idempotencyKey ?? "k-1",
    lastErrorCode: null,
    leaseUntil: null,
    localSequence: overrides.localSequence ?? 1,
    localState: overrides.localState ?? "pending",
    nextAttemptAt: null,
    occurredAt: "2026-11-23T00:00:00.000Z",
    operation: "create",
    outcome: overrides.completed === true
      ? { auditId: null, canonicalVersion: 1, code: null }
      : null,
    payload: { note: "x" },
    receivedAt: null,
    resolvedBy: null,
    restaurantId: RESTAURANT,
    retryCount: 0,
    schemaVersion: "1",
    updatedAt: Date.UTC(2026, 10, 23, 11, 0, 0),
  });
  if (!parsed.ok) throw new Error(`fixture invalid: ${parsed.code} ${parsed.field}`);
  return parsed.value;
}

export function stateWith(entries: readonly OutboxEntry[]): DurableSyncState {
  const last = entries[entries.length - 1];
  const hasPendingWrite = entries.some((item) => item.localState !== "accepted");
  const parsed = parseDurableState({
    deviceId: DEVICE,
    lastLocalSequence: entries.reduce((max, item) => Math.max(max, item.localSequence), 0),
    outbox: entries,
    replica: hasPendingWrite && last !== undefined
      ? [{
        branchId: BRANCH,
        canonicalVersion: 0,
        entityId: last.entityId,
        entityType: last.entityType,
        pendingEventId: last.eventId,
        pendingWrites: [{ eventId: last.eventId, operation: "create", snapshot: { note: "x" } }],
        restaurantId: RESTAURANT,
        revertTo: { canonicalVersion: 0, existed: false, snapshot: null },
        snapshot: { note: "x" },
        tombstone: false,
      }]
      : [],
    scopes: [{ branchId: BRANCH, pullCursor: "cursor-1", restaurantId: RESTAURANT, status: "active" }],
    stateVersion: 1,
  }, DEVICE);
  if (!parsed.ok) throw new Error(`fixture invalid: ${parsed.code} ${parsed.field}`);
  return parsed.value;
}
