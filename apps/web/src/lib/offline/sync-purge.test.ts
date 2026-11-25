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
const restaurantB = "00000000-0000-4000-8000-000000000020";
const branchB = "00000000-0000-4000-8000-000000000021";
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
type ScopeIds = { readonly restaurantId: string; readonly branchId: string };
function scopeState(ids: ScopeIds, pullCursor: string | null = null) {
  return { restaurantId: ids.restaurantId, branchId: ids.branchId, status: "active", pullCursor } as const;
}
function outboxEntry(ids: ScopeIds, eventId: string, idempotencyKey: string, localSequence: number) {
  return { actorId: other, attemptId: null, baseVersion: null, blockedBy: null, branchId: ids.branchId, deviceId: device, entityId: eventId, entityType: "Order", eventId, idempotencyKey, lastErrorCode: null, leaseUntil: null, localSequence, localState: "pending", nextAttemptAt: null, occurredAt: "2026-11-23T00:00:00.000Z", operation: "create", outcome: null, payload: { note: idempotencyKey }, receivedAt: null, resolvedBy: null, restaurantId: ids.restaurantId, retryCount: 0, schemaVersion: "1", updatedAt: 1795478400000 };
}
function replicaEntity(ids: ScopeIds, entityId: string) {
  return { restaurantId: ids.restaurantId, branchId: ids.branchId, entityType: "Order", entityId, canonicalVersion: 1, tombstone: false, snapshot: null, pendingEventId: null, revertTo: null, pendingWrites: [] };
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

test("sign_out with financial evidence degrades purge_all to keep-outbox and keeps the store readable", async () => {
  assert.equal(decideOfflinePurge({ event: "sign_out", hasFinancialEvidence: true }).action, "purge_replica_keep_outbox");
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

test("sign_out without financial evidence purges everything even when a replica exists", async () => {
  assert.equal(decideOfflinePurge({ event: "sign_out", hasFinancialEvidence: false }).action, "purge_all");
  const { factory, store } = await setup();
  const replicaOnly = { ...fixture(), replica: [replicaEntity({ restaurantId: restaurant, branchId: branch }, other)] } as unknown as DurableSyncState;
  await store.persist(replicaOnly);
  const outcome = await store.purgeAll();
  assert.equal(outcome.wiped, true);
  assert.equal(outcome.retainedOutboxCount, 0);
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

test("a locked store refuses purge and rotation while keeping slots and keys intact", async () => {
  const { factory, store } = await setup();
  await store.persist(evidenceState());
  await store.lock();
  await assert.rejects(store.purgeAll(), code("STORAGE_LOCKED"));
  await assert.rejects(store.purgeForScope(scope), code("STORAGE_LOCKED"));
  await assert.rejects(store.rotateKey(), code("STORAGE_LOCKED"));
  const db = await openDb(factory);
  assert.notEqual(await req(db.transaction("sr_state_slots").objectStore("sr_state_slots").get([device, 0])), undefined);
  assert.notEqual(await req(db.transaction("sr_crypto_keys").objectStore("sr_crypto_keys").get([device, 1])), undefined);
  db.close(); store.close();
});

test("a quarantined store refuses purge and rotation while keeping slots and keys intact", async () => {
  const { factory, store } = await setup();
  await store.persist(evidenceState());
  await store.quarantine();
  await assert.rejects(store.purgeAll(), code("STORAGE_QUARANTINED"));
  await assert.rejects(store.purgeForScope(scope), code("STORAGE_QUARANTINED"));
  await assert.rejects(store.rotateKey(), code("STORAGE_QUARANTINED"));
  const db = await openDb(factory);
  assert.notEqual(await req(db.transaction("sr_state_slots").objectStore("sr_state_slots").get([device, 0])), undefined);
  assert.notEqual(await req(db.transaction("sr_crypto_keys").objectStore("sr_crypto_keys").get([device, 1])), undefined);
  db.close(); store.close();
});

test("purgeForScope leaves the other scope replica, evidence and key untouched", async () => {
  const { factory, store } = await setup();
  const idsA: ScopeIds = { restaurantId: restaurant, branchId: branch };
  const idsB: ScopeIds = { restaurantId: restaurantB, branchId: branchB };
  const itemA = outboxEntry(idsA, "00000000-0000-4000-8000-0000000000a1", "isolation-a", 1);
  const itemB = outboxEntry(idsB, "00000000-0000-4000-8000-0000000000b2", "isolation-b", 2);
  const replicaA = replicaEntity(idsA, "00000000-0000-4000-8000-0000000000c3");
  const replicaB = replicaEntity(idsB, "00000000-0000-4000-8000-0000000000d4");
  const state = { ...createEmptyState(device), lastLocalSequence: 2, scopes: [scopeState(idsA, "cursor-a"), scopeState(idsB, "cursor-b")], outbox: [itemA, itemB], replica: [replicaA, replicaB] };
  await store.persist(state as unknown as DurableSyncState);
  const outcome = await store.purgeForScope(scope);
  assert.equal(outcome.wiped, false);
  assert.equal(outcome.removedReplicaCount, 1);
  assert.equal(outcome.retainedOutboxCount, 2);
  const loaded = await store.loadState(device) as DurableSyncState;
  assert.equal(loaded.replica.length, 1);
  assert.deepEqual(loaded.replica[0], replicaB);
  assert.deepEqual(loaded.outbox, [itemA, itemB]);
  const db = await openDb(factory);
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device) as IDBRequest<{ keyVersion: number }>);
  const key = await req(db.transaction("sr_crypto_keys").objectStore("sr_crypto_keys").get([device, meta.keyVersion]) as IDBRequest<CryptoKey | undefined>);
  assert.equal(meta.keyVersion, 2);
  assert.notEqual(key, undefined);
  assert.equal(key?.extractable, false);
  db.close(); store.close();
});

/** Writes a pre-scope (AAD v1) store by hand: no `scope` on the slot nor the metadata. */
async function seedV1(factory: IDBFactory, state: DurableSyncState): Promise<void> {
  const open = factory.open("test", 1);
  open.onupgradeneeded = () => { for (const name of ["sr_device_meta", "sr_state_slots", "sr_crypto_keys"]) open.result.createObjectStore(name); };
  const db = await req(open);
  const generation = 1; const keyVersion = 1;
  const key = await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`sr-sync-v1|${device}|1|${keyVersion}|${generation}`);
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, new TextEncoder().encode(JSON.stringify(state)));
  const tx = db.transaction(["sr_device_meta", "sr_state_slots", "sr_crypto_keys"], "readwrite");
  tx.objectStore("sr_crypto_keys").put(key, [device, keyVersion]);
  tx.objectStore("sr_state_slots").put({ ciphertext, iv, generation, keyVersion }, [device, 0]);
  tx.objectStore("sr_device_meta").put({ activeSlot: 0, generation, sequence: state.lastLocalSequence, keyVersion, locked: false, quarantined: false }, device);
  await txDone(tx);
  db.close();
}

test("a legacy AAD v1 store loads without corruption and upgrades to v2 on the next commit", async () => {
  const factory = new IDBFactory();
  const options = { indexedDB: factory, databaseName: "test", locks, crypto: globalThis.crypto };
  const expected = fixture();
  await seedV1(factory, expected);
  const store = await WebIndexedDbSyncStorage.open(device, options);
  assert.deepEqual(await store.loadState(device), expected);
  await store.persist(expected);
  const db = await openDb(factory);
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device) as IDBRequest<{ activeSlot: number; scope?: string }>);
  const slot = await req(db.transaction("sr_state_slots").objectStore("sr_state_slots").get([device, meta.activeSlot]) as IDBRequest<{ scope?: string }>);
  assert.equal(typeof meta.scope, "string");
  assert.equal(typeof slot.scope, "string");
  db.close(); store.close();
  const reopened = await WebIndexedDbSyncStorage.open(device, options);
  assert.deepEqual(await reopened.loadState(device), expected);
  reopened.close();
});

