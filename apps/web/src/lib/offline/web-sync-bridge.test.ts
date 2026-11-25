import assert from "node:assert/strict";
import test from "node:test";

import { IDBFactory } from "fake-indexeddb";
import { SyncTransportError, type SyncPushRequest, type SyncTransportPort } from "@super-restaurant/sync-engine";
import { parseSyncScopeV1, type BranchScope } from "@super-restaurant/shared-types";

import { WebIndexedDbSyncStorage } from "./sync-store.js";
import {
  openWebSyncBridge,
  stableEntityId,
  syncDatabaseNameForActor,
  syncDeviceIdForActor,
} from "./web-sync-bridge.js";

const device = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const restaurant = "00000000-0000-4000-8000-000000000010";
const branchA = "00000000-0000-4000-8000-000000000011";
const branchB = "00000000-0000-4000-8000-000000000012";
const occurredAt = "2026-11-23T18:00:00.000Z";

const scopeA: BranchScope = parseSyncScopeV1({ branchId: branchA, restaurantId: restaurant })!;
const scopeB: BranchScope = parseSyncScopeV1({ branchId: branchB, restaurantId: restaurant })!;

/** Serializing fake Web Locks, matching the adapter used by the existing store tests. */
const locks = (() => {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: <T>(name: string, _options: unknown, callback: () => Promise<T>): Promise<T> => {
      const previous = tails.get(name) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(callback);
      tails.set(name, next);
      return next;
    },
  } as LockManager;
})();

function idGenerator(): { uuid: () => string } {
  let counter = 100;
  return { uuid: () => `00000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}` };
}

async function openStorage(
  factory: IDBFactory,
  databaseName: string,
  storageDeviceId: string = device,
): Promise<WebIndexedDbSyncStorage> {
  return WebIndexedDbSyncStorage.open(storageDeviceId, {
    crypto: globalThis.crypto,
    databaseName,
    indexedDB: factory,
    locks,
  });
}

function pullResponse(scope: BranchScope): unknown {
  return { changes: [], hasMore: false, nextCursor: null, protocolVersion: 1, scope };
}

interface RecordedTransport extends SyncTransportPort {
  readonly keys: string[];
}

/** Transport that applies each event at most once and acknowledges duplicates afterwards. */
function recordingTransport(): RecordedTransport {
  const keys: string[] = [];
  const applied = new Set<string>();
  return {
    keys,
    pull: (request) => Promise.resolve(pullResponse(request.scope)),
    push: (request: SyncPushRequest): Promise<unknown> => {
      const event = request.events[0];
      if (event === undefined) throw new Error("missing event");
      keys.push(event.idempotencyKey);
      const duplicate = applied.has(event.idempotencyKey);
      applied.add(event.idempotencyKey);
      return Promise.resolve({
        protocolVersion: 1,
        results: [{
          auditId: actor,
          canonicalVersion: 1,
          code: null,
          eventId: event.eventId,
          idempotencyKey: event.idempotencyKey,
          status: duplicate ? "duplicate" : "accepted",
        }],
        scope: request.scope,
      });
    },
  };
}

const commitInput = (scope: BranchScope, idempotencyKey: string) => ({
  deviceId: device,
  idempotencyKey,
  kind: "order_create" as const,
  occurredAt,
  scope,
});

test("la cola persiste tras una recarga simulada y conserva el mismo idempotencyKey", async () => {
  const factory = new IDBFactory();
  const transport = recordingTransport();
  const firstStorage = await openStorage(factory, "reload");
  const first = await openWebSyncBridge({ actorId: actor, deviceId: device, ids: idGenerator(), storage: firstStorage, transport });

  const outcome = await first.commitLocalOperation(commitInput(scopeA, "intent-reload"));
  assert.equal(outcome?.committed, true);
  assert.ok(outcome?.eventId);
  await first.refresh(scopeA);
  const pending = first.getSnapshot(scopeA).events;
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.localState, "pending");

  // Simulated reload: a brand new storage/engine over the same IndexedDB database.
  const secondStorage = await openStorage(factory, "reload");
  const second = await openWebSyncBridge({ actorId: actor, deviceId: device, ids: idGenerator(), storage: secondStorage, transport });
  await second.refresh(scopeA);
  const restored = second.getSnapshot(scopeA).events;
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.eventId, outcome?.eventId);
  assert.equal(second.getOfflinePosSnapshot(scopeA)?.deviceId, device);

  await second.syncNow(scopeA);
  assert.deepEqual(transport.keys, ["intent-reload"]);
  assert.equal(second.getSnapshot(scopeA).events[0]?.localState, "accepted");
  assert.equal(second.getSnapshot(scopeA).lastConfirmedSyncAt === null, false);
});

