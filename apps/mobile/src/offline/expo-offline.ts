/**
 * The only file of `src/offline` that touches the platform.
 *
 * It opens the per-installation encrypted database with `expo-sqlite`, injects
 * the DEK from `expo-secure-store` as a raw SQLCipher key, and **fails closed**
 * when SQLCipher is not compiled into the binary: Expo Go (or a Development
 * Build without the `expo-sqlite` config plugin) ignores `PRAGMA key`, so an
 * empty `PRAGMA cipher_version` means "no offline storage", never "store in
 * plaintext".
 *
 * Requirements that live outside this module's allowed paths and are recorded
 * in HANDOFF.md as follow-ups:
 *
 * - `app.json` must register the `expo-sqlite` plugin with `useSQLCipher: true`
 *   (Development/EAS Build only) and exclude the `.db`/`-wal`/`-shm` files from
 *   iOS backups and Android auto-backup (ADR-005 Â§3.5, Â§5).
 * - SQLCipher Community Edition attribution belongs in `THIRD_PARTY_NOTICES`
 *   and an "Acerca de / Avisos legales" screen before distribution.
 *
 * Pragmas follow ADR-005 Â§3.5 literally: WAL, `synchronous = FULL`,
 * `foreign_keys = ON`, `secure_delete = ON`, `temp_store = MEMORY` and a 5 s
 * `busy_timeout` for the exclusive transaction.
 */
import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
  getRandomBytesAsync,
} from "expo-crypto";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import {
  deleteItemAsync,
  getItemAsync,
  isAvailableAsync,
  setItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} from "expo-secure-store";

import { createExpoDeviceIdentity } from "../expo-device-identity.js";
import {
  isSyncDatabaseKeyHex,
  MobileSyncKeyError,
  MobileSyncKeyStore,
  syncDatabaseKeySql,
  type MobileSyncDatabaseKey,
  type MobileSyncKeyCandidates,
  type MobileSyncSecureStorePort,
} from "./sync-key.js";
import { MobileOfflineSession } from "./sync-session.js";
import {
  MobileSqliteSyncStorage,
  MobileSyncStorageError,
  toStorageError,
  type MobileSyncDatabasePort,
  type MobileSyncStoredMeta,
  type MobileSyncTransactionPort,
} from "./sync-store.js";
import { createMobileSyncTransport, type MobileSyncTransportOptions } from "./sync-transport.js";
import type { SyncTransportPort } from "@super-restaurant/sync-engine";

export const MOBILE_SYNC_DATABASE_PREFIX = "sr_sync_";

/** Everything ADR-005 Â§3.5 requires before the first read or write. */
export const MOBILE_SYNC_PRAGMAS: readonly string[] = Object.freeze([
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = FULL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA secure_delete = ON",
  "PRAGMA temp_store = MEMORY",
  "PRAGMA busy_timeout = 5000",
]);

const SCHEMA_STATEMENTS: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS sync_device_meta (
     device_id TEXT PRIMARY KEY NOT NULL,
     state_version INTEGER NOT NULL,
     last_local_sequence INTEGER NOT NULL,
     write_generation INTEGER NOT NULL,
     key_version INTEGER NOT NULL,
     locked INTEGER NOT NULL,
     quarantined INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     byte_length INTEGER NOT NULL,
     state_sha256 TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sync_state_snapshot (
     device_id TEXT PRIMARY KEY NOT NULL,
     state_json TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
]);

const OPTIONS = Object.freeze({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });

/** Keystore adapter: same accessibility policy as the device identity, plus deletion. */
export const expoMobileSecureStore: MobileSyncSecureStorePort = Object.freeze({
  deleteItem: (key: string): Promise<void> => deleteItemAsync(key, OPTIONS),
  getItem: (key: string): Promise<string | null> => getItemAsync(key, OPTIONS),
  isAvailable: (): Promise<boolean> => isAvailableAsync(),
  setItem: (key: string, value: string): Promise<void> => setItemAsync(key, value, OPTIONS),
});

export interface MobileSyncSqliteDatabase extends MobileSyncDatabasePort {
  readonly databaseName: string;
  /** Only used for `PRAGMA rekey` during a verified key rotation. */
  readonly execSql: (sql: string) => Promise<void>;
}

interface MetaRow {
  readonly device_id: string;
  readonly state_version: number;
  readonly last_local_sequence: number;
  readonly write_generation: number;
  readonly key_version: number;
  readonly locked: number;
  readonly quarantined: number;
  readonly updated_at: number;
  readonly byte_length: number;
  readonly state_sha256: string;
}

function metaFromRow(row: MetaRow): MobileSyncStoredMeta {
  return Object.freeze({
    deviceId: row.device_id,
    stateVersion: 1 as const,
    lastLocalSequence: row.last_local_sequence,
    writeGeneration: row.write_generation,
    keyVersion: row.key_version,
    locked: row.locked === 1,
    quarantined: row.quarantined === 1,
    updatedAt: row.updated_at,
    byteLength: row.byte_length,
    stateSha256: row.state_sha256,
  });
}

