import assert from "node:assert/strict";
import test from "node:test";
import { DeviceSyncEngine } from "./engine.js";
import { SyncEngineError, SyncTransportError } from "./errors.js";
import { InMemorySyncStorage } from "./in-memory-storage.js";
import { DEVICE, FakeClock, FakeServer, SCOPE_A1, SCOPE_A2, SCOPE_B1, SequentialIds, id, orderInput } from "./testkit.test.js";

function rig(options: { readonly pullLimit?: number; readonly maxPagesPerSync?: number } = {}): {
  readonly storage: InMemorySyncStorage;
  readonly server: FakeServer;
  readonly engine: DeviceSyncEngine;
  readonly clock: FakeClock;
} {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const clock = new FakeClock();
  const engine = new DeviceSyncEngine({ deviceId: DEVICE, storage, transport: server, ids: new SequentialIds(), clock, ...options });
  return { storage, server, engine, clock };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof SyncEngineError && error.code === code, code);
}

function change(entity: number, version: number, note: string, tombstone = false): { entityType: string; entityId: string; canonicalVersion: number; tombstone: boolean; snapshot: { note: string } | null } {
  return { entityType: "Order", entityId: id(entity), canonicalVersion: version, tombstone, snapshot: tombstone ? null : { note } };
}

test("accepted y duplicate cierran el outbox pero nunca avanzan el cursor de pull", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, change(0x900, 1, "other-device"));
  await engine.enqueue(orderInput(SCOPE_A1, "c1"));
  const outcome = await engine.push(SCOPE_A1);
  assert.equal(outcome.pullRecommended, true);
  assert.equal(await engine.getPullCursor(SCOPE_A1), null);
  assert.equal((await engine.getStatusSummary(SCOPE_A1)).hasPullCursor, false);
  const pulled = await engine.pull(SCOPE_A1);
  assert.equal(pulled.status, "complete");
  assert.equal(pulled.applied, 2, "the pull also recovers the concurrent change from another device");
  assert.equal(await engine.getPullCursor(SCOPE_A1), "cur|" + `${SCOPE_A1.restaurantId}/${SCOPE_A1.branchId}` + "|2");
});

test("un pull fallido conserva el cursor anterior y no toca la replica", async () => {
  const { engine, server, storage } = rig();
  server.inject(SCOPE_A1, change(0x901, 1, "one"));
  await engine.pull(SCOPE_A1);
  const cursor = await engine.getPullCursor(SCOPE_A1);
  assert.notEqual(cursor, null);
  const before = JSON.stringify(storage.rawState(DEVICE));
  server.pullError = new SyncTransportError("UNAVAILABLE", true);
  const outcome = await engine.pull(SCOPE_A1);
  assert.deepEqual([outcome.status, outcome.code, outcome.retryable], ["failed", "UNAVAILABLE", true]);
  assert.equal(await engine.getPullCursor(SCOPE_A1), cursor);
  assert.equal(JSON.stringify(storage.rawState(DEVICE)), before);
});

test("el cursor es opaco, se pagina con hasMore y se persiste junto con el lote", async () => {
  const { engine, server, storage } = rig({ pullLimit: 2 });
  for (let n = 1; n <= 5; n += 1) server.inject(SCOPE_A1, change(0x910 + n, 1, `n${n}`));
  const persistsBefore = storage.persistCount;
  const outcome = await engine.pull(SCOPE_A1);
  assert.deepEqual([outcome.status, outcome.pages, outcome.applied], ["complete", 3, 5]);
  assert.equal(storage.persistCount - persistsBefore, 3, "exactly one persist per page");
  assert.deepEqual(server.pullRequests.map((request) => request.cursor === null ? null : "opaque"), [null, "opaque", "opaque"]);
  assert.equal(server.pullRequests[1]?.cursor, `cur|${SCOPE_A1.restaurantId}/${SCOPE_A1.branchId}|2`);
  assert.equal((await engine.listReplica(SCOPE_A1)).length, 5);
  const stored = storage.rawState(DEVICE) as { scopes: { pullCursor: string }[]; replica: unknown[] };
  assert.equal(stored.scopes[0]?.pullCursor, await engine.getPullCursor(SCOPE_A1));
  assert.equal(stored.replica.length, 5);
  const again = await engine.pull(SCOPE_A1);
  assert.deepEqual([again.status, again.applied], ["complete", 0]);
});

