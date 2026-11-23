import {
  DeviceSyncEngine,
  InMemorySyncStorage,
  SyncEngineError,
  SyncTransportError,
  type DurableSyncStoragePort,
  type PushOutcome,
  type PullOutcome,
  type SyncPullRequest,
  type SyncPushRequest,
  type SyncTransportPort,
} from "@super-restaurant/sync-engine";
import type {
  BranchScope,
  KdsTicketV1,
  SyncConnectivityStateV1,
} from "@super-restaurant/shared-types";

import type { KdsPendingTransition } from "./kds-local.js";

/**
 * Offline advance for already-received KDS tickets.
 *
 * The kitchen keeps a durable outbox with `KdsTicket` transitions. Per
 * OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §2 the KDS may advance a ticket that is
 * already on its station while offline, but it may never receive new orders,
 * reassign a station or claim that other stations already saw the change.
 */

export interface KdsOfflineScope {
  readonly scope: BranchScope;
  readonly stationId: string;
}

export interface KdsAdvancePreconditions {
  /** True when the ticket came from this station's cache/list, not from another station. */
  readonly ticketReceivedOnStation: boolean;
}

export type KdsAdvanceResult =
  | { readonly queued: true; readonly eventId: string }
  | { readonly queued: false; readonly reasonCode: string | null };

export interface KdsReconcileResult {
  readonly push: PushOutcome;
  readonly pull: PullOutcome;
}

export interface KdsOfflineController {
  /** Hydrates the durable engine state. Safe to call more than once. */
  readonly init: () => Promise<void>;
  /** Local-first capability check for a single ticket without persisting anything. */
  readonly canAdvance: (
    ticket: KdsTicketV1,
    to: "preparing" | "ready",
    preconditions: KdsAdvancePreconditions,
  ) => Promise<{ readonly allowed: boolean; readonly reasonCode: string | null }>;
  /** Queues a `KdsTicket` transition for this device; never sends it directly. */
  readonly advance: (
    ticket: KdsTicketV1,
    to: "preparing" | "ready",
    preconditions: KdsAdvancePreconditions,
  ) => Promise<KdsAdvanceResult>;
  /** Push the outbox then pull the cursor. Push never advances the pull cursor. */
  readonly reconcile: () => Promise<KdsReconcileResult>;
  /** Non-terminal local transitions still waiting to reach the server. */
  readonly pendingTransitions: () => Promise<readonly KdsPendingTransition[]>;
  /** Counters only; user-facing sentences belong to the UI. */
  readonly pendingCount: () => Promise<number>;
}

export interface CreateKdsOfflineControllerOptions {
  readonly scope: BranchScope;
  readonly stationId: string;
  readonly deviceId: string;
  readonly actorId: string;
  readonly transport: SyncTransportPort;
  readonly connectivity: SyncConnectivityStateV1 | (() => SyncConnectivityStateV1);
  readonly storage?: DurableSyncStoragePort;
  readonly uuid?: () => string;
  readonly now?: () => number;
}

const PENDING_STATES: ReadonlySet<string> = new Set(["pending", "sending", "retry_wait"]);

function readTarget(payload: unknown): "preparing" | "ready" | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const to = (payload as { readonly to?: unknown }).to;
  return to === "preparing" || to === "ready" ? to : undefined;
}

export function createKdsOfflineController(options: CreateKdsOfflineControllerOptions): KdsOfflineController {
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => Date.now());
  const engine = new DeviceSyncEngine({
    clientType: "kds",
    clock: { nowMs: now },
    connectivity: options.connectivity,
    deviceId: options.deviceId,
    ids: { uuid },
    storage: options.storage ?? new InMemorySyncStorage(),
    transport: options.transport,
  });
  const scope = Object.freeze({ restaurantId: options.scope.restaurantId, branchId: options.scope.branchId });

  const buildInput = (ticket: KdsTicketV1, to: "preparing" | "ready", preconditions: KdsAdvancePreconditions) => ({
    actorId: options.actorId,
    baseVersion: ticket.orderVersion,
    entityId: ticket.orderItemId,
    entityType: "KdsTicket",
    idempotencyKey: uuid(),
    occurredAt: new Date(now()).toISOString(),
    operation: "transition",
    payload: {
      orderId: ticket.orderId,
      orderItemId: ticket.orderItemId,
      orderVersion: ticket.orderVersion,
      stationId: options.stationId,
      to,
    },
    preconditions: { ticketReceivedOnStation: preconditions.ticketReceivedOnStation },
    scope,
  });

  return Object.freeze({
    init: async (): Promise<void> => {
      await engine.init();
    },

    canAdvance: async (ticket: KdsTicketV1, to: "preparing" | "ready", preconditions: KdsAdvancePreconditions) => {
      const decision = await engine.canEnqueue(buildInput(ticket, to, preconditions));
      return Object.freeze({ allowed: decision.allowed, reasonCode: decision.reasonCode });
    },

    advance: async (ticket: KdsTicketV1, to: "preparing" | "ready", preconditions: KdsAdvancePreconditions) => {
      const input = buildInput(ticket, to, preconditions);
      const decision = await engine.canEnqueue(input);
      if (!decision.allowed) return Object.freeze({ queued: false as const, reasonCode: decision.reasonCode });
      try {
        const entry = await engine.enqueue(input);
        return Object.freeze({ queued: true as const, eventId: entry.eventId });
      } catch (error) {
        if (error instanceof SyncEngineError && error.code === "CAPABILITY_BLOCKED") {
          const detail = error.message.split(": ").slice(1).join(": ");
          return Object.freeze({ queued: false as const, reasonCode: detail === "" ? null : detail });
        }
        throw error;
      }
    },

    reconcile: async (): Promise<KdsReconcileResult> => {
      const result = await engine.sync(scope);
      return Object.freeze({ push: result.push, pull: result.pull });
    },

    pendingTransitions: async (): Promise<readonly KdsPendingTransition[]> => {
      const entries = await engine.getOutbox(scope);
      const transitions: KdsPendingTransition[] = [];
      for (const entry of entries) {
        if (entry.entityType !== "KdsTicket" || entry.operation !== "transition") continue;
        if (!PENDING_STATES.has(entry.localState)) continue;
        const to = readTarget(entry.payload);
        if (to === undefined) continue;
        transitions.push(Object.freeze({ orderItemId: entry.entityId, to }));
      }
      return Object.freeze(transitions);
    },

    pendingCount: async (): Promise<number> => {
      const summary = await engine.getStatusSummary(scope);
      return summary.awaitingPush;
    },
  });
}

