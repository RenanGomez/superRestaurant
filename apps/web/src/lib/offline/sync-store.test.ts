import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyState, parseSyncScope, type DurableSyncState } from "@super-restaurant/sync-engine";
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
function req<T>(r: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function openDb(factory: IDBFactory): Promise<IDBDatabase> { return req(factory.open("test", 1)); }
async function setup() {
  const factory = new IDBFactory();
  const options = { indexedDB: factory, databaseName: "test", locks, crypto: globalThis.crypto };
  const store = await WebIndexedDbSyncStorage.open(device, options);
  await store.loadState(device);
  return { factory, options, store };
}

test("encrypted state survives reopening and uses a non-extractable key", async () => {
  const { factory, options, store } = await setup();
  await store.persist(fixture());
  store.close();
  const db = await openDb(factory);
  const tx = db.transaction(["sr_state_slots", "sr_crypto_keys"], "readonly");
  const slot = await req(tx.objectStore("sr_state_slots").get([device, 0]));
  const key = await req(tx.objectStore("sr_crypto_keys").get([device, 1])) as CryptoKey;
  assert.equal(key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("raw", key));
  assert.equal(new TextDecoder().decode(slot.ciphertext).includes("private-cursor"), false);
  db.close();
  const reopened = await WebIndexedDbSyncStorage.open(device, options);
  assert.deepEqual(await reopened.loadState(device), fixture());
  reopened.close();
});

test("stale writers and sequence regression cannot overwrite a confirmed snapshot", async () => {
  const { options, store } = await setup();
  const second = await WebIndexedDbSyncStorage.open(device, options);
  await second.loadState(device);
  await store.persist(fixture());
  await assert.rejects(second.persist(fixture()), code("STALE_STATE"));
  await assert.rejects(store.persist({ ...fixture(), lastLocalSequence: 6 }), code("SEQUENCE_REGRESSION"));
  assert.deepEqual(await store.loadState(device), fixture());
  store.close(); second.close();
});

test("tampering quarantines the device and never resets its sequence", async () => {
  const { factory, store } = await setup();
  await store.persist(fixture());
  const db = await openDb(factory);
  const tx = db.transaction("sr_state_slots", "readwrite");
  const os = tx.objectStore("sr_state_slots");
  const slot = await req(os.get([device, 0]));
  const bytes = new Uint8Array(slot.ciphertext);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  os.put(slot, [device, 0]);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  await assert.rejects(store.loadState(device), code("STATE_CORRUPT"));
  await assert.rejects(store.persist(fixture()), code("STORAGE_QUARANTINED"));
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device));
  assert.equal(meta.sequence, 7); assert.equal(meta.quarantined, true);
  db.close(); store.close();
});

test("device identities remain isolated and reject foreign state", async () => {
  const { options, store } = await setup();
  await store.persist(fixture());
  const foreign = await WebIndexedDbSyncStorage.open(other, options);
  assert.equal(await foreign.loadState(other), null);
  await assert.rejects(foreign.persist(fixture()), code("STATE_CORRUPT"));
  await assert.rejects(store.loadState(other), code("DEVICE_MISMATCH"));
  store.close(); foreign.close();
});

test("missing Web Locks fails closed", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  try { await assert.rejects(WebIndexedDbSyncStorage.open(device, { indexedDB: new IDBFactory(), crypto: globalThis.crypto }), code("ENCRYPTION_UNAVAILABLE")); }
  finally { if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); }
});

test("quota failure aborts the transaction and preserves the prior snapshot", async () => {
  const { factory, store } = await setup();
  await store.persist(fixture());
  const db = await openDb(factory);
  const sample = db.transaction("sr_device_meta").objectStore("sr_device_meta");
  const proto = Object.getPrototypeOf(sample) as IDBObjectStore;
  const original = proto.put;
  let calls = 0;
  proto.put = function (...args: Parameters<IDBObjectStore["put"]>) {
    calls += 1;
    if (calls === 2) throw new DOMException("full", "QuotaExceededError");
    return original.apply(this, args);
  };
  try { await assert.rejects(store.persist({ ...fixture(), lastLocalSequence: 8 }), code("STORAGE_QUOTA_EXCEEDED")); }
  finally { proto.put = original; }
  assert.deepEqual(await store.loadState(device), fixture());
  db.close(); store.close();
});

test("rejects a replica outside its restaurant and branch scopes", async () => {
  const { store } = await setup();
  const invalid = { ...fixture(), replica: [{ ...scope, branchId: other, entityType: "Order", entityId: other, canonicalVersion: 1, tombstone: false, snapshot: null, pendingEventId: null, revertTo: null, pendingWrites: [] }] };
  await assert.rejects(store.persist(invalid as unknown as DurableSyncState), code("STATE_CORRUPT"));
  assert.equal(await store.loadState(device), null);
  store.close();
});


