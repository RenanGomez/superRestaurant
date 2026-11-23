import assert from "node:assert/strict";
import test from "node:test";

import { SyncTransportError } from "@super-restaurant/sync-engine";

import type { MobileEvent } from "../mobile-state.js";
import { endMobileSession } from "../sign-out.js";
import {
  MobileOfflineSession,
  type MobileDeviceRevocationOutcome,
  type MobileSyncSignOutOutcome,
} from "./sync-session.js";
import type {
  MobileSyncLocalStorageAdmin,
  MobileSyncPendingEvidence,
  MobileSyncPurgeOutcome,
  MobileSyncStorageHealth,
} from "./sync-store.js";
import { MobileSqliteSyncStorage } from "./sync-store.js";
import { createMobileSyncTransport } from "./sync-transport.js";
import { DEVICE, SCOPE, FakeSyncDatabase, storageFor } from "./test-fixtures.js";

const RESTAURANT = "00000000-0000-4000-8000-00000000a0a0";
const BRANCH = "00000000-0000-4000-8000-00000000a1a1";

const EMPTY_PURGE: MobileSyncPurgeOutcome = Object.freeze({
  droppedScopes: 0,
  removedOutboxCount: 0,
  removedReplicaCount: 0,
  retainedOutboxCount: 0,
  retainedReplicaCount: 0,
});

function evidence(overrides: Partial<MobileSyncPendingEvidence> = {}): MobileSyncPendingEvidence {
  return Object.freeze({
    blockingCount: 0,
    financialPendingCount: 0,
    lastLocalSequence: 4,
    outboxCount: 0,
    pendingCount: 0,
    status: "readable" as const,
    ...overrides,
  });
}

class FakeAdmin implements MobileSyncLocalStorageAdmin {
  public readonly calls: string[] = [];
  public evidence: MobileSyncPendingEvidence = evidence();
  public health: MobileSyncStorageHealth = Object.freeze({
    byteLength: 0,
    devicePresent: true,
    lastLocalSequence: 0,
    locked: false,
    quarantined: false,
    writeGeneration: 0,
  });

  public getStorageHealth(): Promise<MobileSyncStorageHealth> {
    return Promise.resolve(this.health);
  }

  public lockStore(): Promise<void> {
    this.calls.push("lock");
    return Promise.resolve();
  }

  public quarantineCorruptStore(): Promise<void> {
    this.calls.push("quarantine");
    return Promise.resolve();
  }

  public purgeNonEvidentiaryCache(): Promise<MobileSyncPurgeOutcome> {
    this.calls.push("purge-cache");
    return Promise.resolve(EMPTY_PURGE);
  }

  public purgeReplicaForScope(scope: { readonly restaurantId: string; readonly branchId: string }): Promise<MobileSyncPurgeOutcome> {
    this.calls.push(`purge-scope:${scope.restaurantId}/${scope.branchId}`);
    return Promise.resolve(EMPTY_PURGE);
  }

  public inspectPendingEvidence(): Promise<MobileSyncPendingEvidence> {
    return Promise.resolve(this.evidence);
  }

  public wipeAll(): Promise<void> {
    this.calls.push("wipe");
    return Promise.resolve();
  }
}

function sessionWith(admin: FakeAdmin): { readonly session: MobileOfflineSession; readonly purged: string[] } {
  const purged: string[] = [];
  const session = new MobileOfflineSession({
    deviceId: DEVICE,
    keys: {
      purge: (deviceId: string): Promise<void> => {
        purged.push(deviceId);
        return Promise.resolve();
      },
    },
    storage: admin,
  });
  return { purged, session };
}

test("a clean sign-out closes the gate, purges caches and keeps the key", async () => {
  const admin = new FakeAdmin();
  const { purged, session } = sessionWith(admin);
  assert.equal(session.pushesAllowed(), true);

  const outcome = await session.prepareSignOut();
  assert.equal(outcome.status, "clean");
  assert.equal(session.pushesAllowed(), false);
  assert.deepEqual(admin.calls, ["purge-cache"]);
  assert.deepEqual(purged, []);
});

test("a sign-out with pending financial evidence locks the store and never wipes it", async () => {
  const admin = new FakeAdmin();
  admin.evidence = evidence({ financialPendingCount: 1, outboxCount: 1, pendingCount: 1 });
  const { purged, session } = sessionWith(admin);

  const outcome = await session.prepareSignOut();
  assert.equal(outcome.status, "evidence-retained");
  if (outcome.status !== "evidence-retained") return;
  assert.equal(outcome.locked, true);
  assert.equal(outcome.evidence.financialPendingCount, 1);
  assert.deepEqual(admin.calls, ["lock", "purge-cache"]);
  assert.deepEqual(purged, [], "the DEK must survive so retained evidence stays readable");
});

test("a corrupt store is quarantined, never purged and never reset", async () => {
  const admin = new FakeAdmin();
  admin.evidence = evidence({ status: "corrupt" });
  const { session } = sessionWith(admin);

  const outcome: MobileSyncSignOutOutcome = await session.prepareSignOut();
  assert.deepEqual(outcome, { quarantined: true, status: "corrupt" });
  assert.deepEqual(admin.calls, ["quarantine"]);
  assert.equal(session.pushesAllowed(), false);
});

