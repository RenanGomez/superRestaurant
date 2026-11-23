import assert from "node:assert/strict";
import test from "node:test";
import { DeviceSyncEngine } from "./engine.js";
import { SyncEngineError, SyncTransportError } from "./errors.js";
import { InMemorySyncStorage } from "./in-memory-storage.js";
import { DEVICE, FakeClock, FakeServer, SCOPE_A1, SCOPE_B1, SequentialIds, id, orderInput } from "./testkit.js";

function rig(options: { readonly maxBatchSize?: number } = {}) {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const clock = new FakeClock();
  const ids = new SequentialIds();
  const build = (): DeviceSyncEngine => new DeviceSyncEngine({
    deviceId: DEVICE,
    storage,
    transport: server,
    ids,
    clock,
    ...options,
  });
  return { storage, server, clock, engine: build(), build };
}

// ---- Multi-pending rollback tests ----------------------------------------------------------

test("rollback multi-pendiente: create aceptado y update posterior rechazado conserva la entidad en el estado del create", async () => {
  const { engine, server } = rig();
  const entityId = id(0x5001);
  const e1 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-1-create"), entityId, payload: { note: "v1" } });
  const e2 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-1-update"), entityId, operation: "update", payload: { note: "v2" } });

  server.pushCodeOverride.set(e2.eventId, { status: "rejected", code: "VALIDATION_FAILED" });
  await engine.push(SCOPE_A1);

  const entity = await engine.getReplicaEntity(SCOPE_A1, "Order", entityId);
  assert.ok(entity !== null, "entity must NOT be deleted because create succeeded");
  assert.deepEqual(entity.snapshot, { note: "v1" });
  assert.equal(entity.pendingEventId, null);
  assert.deepEqual(entity.pendingWrites, []);
  assert.equal(e1.operation, "create");

  // Subsequent pull still applies server canonical version 1!
  const pulled = await engine.pull(SCOPE_A1);
  assert.equal(pulled.applied, 1);
  const synced = await engine.getReplicaEntity(SCOPE_A1, "Order", entityId);
  assert.equal(synced?.canonicalVersion, 1);
});

test("rollback multi-pendiente en lotes separados: E1 aceptado luego E2 rechazado restaura E1, no orig", async () => {
  const { engine, server } = rig({ maxBatchSize: 1 });
  const entityId = id(0x5002);
  server.inject(SCOPE_A1, { entityType: "Order", entityId, canonicalVersion: 1, tombstone: false, snapshot: { note: "orig" } });
  await engine.pull(SCOPE_A1);

  await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-2-u1"), entityId, operation: "update", payload: { note: "u1" } });
  const e2 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-2-u2"), entityId, operation: "update", payload: { note: "u2" } });

  // Batch 1 accepts E1 while E2 is still pending.
  await engine.push(SCOPE_A1);
  const mid = await engine.getReplicaEntity(SCOPE_A1, "Order", entityId);
  assert.deepEqual(mid?.snapshot, { note: "u2" });
  assert.equal(mid?.pendingEventId, e2.eventId);
  assert.deepEqual(mid?.revertTo?.snapshot, { note: "u1" });

  // Batch 2 rejects E2 -> restores confirmed E1 snapshot (`u1`), NOT `orig`!
  server.pushCodeOverride.set(e2.eventId, { status: "rejected", code: "VALIDATION_FAILED" });
  await engine.push(SCOPE_A1);
  const after = await engine.getReplicaEntity(SCOPE_A1, "Order", entityId);
  assert.deepEqual(after?.snapshot, { note: "u1" });
  assert.equal(after?.pendingEventId, null);
  assert.deepEqual(after?.pendingWrites, []);
});