function transactionPort(transaction: SQLiteDatabase): MobileSyncTransactionPort {
  return Object.freeze({
    readMeta: async (deviceId: string): Promise<MobileSyncStoredMeta | null> => {
      const row = await transaction.getFirstAsync<MetaRow>(
        "SELECT device_id, state_version, last_local_sequence, write_generation, key_version, locked, quarantined, updated_at, byte_length, state_sha256 FROM sync_device_meta WHERE device_id = ?",
        deviceId,
      );
      return row === null ? null : metaFromRow(row);
    },
    readSnapshot: async (deviceId: string): Promise<string | null> => {
      const row = await transaction.getFirstAsync<{ readonly state_json: string }>(
        "SELECT state_json FROM sync_state_snapshot WHERE device_id = ?",
        deviceId,
      );
      return row === null ? null : row.state_json;
    },
    writeSnapshot: async (deviceId: string, stateJson: string): Promise<void> => {
      await transaction.runAsync(
        "INSERT INTO sync_state_snapshot (device_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
        deviceId,
        stateJson,
        Date.now(),
      );
    },
    writeMeta: async (meta: MobileSyncStoredMeta): Promise<void> => {
      await transaction.runAsync(
        "INSERT INTO sync_device_meta (device_id, state_version, last_local_sequence, write_generation, key_version, locked, quarantined, updated_at, byte_length, state_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET state_version = excluded.state_version, last_local_sequence = excluded.last_local_sequence, write_generation = excluded.write_generation, key_version = excluded.key_version, locked = excluded.locked, quarantined = excluded.quarantined, updated_at = excluded.updated_at, byte_length = excluded.byte_length, state_sha256 = excluded.state_sha256",
        meta.deviceId,
        meta.stateVersion,
        meta.lastLocalSequence,
        meta.writeGeneration,
        meta.keyVersion,
        meta.locked ? 1 : 0,
        meta.quarantined ? 1 : 0,
        meta.updatedAt,
        meta.byteLength,
        meta.stateSha256,
      );
    },
    deleteSnapshot: async (deviceId: string): Promise<void> => {
      await transaction.runAsync("DELETE FROM sync_state_snapshot WHERE device_id = ?", deviceId);
    },
    deleteMeta: async (deviceId: string): Promise<void> => {
      await transaction.runAsync("DELETE FROM sync_device_meta WHERE device_id = ?", deviceId);
    },
  });
}

export interface OpenMobileSyncDatabaseOptions {
  readonly databaseName: string;
  readonly keyHex: string;
  /** Version of the key in the keystore that `keyHex` belongs to. */
  readonly keyVersion: number;
}

export async function openMobileSyncDatabase(options: OpenMobileSyncDatabaseOptions): Promise<MobileSyncSqliteDatabase> {
  if (!isSyncDatabaseKeyHex(options.keyHex)) {
    throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "keyHex");
  }
  if (!Number.isSafeInteger(options.keyVersion) || options.keyVersion < 1) {
    throw new MobileSyncKeyError("ENCRYPTION_KEY_CORRUPT", "keyVersion");
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(options.databaseName)) {
    throw new MobileSyncStorageError("DEVICE_MISMATCH", "databaseName");
  }

  let database: SQLiteDatabase;
  try {
    database = await openDatabaseAsync(options.databaseName);
  } catch (error) {
    throw toStorageError(error, "STORAGE_LOAD_FAILED");
  }

  try {
    // The key must be the first statement on the connection.
    await database.execAsync(`PRAGMA key = "${syncDatabaseKeySql({ version: options.keyVersion, hex: options.keyHex })}"`);
    const cipher = await database.getFirstAsync<{ readonly cipher_version: string | null }>("PRAGMA cipher_version");
    const cipherVersion = cipher?.cipher_version;
    if (typeof cipherVersion !== "string" || cipherVersion.trim().length === 0) {
      throw new MobileSyncStorageError("ENCRYPTION_UNAVAILABLE", "cipher_version");
    }
    for (const pragma of MOBILE_SYNC_PRAGMAS) await database.execAsync(pragma);
    for (const statement of SCHEMA_STATEMENTS) await database.execAsync(statement);
    await database.getFirstAsync("SELECT count(*) AS present FROM sqlite_master");
  } catch (error) {
    await database.closeAsync().catch(() => undefined);
    throw toStorageError(error, "STORAGE_LOAD_FAILED");
  }

  return Object.freeze({
    databaseName: options.databaseName,
    closeDatabase: async (): Promise<void> => {
      await database.closeAsync();
    },
    execSql: async (sql: string): Promise<void> => {
      await database.execAsync(sql);
    },
    withExclusiveTransaction: async <T>(work: (transaction: MobileSyncTransactionPort) => Promise<T>): Promise<T> => {
      const outcome: { value?: T } = {};
      await database.withExclusiveTransactionAsync(async (transaction) => {
        outcome.value = await work(transactionPort(transaction));
      });
      if (!("value" in outcome)) throw new MobileSyncStorageError("STORAGE_COMMIT_FAILED", "transaction");
      return outcome.value as T;
    },
  });
}

