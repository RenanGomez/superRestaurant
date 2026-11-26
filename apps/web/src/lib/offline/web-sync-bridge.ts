/**
 * Production bridge between the Web POS UI and the durable offline engine.
 *
 * Until this module existed, `window.__srOfflinePosPort` and `window.__srSyncBridge`
 * were only seams: nothing was registered at runtime, so the operator saw an empty
 * queue and "storage unavailable" forever. This module opens the IndexedDB store
 * from {@link WebIndexedDbSyncStorage}, builds one {@link DeviceSyncEngine} per
 * browser device, and registers two concrete ports:
 *
 * - {@link OfflinePosPort}: `commitLocalOperation` writes the operation to the
 *   durable outbox with an idempotency key that survives reloads, and reports
 *   success only after the atomic IndexedDB commit resolved.
 * - {@link WebSyncBridge}: mirrors the real outbox per Restaurant/Branch scope and
 *   pushes/pulls through the existing {@link createWebSyncTransport}.
 *
 * Isolation and data safety:
 *
 * - Scope filtering happens twice: `DeviceSyncEngine` never mixes Restaurant/Branch
 *   scopes, and every snapshot is read with the caller's scope.
 * - A transient IndexedDB I/O failure (`STORAGE_LOAD_FAILED` / `STORAGE_COMMIT_FAILED`)
 *   is surfaced as a rejected operation, never as a quarantine. The caller retries
 *   with the same idempotency key and the engine replays instead of duplicating.
 * - `release()` purges the local database **only** when every persisted outbox entry
 *   is compactable according to the engine's own rule. Any non-compactable evidence
 *   keeps the store intact, including financial entries in any state such as
 *   `rejected` payments, which are audit evidence and are never compacted.
 */
import {
  canCompactOutboxEntry,
  DeviceSyncEngine,
  isTerminalState,
  SyncEngineError,
  SyncTransportError,
  type CapabilityPreconditions,
  type ClockPort,
  type DurableSyncStoragePort,
  type IdGeneratorPort,
  type OutboxEntry,
  type ReplicaEntity,
  type SyncTransportPort,
} from "@super-restaurant/sync-engine";
import {
  isSyncFinancialEntityTypeV1,
  isSyncId,
  type BranchScope,
  type SyncConnectivityStateV1,
  type SyncEntityTypeV1,
  type SyncOperationV1,
} from "@super-restaurant/shared-types";

import {
  getOfflinePosPort,
  OFFLINE_POS_DEFAULT_CASH_LIMIT_MINOR,
  OFFLINE_POS_MESSAGES,
  registerOfflinePosPort,
  type CachedSnapshotInfo,
  type OfflinePosCommitInput,
  type OfflinePosCommitOutcome,
  type OfflinePosPort,
  type OfflinePosSnapshot,
} from "../offline-pos";
import {
  EMPTY_WEB_SYNC_SNAPSHOT,
  getWebSyncBridge,
  registerWebSyncBridge,
  WEB_SYNC_STATE_CHANGED_EVENT,
  type SyncUiEventItem,
  type WebSyncBridge,
  type WebSyncBridgeActionResult,
  type WebSyncUiSnapshot,
} from "../sync-ui";
import { WebIndexedDbSyncStorage, type WebSyncPurgeOptions, type WebSyncPurgeOutcome } from "./sync-store";
import { decideOfflinePurge, type OfflinePurgeAction, type OfflinePurgeEvent } from "./sync-purge";

/** Default IndexedDB database name; tests and secondary tabs may override it. */
export const WEB_SYNC_DATABASE_NAME = "sr_sync_v1";

/**
 * The durable outbox is bound to `(actorId, scope)`, not just to the browser:
 * a different actor signing in on the same installation must never open the
 * previous actor's encrypted store. The suffix is a non-reversible hash so the
 * database name does not expose the Supabase user id.
 */
