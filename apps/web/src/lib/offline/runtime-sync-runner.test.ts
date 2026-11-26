import assert from "node:assert/strict";
import test from "node:test";
import { parseSyncScopeV1, type BranchScope } from "@super-restaurant/shared-types";

import {
  SYNC_FOLLOWER_NOTICE,
  startOfflineRuntime,
  type RuntimeBridge,
} from "./runtime-sync-runner.js";
import { acquireSyncLeader, type SyncLeaderHandle } from "./sync-leader.js";

const device = "00000000-0000-4000-8000-000000000001";
const restaurant = "00000000-0000-4000-8000-000000000010";
const branch = "00000000-0000-4000-8000-000000000011";
const scope: BranchScope = parseSyncScopeV1({ branchId: branch, restaurantId: restaurant })!;

const timers = { setInterval: (): number => 1, clearInterval: (): void => undefined };

function delay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Serializing fake Web Locks, as in the leader/store suites. */
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

interface BridgeSpy {
  readonly bridge: RuntimeBridge;
  readonly calls: string[];
}

function bridgeSpy(): BridgeSpy {
  const calls: string[] = [];
  const bridge: RuntimeBridge = {
    register: () => { calls.push("register"); },
    unregister: () => { calls.push("unregister"); },
    syncNow: () => { calls.push("sync"); return Promise.resolve(); },
    release: () => { calls.push("release"); return Promise.resolve(); },
    setConnectivity: () => { calls.push("connectivity"); },
  };
  return { bridge, calls };
}

function fakeLeader(leader: boolean): { readonly handle: SyncLeaderHandle; fail(): void; grant(): void } {
  const grantedCallbacks = new Set<() => void>();
  const lostCallbacks = new Set<() => void>();
  const handle: SyncLeaderHandle = {
    isLeader: leader,
    status: leader ? "leader" : "follower",
    onGranted: (callback) => {
      if (leader) {
        callback();
        return () => undefined;
      }
      grantedCallbacks.add(callback);
      return () => { grantedCallbacks.delete(callback); };
    },
    onLost: (callback) => {
      lostCallbacks.add(callback);
      return () => { lostCallbacks.delete(callback); };
    },
    release: () => { lostCallbacks.clear(); grantedCallbacks.clear(); },
  };
  return {
    handle,
    fail: () => { for (const callback of [...lostCallbacks]) callback(); },
    grant: () => { for (const callback of [...grantedCallbacks]) callback(); },
  };
}

test("solo el lider abre el puente; el seguidor lo informa y releva al lider", async () => {
  const locks = createLockManager();
  const notices: Array<string | null> = [];
  const firstBridge = bridgeSpy();
  const secondBridge = bridgeSpy();
  const opened: string[] = [];

  const options = (name: string, spy: BridgeSpy) => ({
    deviceId: device,
    scope,
    acquireLeader: () => acquireSyncLeader(device, { channel: null, locks, timeoutMs: 20 }),
    openBridge: () => { opened.push(name); return Promise.resolve(spy.bridge); },
    reportFollower: (notice: string | null) => { notices.push(notice); },
    syncIntervalMs: 1_000,
    timers,
    isOnline: () => true,
  });

  const leader = startOfflineRuntime(options("leader", firstBridge));
  await delay();
  await delay();
  assert.equal(leader.isActive, true);
  assert.deepEqual(opened, ["leader"]);
  assert.deepEqual(firstBridge.calls, ["connectivity", "register", "sync"]);

  const second = startOfflineRuntime(options("second", secondBridge));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(second.isActive, false);
  assert.deepEqual(opened, ["leader"]);
  assert.equal(notices.at(-1), SYNC_FOLLOWER_NOTICE);
  assert.deepEqual(secondBridge.calls, []);

  // The leader tab closes: the queued request wins the lock and the follower takes over.
  leader.stop();
  await delay();
  await delay();
  assert.equal(second.isActive, true);
  assert.deepEqual(opened, ["leader", "second"]);
  assert.deepEqual(secondBridge.calls, ["connectivity", "register", "sync"]);
  assert.equal(notices.at(-1), null);

  second.stop();
  assert.deepEqual(secondBridge.calls, ["connectivity", "register", "sync", "unregister", "release"]);
});

test("perder el lock descarta el motor y reabre el puente contra el mismo almacen", async () => {
  const first = fakeLeader(false);
  const second = fakeLeader(true);
  const acquired = [first.handle, second.handle];
  let acquireCalls = 0;
  const spies = [bridgeSpy(), bridgeSpy()];
  const opened: number[] = [];
  const notices: Array<string | null> = [];

  const runner = startOfflineRuntime({
    deviceId: device,
    scope,
    acquireLeader: () => {
      const handle = acquired[acquireCalls] ?? first.handle;
      acquireCalls += 1;
      return Promise.resolve(handle);
    },
    openBridge: () => {
      const index = Math.min(opened.length, spies.length - 1);
      opened.push(index);
      return Promise.resolve(spies[index]!.bridge);
    },
    reportFollower: (notice: string | null) => { notices.push(notice); },
    syncIntervalMs: 1_000,
    timers,
    isOnline: () => true,
  });

  // First the tab is a follower, then it is granted the lock.
  await delay();
  assert.equal(acquireCalls, 1);
  assert.equal(notices.at(-1), SYNC_FOLLOWER_NOTICE);
  first.grant();
  await delay();
  assert.deepEqual(opened, [0]);
  assert.deepEqual(spies[0]!.calls, ["connectivity", "register", "sync"]);

  // The lock is lost: the engine is released before the new attempt.
  first.fail();
  await delay();
  await delay();
  assert.equal(acquireCalls, 2);
  assert.deepEqual(spies[0]!.calls, ["connectivity", "register", "sync", "unregister", "release"]);
  assert.deepEqual(opened, [0, 1]);
  assert.deepEqual(spies[1]!.calls, ["connectivity", "register", "sync"]);

  runner.stop();
});

test("sin Web Locks no se abre el puente y se informa el motivo real", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  const opened: number[] = [];
  const notices: Array<string | null> = [];
  const runner = startOfflineRuntime({
    deviceId: device,
    scope,
    acquireLeader: () => acquireSyncLeader(device, { channel: null, timeoutMs: 5 }),
    openBridge: () => { opened.push(1); return Promise.resolve(bridgeSpy().bridge); },
    reportFollower: (notice: string | null) => { notices.push(notice); },
    timers,
  });

  try {
    await delay();
    assert.deepEqual(opened, []);
    assert.equal(runner.isActive, false);
    assert.equal(notices.at(-1), "Este navegador no ofrece el bloqueo entre pestañas: esta pestaña no sincroniza.");
    runner.stop();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
  }
});
