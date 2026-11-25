import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyncBannerLifecycle,
  type SyncBannerLifecycle,
  type SyncBannerLifecycleState,
} from "./sync-banner-lifecycle.js";

interface TestRuntime {
  readonly id: string;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function lifecycleWith(overrides: {
  readonly health?: () => Promise<{ readonly locked: boolean }>;
  readonly open?: () => Promise<TestRuntime>;
  readonly onState?: (state: SyncBannerLifecycleState) => void;
  readonly resume?: () => Promise<{ readonly status: string }>;
} = {}): SyncBannerLifecycle {
  return createSyncBannerLifecycle<TestRuntime>({
    loadHealth: overrides.health ?? (() => Promise.resolve({ locked: false })),
    onDiscard: () => Promise.resolve(),
    onOpened: () => undefined,
    onState: overrides.onState ?? (() => undefined),
    openRuntime: overrides.open ?? (() => Promise.resolve({ id: "runtime" })),
    resumeSession: overrides.resume ?? (() => Promise.resolve({ status: "resumed" })),
  });
}

test("a health result that resolves after stop never reaches onState", async () => {
  const health = deferred<{ readonly locked: boolean }>();
  const states: SyncBannerLifecycleState[] = [];
  const lifecycle = lifecycleWith({
    health: () => health.promise,
    onState: (state) => { states.push(state); },
  });

  lifecycle.start();
  await flush();
  lifecycle.stop();
  health.resolve({ locked: false });
  await flush();

  assert.deepEqual(states, []);
});

test("a locked store that cannot be resumed reports the lock notice", async () => {
  const states: SyncBannerLifecycleState[] = [];
  const lifecycle = lifecycleWith({
    health: () => Promise.resolve({ locked: true }),
    onState: (state) => { states.push(state); },
    resume: () => Promise.resolve({ status: "corrupt" }),
  });

  lifecycle.start();
  await flush();

  assert.deepEqual(states, [{ notice: "storage-locked", status: "unavailable" }]);
});

test("a resume that does not return resumed reports the resume notice", async () => {
  const states: SyncBannerLifecycleState[] = [];
  const lifecycle = lifecycleWith({
    health: () => Promise.resolve({ locked: true }),
    onState: (state) => { states.push(state); },
    resume: () => Promise.resolve({ status: "failed" }),
  });

  lifecycle.start();
  await flush();

  assert.deepEqual(states, [{ notice: "resume-failed", status: "unavailable" }]);
});

test("a usable store emits the normal ready state", async () => {
  const states: SyncBannerLifecycleState[] = [];
  const lifecycle = lifecycleWith({
    health: () => Promise.resolve({ locked: false }),
    onState: (state) => { states.push(state); },
  });

  lifecycle.start();
  await flush();

  assert.deepEqual(states, [{ status: "ready" }]);
});

test("a locked store resumed for this session emits the normal ready state", async () => {
  const states: SyncBannerLifecycleState[] = [];
  const lifecycle = lifecycleWith({
    health: () => Promise.resolve({ locked: true }),
    onState: (state) => { states.push(state); },
    resume: () => Promise.resolve({ status: "resumed" }),
  });

  lifecycle.start();
  await flush();

  assert.deepEqual(states, [{ status: "ready" }]);
});

test("an open that rejects reports unavailable storage", async () => {
  const states: SyncBannerLifecycleState[] = [];
  const lifecycle = lifecycleWith({
    onState: (state) => { states.push(state); },
    open: () => Promise.reject(new Error("ENCRYPTION_UNAVAILABLE")),
  });

  lifecycle.start();
  await flush();

  assert.deepEqual(states, [{ notice: "storage-unavailable", status: "unavailable" }]);
});
