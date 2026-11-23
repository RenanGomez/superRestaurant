import assert from "node:assert/strict";
import test from "node:test";

import type { MobileSecureStorePort } from "../device-identity.js";
import {
  MobileSyncKeyError,
  MobileSyncKeyStore,
  SYNC_DB_KEY_BYTES,
  isSyncDatabaseKeyHex,
  syncDatabaseKeySql,
  syncKeyPointerKey,
  syncKeyStorageKey,
  type MobileSyncSecureStorePort,
} from "./sync-key.js";

const DEVICE = "00000000-0000-4000-8000-00000000d1d1";

class FakeSecureStore implements MobileSyncSecureStorePort {
  public readonly values = new Map<string, string>();
  public available = true;
  public failWrites = false;
  public failures = 0;

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  public getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  public setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) {
      this.failures += 1;
      return Promise.reject(new Error("keystore refused"));
    }
    this.values.set(key, value);
    return Promise.resolve();
  }

  public deleteItem(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

/** Bytes whose hex is `01 02 … 20`, so every assertion can be exact. */
function deterministicBytes(length: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = index + 1;
  return Promise.resolve(bytes);
}

function keyStore(store: MobileSyncSecureStorePort, randomBytes = deterministicBytes): MobileSyncKeyStore {
  return new MobileSyncKeyStore({ randomBytes, store });
}

const EXPECTED_HEX = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

test("the first call mints a 32-byte key once and keeps it across launches", async () => {
  const store = new FakeSecureStore();
  const keys = keyStore(store);
  const first = await keys.getOrCreate(DEVICE);
  assert.deepEqual(first, { hex: EXPECTED_HEX, version: 1 });
  assert.equal(isSyncDatabaseKeyHex(first.hex), true);

  const restarted = await keyStore(store).getOrCreate(DEVICE);
  assert.deepEqual(restarted, first);
  assert.equal(store.values.size, 2, "one key plus the pointer");
  assert.equal(store.values.get(syncKeyPointerKey(DEVICE)), "1");
});

test("a stored key that is not canonical 64-char hex is corrupt and is not overwritten", async () => {
  const store = new FakeSecureStore();
  store.values.set(syncKeyStorageKey(DEVICE, 1), "ABC");
  store.values.set(syncKeyPointerKey(DEVICE), "1");
  await assert.rejects(
    keyStore(store).getOrCreate(DEVICE),
    (error: unknown) => error instanceof MobileSyncKeyError && error.code === "ENCRYPTION_KEY_CORRUPT",
  );
  assert.equal(store.values.get(syncKeyStorageKey(DEVICE, 1)), "ABC");
});

test("a pointer to a missing version is corrupt, never silently re-minted", async () => {
  const store = new FakeSecureStore();
  store.values.set(syncKeyPointerKey(DEVICE), "2");
  await assert.rejects(
    keyStore(store).current(DEVICE),
    (error: unknown) => error instanceof MobileSyncKeyError && error.code === "ENCRYPTION_KEY_CORRUPT",
  );
});

test("a keystore that is unavailable or refuses writes fails closed", async () => {
  const unavailable = new FakeSecureStore();
  unavailable.available = false;
  await assert.rejects(
    keyStore(unavailable).getOrCreate(DEVICE),
    (error: unknown) => error instanceof MobileSyncKeyError && error.code === "ENCRYPTION_UNAVAILABLE",
  );

  const refusing = new FakeSecureStore();
  refusing.failWrites = true;
  await assert.rejects(
    keyStore(refusing).getOrCreate(DEVICE),
    (error: unknown) => error instanceof MobileSyncKeyError && error.code === "ENCRYPTION_UNAVAILABLE",
  );
  assert.equal(refusing.failures, 1);
});

test("a generator that returns the wrong length is refused instead of stored", async () => {
  const store = new FakeSecureStore();
  await assert.rejects(
    keyStore(store, () => Promise.resolve(new Uint8Array(SYNC_DB_KEY_BYTES - 1))).getOrCreate(DEVICE),
    (error: unknown) => error instanceof MobileSyncKeyError && error.code === "ENCRYPTION_KEY_CORRUPT",
  );
  assert.equal(store.values.size, 0);
});

test("rotation commits the pointer only after rekey and retireBelow deletes only the superseded key", async () => {
  const store = new FakeSecureStore();
  const keys = keyStore(store);
  await keys.getOrCreate(DEVICE);
  const next = await keys.rotate(DEVICE);
  assert.equal(next.version, 2);
  assert.equal(store.values.get(syncKeyPointerKey(DEVICE)), "1", "rotate must not move the pointer before the rekey");

  await keys.commitRotation(DEVICE, next.version);
  assert.equal(store.values.get(syncKeyPointerKey(DEVICE)), "2");

  await keys.retireBelow(DEVICE, 2);
  assert.equal(store.values.has(syncKeyStorageKey(DEVICE, 1)), false);
  assert.equal(store.values.has(syncKeyStorageKey(DEVICE, 2)), true);
  assert.deepEqual(await keys.current(DEVICE), next);
});

test("a failed rekey leaves the pointer on the old key so the database still reopens", async () => {
  const store = new FakeSecureStore();
  const keys = keyStore(store);
  const original = await keys.getOrCreate(DEVICE);

  // `rotate` stores N+1 but the simulated `PRAGMA rekey` throws, so nothing commits.
  const next = await keys.rotate(DEVICE);
  assert.equal(next.version, 2);
  assert.equal(store.values.get(syncKeyPointerKey(DEVICE)), "1", "pointer must survive a failed rekey");
  assert.deepEqual(await keys.current(DEVICE), original);

  const reopened = await keyStore(store).openCandidates(DEVICE);
  assert.equal(reopened.pointerVersion, 1);
  assert.deepEqual(reopened.keys[0], original, "the old key still opens the database");
});

test("a crash after the rekey but before commit recovers the uncommitted key on reopen", async () => {
  const store = new FakeSecureStore();
  const keys = keyStore(store);
  await keys.getOrCreate(DEVICE);
  const next = await keys.rotate(DEVICE);

  // The database was rekeyed but the process died before `commitRotation`.
  const reopened = await keyStore(store).openCandidates(DEVICE);
  assert.equal(reopened.pointerVersion, 1);
  assert.deepEqual(reopened.keys.map((key) => key.version), [1, 2]);
  assert.deepEqual(reopened.keys[1], next);
});

test("commitRotation refuses a version that was never stored", async () => {
  const store = new FakeSecureStore();
  const keys = keyStore(store);
  await keys.getOrCreate(DEVICE);
  await assert.rejects(
    keys.commitRotation(DEVICE, 2),
    (error: unknown) => error instanceof MobileSyncKeyError && error.code === "ENCRYPTION_KEY_CORRUPT",
  );
  assert.equal(store.values.get(syncKeyPointerKey(DEVICE)), "1");
});

test("concurrent first-run callers share one attempt and one key", async () => {
  const store = new FakeSecureStore();
  let mints = 0;
  const keys = keyStore(store, (length) => {
    mints += 1;
    return deterministicBytes(length);
  });
  const [first, second] = await Promise.all([keys.getOrCreate(DEVICE), keys.getOrCreate(DEVICE)]);
  assert.deepEqual(first, second);
  assert.equal(mints, 1);
});

test("purge clears the cached attempt so a later call mints a new key", async () => {
  const store = new FakeSecureStore();
  const keys = keyStore(store);
  await keys.getOrCreate(DEVICE);
  await keys.purge(DEVICE);
  assert.equal(await keys.current(DEVICE), null, "a stale cached key must not leak after a purge");
  const recreated = await keys.getOrCreate(DEVICE);
  assert.equal(recreated.version, 1);
  assert.equal(store.values.has(syncKeyStorageKey(DEVICE, 1)), true);
});

test("purge deletes every version and the pointer", async () => {
  const store = new FakeSecureStore();
  const keys = keyStore(store);
  await keys.getOrCreate(DEVICE);
  await keys.rotate(DEVICE);
  await keys.purge(DEVICE);
  assert.equal(store.values.size, 0);
  assert.equal(await keyStore(store).current(DEVICE), null);
});

test("the SQLite key literal is only built from validated hex", () => {
  assert.equal(syncDatabaseKeySql({ hex: EXPECTED_HEX, version: 1 }), `x'${EXPECTED_HEX}'`);
  assert.throws(
    () => syncDatabaseKeySql({ hex: `x' OR 1=1 --`, version: 1 }),
    (error: unknown) => error instanceof MobileSyncKeyError && error.code === "ENCRYPTION_KEY_CORRUPT",
  );
  assert.equal(isSyncDatabaseKeyHex("0".repeat(64)), true);
  assert.equal(isSyncDatabaseKeyHex("0".repeat(63)), false);
});

// The identity port and the key port must stay compatible: this assertion fails to
// compile if `MobileSecureStorePort` ever diverges from what the key store needs.
const identityCompatible: MobileSecureStorePort = new FakeSecureStore();
assert.ok(identityCompatible);
