import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { DeviceSyncEngine, SyncEngineError, parseSyncScope } from "@super-restaurant/sync-engine";
import type { DurableSyncState, DurableSyncStoragePort } from "@super-restaurant/sync-engine";
import { WebIndexedDbSyncStorage, WebSyncStorageError } from "./sync-store.js";
import { acquireSyncLeader } from "./sync-leader.js";

const device = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const restaurant = "00000000-0000-4000-8000-000000000010";
const branch = "00000000-0000-4000-8000-000000000011";

function createLockManager(): LockManager {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: <T>(name: string, _options: unknown, callback: () => Promise<T>): Promise<T> => {
      const previous = tails.get(name) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(callback);
      tails.set(name, next);
      return next;
    },
  } as LockManager;
}

function createLossLockManager(): { readonly locks: LockManager; readonly lose: () => void } {
  let rejectRequest: (reason: unknown) => void = () => undefined;
  const request = new Promise<unknown>((_resolve, reject) => {
    rejectRequest = reject;
  });
  const locks = {
    request: (_name: string, _options: unknown, callback: () => Promise<unknown>): Promise<unknown> => {
      void callback();
      return request;
    },
  } as LockManager;
  return { locks, lose: () => rejectRequest(new Error("lock lost")) };
}

function delay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createChannelSpy(): { readonly channel: BroadcastChannel; readonly sent: { readonly type: string }[] } {
  const sent: { readonly type: string }[] = [];
  const channel = {
    postMessage: (message: unknown): void => {
      sent.push(message as { readonly type: string });
    },
    close: (): void => undefined,
  } as unknown as BroadcastChannel;
  return { channel, sent };
}

test("dos adquirentes del mismo deviceId: solo el primero lidera y el relevo llega al liberar", async () => {
  const locks = createLockManager();
  const { channel, sent } = createChannelSpy();
  const first = await acquireSyncLeader(device, { locks, channel });
  assert.equal(first.isLeader, true);
  let lost = 0;
  first.onLost(() => {
    lost += 1;
  });

  let secondResolved = false;
  const secondPromise = acquireSyncLeader(device, { locks, channel }).then((handle) => {
    secondResolved = true;
    return handle;
  });
  await delay();
  assert.equal(secondResolved, false);
  assert.equal(first.isLeader, true);

  first.release();
  const second = await secondPromise;
  await delay();
  assert.equal(secondResolved, true);
  assert.equal(first.isLeader, false);
  assert.equal(second.isLeader, true);
  assert.equal(lost, 1);
  assert.deepEqual(sent.map((message) => message.type), ["leader-claimed", "leader-released", "leader-claimed"]);
  second.release();
});

test("la pérdida del lock dispara onLost una sola vez", async () => {
  const { locks, lose } = createLossLockManager();
  const leader = await acquireSyncLeader(device, { locks, channel: null });
  assert.equal(leader.isLeader, true);
  let lost = 0;
  leader.onLost(() => {
    lost += 1;
  });

  lose();
  await delay();
  assert.equal(leader.isLeader, false);
  assert.equal(lost, 1);

  leader.release();
  await delay();
  assert.equal(lost, 1);
});

test("sin Web Locks no hay liderazgo optimista", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  try {
    const handle = await acquireSyncLeader(device, { channel: null });
    assert.equal(handle.isLeader, false);
    let lost = 0;
    handle.onLost(() => {
      lost += 1;
    });
    handle.release();
    assert.equal(lost, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
  }
});

class FailsOnceStorage implements DurableSyncStoragePort {
  private pending = 1;
  public constructor(private readonly inner: DurableSyncStoragePort) {}
  public loadState(deviceId: string): Promise<unknown> {
    return this.inner.loadState(deviceId);
  }
  public persist(state: DurableSyncState): Promise<void> {
    if (this.pending > 0) {
      this.pending -= 1;
      return Promise.reject(new WebSyncStorageError("STORAGE_COMMIT_FAILED"));
    }
    return this.inner.persist(state);
  }
}

test("pestaña obsoleta: descarta el motor, reabre el almacén y reintenta con la misma idempotency key", async () => {
  const locks = createLockManager();
  const factory = new IDBFactory();
  const options = { indexedDB: factory, databaseName: "sr_leader_stale_tab", locks, crypto: globalThis.crypto };
  const store = await WebIndexedDbSyncStorage.open(device, options);
  await store.loadState(device);
  const transport = { push: () => Promise.resolve(null), pull: () => Promise.resolve(null) };
  const parsedScope = parseSyncScope({ restaurantId: restaurant, branchId: branch });
  if (!parsedScope.ok) throw new Error("scope");
  const input = {
    scope: parsedScope.value,
    actorId: other,
    entityType: "Order" as const,
    entityId: other,
    operation: "create" as const,
    idempotencyKey: "stale-tab-intent",
    payload: { note: "offline" },
  };

  const staleEngine = new DeviceSyncEngine({ deviceId: device, storage: new FailsOnceStorage(store), transport });
  await assert.rejects(
    staleEngine.enqueue(input),
    (error: unknown) => error instanceof SyncEngineError && error.code === "STORAGE_COMMIT_FAILED",
  );
  assert.equal(await store.loadState(device), null);
  store.close();

  const reopened = await WebIndexedDbSyncStorage.open(device, options);
  const freshEngine = new DeviceSyncEngine({ deviceId: device, storage: reopened, transport });
  const retried = await freshEngine.enqueue(input);
  assert.equal(retried.idempotencyKey, input.idempotencyKey);
  const persisted = (await reopened.loadState(device)) as DurableSyncState;
  assert.equal(persisted.outbox.length, 1);
  assert.equal(persisted.outbox[0]?.idempotencyKey, "stale-tab-intent");
  assert.equal(persisted.lastLocalSequence, 1);
  reopened.close();
});