test("duplicate idempotency keys in one scope are rejected before writing", async () => {
  const { store } = await setup();
  const item = { actorId: other, attemptId: null, baseVersion: null, blockedBy: null, branchId: branch, deviceId: device, entityId: other, entityType: "Order", eventId: other, idempotencyKey: "same-key", lastErrorCode: null, leaseUntil: null, localSequence: 1, localState: "pending", nextAttemptAt: null, occurredAt: "2026-11-23T00:00:00.000Z", operation: "create", outcome: null, payload: { note: "evidence" }, receivedAt: null, resolvedBy: null, restaurantId: restaurant, retryCount: 0, schemaVersion: "1", updatedAt: 1795478400000 };
  const valid = { ...fixture(), lastLocalSequence: 1, outbox: [item] } as unknown as DurableSyncState;
  await store.persist(valid);
  assert.deepEqual(await store.loadState(device), valid);
  const duplicate = { ...item, eventId: "00000000-0000-4000-8000-000000000003", localSequence: 2 };
  const state = { ...fixture(), lastLocalSequence: 2, outbox: [item, duplicate] };
  await assert.rejects(store.persist(state as unknown as DurableSyncState), code("STATE_CORRUPT"));
  assert.deepEqual(await store.loadState(device), valid);
  store.close();
});

test("transient IndexedDB read failure is retryable without quarantine", async () => {
  const { factory, store } = await setup();
  await store.persist(fixture());
  const db = await openDb(factory);
  const sample = db.transaction("sr_state_slots").objectStore("sr_state_slots");
  const proto = Object.getPrototypeOf(sample) as IDBObjectStore;
  const original = proto.get;
  proto.get = function (key: IDBValidKey | IDBKeyRange) {
    if (this.name === "sr_state_slots") throw new DOMException("transient", "AbortError");
    return original.call(this, key);
  };
  try { await assert.rejects(store.loadState(device), code("STORAGE_LOAD_FAILED")); }
  finally { proto.get = original; }
  assert.deepEqual(await store.loadState(device), fixture());
  const meta = await req(db.transaction("sr_device_meta").objectStore("sr_device_meta").get(device));
  assert.equal(meta.quarantined, false);
  db.close(); store.close();
});

test("a stale tab reloads before retrying and preserves both writes", async () => {
  const { options, store } = await setup();
  const second = await WebIndexedDbSyncStorage.open(device, options);
  await second.loadState(device);
  await store.persist(fixture());
  await assert.rejects(second.persist(fixture()), code("STALE_STATE"));
  const latest = await second.loadState(device) as DurableSyncState;
  await second.persist({ ...latest, lastLocalSequence: 8 });
  assert.equal((await store.loadState(device) as DurableSyncState).lastLocalSequence, 8);
  store.close(); second.close();
});

test("quarantine preserves the previous encrypted slot for supervised evidence inspection", async () => {
  const { factory, store } = await setup();
  const item = { actorId: other, attemptId: null, baseVersion: null, blockedBy: null, branchId: branch, deviceId: device, entityId: other, entityType: "Order", eventId: other, idempotencyKey: "review-evidence", lastErrorCode: "CONFLICT", leaseUntil: null, localSequence: 1, localState: "manual_review", nextAttemptAt: null, occurredAt: "2026-11-23T00:00:00.000Z", operation: "create", outcome: null, payload: { note: "evidence" }, receivedAt: null, resolvedBy: null, restaurantId: restaurant, retryCount: 0, schemaVersion: "1", updatedAt: 1795478400000 };
  const evidence = { ...fixture(), outbox: [item] } as unknown as DurableSyncState;
  await store.persist(evidence);
  await store.persist({ ...evidence, lastLocalSequence: 8 });
  const db = await openDb(factory);
  const tx = db.transaction("sr_state_slots", "readwrite");
  const os = tx.objectStore("sr_state_slots");
  const slot = await req(os.get([device, 1]));
  const bytes = new Uint8Array(slot.ciphertext); bytes[0] = (bytes[0] ?? 0) ^ 1;
  os.put(slot, [device, 1]);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  await assert.rejects(store.loadState(device), code("STATE_CORRUPT"));
  assert.deepEqual(await store.inspectPreviousEvidence(), evidence);
  await assert.rejects(store.loadState(device), code("STORAGE_QUARANTINED"));
  db.close(); store.close();
});

