/**
 * The durable offline store of the mobile app: one encrypted SQLite database per
 * installation, addressed through the minimal `DurableSyncStoragePort` the sync
 * engine already consumes.
 *
 * Everything in this module is pure: it never imports `expo-sqlite` nor any
 * other native module, so atomicity, restart and revocation rules run in the
 * plain Node test build. `expo-offline.ts` is the only file that touches the
 * platform, and it supplies `MobileSyncDatabasePort` and `sha256Hex`.
 *
 * Rules that mirror ADR-005 Â§3.5, Â§5 and Â§6.2:
 *
 * - `persist` writes the whole `DurableSyncState` (replica, outbox,
 *   `lastLocalSequence`, `pullCursor`) plus the adapter metadata in **one**
 *   exclusive transaction. A failure before commit rejects the promise and
 *   leaves the previous state untouched; the engine turns that into
 *   `STORAGE_COMMIT_FAILED` without advancing its in-memory state.
 * - `writeGeneration` only moves forward, and a `lastLocalSequence` below the
 *   confirmed one is refused (`SEQUENCE_REGRESSION`) without touching storage.
 * - A locked (signed-out with pending evidence) or quarantined store refuses
 *   new commits. Administrative operations may still run while locked, because
 *   purging read caches and preserving evidence is exactly what a lock needs.
 * - Corruption is never repaired by resetting to an empty state: a corrupt
 *   snapshot surfaces as `STATE_CORRUPT` so the caller can quarantine it and
 *   keep `lastLocalSequence` from ever restarting at zero.
 */
import {
  isSyncFinancialEntityTypeV1,
  isTerminalState,
  parseDurableState,
  type DurableSyncState,
  type DurableSyncStoragePort,
  type OutboxEntry,
  type ReplicaEntity,
  type SyncScopeInput,
} from "@super-restaurant/sync-engine";

export const MOBILE_SYNC_STORAGE_ERROR_CODES = [
  "ENCRYPTION_UNAVAILABLE",
  "STORAGE_COMMIT_FAILED",
  "STORAGE_LOAD_FAILED",
  "STORAGE_LOCKED",
  "STORAGE_QUARANTINED",
  "STORAGE_QUOTA_EXCEEDED",
  "SEQUENCE_REGRESSION",
  "STATE_CORRUPT",
  "DEVICE_MISMATCH",
  "STALE_STATE",
] as const;

export type MobileSyncStorageErrorCode = (typeof MOBILE_SYNC_STORAGE_ERROR_CODES)[number];

export class MobileSyncStorageError extends Error {
  public constructor(public readonly code: MobileSyncStorageErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "MobileSyncStorageError";
  }
}

/** Control row of one device inside the encrypted database (ADR-005 Â§3.5). */
export interface MobileSyncStoredMeta {
  readonly deviceId: string;
  readonly stateVersion: 1;
  readonly lastLocalSequence: number;
  readonly writeGeneration: number;
  readonly keyVersion: number;
  readonly locked: boolean;
  readonly quarantined: boolean;
  readonly updatedAt: number;
  readonly byteLength: number;
  readonly stateSha256: string;
}

/** The only SQL surface the storage core needs; `expo-offline.ts` implements it on expo-sqlite. */
export interface MobileSyncTransactionPort {
  readonly readMeta: (deviceId: string) => Promise<MobileSyncStoredMeta | null>;
  readonly readSnapshot: (deviceId: string) => Promise<string | null>;
  readonly writeSnapshot: (deviceId: string, stateJson: string) => Promise<void>;
  readonly writeMeta: (meta: MobileSyncStoredMeta) => Promise<void>;
  readonly deleteSnapshot: (deviceId: string) => Promise<void>;
  readonly deleteMeta: (deviceId: string) => Promise<void>;
}

export interface MobileSyncDatabasePort {
  /** Runs `work` inside ONE exclusive transaction; any throw rolls the whole transaction back. */
  readonly withExclusiveTransaction: <T>(work: (transaction: MobileSyncTransactionPort) => Promise<T>) => Promise<T>;
  readonly closeDatabase: () => Promise<void>;
}

