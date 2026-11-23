import assert from "node:assert/strict";
import test from "node:test";

import {
  DeviceSyncEngine,
  createExponentialBackoff,
  parseSyncScope,
  type SyncPushRequest,
  SyncEngineError,
  SyncTransportError,
  parseDurableState,
  type SyncTransportPort,
} from "@super-restaurant/sync-engine";

import {
  MobileSqliteSyncStorage,
  MobileSyncStorageError,
  utf8ByteLength,
} from "./sync-store.js";
import {
  BRANCH,
  DEVICE,
  OTHER_DEVICE,
  RESTAURANT,
  SCOPE,
  FakeSyncDatabase,
  entry,
  fakeSha256,
  fixtureEnvelopeCipher,
  fixtureKeyBytes,
  stateWith,
  storageFor,
  testId,
} from "./test-fixtures.js";
import { createWebCryptoEnvelopeCipher, MobileScopeEnvelopeError } from "./sync-envelope.js";

async function expectStorageError(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof MobileSyncStorageError && error.code === code, code);
}

test("persist writes replica, outbox, localSequence and pullCursor and restart hydrates the same state", async () => {
  const database = new FakeSyncDatabase();
  const state = stateWith([entry()]);
  await storageFor(database).persist(state);

  const restarted = storageFor(database);
  const hydrated = parseDurableState(await restarted.loadState(DEVICE), DEVICE);
  assert.equal(hydrated.ok, true);
  if (!hydrated.ok) return;
  assert.equal(hydrated.value.lastLocalSequence, 1);
  assert.equal(hydrated.value.outbox.length, 1);
  assert.equal(hydrated.value.replica.length, 1);
  assert.equal(hydrated.value.scopes[0]?.pullCursor, "cursor-1");
  assert.equal(database.meta(DEVICE)?.writeGeneration, 1);
  assert.equal(database.meta(DEVICE)?.keyVersion, 1);
});

test("a commit that fails after the snapshot write leaves the previous state intact", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  const first = stateWith([entry()]);
  await storage.persist(first);
  const before = database.rawSnapshot(DEVICE);

  const second = stateWith([entry(), entry({ eventId: testId(0x1002), idempotencyKey: "k-2", localSequence: 2 })]);
  database.failNextCommitAfterSnapshot = 1;
  await expectStorageError(storage.persist(second), "STORAGE_COMMIT_FAILED");

  assert.equal(database.rawSnapshot(DEVICE), before);
  assert.equal(database.meta(DEVICE)?.writeGeneration, 1);
  assert.equal(database.meta(DEVICE)?.lastLocalSequence, 1);
});

test("a failing snapshot write is reported as a quota problem, not as a silent retry", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  database.failNextSnapshotWrite = 1;
  await expectStorageError(storage.persist(stateWith([entry()])), "STORAGE_QUOTA_EXCEEDED");
  assert.equal(database.rawSnapshot(DEVICE), undefined);
});

test("a regressed lastLocalSequence or a foreign deviceId fails closed without writing", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  await storage.persist(stateWith([entry(), entry({ eventId: testId(0x1002), idempotencyKey: "k-2", localSequence: 2 })]));
  const before = database.rawSnapshot(DEVICE);

  await expectStorageError(storage.persist(stateWith([entry()])), "SEQUENCE_REGRESSION");
  assert.equal(database.rawSnapshot(DEVICE), before);

  const foreign = { ...stateWith([entry()]), deviceId: OTHER_DEVICE };
  await expectStorageError(storage.persist(foreign), "STATE_CORRUPT");
  assert.equal(database.rawSnapshot(DEVICE), before);

  const otherStorage = storageFor(database, OTHER_DEVICE);
  await expectStorageError(otherStorage.loadState(DEVICE), "DEVICE_MISMATCH");
});

test("writeGeneration is monotonic across successful commits", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  await storage.persist(stateWith([entry()]));
  await storage.persist(stateWith([entry(), entry({ eventId: testId(0x1002), idempotencyKey: "k-2", localSequence: 2 })]));
  assert.equal(database.meta(DEVICE)?.writeGeneration, 2);
});

