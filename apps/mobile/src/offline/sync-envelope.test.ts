import assert from "node:assert/strict";
import test from "node:test";

import { parseDurableState, parseSyncScope, type DurableSyncState } from "@super-restaurant/sync-engine";

import {
  createWebCryptoEnvelopeCipher,
  decodeScopedSnapshot,
  encodeScopedSnapshot,
  MobileScopeEnvelopeError,
  partitionStateByScope,
  scopeEnvelopeAad,
  type MobileSyncEnvelopeCipher,
} from "./sync-envelope.js";
import { MobileSqliteSyncStorage } from "./sync-store.js";
import {
  BRANCH,
  DEVICE,
  FakeSyncDatabase,
  OTHER_DEVICE,
  RESTAURANT,
  entry,
  fakeSha256,
  fixtureEnvelopeCipher,
  fixtureKeyBytes,
  stateWith,
  storageFor,
  testId,
} from "./test-fixtures.js";

const OTHER_SCOPE = (() => {
  const parsed = parseSyncScope({ branchId: testId(0xb2), restaurantId: RESTAURANT });
  if (!parsed.ok) throw new Error("invalid scope");
  return parsed.value;
})();

function cipherForVersions(versions: readonly number[]): MobileSyncEnvelopeCipher {
  return createWebCryptoEnvelopeCipher({
    rawKey: (version: number): Promise<Uint8Array> => {
      if (!versions.includes(version)) return Promise.reject(new Error(`missing key v${version}`));
      return Promise.resolve(fixtureKeyBytes(version));
    },
    subtle: globalThis.crypto.subtle,
  });
}

function twoScopeState(): DurableSyncState {
  const first = entry();
  const second = entry({
    eventId: testId(0x1002),
    idempotencyKey: "k-2",
    localSequence: 2,
  });
  const parsed = parseDurableState({
    deviceId: DEVICE,
    lastLocalSequence: 2,
    outbox: [first, second],
    replica: [],
    scopes: [
      { branchId: BRANCH, pullCursor: "cursor-a", restaurantId: RESTAURANT, status: "active" },
      { branchId: OTHER_SCOPE.branchId, pullCursor: "cursor-b", restaurantId: RESTAURANT, status: "active" },
    ],
    stateVersion: 1,
  }, DEVICE);
  if (!parsed.ok) throw new Error(`invalid fixture state: ${parsed.code} ${parsed.field}`);
  return parsed.value;
}

test("a snapshot is partitioned into one encrypted entry per restaurantId|branchId", async () => {
  const state = twoScopeState();
  const slices = partitionStateByScope(state);
  assert.equal(slices.length, 2);
  const serialized = await encodeScopedSnapshot(state, fixtureEnvelopeCipher(), DEVICE, 1);
  const document = JSON.parse(serialized) as { entries: { scope: string; ciphertext: string }[] };
  assert.equal(document.entries.length, 2);
  assert.deepEqual(document.entries.map((item) => item.scope).sort(), [
    `${RESTAURANT}|${BRANCH}`,
    `${RESTAURANT}|${OTHER_SCOPE.branchId}`,
  ].sort());
  // The plaintext cursor and payload are not visible in the stored bytes.
  assert.equal(serialized.includes("cursor-a"), false);
  assert.equal(serialized.includes("private-cursor"), false);

  const merged = await decodeScopedSnapshot(serialized, fixtureEnvelopeCipher(), DEVICE);
  assert.equal(merged.lastLocalSequence, 2);
  assert.equal(merged.outbox.length, 2);
  assert.equal(merged.scopes.length, 2);
});

test("reading a scope envelope under another scope fails the GCM tag", async () => {
  const cipher = fixtureEnvelopeCipher();
  const aadA = scopeEnvelopeAad({ branchId: BRANCH, restaurantId: RESTAURANT }, DEVICE, 1);
  const aadB = scopeEnvelopeAad(OTHER_SCOPE, DEVICE, 1);
  const sealed = await cipher.encrypt("{\"note\":\"scope-a\"}", aadA, 1);
  assert.equal(await cipher.decrypt(sealed, aadA, 1), "{\"note\":\"scope-a\"}");
  await assert.rejects(cipher.decrypt(sealed, aadB, 1), (error: unknown) =>
    error instanceof MobileScopeEnvelopeError && error.code === "STATE_CORRUPT");
});