test("DeviceSyncEngine recovers a committed outbox after restart and retries the same intent with scope isolation", async () => {
  const { DeviceSyncEngine, SyncTransportError, createExponentialBackoff } = await import("@super-restaurant/sync-engine");
  const { options, store } = await setup();
  const scope2Result = parseSyncScope({ restaurantId: restaurant, branchId: "00000000-0000-4000-8000-000000000012" });
  const scope3Result = parseSyncScope({ restaurantId: "00000000-0000-4000-8000-000000000020", branchId: branch });
  if (!scope2Result.ok || !scope3Result.ok) throw new Error("scope");
  const scope2 = scope2Result.value; const scope3 = scope3Result.value;
  let now = 1795478400000; let count = 100; let effects = 0;
  const requests: string[] = [];
  const seen = new Set<string>();
  const transport = {
    push: async (request: import("@super-restaurant/sync-engine").SyncPushRequest): Promise<unknown> => {
      const event = request.events[0]; if (!event) throw new Error("missing event");
      requests.push(event.idempotencyKey);
      const duplicate = seen.has(event.idempotencyKey);
      if (!duplicate) { seen.add(event.idempotencyKey); effects += 1; throw new SyncTransportError("TIMEOUT", true); }
      return { protocolVersion: 1, scope: request.scope, results: [{ eventId: event.eventId, idempotencyKey: event.idempotencyKey, status: "duplicate", code: null, canonicalVersion: 1, auditId: other }] };
    },
    pull: (): Promise<unknown> => Promise.resolve(null),
  };
  const build = (storage: WebIndexedDbSyncStorage) => new DeviceSyncEngine({ deviceId: device, storage, transport, clock: { nowMs: () => now }, ids: { uuid: () => `00000000-0000-4000-8000-${(++count).toString(16).padStart(12, "0")}` }, backoff: createExponentialBackoff({ baseMs: 1000, maxMs: 1000, maxRetries: 3, jitterRatio: 0 }) });
  const first = build(store);
  const entry = await first.enqueue({ scope, actorId: other, entityType: "Order", entityId: other, operation: "create", idempotencyKey: "stable-intent", payload: { note: "offline" }, replicaSnapshot: { note: "offline" } });
  assert.equal((await first.getOutbox(scope2)).length, 0);
  assert.equal((await first.getOutbox(scope3)).length, 0);
  assert.equal((await first.listReplica(scope2)).length, 0);
  assert.equal((await first.listReplica(scope3)).length, 0);
  assert.equal((await first.push(scope)).failureCode, "TIMEOUT");
  store.close(); now += 5000;
  const reopened = await WebIndexedDbSyncStorage.open(device, options);
  const restarted = build(reopened);
  assert.equal((await restarted.getOutbox(scope))[0]?.eventId, entry.eventId);
  assert.equal((await restarted.listReplica(scope))[0]?.pendingEventId, entry.eventId);
  await restarted.push(scope);
  assert.deepEqual(requests, ["stable-intent", "stable-intent"]);
  assert.equal(effects, 1);
  assert.equal((await restarted.getOutbox(scope))[0]?.localState, "duplicate");
  const otherStore = await WebIndexedDbSyncStorage.open(other, options);
  const otherEngine = new DeviceSyncEngine({ deviceId: other, storage: otherStore, transport });
  assert.equal((await otherEngine.getOutbox(scope)).length, 0);
  assert.equal((await otherEngine.listReplica(scope)).length, 0);
  reopened.close(); otherStore.close();
});

test("a plain HTTP 403 does not revoke the scope in DeviceSyncEngine", async () => {
  const { DeviceSyncEngine } = await import("@super-restaurant/sync-engine");
  const { createWebSyncTransport } = await import("./sync-transport.js");
  const { store } = await setup();
  const transport = createWebSyncTransport({ apiBaseUrl: "https://api.example.test", accessToken: () => Promise.resolve("token"), fetcher: () => Promise.resolve(new Response(JSON.stringify({ statusCode: 403, message: "Forbidden" }), { status: 403 })) });
  let count = 100;
  const engine = new DeviceSyncEngine({ deviceId: device, storage: store, transport, ids: { uuid: () => `00000000-0000-4000-8000-${(++count).toString(16).padStart(12, "0")}` } });
  const input = { scope, actorId: other, entityType: "Order" as const, entityId: other, operation: "create" as const, idempotencyKey: "http403", payload: { note: "test" } };
  await engine.enqueue(input);
  const outcome = await engine.push(scope);
  assert.equal(outcome.failureCode, "HTTP_403"); assert.equal(outcome.revoked, false);
  await engine.enqueue({ ...input, entityId: "00000000-0000-4000-8000-000000000003", idempotencyKey: "after403" });
  store.close();
});