export interface MobileSyncStorageOptions {
  readonly deviceId: string;
  readonly database: MobileSyncDatabasePort;
  /** SHA-256 of the serialized state, as lowercase hex. `expo-offline.ts` supplies expo-crypto. */
  readonly sha256Hex: (text: string) => Promise<string>;
  /** Version of the database key in `expo-secure-store` that this database was opened with. */
  readonly keyVersion: number;
  readonly nowMs?: () => number;
}

export interface MobileSyncStorageHealth {
  readonly devicePresent: boolean;
  readonly locked: boolean;
  readonly quarantined: boolean;
  readonly writeGeneration: number;
  readonly lastLocalSequence: number;
  readonly byteLength: number;
}

export interface MobileSyncPendingEvidence {
  /**
   * `missing`: no local state at all. `readable`: state parsed.
   * `corrupt`: the snapshot exists but cannot be trusted; never purge or reset it here.
   */
  readonly status: "missing" | "readable" | "corrupt";
  readonly outboxCount: number;
  readonly pendingCount: number;
  readonly blockingCount: number;
  readonly financialPendingCount: number;
  readonly lastLocalSequence: number;
}

export interface MobileSyncPurgeOutcome {
  readonly removedOutboxCount: number;
  readonly retainedOutboxCount: number;
  readonly removedReplicaCount: number;
  readonly retainedReplicaCount: number;
  readonly droppedScopes: number;
}

/** ADR-005 Â§3.6: lifecycle and security operations, kept apart from the engine port. */
export interface MobileSyncLocalStorageAdmin {
  readonly getStorageHealth: () => Promise<MobileSyncStorageHealth>;
  readonly lockStore: () => Promise<void>;
  /** Reopens a store locked by a sign-out once an authenticated session resumes. Never clears quarantine. */
  readonly unlockStore: () => Promise<void>;
  readonly quarantineCorruptStore: () => Promise<void>;
  readonly purgeNonEvidentiaryCache: () => Promise<MobileSyncPurgeOutcome>;
  readonly purgeReplicaForScope: (scope: SyncScopeInput) => Promise<MobileSyncPurgeOutcome>;
  readonly inspectPendingEvidence: () => Promise<MobileSyncPendingEvidence>;
  /** Crypto-shredding companion: removes every row. The DEK is destroyed by `MobileSyncKeyStore`. */
  readonly wipeAll: () => Promise<void>;
}

/** An outbox entry must survive sign-out while it is evidence of something not yet reconciled. */
export function retainsLocalEvidence(entry: OutboxEntry): boolean {
  if (!isTerminalState(entry.localState)) return true;
  if (entry.blockedBy !== null || entry.resolvedBy !== null) return true;
  // Terminal financial copies are kept for the ADR-005 Â§7.1 retention window; the
  // server ledger stays authoritative and compaction owns their removal.
  return isSyncFinancialEntityTypeV1(entry.entityType);
}

/** UTF-8 length without `TextEncoder`, which is not guaranteed in every Hermes build. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) index += 1;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export function isSequenceRegression(lastLocalSequence: number, confirmedLastLocalSequence: number): boolean {
  return lastLocalSequence < confirmedLastLocalSequence;
}

/**
 * The encrypted-database-backed implementation of `DurableSyncStoragePort`.
 *
 * Production wires it to expo-sqlite (`expo-offline.ts`); tests wire it to an
 * in-memory transaction port that rolls back exactly like SQLite does.
 */
export class MobileSqliteSyncStorage implements DurableSyncStoragePort, MobileSyncLocalStorageAdmin {
  private readonly deviceId: string;
  private readonly database: MobileSyncDatabasePort;
  private readonly sha256Hex: (text: string) => Promise<string>;
  private keyVersion: number;
  private readonly nowMs: () => number;
  private tail: Promise<unknown> = Promise.resolve();
  // STALE_STATE requires discarding the engine, loading again, and replaying the intent.
  private generation = 0;