test("a locked store refuses new commits and keeps the confirmed state", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  await storage.persist(stateWith([entry()]));
  await storage.lockStore();
  const before = database.rawSnapshot(DEVICE);
  await expectStorageError(
    storage.persist(stateWith([entry(), entry({ eventId: testId(0x1002), idempotencyKey: "k-2", localSequence: 2 })])),
    "STORAGE_LOCKED",
  );
  assert.equal(database.rawSnapshot(DEVICE), before);
  assert.equal((await storage.getStorageHealth()).locked, true);
});

test("a quarantined store refuses new commits", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  await storage.persist(stateWith([entry()]));
  await storage.quarantineCorruptStore();
  await expectStorageError(
    storage.persist(stateWith([entry(), entry({ eventId: testId(0x1002), idempotencyKey: "k-2", localSequence: 2 })])),
    "STORAGE_QUARANTINED",
  );
  const health = await storage.getStorageHealth();
  assert.equal(health.quarantined, true);
  assert.equal(health.locked, true);
});

test("a tampered snapshot is reported as corrupt and never reset to an empty state", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  await storage.persist(stateWith([entry()]));

  database.snapshots.set(DEVICE, JSON.stringify({ stateVersion: 1 }));
  const corrupt = new MobileSqliteSyncStorage({
    cipher: fixtureEnvelopeCipher(),
    database,
    deviceId: DEVICE,
    keyVersion: 1,
    sha256Hex: fakeSha256,
  });
  await expectStorageError(corrupt.loadState(DEVICE), "STATE_CORRUPT");
  assert.notEqual(database.rawSnapshot(DEVICE), undefined);

  const evidence = await corrupt.inspectPendingEvidence();
  assert.equal(evidence.status, "corrupt");
});

test("a snapshot whose SHA-256 no longer matches the metadata is corrupt", async () => {
  const database = new FakeSyncDatabase();
  await storageFor(database).persist(stateWith([entry()]));
  const meta = database.meta(DEVICE);
  assert.ok(meta !== undefined);
  database.metas.set(DEVICE, { ...meta, stateSha256: "deadbeef" });
  await expectStorageError(storageFor(database).loadState(DEVICE), "STATE_CORRUPT");
});

test("purgeNonEvidentiaryCache drops read caches and terminal non-financial events but keeps financial evidence", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  const terminalOrder = entry({
    completed: true,
    entityId: testId(0x2002),
    eventId: testId(0x1003),
    idempotencyKey: "k-3",
    localSequence: 3,
    localState: "accepted",
  });
  const terminalPayment = entry({
    completed: true,
    entityId: testId(0x2003),
    entityType: "Payment",
    eventId: testId(0x1004),
    idempotencyKey: "k-4",
    localSequence: 4,
    localState: "accepted",
  });
  await storage.persist(stateWith([entry(), terminalOrder, terminalPayment]));

  const outcome = await storage.purgeNonEvidentiaryCache();
  assert.deepEqual(
    { removed: outcome.removedOutboxCount, retained: outcome.retainedOutboxCount },
    { removed: 1, retained: 2 },
  );
  const hydrated = parseDurableState(await storage.loadState(DEVICE), DEVICE);
  assert.equal(hydrated.ok, true);
  if (!hydrated.ok) return;
  assert.deepEqual(hydrated.value.outbox.map((item) => item.localState).sort(), ["accepted", "pending"]);
  assert.deepEqual(hydrated.value.outbox.map((item) => item.entityType).sort(), ["Order", "Payment"]);
  assert.equal(hydrated.value.replica.length, 1, "only the entity with an unconfirmed write stays");
  assert.equal(hydrated.value.scopes[0]?.pullCursor, null);
  assert.equal(hydrated.value.lastLocalSequence, 4);
});

test("purgeReplicaForScope clears only the revoked scope's replica", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  await storage.persist(stateWith([entry()]));
  const outcome = await storage.purgeReplicaForScope(SCOPE);
  assert.equal(outcome.removedReplicaCount, 1);
  const hydrated = parseDurableState(await storage.loadState(DEVICE), DEVICE);
  assert.equal(hydrated.ok, true);
  if (!hydrated.ok) return;
  assert.equal(hydrated.value.replica.length, 0);
  assert.equal(hydrated.value.outbox.length, 1, "evidence must survive a scope revocation");
});