test("swapping the declared scope of a stored entry is rejected, never decrypted into another branch", async () => {
  const serialized = await encodeScopedSnapshot(twoScopeState(), fixtureEnvelopeCipher(), DEVICE, 1);
  const document = JSON.parse(serialized) as { entries: { scope: string; branchId: string }[] };
  const target = document.entries.find((item) => item.branchId === BRANCH);
  assert.ok(target !== undefined);
  // Claim the ciphertext belongs to the other branch without re-sealing it.
  target.branchId = OTHER_SCOPE.branchId;
  target.scope = `${RESTAURANT}|${OTHER_SCOPE.branchId}`;
  await assert.rejects(decodeScopedSnapshot(JSON.stringify(document), fixtureEnvelopeCipher(), DEVICE), (error: unknown) =>
    error instanceof MobileScopeEnvelopeError && error.code === "STATE_CORRUPT");
});

test("a snapshot cannot be read by another deviceId, even with the same key material", async () => {
  const serialized = await encodeScopedSnapshot(stateWith([entry()]), fixtureEnvelopeCipher(), DEVICE, 1);
  // The device id is part of the AAD of every entry, so a different device fails.
  await assert.rejects(decodeScopedSnapshot(serialized, fixtureEnvelopeCipher(), OTHER_DEVICE), (error: unknown) =>
    error instanceof MobileScopeEnvelopeError && error.code === "STATE_CORRUPT");
});

test("a key version downgrade or upgrade without re-sealing fails the tag", async () => {
  const cipher = fixtureEnvelopeCipher();
  const aadV1 = scopeEnvelopeAad({ branchId: BRANCH, restaurantId: RESTAURANT }, DEVICE, 1);
  const aadV2 = scopeEnvelopeAad({ branchId: BRANCH, restaurantId: RESTAURANT }, DEVICE, 2);
  const sealed = await cipher.encrypt("payload", aadV1, 1);
  await assert.rejects(cipher.decrypt(sealed, aadV2, 2), (error: unknown) =>
    error instanceof MobileScopeEnvelopeError && error.code === "STATE_CORRUPT");
});

test("key rotation re-encrypts every scope without losing pending outbox events", async () => {
  const database = new FakeSyncDatabase();
  const state = stateWith([entry({ entityType: "Payment", localState: "pending" })]);
  await storageFor(database).persist(state);

  const storage = storageFor(database);
  await storage.loadState(DEVICE);
  await storage.rotateKeyVersion(2);

  // Read only with v2: proves every entry was re-sealed before the old key went away.
  const rotated = new MobileSqliteSyncStorage({
    cipher: cipherForVersions([2]),
    database,
    deviceId: DEVICE,
    keyVersion: 2,
    sha256Hex: fakeSha256,
  });
  const hydrated = parseDurableState(await rotated.loadState(DEVICE), DEVICE);
  assert.equal(hydrated.ok, true);
  if (!hydrated.ok) return;
  assert.equal(hydrated.value.outbox.length, 1);
  assert.equal(hydrated.value.outbox[0]?.localState, "pending");
  assert.equal(hydrated.value.outbox[0]?.idempotencyKey, "k-1");
  assert.equal(hydrated.value.lastLocalSequence, 1);

  const document = JSON.parse(database.rawSnapshot(DEVICE) ?? "{}") as { entries: { keyVersion: number }[] };
  assert.deepEqual([...new Set(document.entries.map((item) => item.keyVersion))], [2]);
});

test("a device cannot read another device's persisted snapshot", async () => {
  const database = new FakeSyncDatabase();
  await storageFor(database, DEVICE).persist(stateWith([entry()]));
  assert.equal(await storageFor(database, OTHER_DEVICE).loadState(OTHER_DEVICE), null);
});
