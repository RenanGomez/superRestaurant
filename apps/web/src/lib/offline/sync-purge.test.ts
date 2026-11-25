import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyState, parseSyncScope, type DurableSyncState } from "@super-restaurant/sync-engine";
import { decideOfflinePurge, type OfflinePurgeAction, type OfflinePurgeInput } from "./sync-purge.js";
import { WebIndexedDbSyncStorage, WebSyncStorageError } from "./sync-store.js";

const device = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const restaurant = "00000000-0000-4000-8000-000000000010";
const branch = "00000000-0000-4000-8000-000000000011";
const parsedScope = parseSyncScope({ restaurantId: restaurant, branchId: branch });
if (!parsedScope.ok) throw new Error("scope");
const scope = parsedScope.value;
const locks = (() => {
  const tails = new Map<string, Promise<unknown>>();
  return { request: <T>(name: string, _options: unknown, callback: () => Promise<T>): Promise<T> => {
    const previous = tails.get(name) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(callback);
    tails.set(name, next);
    return next;
  } } as LockManager;
})();
const code = (expected: string) => (error: unknown): boolean => error instanceof WebSyncStorageError && error.code === expected;
function fixture(): DurableSyncState {
  return { ...createEmptyState(device), lastLocalSequence: 7, scopes: [{ ...scope, status: "active", pullCursor: "private-cursor" }] };
}
function evidenceState(): DurableSyncState {
  const item = { actorId: other, attemptId: null, baseVersion: null, blockedBy: null, branchId: branch, deviceId: device, entityId: other, entityType: "Order", eventId: other, idempotencyKey: "purge-evidence", lastErrorCode: "CONFLICT", leaseUntil: null, localSequence: 1, localState: "manual_review", nextAttemptAt: null, occurredAt: "2026-11-23T00:00:00.000Z", operation: "create", outcome: null, payload: { note: "evidence" }, receivedAt: null, resolvedBy: null, restaurantId: restaurant, retryCount: 0, schemaVersion: "1", updatedAt: 1795478400000 };
  const replica = { restaurantId: restaurant, branchId: branch, entityType: "Order", entityId: other, canonicalVersion: 1, tombstone: false, snapshot: null, pendingEventId: null, revertTo: null, pendingWrites: [] };
  return { ...fixture(), lastLocalSequence: 1, outbox: [item], replica: [replica] } as unknown as DurableSyncState;
}
function req<T>(r: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function txDone(tx: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); }
async function openDb(factory: IDBFactory): Promise<IDBDatabase> { return req(factory.open("test", 1)); }
async function setup() {
  const factory = new IDBFactory();
  const options = { indexedDB: factory, databaseName: "test", locks, crypto: globalThis.crypto };
  const store = await WebIndexedDbSyncStorage.open(device, options);
  await store.loadState(device);
  return { factory, options, store };
}

test("offline purge policy covers every event and evidence branch", () => {
  const cases: readonly (readonly [OfflinePurgeInput, OfflinePurgeAction])[] = [
    [{ event: "sign_out", hasFinancialEvidence: false }, "purge_all"],
    [{ event: "sign_out", hasFinancialEvidence: true }, "purge_replica_keep_outbox"],
    [{ event: "auth_revoked", hasFinancialEvidence: false }, "purge_replica_keep_outbox"],
    [{ event: "auth_revoked", hasFinancialEvidence: true }, "purge_replica_keep_outbox"],
    [{ event: "device_revoked", hasFinancialEvidence: false }, "purge_all"],
    [{ event: "device_revoked", hasFinancialEvidence: true }, "lock_and_keep"],
    [{ event: "device_compromised", hasFinancialEvidence: false }, "purge_all"],
    [{ event: "device_compromised", hasFinancialEvidence: true }, "purge_replica_keep_outbox"],
  ];
  for (const [input, expected] of cases) {
    const decision = decideOfflinePurge(input);
    assert.equal(decision.action, expected);
    assert.equal(typeof decision.reason, "string");
    assert.ok(decision.reason.length > 0);
  }
  assert.equal(decideOfflinePurge({ event: "unexpected" as never, hasFinancialEvidence: false }).action, "lock_and_keep");
});

test("AAD bound to the authorized scope rejects a slot relabelled under another scope as corruption", async () => {
  const { factory, store } = await setup();
  await store.persist(fixture());
  const db = await openDb(factory);
  const relabelled = `${restaurant}|${other}`;
  const tx = db.transaction(["sr_device_meta", "sr_state_slots"], "readwrite");
  const metaStore = tx.objectStore("sr_device_meta");
  const slotStore = tx.objectStore("sr_state_slots");
  const meta = await req(metaStore.get(device) as IDBRequest<{ scope: string }>);
  const slot = await req(slotStore.get([device, 0]) as IDBRequest<{ scope: string }>);
  metaStore.put({ ...meta, scope: relabelled }, device);
  slotStore.put({ ...slot, scope: relabelled }, [device, 0]);
  await txDone(tx);
  await assert.rejects(store.loadState(device), code("STATE_CORRUPT"));
  db.close(); store.close();
});

