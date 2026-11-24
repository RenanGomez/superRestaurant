import { parseDurableState, type DurableSyncState, type DurableSyncStoragePort } from "@super-restaurant/sync-engine";

const META = "sr_device_meta";
const SLOTS = "sr_state_slots";
const KEYS = "sr_crypto_keys";
const encoder = new TextEncoder();

type Meta = { activeSlot: number; generation: number; sequence: number; keyVersion: number; locked: boolean; quarantined: boolean };
type Slot = { ciphertext: ArrayBuffer; iv: Uint8Array; generation: number; keyVersion: number };
export class WebSyncStorageError extends Error {
  public readonly retryable: boolean;
  public constructor(public readonly code: string) { super(code); this.name = "WebSyncStorageError"; this.retryable = code === "STORAGE_LOAD_FAILED"; }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("aborted")); tx.onerror = () => undefined; });
}
function storageError(error: unknown): WebSyncStorageError {
  if (error instanceof WebSyncStorageError) return error;
  return new WebSyncStorageError(error instanceof DOMException && error.name === "QuotaExceededError" ? "STORAGE_QUOTA_EXCEEDED" : "STORAGE_COMMIT_FAILED");
}
function aad(deviceId: string, keyVersion: number, generation: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`sr-sync-v1|${deviceId}|1|${keyVersion}|${generation}`);
}

/** IndexedDB stores ciphertext and its non-extractable key in the same origin. This does not protect against XSS.
 * Web Locks serialize individual operations. After STORAGE_COMMIT_FAILED, discard the engine,
 * reopen the store and initialize a new engine before retrying the same idempotency key.
 * Web Locks do not elect a leader or serialize network sends across engine instances.
 */
export class WebIndexedDbSyncStorage implements DurableSyncStoragePort {
  private generation: number | null = null;
  private constructor(
    private readonly deviceId: string,
    private readonly db: IDBDatabase,
    private readonly crypto: Crypto,
    private readonly locks: LockManager,
    private readonly factory: IDBFactory,
    private readonly databaseName: string,
  ) {}