// ---- HTTP transport -------------------------------------------------------------------------

export interface KdsSyncHttpTransportOptions {
  readonly apiBaseUrl: string;
  readonly accessToken: string;
  /** Defaults to the versioned sync endpoints agreed for O1/O2 (`POST /api/v1/sync/push`, `POST /api/v1/sync/pull`). */
  readonly pushPath?: string;
  readonly pullPath?: string;
  readonly fetcher?: typeof fetch;
}

function transportCodeForStatus(status: number): { readonly code: string; readonly retryable: boolean } {
  if (status === 401 || status === 403) return { code: "AUTH_REVOKED", retryable: false };
  if (status === 408 || status === 429 || status >= 500) return { code: "SERVICE_UNAVAILABLE", retryable: true };
  if (status === 404) return { code: "SYNC_UNAVAILABLE", retryable: true };
  return { code: "SYNC_REJECTED", retryable: false };
}

/** Minimal authenticated JSON transport over the sync endpoints. Never invents a cursor. */
export function createKdsSyncHttpTransport(options: KdsSyncHttpTransportOptions): SyncTransportPort {
  const fetcher = options.fetcher ?? fetch;
  const pushPath = options.pushPath ?? "/api/v1/sync/push";
  const pullPath = options.pullPath ?? "/api/v1/sync/pull";

  const post = async (path: string, body: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`${options.apiBaseUrl}${path}`, {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
    } catch {
      throw new SyncTransportError("TRANSPORT_ERROR", true);
    }
    if (!response.ok) {
      const mapped = transportCodeForStatus(response.status);
      throw new SyncTransportError(mapped.code, mapped.retryable);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new SyncTransportError("RESPONSE_INVALID", true);
    }
  };

  return Object.freeze({
    push: (request: SyncPushRequest) => post(pushPath, request),
    pull: (request: SyncPullRequest) => post(pullPath, request),
  });
}

// ---- Durable sync storage -------------------------------------------------------------------

export const KDS_SYNC_DB_NAME = "superRestaurant.kds.sync";
const KDS_SYNC_STORE = "state";

function openSyncDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(KDS_SYNC_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KDS_SYNC_STORE)) database.createObjectStore(KDS_SYNC_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("KDS_SYNC_OPEN_FAILED"));
  });
}

/**
 * `DurableSyncStoragePort` over IndexedDB. Each persist is a single-key put, so a
 * commit either replaces the whole prior state or fails leaving it intact.
 */
export class IndexedDbSyncStorage implements DurableSyncStoragePort {
  private database: Promise<IDBDatabase> | null = null;

  public constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= openSyncDatabase(this.factory);
    return this.database;
  }

  public async loadState(deviceId: string): Promise<unknown> {
    const database = await this.open();
    const transaction = database.transaction(KDS_SYNC_STORE, "readonly");
    const request = transaction.objectStore(KDS_SYNC_STORE).get(deviceId) as IDBRequest<unknown>;
    const raw = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("KDS_SYNC_READ_FAILED"));
    });
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  public async persist(state: { readonly deviceId: string }): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(KDS_SYNC_STORE, "readwrite");
    transaction.objectStore(KDS_SYNC_STORE).put(JSON.stringify(state), state.deviceId);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("KDS_SYNC_WRITE_FAILED"));
      transaction.onabort = () => reject(transaction.error ?? new Error("KDS_SYNC_WRITE_ABORTED"));
    });
  }
}

export function createKdsSyncStorage(indexedDb: IDBFactory | undefined = globalThis.indexedDB): DurableSyncStoragePort {
  return indexedDb === undefined ? new InMemorySyncStorage() : new IndexedDbSyncStorage(indexedDb);
}

/**
 * Removes the durable outbox/replica for this browser profile. Called on
 * sign-out so a different actor never inherits the previous user's pending
 * KDS transitions.
 */
export async function clearKdsSyncState(indexedDb: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  if (indexedDb === undefined) return;
  const database = await openSyncDatabase(indexedDb);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(KDS_SYNC_STORE, "readwrite");
      transaction.objectStore(KDS_SYNC_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("KDS_SYNC_CLEAR_FAILED"));
      transaction.onabort = () => reject(transaction.error ?? new Error("KDS_SYNC_CLEAR_ABORTED"));
    });
  } finally {
    database.close();
  }
}
