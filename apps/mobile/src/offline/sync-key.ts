/**
 * The database encryption key (DEK) of one installation (ADR-005 §4.3).
 *
 * It is a 32-byte random value generated with the platform CSPRNG, stored in
 * the keystore as 64 lowercase hex characters under a **versioned** key
 * (`superRestaurant.syncDbKey.v<N>.<deviceId>`) with
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, and injected into SQLite as a raw key
 * (`PRAGMA key = "x'<64-hex>'"`) to avoid a weak KDF or an encoding drift.
 *
 * The same rules the device identity already follows apply here:
 *
 * - no keystore means no key and therefore no offline database: fail closed
 *   instead of writing plaintext;
 * - a stored value that is not exactly what this module writes is treated as
 *   corrupt and never silently replaced, because replacing the key would make
 *   the existing encrypted database unreadable without saying so;
 * - `purge` is the crypto-shredding half of a device revocation: once the DEK
 *   is gone, the ciphertext that remains cannot be read.
 *
 * This module imports no native package; `expo-offline.ts` supplies the
 * `expo-secure-store` and `expo-crypto` adapters.
 */
import type { MobileSecureStorePort } from "../device-identity.js";

/** Version of the first key this app writes. A rotation moves to `N + 1`. */
export const SYNC_DB_KEY_VERSION = 1;

/** AES-256 key material. */
export const SYNC_DB_KEY_BYTES = 32;

/** Highest version this app will look for; beyond this, the pointer is treated as corrupt. */
export const SYNC_DB_KEY_MAX_VERSION = 99;

const SYNC_DB_KEY_HEX = /^[0-9a-f]{64}$/u;

export const SYNC_DB_KEY_PREFIX = "superRestaurant.syncDbKey";

export type MobileSyncKeyErrorCode =
  /** No keystore on this platform, or it threw. Fail closed: no plaintext fallback. */
  | "ENCRYPTION_UNAVAILABLE"
  /** A stored value or version pointer is not what this module writes. Never overwritten silently. */
  | "ENCRYPTION_KEY_CORRUPT";

export class MobileSyncKeyError extends Error {
  public constructor(public readonly code: MobileSyncKeyErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "MobileSyncKeyError";
  }
}

export interface MobileSyncDatabaseKey {
  readonly version: number;
  readonly hex: string;
}

/** Candidate keys for opening one database; `pointerVersion` is `0` when none was minted yet. */
export interface MobileSyncKeyCandidates {
  readonly pointerVersion: number;
  readonly keys: readonly MobileSyncDatabaseKey[];
}

/** The slice of `expo-secure-store` the key lifecycle needs; adds deletion to the identity port. */
export interface MobileSyncSecureStorePort extends MobileSecureStorePort {
  readonly deleteItem: (key: string) => Promise<void>;
}

export interface MobileSyncKeyStoreOptions {
  readonly store: MobileSyncSecureStorePort;
  /** 32 random bytes from the platform CSPRNG (`expo-crypto` in the app). */
  readonly randomBytes: (length: number) => Promise<Uint8Array>;
}

/** Versioned storage key: a rotation gets a new key rather than an in-place migration. */
export function syncKeyStorageKey(deviceId: string, version: number): string {
  return `${SYNC_DB_KEY_PREFIX}.v${version}.${deviceId}`;
}

/** Pointer to the version the database was opened with. */
export function syncKeyPointerKey(deviceId: string): string {
  return `${SYNC_DB_KEY_PREFIX}Current.${deviceId}`;
}

/**
 * The exact SQLite key literal. Only validated lowercase hex is accepted, so a
 * corrupt or hostile value can never be spliced into the `PRAGMA`.
 */
export function syncDatabaseKeySql(key: MobileSyncDatabaseKey): string {
  if (!SYNC_DB_KEY_HEX.test(key.hex)) throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "sql");
  return `x'${key.hex}'`;
}

export function isSyncDatabaseKeyHex(value: unknown): value is string {
  return typeof value === "string" && SYNC_DB_KEY_HEX.test(value);
}