test("maxPagesPerSync corta la paginacion y deja el cursor del ultimo lote aplicado", async () => {
  const { engine, server } = rig({ pullLimit: 1, maxPagesPerSync: 2 });
  for (let n = 1; n <= 4; n += 1) server.inject(SCOPE_A1, change(0x920 + n, 1, `n${n}`));
  const first = await engine.pull(SCOPE_A1);
  assert.deepEqual([first.status, first.pages, first.applied], ["partial", 2, 2]);
  const second = await engine.pull(SCOPE_A1);
  assert.deepEqual([second.status, second.pages, second.applied], ["complete", 2, 2]);
  assert.equal((await engine.listReplica(SCOPE_A1)).length, 4);
});

test("un cambio fuera de scope descarta el lote completo y no mueve el cursor", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, change(0x930, 1, "ok"));
  await engine.pull(SCOPE_A1);
  const cursor = await engine.getPullCursor(SCOPE_A1);
  server.pullOverride = (request) => ({
    scope: request.scope,
    changes: [
      { ...change(0x931, 1, "fine"), restaurantId: SCOPE_A1.restaurantId, branchId: SCOPE_A1.branchId },
      { ...change(0x932, 1, "leak"), restaurantId: SCOPE_B1.restaurantId, branchId: SCOPE_B1.branchId },
    ],
    nextCursor: "next-opaque",
    hasMore: false,
  });
  await expectCode(engine.pull(SCOPE_A1), "PULL_SCOPE_VIOLATION");
  assert.equal(await engine.getPullCursor(SCOPE_A1), cursor);
  assert.equal((await engine.listReplica(SCOPE_A1)).length, 1);
  assert.equal((await engine.listReplica(SCOPE_B1)).length, 0);
  server.pullOverride = (request) => ({
    scope: { restaurantId: SCOPE_A2.restaurantId, branchId: SCOPE_A2.branchId },
    changes: [], nextCursor: "x", hasMore: false, requested: request.cursor,
  });
  await expectCode(engine.pull(SCOPE_A1), "PULL_SCOPE_VIOLATION");
  server.pullOverride = () => ({ scope: SCOPE_A1, changes: "oops", nextCursor: null, hasMore: false });
  await expectCode(engine.pull(SCOPE_A1), "PULL_RESPONSE_INVALID");
  assert.equal(await engine.getPullCursor(SCOPE_A1), cursor);
});

test("hasMore sin cursor nuevo se rechaza para no ciclar", async () => {
  const { engine, server } = rig();
  server.pullOverride = (request) => ({ scope: request.scope, changes: [], nextCursor: null, hasMore: true });
  await expectCode(engine.pull(SCOPE_A1), "PULL_RESPONSE_INVALID");
  assert.equal(server.pullRequests.length, 1);
});

test("un cursor invalido, expirado o de otro scope deja el scope en resync_required sin saltos", async () => {
  for (const code of ["CURSOR_INVALID", "CURSOR_EXPIRED", "CURSOR_SCOPE_MISMATCH"]) {
    const { engine, server } = rig();
    server.inject(SCOPE_A1, change(0x940, 1, "one"));
    await engine.pull(SCOPE_A1);
    const cursor = await engine.getPullCursor(SCOPE_A1);
    server.pullError = new SyncTransportError(code, false);
    const outcome = await engine.pull(SCOPE_A1);
    assert.deepEqual([outcome.status, outcome.code], ["resync_required", code]);
    assert.equal(await engine.getPullCursor(SCOPE_A1), cursor, "no silent jump");
    assert.equal((await engine.getStatusSummary(SCOPE_A1)).scopeStatus, "resync_required");
    server.pullError = null;
    const requests = server.pullRequests.length;
    assert.equal((await engine.pull(SCOPE_A1)).status, "resync_required");
    assert.equal(server.pullRequests.length, requests, "no transport call until explicit reset");
    await engine.resetScopeForResync(SCOPE_A1);
    assert.equal(await engine.getPullCursor(SCOPE_A1), null);
    assert.equal((await engine.pull(SCOPE_A1)).status, "complete");
  }
});

test("los cursores por scope son independientes y cada replica solo ve lo suyo", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, change(0x950, 1, "a1"));
  server.inject(SCOPE_A2, change(0x951, 1, "a2"));
  await engine.pull(SCOPE_A1);
  await engine.pull(SCOPE_A2);
  assert.equal((await engine.listReplica(SCOPE_A1)).map((entity) => entity.entityId).join(), id(0x950));
  assert.equal((await engine.listReplica(SCOPE_A2)).map((entity) => entity.entityId).join(), id(0x951));
  assert.notEqual(await engine.getPullCursor(SCOPE_A1), await engine.getPullCursor(SCOPE_A2));
});