test("la reconexión reintenta con la misma key y no duplica el efecto", async () => {
  const factory = new IDBFactory();
  const keys: string[] = [];
  let attempts = 0;
  const transport: SyncTransportPort = {
    pull: (request) => Promise.resolve(pullResponse(request.scope)),
    push: (request: SyncPushRequest): Promise<unknown> => {
      const event = request.events[0];
      if (event === undefined) throw new Error("missing event");
      keys.push(event.idempotencyKey);
      attempts += 1;
      if (attempts === 1) throw new SyncTransportError("TIMEOUT", true);
      return Promise.resolve({
        protocolVersion: 1,
        results: [{
          auditId: actor,
          canonicalVersion: 1,
          code: null,
          eventId: event.eventId,
          idempotencyKey: event.idempotencyKey,
          status: "duplicate",
        }],
        scope: request.scope,
      });
    },
  };

  let now = 1_795_478_400_000;
  const storage = await openStorage(factory, "reconnect");
  const bridge = await openWebSyncBridge({
    actorId: actor,
    clock: { nowMs: () => now },
    deviceId: device,
    ids: idGenerator(),
    storage,
    transport,
  });

  const outcome = await bridge.commitLocalOperation(commitInput(scopeA, "stable-intent"));
  assert.equal(outcome?.committed, true);

  await bridge.syncNow(scopeA);
  assert.equal(bridge.getSnapshot(scopeA).events[0]?.localState, "retry_wait");

  now += 5_000; // past the retry backoff, network is back
  await bridge.syncNow(scopeA);

  assert.deepEqual(keys, ["stable-intent", "stable-intent"]);
  assert.equal(attempts, 2);
  assert.equal(bridge.getSnapshot(scopeA).events[0]?.localState, "duplicate");
});

test("los scopes de restaurante y sucursal quedan aislados aunque compartan idempotencyKey", async () => {
  const factory = new IDBFactory();
  const storage = await openStorage(factory, "isolation");
  const bridge = await openWebSyncBridge({ actorId: actor, deviceId: device, ids: idGenerator(), storage, transport: recordingTransport() });

  const inA = await bridge.commitLocalOperation(commitInput(scopeA, "shared-key"));
  await bridge.refresh(scopeB);
  assert.equal(bridge.getSnapshot(scopeA).events.length, 1);
  assert.equal(bridge.getSnapshot(scopeB).events.length, 0);

  const inB = await bridge.commitLocalOperation(commitInput(scopeB, "shared-key"));
  assert.equal(inA?.committed, true);
  assert.equal(inB?.committed, true);
  assert.notEqual(inA?.eventId, inB?.eventId);

  await bridge.refresh(scopeA);
  await bridge.refresh(scopeB);
  assert.equal(bridge.getSnapshot(scopeA).events.length, 1);
  assert.equal(bridge.getSnapshot(scopeB).events.length, 1);
  assert.equal(bridge.getSnapshot(scopeA).events[0]?.branchId, branchA);
  assert.equal(bridge.getSnapshot(scopeB).events[0]?.branchId, branchB);
});

