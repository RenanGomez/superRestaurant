import {
  parseKdsTicketListV1,
  parseSyncScopeV1,
  type KdsTicketV1,
  type SyncConnectivityStateV1,
} from "@super-restaurant/shared-types";

/**
 * Local-first cache for the kitchen display.
 *
 * The KDS may only keep working with tickets it already received for its own
 * branch/station. Everything here is therefore scoped and fails closed: records
 * from another restaurant, branch or station are dropped instead of being shown.
 */

export interface KdsStationScope {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly stationId: string;
}

export interface KdsCacheRecord {
  readonly schemaVersion: 1;
  readonly scope: KdsStationScope;
  /** Tickets as last received from the server (never optimistic). */
  readonly tickets: readonly KdsTicketV1[];
  /** Opaque KDS event cursor; only ever advanced together with a fetched page. */
  readonly cursor: string | null;
  /** ISO instant of the last verified server reception for this station. */
  readonly lastReceivedAt: string;
}

export interface KdsCachePort {
  load(scope: KdsStationScope): Promise<KdsCacheRecord | null>;
  save(record: KdsCacheRecord): Promise<void>;
}

export interface KdsPendingTransition {
  readonly orderItemId: string;
  readonly to: "preparing" | "ready";
}

export type KdsDisplayTicket = KdsTicketV1 & { readonly localPending: boolean };

/** Canonical §2.3 copy: a local KDS advance is not visible to other stations yet. */
export const KDS_LOCAL_ONLY_COPY =
  "Estado guardado en este KDS; otras estaciones lo verán al sincronizar.";
export const KDS_OFFLINE_LOCKED_COPY =
  "Sin conexión: no puedes reasignar estación ni sucursal hasta sincronizar.";
export const KDS_OFFLINE_NO_NEW_TICKETS_COPY =
  "Sin conexión: no se pueden recibir comandas nuevas; se muestran las ya guardadas.";

export function sameStationScope(left: KdsStationScope, right: KdsStationScope): boolean {
  return left.restaurantId === right.restaurantId
    && left.branchId === right.branchId
    && left.stationId === right.stationId;
}

function ticketBelongsTo(ticket: KdsTicketV1, scope: KdsStationScope): boolean {
  return ticket.scope.restaurantId === scope.restaurantId
    && ticket.scope.branchId === scope.branchId
    && ticket.stationId === scope.stationId;
}

/** Drops tickets from another tenant/branch/station and de-duplicates by `orderItemId`. */
export function ticketsForStation(
  tickets: readonly KdsTicketV1[],
  scope: KdsStationScope,
): readonly KdsTicketV1[] {
  const byItem = new Map<string, KdsTicketV1>();
  for (const ticket of tickets) {
    if (!ticketBelongsTo(ticket, scope)) continue;
    if (!byItem.has(ticket.orderItemId)) byItem.set(ticket.orderItemId, ticket);
  }
  return Object.freeze([...byItem.values()]);
}

/**
 * Applies queued local transitions on top of the known tickets for optimism.
 * A pending transition is only shown for a ticket already present in this
 * station, so the board never claims to have received a new order offline.
 */
export function overlayPendingTransitions(
  tickets: readonly KdsTicketV1[],
  pending: readonly KdsPendingTransition[],
): readonly KdsDisplayTicket[] {
  if (pending.length === 0) {
    return Object.freeze(tickets.map((ticket) => ({ ...ticket, localPending: false })));
  }
  const byItem = new Map<string, KdsPendingTransition>();
  for (const item of pending) byItem.set(item.orderItemId, item);
  return Object.freeze(tickets.map((ticket) => {
    const queued = byItem.get(ticket.orderItemId);
    if (queued === undefined) return { ...ticket, localPending: false };
    return { ...ticket, status: queued.to, localPending: true };
  }));
}

/** True while the device cannot safely change branch/station identity. */
export function stationSelectionLocked(connectivity: SyncConnectivityStateV1): boolean {
  return connectivity !== "online" && connectivity !== "degraded";
}

export function buildCacheRecord(input: {
  readonly scope: KdsStationScope;
  readonly tickets: readonly KdsTicketV1[];
  readonly cursor: string | null;
  readonly receivedAt: Date;
}): KdsCacheRecord {
  return Object.freeze({
    schemaVersion: 1 as const,
    scope: Object.freeze({ ...input.scope }),
    tickets: ticketsForStation(input.tickets, input.scope),
    cursor: input.cursor,
    lastReceivedAt: input.receivedAt.toISOString(),
  });
}