test("rollback multi-pendiente: E1 rechazado mientras E2 sigue pendiente conserva E2 y luego revierte a orig si E2 tambien es rechazado", async () => {
  const { engine, server, build } = rig({ maxBatchSize: 1 });
  const entityId = id(0x5003);
  server.inject(SCOPE_A1, { entityType: "Order", entityId, canonicalVersion: 2, tombstone: false, snapshot: { note: "orig" } });
  await engine.pull(SCOPE_A1);

  const e1 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-3-u1"), entityId, operation: "update", payload: { note: "u1" } });
  const e2 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-3-u2"), entityId, operation: "update", payload: { note: "u2" } });

  server.pushCodeOverride.set(e1.eventId, { status: "rejected", code: "BAD_STEP" });
  await engine.push(SCOPE_A1);

  // Restart to verify pendingWrites survives hydration!
  const restarted = build();
  const mid = await restarted.getReplicaEntity(SCOPE_A1, "Order", entityId);
  assert.deepEqual(mid?.snapshot, { note: "u2" });
  assert.equal(mid?.pendingEventId, e2.eventId);
  assert.equal(mid?.pendingWrites.length, 1);

  server.pushCodeOverride.set(e2.eventId, { status: "rejected", code: "BAD_STEP_2" });
  await restarted.push(SCOPE_A1);
  const final = await restarted.getReplicaEntity(SCOPE_A1, "Order", entityId);
  assert.deepEqual(final?.snapshot, { note: "orig" });
  assert.equal(final?.canonicalVersion, 2);
  assert.equal(final?.pendingEventId, null);
});

test("rollback multi-pendiente: E3 rechazado mientras E1 y E2 siguen pendientes revierte a E2", async () => {
  const { engine, server } = rig();
  const entityId = id(0x5004);
  const e1 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-4-c"), entityId, payload: { note: "v1" } });
  const e2 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-4-u1"), entityId, operation: "update", payload: { note: "v2" } });
  const e3 = await engine.enqueue({ ...orderInput(SCOPE_A1, "mp-4-u2"), entityId, operation: "update", payload: { note: "v3" } });

  // E1 & E2 omitted (retry_wait), E3 rejected in same batch.
  server.omitResults.add(e1.eventId);
  server.omitResults.add(e2.eventId);
  server.pushCodeOverride.set(e3.eventId, { status: "rejected", code: "INVALID_QTY" });
  await engine.push(SCOPE_A1);

  const entity = await engine.getReplicaEntity(SCOPE_A1, "Order", entityId);
  assert.deepEqual(entity?.snapshot, { note: "v2" });
  assert.equal(entity?.pendingEventId, e2.eventId);
  assert.deepEqual(entity?.pendingWrites.map((w) => w.eventId), [e1.eventId, e2.eventId]);
});

// ---- Safe compaction tests -----------------------------------------------------------------

test("compactacion segura elimina terminales no financieros viejos, nunca purga financieros, conserva secuencia y respeta scopes", async () => {
  const { engine, clock, build } = rig();
  const order1 = await engine.enqueue(orderInput(SCOPE_A1, "cmp-o1"));
  const order2 = await engine.enqueue(orderInput(SCOPE_A1, "cmp-o2"));
  const payment = await engine.enqueue({
    ...orderInput(SCOPE_A1, "cmp-pay"),
    entityType: "Payment",
    payload: { amountMinor: 1000, currency: "MXN" },
  });
  const cash = await engine.enqueue({
    ...orderInput(SCOPE_A1, "cmp-cash"),
    entityType: "CashMovement",
    payload: { amountMinor: 500, currency: "MXN" },
  });
  const otherScope = await engine.enqueue(orderInput(SCOPE_B1, "cmp-b1"));

  await engine.push(SCOPE_A1);
  await engine.push(SCOPE_B1);

  clock.advance(60_000);
  const pendingOrder = await engine.enqueue(orderInput(SCOPE_A1, "cmp-pending"));

  const outcome = await engine.compact({
    scope: SCOPE_A1,
    olderThanMs: clock.now - 1_000,
    retainMinTerminalCount: 1,
  });

  // 2 old terminal orders eligible, retainMinTerminalCount=1 -> removes 1 (order1), keeps order2, payment, cash, pendingOrder.
  assert.equal(outcome.removedOutboxCount, 1);
  assert.equal(outcome.skippedFinancialCount, 2);
  assert.equal(outcome.retainedOutboxCount, 4);

  const remaining = await engine.getOutbox(SCOPE_A1);
  const idsRemaining = new Set(remaining.map((entry) => entry.eventId));
  assert.equal(idsRemaining.has(order1.eventId), false);
  assert.equal(idsRemaining.has(order2.eventId), true);
  assert.equal(idsRemaining.has(payment.eventId), true, "Payment must NEVER be compacted");
  assert.equal(idsRemaining.has(cash.eventId), true, "CashMovement must NEVER be compacted");
  assert.equal(idsRemaining.has(pendingOrder.eventId), true, "pending must NEVER be compacted");

  // Other scope untouched.
  assert.deepEqual((await engine.getOutbox(SCOPE_B1)).map((e) => e.eventId), [otherScope.eventId]);

  // localSequence continues monotonically after restart & compaction.
  const restarted = build();
  const next = await restarted.enqueue(orderInput(SCOPE_A1, "cmp-after"));
  assert.equal(next.localSequence, pendingOrder.localSequence + 1);
});