test("orden por canonicalVersion: la misma version o una menor no sobrescribe", async () => {
  const { engine, server } = rig({ pullLimit: 1 });
  server.inject(SCOPE_A1, change(0x960, 3, "v3"));
  server.inject(SCOPE_A1, change(0x960, 2, "v2-late"));
  server.inject(SCOPE_A1, change(0x960, 3, "v3-again"));
  await engine.pull(SCOPE_A1);
  const entity = await engine.getReplicaEntity(SCOPE_A1, "Order", id(0x960));
  assert.deepEqual([entity?.canonicalVersion, entity?.snapshot], [3, { note: "v3" }]);
  server.inject(SCOPE_A1, change(0x960, 4, "v4"));
  await engine.pull(SCOPE_A1);
  assert.deepEqual((await engine.getReplicaEntity(SCOPE_A1, "Order", id(0x960)))?.snapshot, { note: "v4" });
});

test("tombstone: no se resucita, bloquea updates atrasados y el entityId no se recrea", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, change(0x970, 1, "alive"));
  server.inject(SCOPE_A1, change(0x970, 2, "", true));
  server.inject(SCOPE_A1, change(0x970, 3, "zombie"));
  server.inject(SCOPE_A1, change(0x970, 1, "late-update"));
  await engine.pull(SCOPE_A1);
  const entity = await engine.getReplicaEntity(SCOPE_A1, "Order", id(0x970));
  assert.deepEqual([entity?.tombstone, entity?.canonicalVersion, entity?.snapshot], [true, 2, null]);
  server.inject(SCOPE_A1, change(0x970, 5, "", true));
  await engine.pull(SCOPE_A1);
  assert.equal((await engine.getReplicaEntity(SCOPE_A1, "Order", id(0x970)))?.canonicalVersion, 5);
  await expectCode(engine.enqueue({ ...orderInput(SCOPE_A1, "recreate"), entityId: id(0x970) }), "ENTITY_TOMBSTONED");
  await expectCode(engine.enqueue({ ...orderInput(SCOPE_A1, "late"), entityId: id(0x970), operation: "update" }), "ENTITY_TOMBSTONED");
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 0);
});

test("un tombstone de una entidad desconocida se conserva para impedir recrearla", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, change(0x980, 2, "", true));
  server.inject(SCOPE_A1, change(0x980, 3, "ghost"));
  await engine.pull(SCOPE_A1);
  assert.equal((await engine.getReplicaEntity(SCOPE_A1, "Order", id(0x980)))?.tombstone, true);
});

test("aislamiento en pull: dos restaurantes y sucursales no comparten replica ni cursor", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, change(0x990, 1, "a1"));
  server.inject(SCOPE_B1, change(0x990, 7, "b1-same-entity-id"));
  await engine.pull(SCOPE_A1);
  assert.equal(await engine.getPullCursor(SCOPE_B1), null);
  assert.equal((await engine.listReplica(SCOPE_B1)).length, 0);
  await engine.pull(SCOPE_B1);
  assert.deepEqual((await engine.getReplicaEntity(SCOPE_A1, "Order", id(0x990)))?.snapshot, { note: "a1" });
  assert.deepEqual((await engine.getReplicaEntity(SCOPE_B1, "Order", id(0x990)))?.snapshot, { note: "b1-same-entity-id" });
  assert.equal((await engine.getReplicaEntity(SCOPE_A2, "Order", id(0x990))), null);
  assert.equal((await engine.getStatusSummary(SCOPE_A2)).scopeStatus, "unregistered");
});

test("un snapshot con datos sensibles invalida el lote de pull", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, { ...change(0x9a0, 1, "x"), snapshot: { note: "4111111111111111" } });
  await expectCode(engine.pull(SCOPE_A1), "PULL_RESPONSE_INVALID");
  assert.equal(await engine.getPullCursor(SCOPE_A1), null);
});

test("el pull aplicado limpia la marca pendiente de un evento ya aceptado y el estado sobrevive al reinicio", async () => {
  const { engine, server, storage, clock } = rig();
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "reconcile", { replicaSnapshot: { note: "optimistic" } }));
  await engine.push(SCOPE_A1);
  await engine.pull(SCOPE_A1);
  const entity = await engine.getReplicaEntity(SCOPE_A1, "Order", entry.entityId);
  assert.deepEqual([entity?.canonicalVersion, entity?.pendingEventId], [1, null]);
  const restarted = new DeviceSyncEngine({ deviceId: DEVICE, storage, transport: server, ids: new SequentialIds(), clock });
  assert.equal(await restarted.getPullCursor(SCOPE_A1), await engine.getPullCursor(SCOPE_A1));
  assert.equal((await restarted.sync(SCOPE_A1)).pull.applied, 0);
});