test("release conserva la evidencia pendiente y solo purga una cola confirmada", async () => {
  const factory = new IDBFactory();
  let purgeCalls = 0;
  const storage = await openStorage(factory, "release-pending");
  const bridge = await openWebSyncBridge({
    actorId: actor,
    deviceId: device,
    ids: idGenerator(),
    purgeStore: () => {
      purgeCalls += 1;
      return Promise.resolve();
    },
    storage,
    transport: recordingTransport(),
  });

  await bridge.commitLocalOperation(commitInput(scopeA, "still-pending"));
  const retained = await bridge.release();
  assert.equal(retained.purged, false);
  assert.equal(retained.retainedUnconfirmed, 1);
  assert.equal(purgeCalls, 0);

  const cleanStorage = await openStorage(factory, "release-clean");
  const clean = await openWebSyncBridge({
    actorId: actor,
    deviceId: device,
    ids: idGenerator(),
    purgeStore: () => {
      purgeCalls += 1;
      return Promise.resolve();
    },
    storage: cleanStorage,
    transport: recordingTransport(),
  });
  const purged = await clean.release();
  assert.equal(purged.purged, true);
  assert.equal(purgeCalls, 1);
});

test("un fallo de escritura transitorio se reintenta con la misma key sin cuarentena", async () => {
  const factory = new IDBFactory();
  const storage = await openStorage(factory, "transient");
  let failNextPersist = true;
  const flaky = {
    loadState: (deviceId: string): Promise<unknown> => storage.loadState(deviceId),
    persist: (state: Parameters<typeof storage.persist>[0]): Promise<void> => {
      if (failNextPersist) {
        failNextPersist = false;
        return Promise.reject(new Error("transient io"));
      }
      return storage.persist(state);
    },
  };

  const bridge = await openWebSyncBridge({
    actorId: actor,
    deviceId: device,
    ids: idGenerator(),
    storage: flaky,
    transport: recordingTransport(),
  });

  const failed = await bridge.commitLocalOperation(commitInput(scopeA, "retryable-intent"));
  assert.equal(failed?.committed, false);
  assert.equal(failed?.code, "STORAGE_COMMIT_FAILED");
  assert.equal(bridge.getSnapshot(scopeA).events.length, 0);

  // Same key, same intent: the retry succeeds and nothing was quarantined or duplicated.
  const retried = await bridge.commitLocalOperation(commitInput(scopeA, "retryable-intent"));
  assert.equal(retried?.committed, true);
  assert.equal(bridge.getSnapshot(scopeA).events.length, 1);
  assert.ok(retried?.eventId);
});

test("cambiar de actor en el mismo almacén no drena eventos ajenos", async () => {
  const otherActor = "00000000-0000-4000-8000-000000000003";
  const factory = new IDBFactory();
  const sharedStorage = await openStorage(factory, "actor-binding");
  const transport = recordingTransport();

  const first = await openWebSyncBridge({
    actorId: actor,
    deviceId: device,
    ids: idGenerator(),
    storage: sharedStorage,
    transport,
  });
  assert.equal((await first.commitLocalOperation(commitInput(scopeA, "owned-by-first-actor")))?.committed, true);

  // A different actor signs in on the same browser and receives the same injected
  // store (legacy/shared case): its token must not push the first actor's evidence.
  const second = await openWebSyncBridge({
    actorId: otherActor,
    deviceId: device,
    ids: idGenerator(),
    storage: sharedStorage,
    transport,
  });
  await second.syncNow(scopeA);
  assert.deepEqual(transport.keys, []);
  assert.equal(second.getSnapshot(scopeA).events[0]?.localState, "pending");

  // Production stores are also separate per actor, so the foreign evidence is not
  // even readable after the account switch.
  assert.notEqual(
    syncDatabaseNameForActor(device, actor),
    syncDatabaseNameForActor(device, otherActor),
  );
  assert.match(syncDatabaseNameForActor(device, actor), /^sr_sync_v1_[0-9a-f]{16}$/u);
});

test("release sella el almacén y rechaza commits posteriores con STORAGE_CLOSED", async () => {
  const factory = new IDBFactory();
  let purgeCalls = 0;
  const storage = await openStorage(factory, "release-closing");
  const bridge = await openWebSyncBridge({
    actorId: actor,
    deviceId: device,
    ids: idGenerator(),
    purgeStore: () => {
      purgeCalls += 1;
      return Promise.resolve();
    },
    storage,
    transport: recordingTransport(),
  });

  const releasing = bridge.release();
  const blocked = await bridge.commitLocalOperation(commitInput(scopeA, "after-release"));
  assert.equal(blocked?.committed, false);
  assert.equal(blocked?.code, "STORAGE_CLOSED");

  const outcome = await releasing;
  assert.equal(outcome.purged, true);
  assert.equal(purgeCalls, 1);
});