  public constructor(options: MobileSyncStorageOptions) {
    if (typeof options.deviceId !== "string" || options.deviceId.length === 0) {
      throw new MobileSyncStorageError("DEVICE_MISMATCH", "deviceId");
    }
    if (!Number.isSafeInteger(options.keyVersion) || options.keyVersion < 1) {
      throw new MobileSyncStorageError("ENCRYPTION_UNAVAILABLE", "keyVersion");
    }
    this.deviceId = options.deviceId;
    this.database = options.database;
    this.sha256Hex = options.sha256Hex;
    this.keyVersion = options.keyVersion;
    this.nowMs = options.nowMs ?? ((): number => Date.now());
  }

  // ---- DurableSyncStoragePort ------------------------------------------------------------

  public loadState(deviceId: string): Promise<unknown> {
    return this.serialize(async () => {
      if (deviceId !== this.deviceId) throw new MobileSyncStorageError("DEVICE_MISMATCH", "loadState");
      let raw: string | null;
      let meta: MobileSyncStoredMeta | null;
      try {
        const read = await this.database.withExclusiveTransaction((transaction) => Promise.all([
          transaction.readSnapshot(this.deviceId),
          transaction.readMeta(this.deviceId),
        ]));
        raw = read[0];
        meta = read[1];
      } catch (error) {
        throw toStorageError(error, "STORAGE_LOAD_FAILED");
      }
      if (raw === null) {
        this.generation = meta?.writeGeneration ?? 0;
        return null;
      }
      const state = await this.hydrate(raw, meta);
      this.generation = meta?.writeGeneration ?? 0;
      return state;
    });
  }

  public persist(state: DurableSyncState): Promise<void> {
    const parsed = parseDurableState(state, this.deviceId);
    if (!parsed.ok) {
      return Promise.reject(new MobileSyncStorageError(
        parsed.code === "SEQUENCE_REGRESSION" ? "SEQUENCE_REGRESSION" : "STATE_CORRUPT",
        parsed.field,
      ));
    }
    const validated = parsed.value;
    return this.serialize(async () => {
      try {
        await this.database.withExclusiveTransaction(async (transaction) => {
          const meta = await transaction.readMeta(this.deviceId);
          if (meta?.quarantined === true) throw new MobileSyncStorageError("STORAGE_QUARANTINED");
          if (meta?.locked === true) throw new MobileSyncStorageError("STORAGE_LOCKED");
          if ((meta?.writeGeneration ?? 0) !== this.generation) throw new MobileSyncStorageError("STALE_STATE");
          if (isSequenceRegression(validated.lastLocalSequence, meta?.lastLocalSequence ?? 0)) {
            throw new MobileSyncStorageError("SEQUENCE_REGRESSION");
          }
          await this.writeSnapshot(transaction, validated, meta);
        });
        this.generation += 1;
      } catch (error) {
        throw toStorageError(error, "STORAGE_COMMIT_FAILED");
      }
    });
  }

  // ---- MobileSyncLocalStorageAdmin -------------------------------------------------------

  public getStorageHealth(): Promise<MobileSyncStorageHealth> {
    return this.serialize(async () => {
      const { meta, raw } = await this.readBoth();
      return Object.freeze({
        devicePresent: raw !== null,
        locked: meta?.locked === true,
        quarantined: meta?.quarantined === true,
        writeGeneration: meta?.writeGeneration ?? 0,
        lastLocalSequence: meta?.lastLocalSequence ?? 0,
        byteLength: meta?.byteLength ?? 0,
      });
    });
  }

  public lockStore(): Promise<void> {
    return this.updateMeta((meta) => ({ ...metaOrEmpty(meta, this.deviceId), locked: true }));
  }

  /**
   * Reopens a store that a sign-out with retained evidence left locked. Only
   * the `locked` flag changes: the snapshot, `lastLocalSequence`, the write
   * generation and a quarantine in progress are all preserved.
   */
  public unlockStore(): Promise<void> {
    return this.updateMeta((meta) => ({
      ...metaOrEmpty(meta, this.deviceId),
      locked: false,
      quarantined: meta?.quarantined === true,
    }));
  }

