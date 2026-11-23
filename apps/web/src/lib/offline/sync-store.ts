import { parseDurableState, type DurableSyncState, type DurableSyncStoragePort } from "@super-restaurant/sync-engine";

const META = "sr_device_meta";
const SLOTS = "sr_state_slots";
const KEYS = "sr_crypto_keys";
const encoder = new TextEncoder();

type Meta = { activeSlot: number; generation: number; sequence: number; keyVersion: number; locked: boolean; quarantined: boolean };
type Slot = { ciphertext: ArrayBuffer; iv: Uint8Array; generation: number; keyVersion: number };
export class WebSyncStorageError extends Error {
  public constructor(public readonly code: string) { super(code); this.name = "WebSyncStorageError"; }
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

/** IndexedDB stores only AES-GCM ciphertext; Web Locks serialize all access per device. */
export class WebIndexedDbSyncStorage implements DurableSyncStoragePort {
  private generation: number | null = null;
  private constructor(private readonly deviceId: string, private readonly db: IDBDatabase, private readonly crypto: Crypto, private readonly locks: LockManager) {}

  public static async open(deviceId: string, options: { databaseName?: string; indexedDB?: IDBFactory; crypto?: Crypto; locks?: LockManager } = {}): Promise<WebIndexedDbSyncStorage> {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    const crypto = options.crypto ?? globalThis.crypto;
    const locks = options.locks ?? globalThis.navigator?.locks;
    if (!deviceId || !factory || !crypto?.subtle || !locks) throw new WebSyncStorageError("ENCRYPTION_UNAVAILABLE");
    const open = factory.open(options.databaseName ?? "sr_sync_v1", 1);
    open.onupgradeneeded = () => { for (const name of [META, SLOTS, KEYS]) if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name); };
    const db = await request(open);
    return new WebIndexedDbSyncStorage(deviceId, db, crypto, locks);
  }
  public close(): void { this.db.close(); }
  private exclusive<T>(work: () => Promise<T>): Promise<T> { return this.locks.request(`sr-sync:${this.deviceId}`, { mode: "exclusive" }, work); }
  private async read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const tx = this.db.transaction(store, "readonly");
    const done = finished(tx);
    const value = await request(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
    await done;
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
      try {
        const slot = await this.read<Slot>(SLOTS, [deviceId, meta.activeSlot]);
        const key = await this.read<CryptoKey>(KEYS, [deviceId, meta.keyVersion]);
        if (!slot || !key || key.extractable || slot.generation !== meta.generation || slot.keyVersion !== meta.keyVersion || slot.iv.length !== 12) throw new Error("invalid slot");
        const bytes = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: slot.iv as Uint8Array<ArrayBuffer>, additionalData: aad(deviceId, slot.keyVersion, slot.generation) }, key, slot.ciphertext);
        const parsed = parseDurableState(JSON.parse(new TextDecoder().decode(bytes)) as unknown, deviceId);
        if (!parsed.ok || parsed.value.lastLocalSequence !== meta.sequence) throw new Error("invalid state");
        this.generation = meta.generation;
        return parsed.value;
      } catch {
        await this.quarantine();
        throw new WebSyncStorageError("STATE_CORRUPT");
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