test("release relee el outbox y no borra si aparece evidencia justo antes", async () => {
  const factory = new IDBFactory();
  const real = await openStorage(factory, "release-reread");
  let inRelease = false;
  let releaseReads = 0;
  const wrapper = {
    loadState: async (deviceId: string): Promise<unknown> => {
      const base = await real.loadState(deviceId);
      if (!inRelease) return base;
      releaseReads += 1;
      // First check looks empty; the re-read right before deletion sees the event.
      return releaseReads === 1 ? { ...(base as Record<string, unknown>), outbox: [] } : base;
    },
    persist: (state: Parameters<typeof real.persist>[0]): Promise<void> => real.persist(state),
  };

  let purgeCalls = 0;
  const bridge = await openWebSyncBridge({
    actorId: actor,
    deviceId: device,
    ids: idGenerator(),
    purgeStore: () => {
      purgeCalls += 1;
      return Promise.resolve();
    },
    storage: wrapper,
    transport: recordingTransport(),
  });
  assert.equal((await bridge.commitLocalOperation(commitInput(scopeA, "race-evidence")))?.committed, true);

  inRelease = true;
  const outcome = await bridge.release();
  assert.equal(outcome.purged, false);
  assert.equal(outcome.retainedUnconfirmed, 1);
  assert.equal(purgeCalls, 0);
  assert.equal(releaseReads, 2);
});

test("un commit con actorId distinto al montado se rechaza sin encolar", async () => {
  const factory = new IDBFactory();
  const storage = await openStorage(factory, "actor-mismatch");
  const bridge = await openWebSyncBridge({
    actorId: actor,
    deviceId: device,
    ids: idGenerator(),
    storage,
    transport: recordingTransport(),
  });

  const rejected = await bridge.commitLocalOperation({
    ...commitInput(scopeA, "foreign-commit"),
    actorId: "00000000-0000-4000-8000-000000000099",
  });
  assert.equal(rejected?.committed, false);
  assert.equal(rejected?.code, "ACTOR_MISMATCH");
  assert.equal(bridge.getSnapshot(scopeA).events.length, 0);
});

test("stableEntityId es determinista para la misma intención", () => {  const first = stableEntityId([restaurant, branchA, "order_create", "same-key"]);
  const second = stableEntityId([restaurant, branchA, "order_create", "same-key"]);
  const other = stableEntityId([restaurant, branchB, "order_create", "same-key"]);
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
});

test("el puente registra el dispositivo exactamente una vez antes del primer push", async () => {
  const factory = new IDBFactory();
  const storage = await openStorage(factory, "register-once");
  const registered: Array<{ readonly deviceId: string; readonly scope: BranchScope }> = [];
  const base = recordingTransport();
  const order: string[] = [];
  const transport: SyncTransportPort = {
    pull: base.pull,
    push: (request) => {
      order.push("push");
      return base.push(request);
    },
    registerDevice: (request) => {
      order.push("register");
      registered.push(request);
      return Promise.resolve({ status: "active" });
    },
  };
  const bridge = await openWebSyncBridge({ actorId: actor, deviceId: device, ids: idGenerator(), storage, transport });
  assert.equal((await bridge.commitLocalOperation(commitInput(scopeA, "registered-intent")))?.committed, true);

  await bridge.syncNow(scopeA);
  await bridge.syncNow(scopeA);

  assert.deepEqual(registered, [{ deviceId: device, scope: scopeA }]);
  assert.deepEqual(base.keys, ["registered-intent"]);
  assert.deepEqual(order, ["register", "push"]);
});