test("rotateKey makes previous evidence deterministically uninspectable without quarantining", async () => {
  const { factory, store } = await setup();
  const evidence = evidenceState();
  await store.persist(evidence);
  await store.persist({ ...evidence, lastLocalSequence: 8 });
  await store.rotateKey();
  assert.equal(await store.inspectPreviousEvidence(), null);
  assert.equal((await store.loadState(device) as DurableSyncState).lastLocalSequence, 8);
  const db = await openDb(factory);
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device) as IDBRequest<{ activeSlot: number }>);
  const tx = db.transaction("sr_state_slots", "readwrite");
  const os = tx.objectStore("sr_state_slots");
  const slot = await req(os.get([device, meta.activeSlot]) as IDBRequest<{ ciphertext: ArrayBuffer }>);
  const bytes = new Uint8Array(slot.ciphertext); bytes[0] = (bytes[0] ?? 0) ^ 1;
  os.put(slot, [device, meta.activeSlot]);
  await txDone(tx);
  await assert.rejects(store.loadState(device), code("STATE_CORRUPT"));
  assert.equal(await store.inspectPreviousEvidence(), null);
  db.close(); store.close();
});

test("purgeForScope matches case-insensitive identifiers instead of silently purging nothing", async () => {
  const { store } = await setup();
  const idsUpper: ScopeIds = { restaurantId: restaurant.toUpperCase(), branchId: branch.toUpperCase() };
  const item = outboxEntry(idsUpper, other, "normalized", 1);
  const state = { ...createEmptyState(device), lastLocalSequence: 1, scopes: [scopeState(idsUpper)], outbox: [item], replica: [replicaEntity(idsUpper, other)] };
  await store.persist(state as unknown as DurableSyncState);
  const outcome = await store.purgeForScope({ restaurantId: restaurant, branchId: branch });
  assert.equal(outcome.wiped, false);
  assert.equal(outcome.removedReplicaCount, 1);
  assert.equal(outcome.retainedOutboxCount, 1);
  const loaded = await store.loadState(device) as DurableSyncState;
  assert.equal(loaded.replica.length, 0);
  assert.deepEqual(loaded.outbox, [item]);
  store.close();
});

test("lock on an already quarantined store keeps both flags without corrupting the slot", async () => {
  const { factory, store } = await setup();
  await store.persist(fixture());
  await store.quarantine();
  await store.lock();
  const db = await openDb(factory);
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device) as IDBRequest<{ locked: boolean; quarantined: boolean }>);
  assert.equal(meta.locked, true);
  assert.equal(meta.quarantined, true);
  assert.notEqual(await req(db.transaction("sr_state_slots").objectStore("sr_state_slots").get([device, 0])), undefined);
  db.close();
  await assert.rejects(store.loadState(device), code("STORAGE_QUARANTINED"));
  store.close();
});

test("a degraded purge reencrypts and a later commit still loads", async () => {
  const { store } = await setup();
  const evidence = evidenceState();
  await store.persist(evidence);
  const outcome = await store.purgeAll();
  assert.equal(outcome.wiped, false);
  const next = { ...evidence, replica: [], lastLocalSequence: 2 } as DurableSyncState;
  await store.persist(next);
  assert.deepEqual(await store.loadState(device), next);
  store.close();
});