test("a scope revocation locks the store and drops only that scope's replica", async () => {
  const admin = new FakeAdmin();
  admin.evidence = evidence({ blockingCount: 1, financialPendingCount: 1, outboxCount: 2, pendingCount: 1 });
  const { purged, session } = sessionWith(admin);

  const outcome = await session.handleScopeRevocation(SCOPE);
  assert.equal(outcome.status, "revoked");
  assert.deepEqual(admin.calls, ["lock", `purge-scope:${RESTAURANT}/${BRANCH}`]);
  assert.equal(session.pushesAllowed(), false);
  assert.deepEqual(purged, []);
});

test("a compromised device is shredded even with financial evidence", async () => {
  const admin = new FakeAdmin();
  admin.evidence = evidence({ financialPendingCount: 2, outboxCount: 2, pendingCount: 2 });
  const { purged, session } = sessionWith(admin);

  const outcome = await session.handleDeviceRevocation("DEVICE_COMPROMISED");
  assert.deepEqual(outcome, { evidenceWasPending: true, status: "shredded" });
  assert.deepEqual(admin.calls, ["wipe"]);
  assert.deepEqual(purged, [DEVICE]);
});

test("a revoked device without financial pending evidence is shredded", async () => {
  const admin = new FakeAdmin();
  admin.evidence = evidence({ outboxCount: 1, pendingCount: 1 });
  const { purged, session } = sessionWith(admin);

  const outcome: MobileDeviceRevocationOutcome = await session.handleDeviceRevocation("DEVICE_REVOKED");
  assert.equal(outcome.status, "shredded");
  assert.deepEqual(admin.calls, ["wipe"]);
  assert.deepEqual(purged, [DEVICE]);
});

test("a revoked device with financial evidence keeps it encrypted and locks the store", async () => {
  const admin = new FakeAdmin();
  admin.evidence = evidence({ financialPendingCount: 1, outboxCount: 3, pendingCount: 1 });
  const { purged, session } = sessionWith(admin);

  const outcome = await session.handleDeviceRevocation("DEVICE_REVOKED");
  assert.equal(outcome.status, "evidence-quarantined");
  assert.deepEqual(admin.calls, ["lock", "purge-cache"]);
  assert.deepEqual(purged, [], "a supervisor still needs to reconcile this device");
});

test("the transport bound to the session stops pushing the moment sign-out starts", async () => {
  const admin = new FakeAdmin();
  const { session } = sessionWith(admin);
  let fetches = 0;
  const fetcher = (): Promise<Response> => {
    fetches += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const transport = createMobileSyncTransport({
    accessToken: () => Promise.resolve("token"),
    apiBaseUrl: "https://api.superrestaurant.test",
    canSend: () => session.pushesAllowed(),
    fetcher: fetcher as typeof fetch,
  });
  const request = {
    deviceId: DEVICE,
    events: [],
    protocolVersion: 1 as const,
    scope: SCOPE,
  };

  await transport.push(request);
  assert.equal(fetches, 1);

  // The gate closes synchronously; the storage work may still be in flight.
  const signOut = session.prepareSignOut();
  await assert.rejects(
    transport.push(request),
    (error: unknown) => error instanceof SyncTransportError && error.code === "AUTH_REVOKED",
  );
  await signOut;
  assert.equal(fetches, 1);
});

test("locking the real store through the session stops the engine's next commit", async () => {
  const database = new FakeSyncDatabase();
  const storage: MobileSqliteSyncStorage = storageFor(database);
  const session = new MobileOfflineSession({
    deviceId: DEVICE,
    keys: { purge: (): Promise<void> => Promise.resolve() },
    storage,
  });
  await session.handleScopeRevocation(SCOPE);
  const health = await storage.getStorageHealth();
  assert.equal(health.locked, true);
  assert.equal(session.pushesAllowed(), false);
});

test("a clean sign-out still ends the session locally when the storage hook fails", async () => {
  const events: MobileEvent[] = [];
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => { rejections.push(reason); };
  process.on("unhandledRejection", onRejection);
  try {
    let signOutCalls = 0;
    endMobileSession({
      dispatch: (event) => { events.push(event); },
      notice: "sessionEnded",
      releaseLocalData: () => Promise.reject(new Error("STORAGE_BROKEN")),
      signOut: () => { signOutCalls += 1; return Promise.resolve(); },
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]?.type, "signedOut");
    assert.equal(signOutCalls, 1);
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});

test("a storage hook that throws synchronously does not break the local sign-out", () => {
  const events: MobileEvent[] = [];
  endMobileSession({
    dispatch: (event) => { events.push(event); },
    notice: undefined,
    releaseLocalData: () => { throw new Error("STORAGE_THREW"); },
    signOut: () => Promise.resolve(),
  });
  assert.equal(events.length, 1);
});