export function syncDatabaseNameForActor(deviceId: string, actorId: string | undefined): string {
  if (actorId === undefined || !isSyncId(actorId)) return WEB_SYNC_DATABASE_NAME;
  const suffix = stableEntityId([deviceId, actorId]).replace(/-/gu, "").slice(0, 16);
  return `${WEB_SYNC_DATABASE_NAME}_${suffix}`;
}

export interface WebSyncBridgeOpenOptions {
  /** Local device identity (UUID/ULID). One engine per device. */
  readonly deviceId: string;
  /** Existing `createWebSyncTransport`; the bridge never builds request bodies itself. */
  readonly transport: SyncTransportPort;
  /** Authenticated actor used as the envelope author; required to commit local operations. */
  readonly actorId?: string;
  /** Pre-opened storage (tests). When omitted the bridge opens the encrypted IndexedDB store. */
  readonly storage?: DurableSyncStoragePort;
  readonly databaseName?: string;
  readonly clock?: ClockPort;
  readonly ids?: IdGeneratorPort;
  /** Connectivity provider; defaults to `navigator.onLine` (else `online`). */
  readonly connectivity?: () => SyncConnectivityStateV1;
  readonly nowIso?: () => string;
  /** Replaces the default `IndexedDB` purge used by `release()`. */
  readonly purgeStore?: () => Promise<void>;
  /** Closes a caller-provided storage during `release()`. */
  readonly closeStorage?: () => Promise<void> | void;
}

export interface WebSyncReleaseOutcome {
  /** Purge action the policy chose for the event that sealed/released the bridge. */
  readonly action: OfflinePurgeAction;
  /** True only when the local device state was actually removed. */
  readonly purged: boolean;
  /**
   * Number of persisted events retained as evidence because the engine may not compact
   * them: pending/blocked/review entries and *all* financial entries, rejected included.
   */
  readonly retainedUnconfirmed: number;
}

export interface WebSyncBridgeHandle {
  readonly deviceId: string;
  /** Registers both global ports for this scope and starts the first reconciliation. */
  readonly register: (scope: BranchScope) => void;
  /** Removes the global ports if this handle still owns them. */
  readonly unregister: () => void;
  readonly bridge: WebSyncBridge;
  readonly offlinePort: OfflinePosPort;
  readonly getSnapshot: (scope: BranchScope) => WebSyncUiSnapshot;
  readonly getOfflinePosSnapshot: (scope: BranchScope) => OfflinePosSnapshot | null;
  readonly commitLocalOperation: (input: OfflinePosCommitInput) => Promise<OfflinePosCommitOutcome | null>;
  readonly refresh: (scope: BranchScope) => Promise<void>;
  readonly syncNow: (scope: BranchScope) => Promise<void>;
  readonly retryPending: (scope: BranchScope, eventId?: string) => Promise<WebSyncBridgeActionResult>;
  readonly requestResync: (scope: BranchScope) => Promise<WebSyncBridgeActionResult>;
  readonly setConnectivity: (state: SyncConnectivityStateV1) => void;
  readonly release: () => Promise<WebSyncReleaseOutcome>;
}

interface CommitMapping {
  readonly entityType: SyncEntityTypeV1;
  readonly operation: SyncOperationV1;
  readonly entityId?: string;
  readonly payload?: unknown;
  readonly baseVersion?: number | null;
}

const COMMIT_KINDS: Readonly<Record<string, Omit<CommitMapping, "entityId" | "payload" | "baseVersion">>> = Object.freeze({
  order_create: { entityType: "Order", operation: "create" },
  order_add_line: { entityType: "OrderItem", operation: "create" },
  cash_collect: { entityType: "Payment", operation: "create" },
});

/**
 * `release()` asks whether an entry may be compacted *right now*, so age never hides
 * evidence (`olderThanMs` is infinite) and chain references are irrelevant: the store
 * is discarded as a whole only when no entry would be retained for any reason.
 */
const RELEASE_COMPACTION_CONTEXT = Object.freeze({
  olderThanMs: Number.POSITIVE_INFINITY,
  referencedEventIds: new Set<string>(),
});