test("wipeAll removes the snapshot and the metadata", async () => {
  const database = new FakeSyncDatabase();
  const storage = storageFor(database);
  await storage.persist(stateWith([entry()]));
  await storage.wipeAll();
  assert.equal(database.rawSnapshot(DEVICE), undefined);
  assert.equal(database.meta(DEVICE), undefined);
  assert.equal(await storage.loadState(DEVICE), null);
});

test("the engine enqueues over this store, and a restarted engine resumes the sequence", async () => {
  const database = new FakeSyncDatabase();
  const unusedTransport: SyncTransportPort = {
    push: (): Promise<unknown> => Promise.reject(new SyncTransportError("UNUSED", true)),
    pull: (): Promise<unknown> => Promise.reject(new SyncTransportError("UNUSED", true)),
  };
  let counter = 0;
  const ids = { uuid: (): string => testId(0x9000 + (counter += 1)) };
  let now = Date.UTC(2026, 10, 23, 12, 0, 0);
  const build = (): DeviceSyncEngine => new DeviceSyncEngine({
    clientType: "mobile",
    clock: { nowMs: () => (now += 1) },
    deviceId: DEVICE,
    ids,
    storage: storageFor(database),
    transport: unusedTransport,
  });

  const first = await build().enqueue({
    actorId: "00000000-0000-4000-8000-00000000acac",
    entityId: testId(0x3001),
    entityType: "Order",
    idempotencyKey: "engine-1",
    operation: "create",
    payload: { note: "uno" },
    scope: { branchId: BRANCH, restaurantId: RESTAURANT },
  });
  assert.equal(first.localSequence, 1);

  const restarted = build();
  const second = await restarted.enqueue({
    actorId: "00000000-0000-4000-8000-00000000acac",
    entityId: testId(0x3002),
    entityType: "Order",
    idempotencyKey: "engine-2",
    operation: "create",
    payload: { note: "dos" },
    scope: { branchId: BRANCH, restaurantId: RESTAURANT },
  });
  assert.equal(second.localSequence, 2);

  const locked = storageFor(database);
  await locked.lockStore();
  const blocked = build();
  await assert.rejects(
    blocked.enqueue({
      actorId: "00000000-0000-4000-8000-00000000acac",
      entityId: testId(0x3003),
      entityType: "Order",
      idempotencyKey: "engine-3",
      operation: "create",
      payload: { note: "tres" },
      scope: { branchId: BRANCH, restaurantId: RESTAURANT },
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "STORAGE_COMMIT_FAILED",
  );
});

test("utf8ByteLength counts multi-byte characters without TextEncoder", () => {
  assert.equal(utf8ByteLength("abc"), 3);
  assert.equal(utf8ByteLength("ñ"), 2);
  assert.equal(utf8ByteLength("€"), 3);
  assert.equal(utf8ByteLength("🍕"), 4);
});


test("stale writers must reload before retrying", async () => {
  const database = new FakeSyncDatabase();
  const first = storageFor(database);
  const second = storageFor(database);
  await first.loadState(DEVICE);
  await second.loadState(DEVICE);
  await first.persist(stateWith([entry()]));
  await expectStorageError(second.persist(stateWith([entry()])), "STALE_STATE");
  await second.loadState(DEVICE);
  await second.persist(stateWith([entry()]));
  assert.equal(database.meta(DEVICE)?.writeGeneration, 2);
});

test("engine restart retries the same idempotency key with scope isolation", async () => {
  const database = new FakeSyncDatabase();
  let now = Date.UTC(2026, 10, 23);
  let count = 0;
  let effects = 0;
  const keys: string[] = [];
  const transport: SyncTransportPort = {
    push: (request: SyncPushRequest): Promise<unknown> => {
      const event = request.events[0];
      if (event === undefined) throw new Error("missing event");
      keys.push(event.idempotencyKey);
      if (keys.length === 1) { effects += 1; return Promise.reject(new SyncTransportError("TIMEOUT", true)); }
      return Promise.resolve({ protocolVersion: 1, scope: request.scope, results: [{ eventId: event.eventId, idempotencyKey: event.idempotencyKey, status: "duplicate", code: null, canonicalVersion: 1, auditId: testId(99) }] });
    },
    pull: () => Promise.resolve(null),
  };
  const build = (deviceId = DEVICE): DeviceSyncEngine => new DeviceSyncEngine({
    deviceId, clientType: "mobile", storage: storageFor(database, deviceId), transport,
    clock: { nowMs: () => now }, ids: { uuid: () => testId(0x9000 + ++count) },
    backoff: createExponentialBackoff({ baseMs: 1000, maxMs: 1000, maxRetries: 3, jitterRatio: 0 }),
  });
  const first = build();
  await first.enqueue({ actorId: testId(77), entityId: testId(78), entityType: "Order", idempotencyKey: "stable-intent", operation: "create", payload: { note: "offline" }, scope: SCOPE });
  const branch = parseSyncScope({ restaurantId: RESTAURANT, branchId: testId(80) });
  const restaurant = parseSyncScope({ restaurantId: testId(81), branchId: BRANCH });
  if (!branch.ok || !restaurant.ok) throw new Error("invalid scope");
  assert.equal((await first.getOutbox(branch.value)).length, 0);
  assert.equal((await first.getOutbox(restaurant.value)).length, 0);
  assert.equal((await build(OTHER_DEVICE).getOutbox(SCOPE)).length, 0);
  assert.equal((await first.push(SCOPE)).failureCode, "TIMEOUT");
  now += 5000;
  const restarted = build();
  await restarted.push(SCOPE);
  assert.deepEqual(keys, ["stable-intent", "stable-intent"]);
  assert.equal(effects, 1);
  assert.equal((await restarted.getOutbox(SCOPE))[0]?.localState, "duplicate");
});


test("transient hash I/O failure does not report corrupt evidence", async () => {
  const database = new FakeSyncDatabase();
  await storageFor(database).persist(stateWith([entry()]));
  const store = new MobileSqliteSyncStorage({ cipher: fixtureEnvelopeCipher(), database, deviceId: DEVICE, keyVersion: 1, sha256Hex: () => Promise.reject(new Error("temporary I/O")) });
  await expectStorageError(store.inspectPendingEvidence(), "STORAGE_LOAD_FAILED");
  assert.equal((await store.getStorageHealth()).quarantined, false);
});

test("a transient keystore failure is retryable and never quarantines the store", async () => {
  const database = new FakeSyncDatabase();
  await storageFor(database).persist(stateWith([entry()]));
  let rejections = 1;
  const cipher = createWebCryptoEnvelopeCipher({
    rawKey: (version: number): Promise<Uint8Array> => {
      if (rejections > 0) {
        rejections -= 1;
        return Promise.reject(new Error("keystore temporarily down"));
      }
      return Promise.resolve(fixtureKeyBytes(version));
    },
    subtle: globalThis.crypto.subtle,
  });
  const store = new MobileSqliteSyncStorage({ cipher, database, deviceId: DEVICE, keyVersion: 1, sha256Hex: fakeSha256 });
  await expectStorageError(store.inspectPendingEvidence(), "STORAGE_LOAD_FAILED");
  assert.equal((await store.getStorageHealth()).quarantined, false, "a key failure is not corruption");
  const recovered = parseDurableState(await store.loadState(DEVICE), DEVICE);
  assert.equal(recovered.ok, true, "the next load succeeds once the keystore recovers");
});

test("a missing key version surfaces ENCRYPTION_KEY_MISSING and does not quarantine", async () => {
  const database = new FakeSyncDatabase();
  await storageFor(database).persist(stateWith([entry()]));
  const cipher = createWebCryptoEnvelopeCipher({
    rawKey: (): Promise<Uint8Array> => Promise.reject(new MobileScopeEnvelopeError("ENCRYPTION_KEY_MISSING", "v1")),
    subtle: globalThis.crypto.subtle,
  });
  const store = new MobileSqliteSyncStorage({ cipher, database, deviceId: DEVICE, keyVersion: 1, sha256Hex: fakeSha256 });
  await expectStorageError(store.inspectPendingEvidence(), "ENCRYPTION_KEY_MISSING");
  assert.equal((await store.getStorageHealth()).quarantined, false);
});