test("rotateKey re-encrypts the active slot under a new key version and retires the previous key", async () => {
  const { factory, options, store } = await setup();
  await store.persist(fixture());
  await store.rotateKey();
  assert.deepEqual(await store.loadState(device), fixture());
  const db = await openDb(factory);
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device) as IDBRequest<{ activeSlot: number; generation: number; keyVersion: number }>);
  const oldKey = await req(db.transaction("sr_crypto_keys").objectStore("sr_crypto_keys").get([device, 1]));
  const newKey = await req(db.transaction("sr_crypto_keys").objectStore("sr_crypto_keys").get([device, 2]) as IDBRequest<CryptoKey>);
  const slot = await req(db.transaction("sr_state_slots").objectStore("sr_state_slots").get([device, meta.activeSlot]) as IDBRequest<{ generation: number; keyVersion: number }>);
  assert.equal(meta.keyVersion, 2);
  assert.equal(oldKey, undefined);
  assert.equal(newKey.extractable, false);
  assert.equal(slot.keyVersion, 2);
  assert.equal(slot.generation, meta.generation);
  db.close(); store.close();
  const reopened = await WebIndexedDbSyncStorage.open(device, options);
  assert.deepEqual(await reopened.loadState(device), fixture());
  reopened.close();
});

test("purgeForScope drops the scope replica but keeps outbox evidence under a fresh key", async () => {
  const { factory, store } = await setup();
  const evidence = evidenceState();
  await store.persist(evidence);
  const outcome = await store.purgeForScope(scope);
  assert.equal(outcome.wiped, false);
  assert.equal(outcome.removedReplicaCount, 1);
  assert.equal(outcome.retainedOutboxCount, 1);
  const loaded = await store.loadState(device) as DurableSyncState;
  assert.equal(loaded.replica.length, 0);
  assert.deepEqual(loaded.outbox, evidence.outbox);
  const db = await openDb(factory);
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device) as IDBRequest<{ keyVersion: number }>);
  const oldKey = await req(db.transaction("sr_crypto_keys").objectStore("sr_crypto_keys").get([device, 1]));
  assert.equal(meta.keyVersion, 2);
  assert.equal(oldKey, undefined);
  db.close(); store.close();
});

test("purgeAll keeps retained outbox evidence when the store cannot distinguish it", async () => {
  const { store } = await setup();
  const evidence = evidenceState();
  await store.persist(evidence);
  const outcome = await store.purgeAll();
  assert.equal(outcome.wiped, false);
  assert.equal(outcome.removedReplicaCount, 1);
  assert.equal(outcome.retainedOutboxCount, 1);
  const loaded = await store.loadState(device) as DurableSyncState;
  assert.equal(loaded.replica.length, 0);
  assert.deepEqual(loaded.outbox, evidence.outbox);
  store.close();
});

test("purgeAll with no evidence wipes stored slots, keys and metadata", async () => {
  const { factory, store } = await setup();
  await store.persist(fixture());
  const outcome = await store.purgeAll();
  assert.equal(outcome.wiped, true);
  const db = await openDb(factory);
  assert.equal(await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device)), undefined);
  assert.equal(await req(db.transaction("sr_state_slots").objectStore("sr_state_slots").get([device, 0])), undefined);
  assert.equal(await req(db.transaction("sr_state_slots").objectStore("sr_state_slots").get([device, 1])), undefined);
  assert.equal(await req(db.transaction("sr_crypto_keys").objectStore("sr_crypto_keys").get([device, 1])), undefined);
  db.close();
  assert.equal(await store.loadState(device), null);
  store.close();
});

test("lock and quarantine are public administrative operations that preserve the snapshot", async () => {
  const { options, store } = await setup();
  await store.persist(fixture());
  await store.lock();
  await assert.rejects(store.loadState(device), code("STORAGE_LOCKED"));
  const second = await WebIndexedDbSyncStorage.open(device, options);
  await assert.rejects(second.loadState(device), code("STORAGE_LOCKED"));
  await assert.rejects(second.persist(fixture()), code("STORAGE_LOCKED"));
  second.close();
  await store.quarantine();
  await assert.rejects(store.loadState(device), code("STORAGE_QUARANTINED"));
  store.close();
});