test("dos actores del mismo tablet derivan deviceId distintos y ambos registran", async () => {
  const baseDeviceId = "00000000-0000-4000-8000-0000000000aa";
  const otherActor = "00000000-0000-4000-8000-000000000003";
  const actorDeviceId = syncDeviceIdForActor(baseDeviceId, actor);
  const otherDeviceId = syncDeviceIdForActor(baseDeviceId, otherActor);

  assert.equal(syncDeviceIdForActor(baseDeviceId, actor), actorDeviceId);
  assert.notEqual(actorDeviceId, otherDeviceId);
  assert.match(actorDeviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.match(otherDeviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

  // Simulated server: a device row binds to the first actor that registers it, so
  // reusing the base browser id makes the second cashier fail with 403 forever.
  const owners = new Map<string, string>();
  const registrations: Array<{ readonly actorId: string; readonly deviceId: string }> = [];
  const transportFor = (registeredActor: string): SyncTransportPort => {
    const base = recordingTransport();
    return {
      pull: base.pull,
      push: base.push,
      registerDevice: (request) => {
        const owner = owners.get(request.deviceId);
        if (owner !== undefined && owner !== registeredActor) {
          return Promise.reject(new SyncTransportError("HTTP_403", false));
        }
        owners.set(request.deviceId, registeredActor);
        registrations.push({ actorId: registeredActor, deviceId: request.deviceId });
        return Promise.resolve({ status: "active" });
      },
    };
  };
  const factory = new IDBFactory();
  const first = await openWebSyncBridge({
    actorId: actor,
    deviceId: actorDeviceId,
    ids: idGenerator(),
    storage: await openStorage(factory, "shared-tablet-a", actorDeviceId),
    transport: transportFor(actor),
  });
  const second = await openWebSyncBridge({
    actorId: otherActor,
    deviceId: otherDeviceId,
    ids: idGenerator(),
    storage: await openStorage(factory, "shared-tablet-b", otherDeviceId),
    transport: transportFor(otherActor),
  });

  assert.equal((await first.commitLocalOperation({ ...commitInput(scopeA, "first-cashier"), deviceId: actorDeviceId }))?.committed, true);
  assert.equal((await second.commitLocalOperation({ ...commitInput(scopeA, "second-cashier"), deviceId: otherDeviceId }))?.committed, true);
  await first.syncNow(scopeA);
  await second.syncNow(scopeA);

  assert.deepEqual(registrations, [
    { actorId: actor, deviceId: actorDeviceId },
    { actorId: otherActor, deviceId: otherDeviceId },
  ]);
  assert.equal(first.getSnapshot(scopeA).events[0]?.localState, "accepted");
  assert.equal(second.getSnapshot(scopeA).events[0]?.localState, "accepted");
});

test("un registro 403 bloquea el push y conserva la evidencia local", async () => {
  const factory = new IDBFactory();
  const storage = await openStorage(factory, "register-forbidden");
  const base = recordingTransport();
  let registrations = 0;
  const transport: SyncTransportPort = {
    ...base,
    registerDevice: () => {
      registrations += 1;
      return Promise.reject(new SyncTransportError("HTTP_403", false));
    },
  };
  const bridge = await openWebSyncBridge({ actorId: actor, deviceId: device, ids: idGenerator(), storage, transport });
  assert.equal((await bridge.commitLocalOperation(commitInput(scopeA, "forbidden-intent")))?.committed, true);

  await bridge.syncNow(scopeA);

  assert.equal(registrations, 1);
  assert.deepEqual(base.keys, []);
  assert.equal(bridge.getSnapshot(scopeA).events[0]?.localState, "pending");
});

test("sin registro en el transporte el puente conserva el comportamiento anterior", async () => {
  const factory = new IDBFactory();
  const storage = await openStorage(factory, "no-register");
  const bridge = await openWebSyncBridge({ actorId: actor, deviceId: device, ids: idGenerator(), storage, transport: recordingTransport() });
  assert.equal((await bridge.commitLocalOperation(commitInput(scopeA, "legacy-transport")))?.committed, true);
  await bridge.syncNow(scopeA);
  assert.equal(bridge.getSnapshot(scopeA).events[0]?.localState, "accepted");
});