export const mobileSha256Hex = (text: string): Promise<string> =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, text, { encoding: CryptoEncoding.HEX });

export interface MobileOfflineRuntime {
  readonly deviceId: string;
  readonly keys: MobileSyncKeyStore;
  readonly session: MobileOfflineSession;
  readonly storage: MobileSqliteSyncStorage;
  readonly database: MobileSyncSqliteDatabase;
  readonly close: () => Promise<void>;
}

/**
 * Opens the encrypted offline store for this installation. Throws
 * `ENCRYPTION_UNAVAILABLE` / `ENCRYPTION_KEY_CORRUPT` instead of degrading to
 * an unencrypted database.
 */
export async function openMobileOfflineRuntime(): Promise<MobileOfflineRuntime> {
  const deviceId = await createExpoDeviceIdentity().load();
  const keys = new MobileSyncKeyStore({ randomBytes: getRandomBytesAsync, store: expoMobileSecureStore });
  const databaseName = `${MOBILE_SYNC_DATABASE_PREFIX}${deviceId}.db`;
  let candidates: MobileSyncKeyCandidates = await keys.openCandidates(deviceId);
  if (candidates.keys.length === 0) {
    const created = await keys.getOrCreate(deviceId);
    candidates = Object.freeze({ keys: Object.freeze([created]), pointerVersion: created.version });
  }

  let key: MobileSyncDatabaseKey | undefined;
  let database: MobileSyncSqliteDatabase | undefined;
  let lastError: unknown;
  for (const candidate of candidates.keys) {
    try {
      database = await openMobileSyncDatabase({ databaseName, keyHex: candidate.hex, keyVersion: candidate.version });
      key = candidate;
      break;
    } catch (error) {
      lastError = error;
      // A missing cipher affects every candidate; do not mask it as a wrong key.
      if (error instanceof MobileSyncStorageError && error.code === "ENCRYPTION_UNAVAILABLE") throw error;
    }
  }
  if (database === undefined || key === undefined) throw toStorageError(lastError, "STORAGE_LOAD_FAILED");

  // A successful open with an uncommitted rotation is proof the rekey landed:
  // commit the pointer so the next launch opens the right key on the first try.
  if (key.version !== candidates.pointerVersion) {
    try {
      await keys.commitRotation(deviceId, key.version);
    } catch {
      // The database is already open with a working key; a stuck pointer only
      // means the next launch falls back again.
    }
  }

  const storage = new MobileSqliteSyncStorage({
    database,
    deviceId,
    keyVersion: key.version,
    sha256Hex: mobileSha256Hex,
  });
  const session = new MobileOfflineSession({ deviceId, keys, storage });
  return Object.freeze({
    close: async (): Promise<void> => {
      await storage.closeDatabase();
    },
    database,
    deviceId,
    keys,
    session,
    storage,
  });
}

/** Transport bound to this runtime, so the revocation gate and token always come from the session. */
export function createMobileOfflineTransport(
  runtime: MobileOfflineRuntime,
  options: Omit<MobileSyncTransportOptions, "canSend">,
): SyncTransportPort {
  return createMobileSyncTransport({ ...options, canSend: () => runtime.session.pushesAllowed() });
}

/**
 * Verified rotation (ADR-005 Â§4.3): generate `N + 1`, rekey the database, and
 * only **after** the rekey resolves move the pointer and delete the previous
 * key. A rekey that throws, or a process that dies before `commitRotation`,
 * leaves the pointer on the key the database still uses, so nothing is lost.
 */
export async function rotateMobileSyncDatabaseKey(runtime: MobileOfflineRuntime): Promise<MobileSyncDatabaseKey> {
  const next = await runtime.keys.rotate(runtime.deviceId);
  try {
    await runtime.database.execSql(`PRAGMA rekey = "${syncDatabaseKeySql(next)}"`);
  } catch (error) {
    throw toStorageError(error, "STORAGE_COMMIT_FAILED");
  }
  // The rekey resolved, so the database now needs the new key: commit the
  // pointer before retiring the old key. If the commit fails, the old key is
  // kept and the next open falls back to `N + 1` via `openCandidates`.
  await runtime.keys.commitRotation(runtime.deviceId, next.version);
  await runtime.keys.retireBelow(runtime.deviceId, next.version);
  runtime.storage.adoptKeyVersion(next.version);
  return next;
}