export function formatLastReceived(lastReceivedAt: string | null): string {
  if (lastReceivedAt === null) return "Sin recepción registrada";
  const parsed = new Date(lastReceivedAt);
  if (Number.isNaN(parsed.getTime())) return "Sin recepción registrada";
  return `Última recepción ${parsed.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Runtime validation for a record read back from storage. A corrupted or
 * cross-scope record is dropped instead of being rendered. Tickets are parsed
 * with the shared contract, so a stale cache never leaks another station.
 */
export function parseCacheRecord(value: unknown, expected: KdsStationScope): KdsCacheRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as { readonly [key: string]: unknown };
  if (record["schemaVersion"] !== 1) return null;
  const rawScope = record["scope"];
  if (typeof rawScope !== "object" || rawScope === null) return null;
  const scope = parseSyncScopeV1({
    restaurantId: (rawScope as { readonly [key: string]: unknown })["restaurantId"],
    branchId: (rawScope as { readonly [key: string]: unknown })["branchId"],
  });
  if (scope === undefined) return null;
  const scoped = rawScope as { readonly [key: string]: unknown };
  if (
    scoped["restaurantId"] !== expected.restaurantId
    || scoped["branchId"] !== expected.branchId
    || scoped["stationId"] !== expected.stationId
  ) return null;
  const cursor = record["cursor"];
  if (!(cursor === null || (typeof cursor === "string" && cursor.length > 0))) return null;
  const lastReceivedAt = record["lastReceivedAt"];
  if (typeof lastReceivedAt !== "string" || Number.isNaN(Date.parse(lastReceivedAt))) return null;

  const parsed = parseKdsTicketListV1({
    schemaVersion: 1,
    scope,
    stationId: expected.stationId,
    tickets: record["tickets"],
    truncated: false,
  });
  if (parsed === undefined) return null;
  return Object.freeze({
    schemaVersion: 1 as const,
    scope: Object.freeze({ ...expected }),
    tickets: Object.freeze(ticketsForStation(parsed.tickets, expected)),
    cursor: cursor as string | null,
    lastReceivedAt,
  });
}

/** In-memory reference cache for tests and for browsers without IndexedDB. */
export class InMemoryKdsCache implements KdsCachePort {
  private readonly records = new Map<string, string>();

  public load(scope: KdsStationScope): Promise<KdsCacheRecord | null> {
    const raw = this.records.get(cacheKey(scope));
    if (raw === undefined) return Promise.resolve(null);
    try {
      return Promise.resolve(parseCacheRecord(JSON.parse(raw) as unknown, scope));
    } catch {
      return Promise.resolve(null);
    }
  }

  public save(record: KdsCacheRecord): Promise<void> {
    this.records.set(cacheKey(record.scope), JSON.stringify(record));
    return Promise.resolve();
  }

  /** Replaces the stored record with arbitrary JSON, to simulate corruption. */
  public seedRaw(scope: KdsStationScope, value: unknown): void {
    this.records.set(cacheKey(scope), JSON.stringify(value));
  }
}

function cacheKey(scope: KdsStationScope): string {
  return `${scope.restaurantId}:${scope.branchId}:${scope.stationId}`;
}

export const KDS_CACHE_DB_NAME = "superRestaurant.kds";
const KDS_CACHE_STORE = "tickets";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("KDS_CACHE_REQUEST_FAILED"));
  });
}

function openCacheDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(KDS_CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KDS_CACHE_STORE)) database.createObjectStore(KDS_CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("KDS_CACHE_OPEN_FAILED"));
  });
}

/** IndexedDB-backed ticket cache. Single-key writes keep each save atomic. */
export class IndexedDbKdsCache implements KdsCachePort {
  private database: Promise<IDBDatabase> | null = null;

  public constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.database ??= openCacheDatabase(this.factory);
    return this.database;
  }

  public async load(scope: KdsStationScope): Promise<KdsCacheRecord | null> {
    const database = await this.open();
    const transaction = database.transaction(KDS_CACHE_STORE, "readonly");
    const raw = await requestToPromise(transaction.objectStore(KDS_CACHE_STORE).get(cacheKey(scope)) as IDBRequest<unknown>);
    if (typeof raw !== "string") return null;
    try {
      return parseCacheRecord(JSON.parse(raw) as unknown, scope);
    } catch {
      return null;
    }
  }

  public async save(record: KdsCacheRecord): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(KDS_CACHE_STORE, "readwrite");
    transaction.objectStore(KDS_CACHE_STORE).put(JSON.stringify(record), cacheKey(record.scope));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("KDS_CACHE_WRITE_FAILED"));
      transaction.onabort = () => reject(transaction.error ?? new Error("KDS_CACHE_WRITE_ABORTED"));
    });
  }
}

/** Picks IndexedDB when the runtime exposes it; otherwise an in-memory cache. */
export function createKdsCache(indexedDb: IDBFactory | undefined = globalThis.indexedDB): KdsCachePort {
  return indexedDb === undefined ? new InMemoryKdsCache() : new IndexedDbKdsCache(indexedDb);
}

/**
 * Removes cached tickets for every station. Called on sign-out so a different
 * actor never sees the previous user's kitchen data.
 */
export async function clearKdsCache(indexedDb: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  if (indexedDb === undefined) return;
  const database = await openCacheDatabase(indexedDb);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(KDS_CACHE_STORE, "readwrite");
      transaction.objectStore(KDS_CACHE_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("KDS_CACHE_CLEAR_FAILED"));
      transaction.onabort = () => reject(transaction.error ?? new Error("KDS_CACHE_CLEAR_ABORTED"));
    });
  } finally {
    database.close();
  }
}