  public quarantineCorruptStore(): Promise<void> {
    return this.updateMeta((meta) => ({ ...metaOrEmpty(meta, this.deviceId), quarantined: true, locked: true }));
  }

  /**
   * Sign-out cache purge (ADR-005 Â§5). Read caches, cursors and every outbox
   * entry that is not evidence go; evidence, `deviceId` and `lastLocalSequence`
   * stay, and the state is written back in one transaction.
   */
  public purgeNonEvidentiaryCache(): Promise<MobileSyncPurgeOutcome> {
    return this.mutateState((state) => {
      if (state === null) {
        return { state: null, result: emptyPurgeOutcome() };
      }
      const retained = state.outbox.filter(retainsLocalEvidence);
      return { state: purgeState(state, retained), result: purgeOutcome(state, retained) };
    });
  }

  /** After `AUTH_REVOKED`: drop the revoked scope's read replica, keep every outbox entry. */
  public purgeReplicaForScope(scope: SyncScopeInput): Promise<MobileSyncPurgeOutcome> {
    return this.mutateState((state) => {
      if (state === null) return { state: null, result: emptyPurgeOutcome() };
      const inScope = (item: { readonly restaurantId: string; readonly branchId: string }): boolean =>
        item.restaurantId === scope.restaurantId && item.branchId === scope.branchId;
      const retainedReplica = state.replica.filter((entity) => !inScope(entity));
      const retainedOutbox = state.outbox;
      const next = purgeState({ ...state, replica: retainedReplica }, retainedOutbox);
      return {
        state: next,
        result: Object.freeze({
          removedOutboxCount: 0,
          retainedOutboxCount: retainedOutbox.length,
          removedReplicaCount: state.replica.length - retainedReplica.length,
          retainedReplicaCount: retainedReplica.length,
          droppedScopes: 0,
        }),
      };
    });
  }

  public inspectPendingEvidence(): Promise<MobileSyncPendingEvidence> {
    return this.serialize(async () => {
      const { raw, meta } = await this.readBoth();
      if (raw === null) {
        return Object.freeze({
          status: "missing" as const,
          outboxCount: 0,
          pendingCount: 0,
          blockingCount: 0,
          financialPendingCount: 0,
          lastLocalSequence: 0,
        });
      }
      let state: DurableSyncState;
      try {
        state = await this.hydrate(raw, meta);
      } catch (error) {
        if (!(error instanceof MobileSyncStorageError) || (error.code !== "STATE_CORRUPT" && error.code !== "SEQUENCE_REGRESSION")) throw toStorageError(error, "STORAGE_LOAD_FAILED");
        return Object.freeze({
          status: "corrupt" as const,
          outboxCount: 0,
          pendingCount: 0,
          blockingCount: 0,
          financialPendingCount: 0,
          lastLocalSequence: 0,
        });
      }
      const pending = state.outbox.filter((entry) => !isTerminalState(entry.localState));
      const blocking = state.outbox.filter((entry) => entry.blockedBy !== null || entry.resolvedBy !== null);
      const financialPending = pending.filter((entry) => isSyncFinancialEntityTypeV1(entry.entityType));
      return Object.freeze({
        status: "readable" as const,
        outboxCount: state.outbox.length,
        pendingCount: pending.length,
        blockingCount: blocking.length,
        financialPendingCount: financialPending.length,
        lastLocalSequence: state.lastLocalSequence,
      });
    });
  }

  public wipeAll(): Promise<void> {
    return this.serialize(async () => {
      try {
        await this.database.withExclusiveTransaction(async (transaction) => {
          await transaction.deleteSnapshot(this.deviceId);
          await transaction.deleteMeta(this.deviceId);
        });
      } catch (error) {
        throw toStorageError(error, "STORAGE_COMMIT_FAILED");
      }
    });
  }

  public closeDatabase(): Promise<void> {
    return this.database.closeDatabase();
  }