/** Administrative operations only the encrypted IndexedDB store exposes. Tests may inject a plain port. */
interface PurgeableWebStorage extends DurableSyncStoragePort {
  lock(): Promise<void>;
  purge(): Promise<void>;
  purgeAll(options?: WebSyncPurgeOptions): Promise<WebSyncPurgeOutcome>;
  close(): void;
}

function purgeableStorage(storage: DurableSyncStoragePort): PurgeableWebStorage | undefined {
  const candidate = storage as Partial<PurgeableWebStorage>;
  return typeof candidate.lock === "function"
    && typeof candidate.purge === "function"
    && typeof candidate.purgeAll === "function"
    ? candidate as PurgeableWebStorage
    : undefined;
}

function protocolConnectivity(): SyncConnectivityStateV1 {
  return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";
}

function scopeKey(scope: BranchScope): string {
  return `${scope.restaurantId}/${scope.branchId}`;
}

/** Deterministic UUID-shaped identity so a retry with the same key keeps the same intent fingerprint. */
export function stableEntityId(parts: readonly string[]): string {
  const text = parts.join("\u0000");
  const fnv = (seed: number): number => {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  };
  const hex = [fnv(0x811c9dc5), fnv(0x9e3779b9), fnv(0x85ebca6b), fnv(0xc2b2ae35)]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Sync device identity is derived per `(browser installation, actor)`: the server
 * pins a registered device row to the first actor (`on conflict do nothing`) and
 * keeps `sync_device_state` per actor, so sharing one browser id across cashiers of
 * the same tablet left every later actor `unknown`/403. The base browser identity in
 * localStorage is untouched; only the identifier sent to the API/engine changes, so
 * replica and outbox stay per actor and a shift change cannot leak evidence.
 * The version/variant nibbles are rewritten to a valid v4 UUID for the API contract.
 */
export function syncDeviceIdForActor(baseDeviceId: string, actorId: string): string {
  const derived = stableEntityId([baseDeviceId, actorId]);
  const versioned = `${derived.slice(0, 14)}4${derived.slice(15)}`;
  const variant = ["8", "9", "a", "b"][Number.parseInt(versioned.slice(19, 20), 16) & 0x3] ?? "8";
  return `${versioned.slice(0, 19)}${variant}${versioned.slice(20)}`;
}

function toEventItem(entry: OutboxEntry): SyncUiEventItem {
  const payload = entry.payload as Readonly<Record<string, unknown>>;
  const summaryLabel = typeof payload["summaryLabel"] === "string" ? payload["summaryLabel"] : null;
  return Object.freeze({
    branchId: entry.branchId,
    entityType: entry.entityType,
    eventId: entry.eventId,
    financial: isSyncFinancialEntityTypeV1(entry.entityType),
    lastErrorCode: entry.lastErrorCode,
    localSequence: entry.localSequence,
    localState: entry.localState,
    occurredAt: entry.occurredAt,
    operation: entry.operation,
    restaurantId: entry.restaurantId,
    retryCount: entry.retryCount,
    schemaOutdated: false,
    summaryLabel,
    updatedAt: new Date(entry.updatedAt).toISOString(),
  });
}

function cachedSnapshotInfo(
  replica: readonly ReplicaEntity[],
  entityType: SyncEntityTypeV1,
  kind: CachedSnapshotInfo["kind"],
  capturedAt: string,
): CachedSnapshotInfo | null {
  const matches = replica.filter(
    (entity) => entity.entityType === entityType && entity.tombstone === false && entity.snapshot !== null,
  );
  if (matches.length === 0) return null;
  const version = matches.reduce((max, entity) => Math.max(max, entity.canonicalVersion), 0) || matches.length;
  return Object.freeze({ capturedAt, kind, version });
}

function buildOfflineSnapshot(input: {
  readonly deviceId: string;
  readonly connectivity: SyncConnectivityStateV1;
  readonly replica: readonly ReplicaEntity[];
  readonly capturedAt: string;
}): OfflinePosSnapshot {
  const register = input.replica.find((entity) => entity.entityType === "CashRegisterSession");
  const registerSnapshot = register?.snapshot as Readonly<Record<string, unknown>> | null | undefined;
  const cashRegisterOpen = registerSnapshot?.["status"] === "open" || registerSnapshot?.["state"] === "open";
  return Object.freeze({
    cashRegisterOpen,
    cashierShiftOpen: false,
    catalog: cachedSnapshotInfo(input.replica, "MenuCatalog", "menu", input.capturedAt),
    connectivity: input.connectivity,
    deviceId: input.deviceId,
    offlineCashLimitMinor: OFFLINE_POS_DEFAULT_CASH_LIMIT_MINOR,
    offlineCashUsedMinor: 0,
    tables: cachedSnapshotInfo(input.replica, "DiningTable", "tables", input.capturedAt),
    ticketTemplateCached: false,
  });
}

function preconditionsFrom(snapshot: OfflinePosSnapshot | null): CapabilityPreconditions {
  if (snapshot === null) {
    return Object.freeze({
      cashRegisterOpen: false,
      cashierShiftOpen: false,
      externalTerminalConfirmed: false,
      hasCatalogSnapshots: false,
      hasValidSession: true,
      templateCached: false,
      withinLocalRuleLimit: true,
      withinOfflineCashLimit: true,
    });
  }
  return Object.freeze({
    cashRegisterOpen: snapshot.cashRegisterOpen,
    cashierShiftOpen: snapshot.cashierShiftOpen,
    externalTerminalConfirmed: false,
    hasCatalogSnapshots: snapshot.catalog !== null && snapshot.tables !== null,
    hasValidSession: true,
    templateCached: snapshot.ticketTemplateCached,
    withinLocalRuleLimit: true,
    withinOfflineCashLimit: snapshot.offlineCashUsedMinor < snapshot.offlineCashLimitMinor,
  });
}

export async function openWebSyncBridge(options: WebSyncBridgeOpenOptions): Promise<WebSyncBridgeHandle> {
  if (!isSyncId(options.deviceId)) {
    throw new SyncEngineError("INPUT_INVALID", "deviceId");
  }

  let ownedStorage: WebIndexedDbSyncStorage | undefined;
  let storage = options.storage;
  if (storage === undefined) {
    ownedStorage = await WebIndexedDbSyncStorage.open(options.deviceId, {
      databaseName: options.databaseName ?? syncDatabaseNameForActor(options.deviceId, options.actorId),
    });
    storage = ownedStorage;
  }

  const connectivityRef: { current: SyncConnectivityStateV1 } = {
    current: options.connectivity?.() ?? protocolConnectivity(),
  };
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const hydratedAt = nowIso();

  const snapshots = new Map<string, WebSyncUiSnapshot>();
  const offlineSnapshots = new Map<string, OfflinePosSnapshot>();
  const listeners = new Set<() => void>();

  let syncing = false;
  let lastConfirmedSyncAt: string | null = null;
  let syncPromise: Promise<void> | undefined;
  let releasePromise: Promise<WebSyncReleaseOutcome> | undefined;
  /** Latched at the first synchronous step of `release()`; blocks new commits. */
  let closing = false;
  /** Latched when the server revoked this device/actor: the store is locked and sealed for good. */
  let sealed = false;
  /** Outcome of the revocation purge, returned by `release()` instead of counting a locked store. */
  let sealedOutcome: WebSyncReleaseOutcome | null = null;
  /** Last readable outbox per scope, captured before sealing so the UI can show retained evidence. */
  const retainedEvents = new Map<string, readonly SyncUiEventItem[]>();
  let activeCommits = 0;
  const commitWaiters: Array<() => void> = [];
  /** In-memory only: a registered scope survives for this bridge session, never on disk. */
  const registeredScopes = new Set<string>();

  const engine = new DeviceSyncEngine({
    clientType: "web_pos",
    connectivity: () => connectivityRef.current,
    deviceId: options.deviceId,
    storage,
    transport: options.transport,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.ids === undefined ? {} : { ids: options.ids }),
  });
  await engine.init();
  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A broken subscriber must never break the queue refresh.
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(WEB_SYNC_STATE_CHANGED_EVENT));
    }
  };

  const refresh = async (scope: BranchScope): Promise<void> => {
    const key = scopeKey(scope);
    if (sealed) {
      // The store is locked on purpose: it stays readable as a sealed report, never as a queue.
      snapshots.set(key, Object.freeze({
        ...EMPTY_WEB_SYNC_SNAPSHOT,
        events: retainedEvents.get(key) ?? Object.freeze([]),
        lastConfirmedSyncAt,
        scopeRevoked: true,
        storageReady: true,
        syncing: false,
      }));
      notify();
      return;
    }
    try {
      const [outbox, status, replica] = await Promise.all([
        engine.getOutbox(scope),
        engine.getStatusSummary(scope),
        engine.listReplica(scope),
      ]);
      snapshots.set(key, Object.freeze({
        events: Object.freeze(outbox.map(toEventItem)),
        lastConfirmedSyncAt,
        resyncRequired: status.scopeStatus === "resync_required",
        schemaOutdated: false,
        scopeRevoked: status.scopeStatus === "revoked",
        storageQuarantined: false,
        storageReady: true,
        syncing,
      }));
      offlineSnapshots.set(key, buildOfflineSnapshot({
        capturedAt: lastConfirmedSyncAt ?? hydratedAt,
        connectivity: connectivityRef.current,
        deviceId: options.deviceId,
        replica,
      }));
    } catch {
      snapshots.set(key, Object.freeze({
        ...EMPTY_WEB_SYNC_SNAPSHOT,
        lastConfirmedSyncAt,
        storageReady: false,
        syncing,
      }));
    }
    notify();
  };

  /**
   * Registers this device in the scope before the first push of the session. An
   * unregistered device is rejected by the server as `DEVICE_REVOKED`, which the
   * engine turns into a revoked scope that never drains. Registration is retried
   * on the next sync until it succeeds, and a hard `401`/`403` blocks the push
   * instead of sending data the server will reject.
   */
  const ensureDeviceRegistered = async (scope: BranchScope): Promise<boolean> => {
    const key = scopeKey(scope);
    if (registeredScopes.has(key)) return true;
    const registerDevice = options.transport.registerDevice;
    if (registerDevice === undefined) return true;
    try {
      await registerDevice({ deviceId: options.deviceId, scope });
      registeredScopes.add(key);
      return true;
    } catch (error) {
      const nonRetryable = error instanceof SyncTransportError && !error.retryable;
      connectivityRef.current = nonRetryable
        ? "sync_blocked"
        : connectivityRef.current === "offline" ? "offline" : "degraded";
      return false;
    }
  };

  const syncNow = (scope: BranchScope): Promise<void> => {
    if (syncPromise !== undefined) return syncPromise;
    const run = (async (): Promise<void> => {
      if (sealed) {
        await refresh(scope);
        return;
      }
      syncing = true;
      notify();
      try {
        if (!(await ensureDeviceRegistered(scope))) return;
        if (options.actorId !== undefined) {
          // Defence in depth for a shared/legacy store: never hand this actor's
          // token a batch that contains another actor's unconfirmed evidence.
          const pending = await engine.getOutbox(scope);
          const foreign = pending.filter(
            (entry) => !isTerminalState(entry.localState) && entry.actorId !== options.actorId,
          );
          if (foreign.length > 0) {
            connectivityRef.current = connectivityRef.current === "offline" ? "offline" : "degraded";
            return;
          }
        }
        const result = await engine.sync(scope);
        if (result.push.revoked || result.pull.status === "revoked") {
          connectivityRef.current = "sync_blocked";
          await sealAfterRevocation(scope);
        } else if (
          result.push.failureCode !== null
          || result.pull.status === "failed"
          || result.pull.status === "resync_required"
        ) {
          connectivityRef.current = connectivityRef.current === "offline" ? "offline" : "degraded";
        } else {
          connectivityRef.current = "online";
          lastConfirmedSyncAt = nowIso();
        }
      } catch (error) {
        connectivityRef.current = connectivityRef.current === "offline" ? "offline" : "degraded";
        if (error instanceof SyncEngineError && error.code === "SCOPE_REVOKED") {
          connectivityRef.current = "sync_blocked";
          await sealAfterRevocation(scope);
        }
      } finally {
        syncing = false;
        await refresh(scope);
      }
    })();
    syncPromise = run;
    const clear = (): void => {
      if (syncPromise === run) syncPromise = undefined;
    };
    void run.then(clear, clear);
    return run;
  };

  const commitLocalOperation = async (input: OfflinePosCommitInput): Promise<OfflinePosCommitOutcome | null> => {
    // `closing` is set synchronously at the start of `release()`, before any await:
    // nothing can be added to a store that is about to be deleted.
    if (closing) {
      return Object.freeze({ code: "STORAGE_CLOSED", committed: false, eventId: null });
    }
    if (sealed) {
      // The server revoked this device/actor: the store is locked and no new evidence may
      // enter it. The caller has to sign in again before capturing offline.
      return Object.freeze({ code: "SCOPE_REVOKED", committed: false, eventId: null });
    }
    if (input.deviceId !== options.deviceId) {
      return Object.freeze({ code: "DEVICE_MISMATCH", committed: false, eventId: null });
    }
    const mountedActor = options.actorId;
    if (mountedActor === undefined || !isSyncId(mountedActor)) {
      return Object.freeze({ code: "SESSION_REQUIRED", committed: false, eventId: null });
    }
    // The outbox is bound to the actor this bridge was mounted for. A different
    // actor is rejected here (and never reaches the durable queue) instead of
    // being pushed later with someone else's token.
    if (input.actorId !== undefined && input.actorId !== mountedActor) {
      return Object.freeze({ code: "ACTOR_MISMATCH", committed: false, eventId: null });
    }
    const actorId = mountedActor;

    const base = COMMIT_KINDS[input.kind];
    const entityType = input.entityType ?? base?.entityType;
    const operation = input.operation ?? base?.operation;
    if (entityType === undefined || operation === undefined) {
      return Object.freeze({ code: "NOT_SUPPORTED", committed: false, eventId: null });
    }

    const entityId = input.entityId
      ?? stableEntityId([input.scope.restaurantId, input.scope.branchId, input.kind, input.idempotencyKey]);
    const payload = input.payload ?? Object.freeze({
      kind: input.kind,
      ...(input.summaryLabel === undefined ? {} : { summaryLabel: input.summaryLabel }),
    });

    activeCommits += 1;
    try {
      const entry = await engine.enqueue({
        actorId,
        entityId,
        entityType,
        idempotencyKey: input.idempotencyKey,
        occurredAt: input.occurredAt,
        operation,
        payload,
        preconditions: preconditionsFrom(offlineSnapshots.get(scopeKey(input.scope)) ?? null),
        scope: input.scope,
        ...(input.baseVersion === undefined ? {} : { baseVersion: input.baseVersion }),
      });
      await refresh(input.scope);
      return Object.freeze({
        code: null,
        committed: true,
        eventId: entry.eventId,
        message: OFFLINE_POS_MESSAGES.localSavedNotShared,
      });
    } catch (error) {
      await refresh(input.scope);
      const code = error instanceof SyncEngineError ? error.code : "STORAGE_COMMIT_FAILED";
      return Object.freeze({ code, committed: false, eventId: null });
    } finally {
      activeCommits -= 1;
      if (activeCommits === 0) {
        for (const resume of commitWaiters.splice(0)) resume();
      }
    }
  };

  const retryPending = async (scope: BranchScope): Promise<WebSyncBridgeActionResult> => {
    await syncNow(scope);
    const blocked = sealed || connectivityRef.current === "sync_blocked";
    return Object.freeze({
      code: blocked ? "SYNC_BLOCKED" : null,
      ok: !blocked,
      ...(lastConfirmedSyncAt === null ? {} : { confirmedAt: lastConfirmedSyncAt }),
    });
  };

  const requestResync = async (scope: BranchScope): Promise<WebSyncBridgeActionResult> => {
    if (sealed) {
      await refresh(scope);
      return Object.freeze({ code: "SYNC_BLOCKED", ok: false });
    }
    try {
      await engine.resetScopeForResync(scope);
      const outcome = options.transport.pullSnapshot === undefined
        ? await engine.pull(scope)
        : await engine.resyncFromSnapshot(scope);
      const ok = outcome.status === "complete" || outcome.status === "partial";
      if (ok) lastConfirmedSyncAt = nowIso();
      await refresh(scope);
      return Object.freeze({
        code: ok ? null : (outcome.code ?? null),
        ok,
        ...(lastConfirmedSyncAt === null ? {} : { confirmedAt: lastConfirmedSyncAt }),
      });
    } catch (error) {
      const code = error instanceof SyncEngineError ? error.code : "RESYNC_FAILED";
      await refresh(scope);
      return Object.freeze({ code, ok: false });
    }
  };

  const offlinePort: OfflinePosPort = Object.freeze({
    commitLocalOperation,
    getSnapshot: (scope: BranchScope): OfflinePosSnapshot | null => offlineSnapshots.get(scopeKey(scope)) ?? null,
  });

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const bridge: WebSyncBridge = Object.freeze({
    getSnapshot: (scope: BranchScope): WebSyncUiSnapshot => snapshots.get(scopeKey(scope)) ?? EMPTY_WEB_SYNC_SNAPSHOT,
    requestResync,
    retryPending,
    subscribe,
  });

  const register = (scope: BranchScope): void => {
    registerOfflinePosPort(offlinePort);
    registerWebSyncBridge(bridge);
    void refresh(scope);
  };

  const unregister = (): void => {
    if (getOfflinePosPort() === offlinePort) registerOfflinePosPort(undefined);
    if (getWebSyncBridge() === bridge) registerWebSyncBridge(undefined);
  };

  const setConnectivity = (state: SyncConnectivityStateV1): void => {
    connectivityRef.current = state;
    notify();
  };

  const countUnconfirmed = async (): Promise<number> => {
    try {
      const raw = await storage.loadState(options.deviceId);
      const outbox = raw !== null && typeof raw === "object" && Array.isArray((raw as { outbox?: unknown }).outbox)
        ? (raw as { outbox: readonly OutboxEntry[] }).outbox
        : [];
      // An entry retains the store unless the engine itself may compact it. Reusing
      // `canCompactOutboxEntry` keeps the financial-evidence rule in one place: rejected
      // payments are terminal but never compactable, so they are always retained.
      return outbox.filter((entry) => !canCompactOutboxEntry(entry, RELEASE_COMPACTION_CONTEXT)).length;
    } catch {
      return -1;
    }
  };

  /**
   * Deletes the local device state. The caller already proved the outbox has no
   * non-compactable evidence; a custom purge port (tests) wins over the owned store.
   */
  const deleteStore = async (): Promise<boolean> => {
    try {
      if (options.purgeStore !== undefined) {
        await options.purgeStore();
        return true;
      }
      if (ownedStorage !== undefined) {
        await ownedStorage.purge();
        return true;
      }
      if (options.closeStorage !== undefined) {
        await options.closeStorage();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  /**
   * Applies the purge policy for an offline event. The outbox is re-read right before the
   * destructive step and an unreadable store (`-1`) counts as evidence, so nothing is
   * destroyed that could not be inspected first.
   */
  const applyOfflinePurge = async (event: OfflinePurgeEvent): Promise<WebSyncReleaseOutcome> => {
    let unconfirmed = await countUnconfirmed();
    if (unconfirmed === 0) unconfirmed = await countUnconfirmed();
    const decision = decideOfflinePurge({ event, hasFinancialEvidence: unconfirmed !== 0 });
    const retained = Math.max(0, unconfirmed);
    const keep = (): WebSyncReleaseOutcome => Object.freeze({
      action: decision.action,
      purged: false,
      retainedUnconfirmed: retained,
    });

    if (decision.action === "purge_all") {
      return Object.freeze({ action: decision.action, purged: await deleteStore(), retainedUnconfirmed: 0 });
    }

    const purgeable = storage === undefined ? undefined : purgeableStorage(storage);
    if (purgeable === undefined) return keep();

    if (decision.action === "lock_and_keep") {
      try { await purgeable.lock(); } catch { return keep(); }
      return keep();
    }

    if (decision.action === "lock_and_purge_replica") {
      try {
        // Seal first: a commit landing between the lock and the purge must fail instead of
        // surviving in a store whose replica is already gone.
        await purgeable.lock();
        const outcome = await purgeable.purgeAll({ allowLocked: true });
        return Object.freeze({
          action: decision.action,
          purged: outcome.wiped,
          retainedUnconfirmed: outcome.retainedOutboxCount,
        });
      } catch {
        return keep();
      }
    }

    try {
      const outcome = await purgeable.purgeAll();
      return Object.freeze({
        action: decision.action,
        purged: outcome.wiped,
        retainedUnconfirmed: outcome.retainedOutboxCount,
      });
    } catch {
      return keep();
    }
  };

  /**
   * The server revoked this device/actor (`AUTH_REVOKED`, `DEVICE_REVOKED`). The engine has
   * already moved pending financial events to manual review; this keeps that evidence,
   * drops the replica and locks the store so the revoked credential cannot read it again.
   */
  const sealAfterRevocation = async (scope: BranchScope): Promise<void> => {
    if (sealed) return;
    const key = scopeKey(scope);
    try {
      retainedEvents.set(key, Object.freeze((await engine.getOutbox(scope)).map(toEventItem)));
    } catch {
      retainedEvents.set(key, Object.freeze([]));
    }
    sealed = true;
    connectivityRef.current = "sync_blocked";
    sealedOutcome = await applyOfflinePurge("auth_revoked");
    notify();
  };

  /**
   * Seals the bridge against new commits, then applies the sign-out purge policy. Any
   * non-compactable entry — pending, blocked, in review, or financial in any state
   * including `rejected` — is retained as evidence and the replica is dropped instead.
   */
  const release = (): Promise<WebSyncReleaseOutcome> => {
    if (releasePromise !== undefined) return releasePromise;
    const run = (async (): Promise<WebSyncReleaseOutcome> => {
      // First synchronous statement: no new commit may enter the store from here on.
      closing = true;
      if (syncPromise !== undefined) {
        try {
          await syncPromise;
        } catch {
          // The final state below is read from disk, not from the failed push.
        }
      }
      // Let a commit that started before the latch finish, then read the outbox.
      if (activeCommits > 0) {
        await new Promise<void>((resolve) => commitWaiters.push(resolve));
      }
      // A revoked bridge already locked and purged; re-running the policy would only
      // count an intentionally unreadable (locked) store.
      const outcome = sealed && sealedOutcome !== null
        ? sealedOutcome
        : await applyOfflinePurge("sign_out");
      try {
        if (ownedStorage !== undefined) ownedStorage.close();
        else if (options.closeStorage !== undefined) await options.closeStorage();
      } catch {
        // A close failure does not change the purge outcome already computed from disk.
      }
      return outcome;
    })();
    releasePromise = run;
    void run.catch(() => {
      if (releasePromise === run) releasePromise = undefined;
    });
    return run;
  };

  return Object.freeze({
    bridge,
    commitLocalOperation,
    deviceId: options.deviceId,
    getOfflinePosSnapshot: (scope: BranchScope): OfflinePosSnapshot | null =>
      offlineSnapshots.get(scopeKey(scope)) ?? null,
    getSnapshot: (scope: BranchScope): WebSyncUiSnapshot => snapshots.get(scopeKey(scope)) ?? EMPTY_WEB_SYNC_SNAPSHOT,
    offlinePort,
    refresh,
    register,
    release,
    requestResync,
    retryPending,
    setConnectivity,
    syncNow,
    unregister,
  });
}