function hexOf(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export class MobileSyncKeyStore {
  private readonly store: MobileSyncSecureStorePort;
  private readonly randomBytes: (length: number) => Promise<Uint8Array>;
  /** One attempt per device: two start-up callers must never mint two keys. */
  private readonly attempts = new Map<string, Promise<MobileSyncDatabaseKey>>();

  public constructor(options: MobileSyncKeyStoreOptions) {
    this.store = options.store;
    this.randomBytes = options.randomBytes;
  }

  /** The key this device is already using, or `null` when it has none yet. */
  public current(deviceId: string): Promise<MobileSyncDatabaseKey | null> {
    return this.readVersion(deviceId).then((version) => this.readKey(deviceId, version));
  }

  /** Reads the current key, minting `v1` on first use. Idempotent across launches. */
  public getOrCreate(deviceId: string): Promise<MobileSyncDatabaseKey> {
    const existing = this.attempts.get(deviceId);
    if (existing !== undefined) return existing;
    const attempt = this.loadOrCreate(deviceId).catch((error: unknown) => {
      this.attempts.delete(deviceId);
      throw error;
    });
    this.attempts.set(deviceId, attempt);
    return attempt;
  }

  private async loadOrCreate(deviceId: string): Promise<MobileSyncDatabaseKey> {
    const existing = await this.current(deviceId);
    if (existing !== null) return existing;
    const hex = await this.mint();
    try {
      await this.store.setItem(syncKeyStorageKey(deviceId, SYNC_DB_KEY_VERSION), hex);
      await this.store.setItem(syncKeyPointerKey(deviceId), String(SYNC_DB_KEY_VERSION));
    } catch {
      throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "write");
    }
    return Object.freeze({ version: SYNC_DB_KEY_VERSION, hex });
  }

  /**
   * Generates `N + 1` and stores it **without moving the pointer**. The caller
   * runs `PRAGMA rekey` and only after a verified re-encryption calls
   * `commitRotation` (then `retireBelow`). If the rekey fails or the process
   * dies before the commit, the pointer still names the key the database is
   * actually encrypted with, so the store stays readable.
   */
  public async rotate(deviceId: string): Promise<MobileSyncDatabaseKey> {
    const current = await this.current(deviceId);
    const nextVersion = (current?.version ?? 0) + 1;
    if (nextVersion > SYNC_DB_KEY_MAX_VERSION) throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "version");
    const hex = await this.mint();
    try {
      await this.store.setItem(syncKeyStorageKey(deviceId, nextVersion), hex);
    } catch {
      throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "rotate");
    }
    // A cached first-run result would otherwise keep handing out the old key.
    this.attempts.delete(deviceId);
    return Object.freeze({ version: nextVersion, hex });
  }

  /**
   * Moves the pointer to `version` **after** a rekey was verified against the
   * new key. Until this succeeds the pointer keeps naming the previous key, so
   * a crash between rekey and commit opens the old key first and then falls
   * back to the newer one (`openCandidates`).
   */
  public async commitRotation(deviceId: string, version: number): Promise<void> {
    if (!Number.isSafeInteger(version) || version < 1 || version > SYNC_DB_KEY_MAX_VERSION) {
      throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "version");
    }
    if (await this.readKey(deviceId, version) === null) {
      throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "missing");
    }
    try {
      await this.store.setItem(syncKeyPointerKey(deviceId), String(version));
    } catch {
      throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "rotate");
    }
    this.attempts.delete(deviceId);
  }

  /**
   * Keys to try when opening the database, in order: the pointer key, an
   * uncommitted rotation immediately above it (crash after a successful rekey
   * but before `commitRotation`), and the previous version (a rotation that was
   * stored but never committed, while the database still uses the old key).
   */
  public async openCandidates(deviceId: string): Promise<MobileSyncKeyCandidates> {
    const pointerVersion = await this.readVersion(deviceId);
    if (pointerVersion === 0) return Object.freeze({ keys: Object.freeze([]), pointerVersion });
    const pointer = await this.readKey(deviceId, pointerVersion);
    if (pointer === null) throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "missing");
    const keys: MobileSyncDatabaseKey[] = [pointer];
    if (pointerVersion + 1 <= SYNC_DB_KEY_MAX_VERSION) {
      const uncommitted = await this.tryReadKey(deviceId, pointerVersion + 1);
      if (uncommitted !== null) keys.push(uncommitted);
    }
    if (pointerVersion > 1) {
      const previous = await this.tryReadKey(deviceId, pointerVersion - 1);
      if (previous !== null) keys.push(previous);
    }
    return Object.freeze({ keys: Object.freeze(keys), pointerVersion });
  }

  /** Deletes every key below `version` after a confirmed rekey. Best effort per version. */
  public async retireBelow(deviceId: string, version: number): Promise<void> {
    for (let candidate = 1; candidate < version; candidate += 1) {
      try {
        await this.store.deleteItem(syncKeyStorageKey(deviceId, candidate));
      } catch {
        // A keystore that refused a deletion does not make the new key unusable;
        // the value left behind belongs to a database that no longer exists.
      }
    }
  }

  /** Crypto-shredding: every version and the pointer go. Afterwards ciphertext is unreadable. */
  public async purge(deviceId: string): Promise<void> {
    this.attempts.delete(deviceId);
    // Delete every possible version, not just those below the pointer: an
    // uncommitted rotation stores `N + 1` while the pointer still says `N`.
    for (let candidate = 1; candidate <= SYNC_DB_KEY_MAX_VERSION; candidate += 1) {
      try {
        await this.store.deleteItem(syncKeyStorageKey(deviceId, candidate));
      } catch {
        // Keep deleting the rest; a partial keystore failure still destroys most versions.
      }
    }
    try {
      await this.store.deleteItem(syncKeyPointerKey(deviceId));
    } catch {
      // The pointer alone cannot decrypt anything.
    }
  }

  private async mint(): Promise<string> {
    let bytes: Uint8Array;
    try {
      bytes = await this.randomBytes(SYNC_DB_KEY_BYTES);
    } catch {
      throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "random");
    }
    if (!(bytes instanceof Uint8Array) || bytes.length !== SYNC_DB_KEY_BYTES) {
      throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "random");
    }
    return hexOf(bytes);
  }

  private async readVersion(deviceId: string): Promise<number> {
    let available: boolean;
    try {
      available = await this.store.isAvailable();
    } catch {
      throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "available");
    }
    if (!available) throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "available");

    let pointer: string | null;
    try {
      pointer = await this.store.getItem(syncKeyPointerKey(deviceId));
    } catch {
      throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "read");
    }
    if (pointer === null) {
      // Pre-pointer installs (or a first run that failed between writes): adopt v1
      // if it exists, otherwise there is simply no key yet.
      const legacy = await this.readRaw(syncKeyStorageKey(deviceId, SYNC_DB_KEY_VERSION));
      return legacy === null ? 0 : SYNC_DB_KEY_VERSION;
    }
    if (!/^[1-9][0-9]?$/u.test(pointer)) throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "version");
    const version = Number(pointer);
    if (version > SYNC_DB_KEY_MAX_VERSION) throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "version");
    return version;
  }

  private async readKey(deviceId: string, version: number): Promise<MobileSyncDatabaseKey | null> {
    if (version === 0) return null;
    const hex = await this.readRaw(syncKeyStorageKey(deviceId, version));
    if (hex === null) throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "missing");
    if (!isSyncDatabaseKeyHex(hex)) throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "format");
    return Object.freeze({ version, hex });
  }

  /** Non-throwing variant for the optional fallback slots of `openCandidates`. */
  private async tryReadKey(deviceId: string, version: number): Promise<MobileSyncDatabaseKey | null> {
    const hex = await this.readRaw(syncKeyStorageKey(deviceId, version));
    if (hex === null || !isSyncDatabaseKeyHex(hex)) return null;
    return Object.freeze({ version, hex });
  }

  private async readRaw(key: string): Promise<string | null> {
    try {
      return await this.store.getItem(key);
    } catch {
      throw new MobileSyncKeyError("ENCRYPTION_UNAVAILABLE", "read");
    }
  }
}