  /** Stamps the key version recorded on later commits after a verified rotation. */
  public adoptKeyVersion(version: number): void {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new MobileSyncStorageError("ENCRYPTION_UNAVAILABLE", "keyVersion");
    }
    this.keyVersion = version;
  }

  // ---- Internals -------------------------------------------------------------------------

  private async readBoth(): Promise<{ readonly raw: string | null; readonly meta: MobileSyncStoredMeta | null }> {
    try {
      const [raw, meta] = await this.database.withExclusiveTransaction((transaction) => Promise.all([
        transaction.readSnapshot(this.deviceId),
        transaction.readMeta(this.deviceId),
      ]));
      return { raw, meta };
    } catch (error) {
      throw toStorageError(error, "STORAGE_LOAD_FAILED");
    }
  }

  /** Parses, verifies the SHA-256 the adapter wrote, and enforces the sequence floor. */
  private async hydrate(raw: string, meta: MobileSyncStoredMeta | null): Promise<DurableSyncState> {
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new MobileSyncStorageError("STATE_CORRUPT", "json");
    }
    const parsed = parseDurableState(value, this.deviceId);
    if (!parsed.ok) {
      throw new MobileSyncStorageError(parsed.code === "SEQUENCE_REGRESSION" ? "SEQUENCE_REGRESSION" : "STATE_CORRUPT", parsed.field);
    }
    if (meta !== null && meta.stateSha256.length > 0) {
      const digest = await this.sha256Hex(raw);
      if (digest !== meta.stateSha256) throw new MobileSyncStorageError("STATE_CORRUPT", "sha256");
    }
    if (meta !== null && isSequenceRegression(parsed.value.lastLocalSequence, meta.lastLocalSequence)) {
      throw new MobileSyncStorageError("SEQUENCE_REGRESSION", "meta");
    }
    return parsed.value;
  }

  private async writeSnapshot(
    transaction: MobileSyncTransactionPort,
    state: DurableSyncState,
    meta: MobileSyncStoredMeta | null,
  ): Promise<void> {
    const json = JSON.stringify(state);
    const sha256 = await this.sha256Hex(json);
    const nextMeta: MobileSyncStoredMeta = {
      deviceId: this.deviceId,
      stateVersion: 1,
      lastLocalSequence: state.lastLocalSequence,
      writeGeneration: (meta?.writeGeneration ?? 0) + 1,
      keyVersion: this.keyVersion,
      locked: meta?.locked === true,
      quarantined: meta?.quarantined === true,
      updatedAt: this.nowMs(),
      byteLength: utf8ByteLength(json),
      stateSha256: sha256,
    };
    // Snapshot first, meta second, both inside the same transaction: the meta row
    // only ever points at a snapshot that was written in this same commit.
    await transaction.writeSnapshot(this.deviceId, json);
    await transaction.writeMeta(nextMeta);
  }

  /** Metadata-only change (lock/quarantine), preserving snapshot, sequence and generation. */
  private updateMeta(change: (meta: MobileSyncStoredMeta | null) => MobileSyncStoredMeta): Promise<void> {
    return this.serialize(async () => {
      try {
        const generation = await this.database.withExclusiveTransaction(async (transaction) => {
          const meta = await transaction.readMeta(this.deviceId);
          const next = change(meta);
          await transaction.writeMeta({
            ...next,
            deviceId: this.deviceId,
            stateVersion: 1,
            updatedAt: this.nowMs(),
            writeGeneration: (meta?.writeGeneration ?? 0) + 1,
          });
          return (meta?.writeGeneration ?? 0) + 1;
        });
        this.generation = generation;
      } catch (error) {
        throw toStorageError(error, "STORAGE_COMMIT_FAILED");
      }
    });
  }

  /** Administrative mutation of the whole state, allowed while locked, still never regressing sequence. */
  private mutateState(
    change: (state: DurableSyncState | null) => { readonly state: DurableSyncState | null; readonly result: MobileSyncPurgeOutcome },
  ): Promise<MobileSyncPurgeOutcome> {
    return this.serialize(async () => {
      try {
        const result = await this.database.withExclusiveTransaction(async (transaction) => {
          const meta = await transaction.readMeta(this.deviceId);
          const raw = await transaction.readSnapshot(this.deviceId);
          const state = raw === null ? null : await this.hydrate(raw, meta);
          const outcome = change(state);
          if (outcome.state === null) return { result: outcome.result, generation: meta?.writeGeneration ?? 0 };
          const parsed = parseDurableState(outcome.state, this.deviceId);
          if (!parsed.ok) throw new MobileSyncStorageError("STATE_CORRUPT", parsed.field);
          if (isSequenceRegression(parsed.value.lastLocalSequence, meta?.lastLocalSequence ?? 0)) {
            throw new MobileSyncStorageError("SEQUENCE_REGRESSION");
          }
          await this.writeSnapshot(transaction, parsed.value, meta);
          return { result: outcome.result, generation: (meta?.writeGeneration ?? 0) + 1 };
        });
        this.generation = result.generation;
        return result.result;
      } catch (error) {
        throw toStorageError(error, "STORAGE_COMMIT_FAILED");
      }
    });
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

function metaOrEmpty(meta: MobileSyncStoredMeta | null, deviceId: string): MobileSyncStoredMeta {
  return meta ?? Object.freeze({
    deviceId,
    stateVersion: 1 as const,
    lastLocalSequence: 0,
    writeGeneration: 0,
    keyVersion: 1,
    locked: false,
    quarantined: false,
    updatedAt: 0,
    byteLength: 0,
    stateSha256: "",
  });
}

function emptyPurgeOutcome(): MobileSyncPurgeOutcome {
  return Object.freeze({
    removedOutboxCount: 0,
    retainedOutboxCount: 0,
    removedReplicaCount: 0,
    retainedReplicaCount: 0,
    droppedScopes: 0,
  });
}

function purgeOutcome(state: DurableSyncState, retained: readonly OutboxEntry[]): MobileSyncPurgeOutcome {
  const next = purgeState(state, retained);
  return Object.freeze({
    removedOutboxCount: state.outbox.length - retained.length,
    retainedOutboxCount: retained.length,
    removedReplicaCount: state.replica.length - next.replica.length,
    retainedReplicaCount: next.replica.length,
    droppedScopes: state.scopes.length - next.scopes.length,
  });
}

/**
 * Drops read caches and cursors while keeping only what evidence needs: the
 * retained outbox entries, the scopes they belong to, and any replica entity
 * that still has an unconfirmed write. `lastLocalSequence` is never touched.
 */
function purgeState(state: DurableSyncState, retained: readonly OutboxEntry[]): DurableSyncState {
  const retainedIds = new Set(retained.map((entry) => entry.eventId));
  const neededScopes = new Set(retained.map((entry) => `${entry.restaurantId}/${entry.branchId}`));
  const scopes = state.scopes
    .filter((scope) => neededScopes.has(`${scope.restaurantId}/${scope.branchId}`))
    .map((scope) => Object.freeze({ ...scope, pullCursor: null }));
  const replica = state.replica.filter((entity: ReplicaEntity) =>
    entity.pendingWrites.some((write) => retainedIds.has(write.eventId)));
  return Object.freeze({
    ...state,
    scopes: Object.freeze(scopes),
    outbox: Object.freeze([...retained]),
    replica: Object.freeze(replica),
  });
}

/** Maps a driver error to a stable storage code; quota is called out so the UI can go read-only. */
export function toStorageError(error: unknown, fallback: MobileSyncStorageErrorCode): MobileSyncStorageError {
  if (error instanceof MobileSyncStorageError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  if (lowered.includes("sqlite_full") || lowered.includes("database or disk is full")
    || lowered.includes("quotaexceeded") || lowered.includes("disk i/o error")) {
    return new MobileSyncStorageError("STORAGE_QUOTA_EXCEEDED", message);
  }
  return new MobileSyncStorageError(fallback, message);
}