test("compactacion nunca elimina tombstones sin resyncBarrierConfirmed y solo los elimina con barrera confirmada", async () => {
  const { engine, server, clock } = rig();
  const tableId = id(0x6100);
  server.inject(SCOPE_A1, { entityType: "DiningTable", entityId: tableId, canonicalVersion: 1, tombstone: false, snapshot: { name: "M1" } });
  server.inject(SCOPE_A1, { entityType: "DiningTable", entityId: tableId, canonicalVersion: 2, tombstone: true, snapshot: null });
  await engine.pull(SCOPE_A1);

  await assert.rejects(
    engine.compact({ scope: SCOPE_A1, olderThanMs: clock.now, compactTombstones: true, resyncBarrierConfirmed: false }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "COMPACTION_INVALID",
  );
  assert.equal((await engine.getReplicaEntity(SCOPE_A1, "DiningTable", tableId))?.tombstone, true);

  const compacted = await engine.compact({
    scope: SCOPE_A1,
    olderThanMs: clock.now,
    compactTombstones: true,
    resyncBarrierConfirmed: true,
  });
  assert.equal(compacted.removedTombstoneCount, 1);
  assert.equal(await engine.getReplicaEntity(SCOPE_A1, "DiningTable", tableId), null);
});

// ---- Snapshot resync tests -----------------------------------------------------------------

test("resync por snapshot recupera resync_required atomicamente, preserva pendientes locales y limpia obsoletos", async () => {
  const { engine, server, storage, build } = rig();
  const staleId = id(0x7001);
  const sharedId = id(0x7002);
  const localOnlyId = id(0x7003);
  const otherScopeId = id(0x7004);

  server.inject(SCOPE_A1, { entityType: "Order", entityId: staleId, canonicalVersion: 1, tombstone: false, snapshot: { note: "old" } });
  server.inject(SCOPE_A1, { entityType: "Order", entityId: sharedId, canonicalVersion: 1, tombstone: false, snapshot: { note: "v1" } });
  server.inject(SCOPE_B1, { entityType: "Order", entityId: otherScopeId, canonicalVersion: 1, tombstone: false, snapshot: { note: "b1" } });
  await engine.pull(SCOPE_A1);
  await engine.pull(SCOPE_B1);

  // Local unconfirmed writes: one update on sharedId, one offline create on localOnlyId.
  const localEdit = await engine.enqueue({ ...orderInput(SCOPE_A1, "rs-edit"), entityId: sharedId, operation: "update", payload: { note: "local-opt" } });
  const localCreate = await engine.enqueue({ ...orderInput(SCOPE_A1, "rs-create"), entityId: localOnlyId, payload: { note: "offline-new" } });

  // Cursor expires -> scope enters resync_required.
  server.pullError = new SyncTransportError("CURSOR_EXPIRED", false);
  const failedPull = await engine.pull(SCOPE_A1);
  assert.equal(failedPull.status, "resync_required");
  server.pullError = null;

  // Snapshot returns updated sharedId (v5) and a new entity, omitting staleId.
  const freshId = id(0x7005);
  server.snapshotOverride = (request) => ({
    protocolVersion: 1,
    scope: request.scope,
    snapshotCursor: `cur|${SCOPE_A1.restaurantId}/${SCOPE_A1.branchId}|99`,
    generatedAt: "2026-10-22T12:30:00.000Z",
    entities: [
      {
        entityType: "Order",
        entityId: sharedId,
        restaurantId: SCOPE_A1.restaurantId,
        branchId: SCOPE_A1.branchId,
        canonicalVersion: 5,
        tombstone: false,
        snapshot: { note: "server-v5" },
      },
      {
        entityType: "Order",
        entityId: freshId,
        restaurantId: SCOPE_A1.restaurantId,
        branchId: SCOPE_A1.branchId,
        canonicalVersion: 1,
        tombstone: false,
        snapshot: { note: "fresh" },
      },
    ],
  });

  const persistsBefore = storage.persistCount;
  const resync = await engine.resyncFromSnapshot(SCOPE_A1);
  assert.equal(storage.persistCount - persistsBefore, 1, "single atomic persist for snapshot + cursor");
  assert.equal(resync.status, "complete");
  assert.equal(resync.applied, 2);
  assert.equal(resync.preservedPending, 2);
  assert.equal(resync.removedStale, 1);
  assert.equal(resync.cursor, `cur|${SCOPE_A1.restaurantId}/${SCOPE_A1.branchId}|99`);

  // Verify scope active + cursor updated + replica reconciled.
  assert.equal((await engine.getStatusSummary(SCOPE_A1)).scopeStatus, "active");
  assert.equal(await engine.getPullCursor(SCOPE_A1), resync.cursor);
  assert.equal(await engine.getReplicaEntity(SCOPE_A1, "Order", staleId), null, "stale confirmed entity pruned");
  assert.deepEqual((await engine.getReplicaEntity(SCOPE_A1, "Order", freshId))?.snapshot, { note: "fresh" });

  // Pending update on sharedId re-anchored revertTo to server-v5 while keeping optimistic snapshot!
  const shared = await engine.getReplicaEntity(SCOPE_A1, "Order", sharedId);
  assert.equal(shared?.canonicalVersion, 5);
  assert.deepEqual(shared?.snapshot, { note: "local-opt" });
  assert.equal(shared?.pendingEventId, localEdit.eventId);
  assert.deepEqual(shared?.revertTo, { existed: true, snapshot: { note: "server-v5" }, canonicalVersion: 5 });

  // Offline create preserved!
  const localOnly = await engine.getReplicaEntity(SCOPE_A1, "Order", localOnlyId);
  assert.deepEqual(localOnly?.snapshot, { note: "offline-new" });
  assert.equal(localOnly?.pendingEventId, localCreate.eventId);

  // Other scope untouched and state survives restart!
  const restarted = build();
  assert.deepEqual((await restarted.getReplicaEntity(SCOPE_B1, "Order", otherScopeId))?.snapshot, { note: "b1" });
  assert.equal(await restarted.getPullCursor(SCOPE_A1), resync.cursor);
});

test("resync por snapshot rechaza violacion de scope y revoca ante DEVICE_REVOKED", async () => {
  const { engine, server } = rig();
  const payment = await engine.enqueue({
    ...orderInput(SCOPE_A1, "rs-rev-pay"),
    entityType: "Payment",
    payload: { amountMinor: 900, currency: "MXN" },
  });

  // Cross-scope entity in snapshot -> PULL_SCOPE_VIOLATION, state untouched.
  await assert.rejects(
    engine.applySnapshotResync(SCOPE_A1, {
      protocolVersion: 1,
      scope: SCOPE_A1,
      snapshotCursor: "snap-1",
      generatedAt: "2026-10-22T12:30:00.000Z",
      entities: [
        {
          entityType: "Order",
          entityId: id(0x7100),
          restaurantId: SCOPE_B1.restaurantId,
          branchId: SCOPE_B1.branchId,
          canonicalVersion: 1,
          tombstone: false,
          snapshot: { note: "leak" },
        },
      ],
    }),
    (error: unknown) => error instanceof SyncEngineError && error.code === "PULL_SCOPE_VIOLATION",
  );
  assert.equal(await engine.getPullCursor(SCOPE_A1), null);

  // DEVICE_REVOKED during snapshot fetch revokes scope and escalates pending Payment to manual_review.
  server.snapshotError = new SyncTransportError("DEVICE_REVOKED", false);
  const revoked = await engine.resyncFromSnapshot(SCOPE_A1);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.code, "DEVICE_REVOKED");
  assert.equal((await engine.getOutbox(SCOPE_A1)).find((e) => e.eventId === payment.eventId)?.localState, "manual_review");
});