  public static async open(deviceId: string, options: { databaseName?: string; indexedDB?: IDBFactory; crypto?: Crypto; locks?: LockManager } = {}): Promise<WebIndexedDbSyncStorage> {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    const crypto = options.crypto ?? globalThis.crypto;
    const locks = options.locks ?? globalThis.navigator?.locks;
    const databaseName = options.databaseName ?? "sr_sync_v1";
    if (!deviceId || !factory || !crypto?.subtle || !locks) throw new WebSyncStorageError("ENCRYPTION_UNAVAILABLE");
    const open = factory.open(databaseName, 1);
    open.onupgradeneeded = () => { for (const name of [META, SLOTS, KEYS]) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name); };
    const db = await request(open);
    return new WebIndexedDbSyncStorage(deviceId, db, crypto, locks, factory, databaseName);
  }
  public close(): void { this.db.close(); }

  /**
   * Best-effort destructive purge used only when the caller proved the outbox has no
   * unconfirmed event. The connection is closed first; a blocked deletion (another
   * tab still holds the database) is reported as a failure so the caller never claims
   * the local store was cleared when it was not.
   */
  public purge(): Promise<void> {
    this.db.close();
    return new Promise<void>((resolve, reject) => {
      const deletion = this.factory.deleteDatabase(this.databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(new WebSyncStorageError("STORAGE_COMMIT_FAILED"));
      deletion.onblocked = () => reject(new WebSyncStorageError("STORAGE_COMMIT_FAILED"));
    });
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> { return this.locks.request(`sr-sync:${this.deviceId}`, { mode: "exclusive" }, work); }
  private async read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const tx = this.db.transaction(store, "readonly");
    const done = finished(tx);
    const [value] = await Promise.all([request(tx.objectStore(store).get(key) as IDBRequest<T | undefined>), done]);
    return value;
  }
  private async quarantine(): Promise<void> {
    const tx = this.db.transaction(META, "readwrite");
    const done = finished(tx);
    const store = tx.objectStore(META);
    const meta = await request(store.get(this.deviceId) as IDBRequest<Meta | undefined>);
    if (meta) store.put({ ...meta, quarantined: true }, this.deviceId);
    await done;
  }
  public loadState(deviceId: string): Promise<unknown> {
    if (deviceId !== this.deviceId) return Promise.reject(new WebSyncStorageError("DEVICE_MISMATCH"));
    return this.exclusive(async () => {
      const meta = await this.read<Meta>(META, deviceId);
      if (!meta) {
        if (await this.read<CryptoKey>(KEYS, [deviceId, 1]) || await this.read<Slot>(SLOTS, [deviceId, 0]) || await this.read<Slot>(SLOTS, [deviceId, 1])) throw new WebSyncStorageError("STATE_CORRUPT");
        this.generation = 0; return null;
      }
      if (meta.quarantined) throw new WebSyncStorageError("STORAGE_QUARANTINED");
      if (meta.locked) throw new WebSyncStorageError("STORAGE_LOCKED");
      let slot: Slot | undefined;
      let key: CryptoKey | undefined;
      try {
        slot = await this.read<Slot>(SLOTS, [deviceId, meta.activeSlot]);
        key = await this.read<CryptoKey>(KEYS, [deviceId, meta.keyVersion]);
      } catch { throw new WebSyncStorageError("STORAGE_LOAD_FAILED"); }
      try {
        if (!slot || !key || key.extractable || slot.generation !== meta.generation || slot.keyVersion !== meta.keyVersion || !(slot.iv instanceof Uint8Array) || slot.iv.length !== 12) throw new WebSyncStorageError("STATE_CORRUPT");
        let bytes: ArrayBuffer;
        try {
          bytes = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: slot.iv as Uint8Array<ArrayBuffer>, additionalData: aad(deviceId, slot.keyVersion, slot.generation) }, key, slot.ciphertext);
        } catch (error) {
          if (error instanceof DOMException && error.name === "OperationError") throw new WebSyncStorageError("STATE_CORRUPT");
          throw new WebSyncStorageError("STORAGE_LOAD_FAILED");
        }
        let raw: unknown;
        try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
        catch { throw new WebSyncStorageError("STATE_CORRUPT"); }
        const parsed = parseDurableState(raw, deviceId);
        if (!parsed.ok || parsed.value.lastLocalSequence !== meta.sequence) throw new WebSyncStorageError("STATE_CORRUPT");
        this.generation = meta.generation;
        return parsed.value;
      } catch (error) {
        if (error instanceof WebSyncStorageError && error.code === "STATE_CORRUPT") await this.quarantine();
        throw error;
      }
    }).catch((error: unknown) => {
      if (error instanceof WebSyncStorageError) throw error;
      throw new WebSyncStorageError("STORAGE_LOAD_FAILED");
    });
  }
  /** Read-only evidence recovery: never clears quarantine or replaces the active slot. */
  public inspectPreviousEvidence(): Promise<DurableSyncState | null> {
    return this.exclusive(async () => {
      const meta = await this.read<Meta>(META, this.deviceId);
      if (!meta?.quarantined || meta.generation < 2) return null;
      const slot = await this.read<Slot>(SLOTS, [this.deviceId, 1 - meta.activeSlot]);
      if (!slot || slot.generation !== meta.generation - 1) return null;
      const key = await this.read<CryptoKey>(KEYS, [this.deviceId, slot.keyVersion]);
      if (!key || key.extractable) return null;
      try {
        const bytes = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: slot.iv as Uint8Array<ArrayBuffer>, additionalData: aad(this.deviceId, slot.keyVersion, slot.generation) }, key, slot.ciphertext);
        const parsed = parseDurableState(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, this.deviceId);
        return parsed.ok ? parsed.value : null;
      } catch (error) {
        if (error instanceof DOMException && error.name !== "OperationError") throw new WebSyncStorageError("STORAGE_LOAD_FAILED");
        return null;
      }
    });
  }
  public persist(state: DurableSyncState): Promise<void> {
    const parsed = parseDurableState(state, this.deviceId);
    if (!parsed.ok) return Promise.reject(new WebSyncStorageError(parsed.code));
    return this.exclusive(async () => {
      try {
        const meta = await this.read<Meta>(META, this.deviceId);
        if (meta?.locked) throw new WebSyncStorageError("STORAGE_LOCKED");
        if (meta?.quarantined) throw new WebSyncStorageError("STORAGE_QUARANTINED");
        if (this.generation === null || this.generation !== (meta?.generation ?? 0)) throw new WebSyncStorageError("STALE_STATE");
        if (state.lastLocalSequence < (meta?.sequence ?? 0)) throw new WebSyncStorageError("SEQUENCE_REGRESSION");
        const version = meta?.keyVersion ?? 1;
        const existing = await this.read<CryptoKey>(KEYS, [this.deviceId, version]);
        if (meta && !existing) { await this.quarantine(); throw new WebSyncStorageError("STATE_CORRUPT"); }
        const key = existing ?? await this.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const generation = (meta?.generation ?? 0) + 1;
        const iv = this.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(this.deviceId, version, generation) }, key, encoder.encode(JSON.stringify(parsed.value)));
        const activeSlot = meta ? 1 - meta.activeSlot : 0;
        const tx = this.db.transaction([META, SLOTS, KEYS], "readwrite", { durability: "strict" });
        const done = finished(tx);
        const current = await request(tx.objectStore(META).get(this.deviceId) as IDBRequest<Meta | undefined>);
        if ((current?.generation ?? 0) !== (meta?.generation ?? 0) || current?.locked || current?.quarantined) { tx.abort(); await done.catch(() => undefined); throw new WebSyncStorageError("STALE_STATE"); }
        try {
        tx.objectStore(KEYS).put(key, [this.deviceId, version]);
        tx.objectStore(SLOTS).put({ ciphertext, iv, generation, keyVersion: version } satisfies Slot, [this.deviceId, activeSlot]);
        tx.objectStore(META).put({ activeSlot, generation, sequence: state.lastLocalSequence, keyVersion: version, locked: false, quarantined: false } satisfies Meta, this.deviceId);
        } catch (error) { tx.abort(); await done.catch(() => undefined); throw error; }
        await done;
        this.generation = generation;
      } catch (error) { throw storageError(error); }
    });
  }
}
