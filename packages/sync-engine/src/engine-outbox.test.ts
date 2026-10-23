import assert from "node:assert/strict";
import test from "node:test";
import { createExponentialBackoff } from "./backoff.js";
import { DeviceSyncEngine, createRandomIdGenerator, type EnqueueInput, type SyncEngineOptions, type SyncTransportPort } from "./engine.js";
import { SyncEngineError, SyncTransportError } from "./errors.js";
import { InMemorySyncStorage } from "./in-memory-storage.js";
import { DEVICE, FakeClock, FakeServer, SCOPE_A1, SCOPE_A2, SCOPE_B1, SequentialIds, id, orderInput } from "./testkit.test.js";

interface Rig {
  readonly storage: InMemorySyncStorage;
  readonly server: FakeServer;
  readonly clock: FakeClock;
  readonly engine: DeviceSyncEngine;
  readonly build: (overrides?: Partial<SyncEngineOptions>) => DeviceSyncEngine;
}

function rig(overrides: Partial<SyncEngineOptions> = {}): Rig {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const clock = new FakeClock();
  const ids = new SequentialIds();
  const build = (extra: Partial<SyncEngineOptions> = {}): DeviceSyncEngine => new DeviceSyncEngine({
    deviceId: DEVICE, storage, transport: server, ids, clock,
    backoff: createExponentialBackoff({ baseMs: 1_000, maxMs: 8_000, maxRetries: 3, jitterRatio: 0 }),
    ...overrides, ...extra,
  });
  return { storage, server, clock, engine: build(), build };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof SyncEngineError && error.code === code, code);
}

test("localSequence es global por dispositivo entre scopes y continua tras reiniciar", async () => {
  const { engine, build } = rig();
  const first = await engine.enqueue(orderInput(SCOPE_A1, "k1"));
  const second = await engine.enqueue(orderInput(SCOPE_B1, "k2"));
  const third = await engine.enqueue(orderInput(SCOPE_A1, "k3"));
  assert.deepEqual([first.localSequence, second.localSequence, third.localSequence], [1, 2, 3]);
  const restarted = build();
  const fourth = await restarted.enqueue(orderInput(SCOPE_A2, "k4"));
  assert.equal(fourth.localSequence, 4);
  assert.deepEqual((await restarted.getOutbox(SCOPE_A1)).map((entry) => entry.localSequence), [1, 3]);
});

test("dos enqueue concurrentes nunca repiten secuencia", async () => {
  const { engine, storage } = rig();
  const entries = await Promise.all([1, 2, 3, 4, 5].map((n) => engine.enqueue(orderInput(n % 2 === 0 ? SCOPE_A1 : SCOPE_B1, `c${n}`))));
  assert.deepEqual(entries.map((entry) => entry.localSequence), [1, 2, 3, 4, 5]);
  assert.equal(new Set(entries.map((entry) => entry.eventId)).size, 5);
  assert.equal(storage.persistCount, 5);
});

test("un estado hidratado con secuencia repetida o retrocedida se rechaza", async () => {
  const { engine, storage, build } = rig();
  await engine.enqueue(orderInput(SCOPE_A1, "s1"));
  await engine.enqueue(orderInput(SCOPE_A1, "s2"));
  const raw = structuredClone(storage.rawState(DEVICE)) as { lastLocalSequence: number; outbox: { localSequence: number }[] };

  const repeated = structuredClone(raw);
  repeated.outbox[1]!.localSequence = 1;
  storage.seedRaw(DEVICE, repeated);
  await expectCode(build().init(), "SEQUENCE_REGRESSION");

  const regressed = structuredClone(raw);
  regressed.lastLocalSequence = 1;
  storage.seedRaw(DEVICE, regressed);
  await expectCode(build().enqueue(orderInput(SCOPE_A1, "s3")), "SEQUENCE_REGRESSION");

  storage.seedRaw(DEVICE, { garbage: true });
  await expectCode(build().init(), "STATE_CORRUPT");
  storage.seedRaw(DEVICE, raw);
  assert.equal((await build().enqueue(orderInput(SCOPE_A1, "s3"))).localSequence, 3);
});

test("replica, outbox y secuencia se escriben en una sola persist", async () => {
  const { engine, storage } = rig();
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "atomic", { replicaSnapshot: { note: "local" } }));
  assert.equal(storage.persistCount, 1);
  const stored = storage.rawState(DEVICE) as { lastLocalSequence: number; outbox: unknown[]; replica: { snapshot: unknown; pendingEventId: string }[] };
  assert.equal(stored.lastLocalSequence, 1);
  assert.equal(stored.outbox.length, 1);
  assert.deepEqual(stored.replica[0]?.snapshot, { note: "local" });
  assert.equal(stored.replica[0]?.pendingEventId, entry.eventId);
});

test("si persist falla no queda nada escrito y la secuencia no avanza", async () => {
  const { engine, storage } = rig();
  storage.failNextPersist();
  await expectCode(engine.enqueue(orderInput(SCOPE_A1, "fails")), "STORAGE_COMMIT_FAILED");
  assert.equal(storage.rawState(DEVICE), null);
  assert.deepEqual(await engine.getOutbox(SCOPE_A1), []);
  assert.deepEqual(await engine.listReplica(SCOPE_A1), []);
  const retried = await engine.enqueue(orderInput(SCOPE_A1, "fails"));
  assert.equal(retried.localSequence, 1);
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 1);
});

test("un lease sending vencido tras reinicio vuelve a pending y se reenvia", async () => {
  const { engine, storage, server, clock, build } = rig({ leaseMs: 1_000 });
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "lease"));
  const stuck: SyncTransportPort = { push: () => new Promise<unknown>(() => undefined), pull: () => Promise.resolve(null) };
  const crashing = build({ transport: stuck });
  void crashing.push(SCOPE_A1);
  const claimed = (await crashing.getOutbox(SCOPE_A1))[0];
  assert.equal(claimed?.localState, "sending");
  assert.equal(claimed?.leaseUntil, clock.now + 1_000);
  assert.equal((storage.rawState(DEVICE) as { outbox: { localState: string }[] }).outbox[0]?.localState, "sending");

  const restarted = build();
  assert.equal((await restarted.push(SCOPE_A1)).sent, 0, "live lease is respected");
  clock.advance(1_001);
  const outcome = await restarted.push(SCOPE_A1);
  assert.equal(outcome.sent, 1);
  const [after] = await restarted.getOutbox(SCOPE_A1);
  assert.equal(after?.localState, "accepted");
  assert.equal(after?.eventId, entry.eventId);
  assert.notEqual(after?.attemptId, claimed?.attemptId);
  assert.equal(server.effects.length, 1);
});

test("retry_wait aplica backoff, persiste retryCount y termina en manual_review al llegar al limite", async () => {
  const { engine, storage, server, clock } = rig();
  await engine.enqueue(orderInput(SCOPE_A1, "backoff"));
  server.pushError = new SyncTransportError("UNAVAILABLE", true);
  const delays = [1_000, 2_000, 4_000];
  for (const [index, delay] of delays.entries()) {
    const start = clock.now;
    const outcome = await engine.push(SCOPE_A1);
    assert.equal(outcome.failureCode, "UNAVAILABLE");
    const [entry] = await engine.getOutbox(SCOPE_A1);
    assert.equal(entry?.localState, "retry_wait");
    assert.equal(entry?.retryCount, index + 1);
    assert.equal(entry?.nextAttemptAt, start + delay);
    assert.equal((storage.rawState(DEVICE) as { outbox: { retryCount: number }[] }).outbox[0]?.retryCount, index + 1);
    assert.equal((await engine.push(SCOPE_A1)).sent, 0, "not due yet");
    clock.advance(delay);
  }
  const final = await engine.push(SCOPE_A1);
  assert.equal(final.sent, 0);
  const [entry] = await engine.getOutbox(SCOPE_A1);
  assert.equal(entry?.localState, "manual_review");
  assert.equal(entry?.lastErrorCode, "RETRY_LIMIT");
  assert.equal(server.pushRequests.length, 3);
});

test("el backoff es determinista, usa jitter inyectable y valida opciones", () => {
  const plain = createExponentialBackoff({ baseMs: 1_000, maxMs: 10_000, jitterRatio: 0.5 });
  const first = plain.nextDelayMs({ retryCount: 1, eventId: id(1) });
  assert.equal(first, plain.nextDelayMs({ retryCount: 1, eventId: id(1) }));
  assert.ok(first >= 500 && first <= 1_000);
  const fixed = createExponentialBackoff({ baseMs: 1_000, maxMs: 10_000, jitterRatio: 0.5, jitter: () => 0.5 });
  assert.equal(fixed.nextDelayMs({ retryCount: 2, eventId: id(1) }), 1_500);
  assert.equal(fixed.nextDelayMs({ retryCount: 20, eventId: id(1) }), 7_500);
  assert.throws(() => createExponentialBackoff({ baseMs: 0 }), RangeError);
  assert.throws(() => createExponentialBackoff({ jitterRatio: 2 }), RangeError);
});

test("un error de transporte no retryable manda el lote a manual_review", async () => {
  const { engine, server } = rig();
  await engine.enqueue(orderInput(SCOPE_A1, "fatal"));
  server.pushError = new SyncTransportError("PAYLOAD_REFUSED", false);
  await engine.push(SCOPE_A1);
  const [entry] = await engine.getOutbox(SCOPE_A1);
  assert.equal(entry?.localState, "manual_review");
  assert.equal(entry?.lastErrorCode, "PAYLOAD_REFUSED");
  assert.equal(entry?.retryCount, 0);
});

test("push devuelve un resultado por evento y un evento sin resultado queda en retry_wait MISSING_RESULT", async () => {
  const { engine, server } = rig();
  const a = await engine.enqueue(orderInput(SCOPE_A1, "p1"));
  const b = await engine.enqueue(orderInput(SCOPE_A1, "p2"));
  const c = await engine.enqueue(orderInput(SCOPE_A1, "p3"));
  server.omitResults.add(b.eventId);
  const outcome = await engine.push(SCOPE_A1);
  assert.equal(outcome.sent, 3);
  const entries = await engine.getOutbox(SCOPE_A1);
  assert.deepEqual(entries.map((entry) => entry.localState), ["accepted", "retry_wait", "accepted"]);
  assert.equal(entries[1]?.lastErrorCode, "MISSING_RESULT");
  assert.deepEqual(entries.map((entry) => entry.retryCount), [0, 1, 0]);
  assert.equal(outcome.pullRecommended, true);
  assert.deepEqual(outcome.events.map((event) => event.eventId), [a.eventId, b.eventId, c.eventId]);
});

test("rejected, conflict y manual_review del servidor se mapean con su codigo", async () => {
  const { engine, server } = rig();
  const events = [] as string[];
  for (const key of ["m1", "m2", "m3"]) events.push((await engine.enqueue(orderInput(SCOPE_A1, key))).eventId);
  server.pushCodeOverride.set(events[0]!, { status: "rejected", code: "VALIDATION_FAILED" });
  server.pushCodeOverride.set(events[1]!, { status: "manual_review", code: "AMBIGUOUS_PAYMENT" });
  server.conflictEntities.add((await engine.getOutbox(SCOPE_A1))[2]!.entityId);
  await engine.push(SCOPE_A1);
  const entries = await engine.getOutbox(SCOPE_A1);
  assert.deepEqual(entries.map((entry) => [entry.localState, entry.lastErrorCode]), [
    ["rejected", "VALIDATION_FAILED"], ["manual_review", "AMBIGUOUS_PAYMENT"], ["conflict", "STALE_BASE_VERSION"],
  ]);
  assert.equal(entries.every((entry) => entry.retryCount === 0), true);
  assert.equal((await engine.push(SCOPE_A1)).sent, 0, "terminal and blocking entries are never resent");
});

test("el lote respeta el orden de localSequence, el tamano maximo y un solo scope", async () => {
  const { engine, server } = rig({ maxBatchSize: 2 });
  await engine.enqueue(orderInput(SCOPE_A1, "b1"));
  await engine.enqueue(orderInput(SCOPE_B1, "b2"));
  await engine.enqueue(orderInput(SCOPE_A1, "b3"));
  await engine.enqueue(orderInput(SCOPE_A1, "b4"));
  await engine.push(SCOPE_A1);
  const [first] = server.pushRequests;
  assert.deepEqual(first?.events.map((event) => event.localSequence), [1, 3]);
  assert.equal(first?.events.every((event) => event.restaurantId === SCOPE_A1.restaurantId && event.branchId === SCOPE_A1.branchId), true);
  assert.equal(first?.events.every((event) => event.localState === "sending"), true);
  await engine.push(SCOPE_A1);
  assert.deepEqual(server.pushRequests[1]?.events.map((event) => event.localSequence), [4]);
  assert.equal((await engine.getOutbox(SCOPE_B1))[0]?.localState, "pending");
});

test("retryCount solo sube en los eventos del lote que fallo", async () => {
  const { engine, server } = rig();
  await engine.enqueue(orderInput(SCOPE_A1, "r1"));
  await engine.enqueue(orderInput(SCOPE_B1, "r2"));
  server.pushError = new SyncTransportError("UNAVAILABLE", true);
  await engine.push(SCOPE_A1);
  assert.equal((await engine.getOutbox(SCOPE_A1))[0]?.retryCount, 1);
  assert.equal((await engine.getOutbox(SCOPE_B1))[0]?.retryCount, 0);
  assert.equal((await engine.getOutbox(SCOPE_B1))[0]?.localState, "pending");
});

test("timeout tras el commit del servidor y reenvio del mismo eventId termina en duplicate sin efecto doble", async () => {
  const { engine, server, clock } = rig();
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "pay-1"));
  server.timeoutAfterCommit = 1;
  await engine.push(SCOPE_A1);
  assert.equal((await engine.getOutbox(SCOPE_A1))[0]?.localState, "retry_wait");
  assert.equal(server.effects.length, 1);
  clock.advance(1_000);
  const outcome = await engine.push(SCOPE_A1);
  const [after] = await engine.getOutbox(SCOPE_A1);
  assert.equal(after?.localState, "duplicate");
  assert.equal(after?.outcome?.canonicalVersion, 1);
  assert.equal(after?.outcome?.auditId, `audit-${entry.eventId}`);
  assert.equal(after?.retryCount, 1);
  assert.equal(server.effects.length, 1);
  assert.equal(outcome.pullRecommended, true);
  assert.deepEqual(server.pushRequests.map((request) => request.events[0]?.eventId), [entry.eventId, entry.eventId]);
  assert.deepEqual(server.pushRequests.map((request) => request.events[0]?.idempotencyKey), ["pay-1", "pay-1"]);
  assert.equal(await engine.getPullCursor(SCOPE_A1), null, "push never advances the pull cursor");
});

test("reutilizar idempotencyKey con otra huella falla y con la misma devuelve el evento existente", async () => {
  const { engine, storage } = rig();
  const base = orderInput(SCOPE_A1, "idem");
  const original = await engine.enqueue({ ...base, payload: { a: 1, b: 2 } });
  const persisted = storage.persistCount;
  const again = await engine.enqueue({ ...base, payload: { b: 2, a: 1 } });
  assert.equal(again.eventId, original.eventId);
  assert.equal(storage.persistCount, persisted);
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 1);
  await expectCode(engine.enqueue({ ...base, payload: { a: 1, b: 3 } }), "IDEMPOTENCY_KEY_REUSE");
  await expectCode(engine.enqueue({ ...base, payload: { a: 1, b: 2 }, entityId: id(0xf0f0) }), "IDEMPOTENCY_KEY_REUSE");
  await expectCode(engine.enqueue({ ...base, payload: { a: 1, b: 2 }, entityType: "Ticket" }), "IDEMPOTENCY_KEY_REUSE");
  await expectCode(engine.enqueue({ ...base, payload: { a: 1, b: 2 }, operation: "update", baseVersion: 0 }), "IDEMPOTENCY_KEY_REUSE");
  const otherScope = await engine.enqueue({ ...base, scope: SCOPE_B1, payload: { a: 9 } });
  assert.notEqual(otherScope.eventId, original.eventId);
  assert.equal(otherScope.localSequence, 2);
});

test("enqueue valida entradas con errores de dominio y respeta reglas de entidad", async () => {
  const { engine } = rig();
  await expectCode(engine.enqueue(null as unknown as EnqueueInput), "INPUT_INVALID");
  await expectCode(engine.enqueue({ ...orderInput(SCOPE_A1, "v1"), scope: { restaurantId: "x", branchId: "y" } }), "SCOPE_INVALID");
  await expectCode(engine.enqueue({ ...orderInput(SCOPE_A1, "v2"), actorId: "nobody" }), "ENVELOPE_INVALID");
  await expectCode(engine.enqueue({ ...orderInput(SCOPE_A1, "v3"), payload: { cvv: "123" } }), "PAYLOAD_SENSITIVE_DATA");
  await expectCode(engine.enqueue({ ...orderInput(SCOPE_A1, "v4"), operation: "update" }), "ENVELOPE_INVALID");
  const created = await engine.enqueue(orderInput(SCOPE_A1, "v5"));
  await expectCode(engine.enqueue({ ...orderInput(SCOPE_A1, "v6"), entityId: created.entityId }), "ENTITY_EXISTS");
  const update = await engine.enqueue({ ...orderInput(SCOPE_A1, "v7"), entityId: created.entityId, operation: "update", payload: { note: "u" } });
  assert.equal(update.baseVersion, 0);
  assert.equal((await engine.getReplicaEntity(SCOPE_A1, "Order", created.entityId))?.pendingEventId, update.eventId);
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 2);
});

test("aislamiento: restaurantes y sucursales del mismo dispositivo no se cruzan en outbox, replica, resumen ni push", async () => {
  const { engine, server } = rig();
  const a1 = await engine.enqueue(orderInput(SCOPE_A1, "iso-a1"));
  await engine.enqueue(orderInput(SCOPE_A2, "iso-a2"));
  await engine.enqueue(orderInput(SCOPE_B1, "iso-b1"));
  for (const [scope, own] of [[SCOPE_A1, "iso-a1"], [SCOPE_A2, "iso-a2"], [SCOPE_B1, "iso-b1"]] as const) {
    const outbox = await engine.getOutbox(scope);
    assert.deepEqual(outbox.map((entry) => entry.idempotencyKey), [own]);
    assert.equal(outbox.every((entry) => entry.restaurantId === scope.restaurantId && entry.branchId === scope.branchId), true);
    const replica = await engine.listReplica(scope);
    assert.equal(replica.length, 1);
    assert.equal(replica.every((entity) => entity.restaurantId === scope.restaurantId && entity.branchId === scope.branchId), true);
    assert.equal((await engine.getStatusSummary(scope)).counts.pending, 1);
  }
  assert.equal(await engine.getReplicaEntity(SCOPE_B1, "Order", a1.entityId), null);
  await engine.push(SCOPE_A1);
  assert.deepEqual(server.pushRequests.map((request) => request.scope), [SCOPE_A1]);
  assert.deepEqual(server.pushRequests[0]?.events.map((event) => event.idempotencyKey), ["iso-a1"]);
  assert.equal((await engine.getStatusSummary(SCOPE_A2)).counts.pending, 1);
  assert.equal((await engine.getStatusSummary(SCOPE_B1)).counts.accepted, 0);
});

test("DEVICE_REVOKED bloquea enqueue y push del scope y manda eventos de pago a manual_review", async () => {
  const { engine, server } = rig({ maxBatchSize: 1 });
  const order = await engine.enqueue(orderInput(SCOPE_A1, "rev-order"));
  const payment = await engine.enqueue({ ...orderInput(SCOPE_A1, "rev-payment"), entityType: "Payment", payload: { amountMinor: 1050, currency: "MXN" } });
  const cash = await engine.enqueue({ ...orderInput(SCOPE_A1, "rev-cash"), entityType: "CashMovement" });
  const other = await engine.enqueue({ ...orderInput(SCOPE_B1, "rev-other"), entityType: "Payment" });
  server.pushError = new SyncTransportError("DEVICE_REVOKED", false);
  const outcome = await engine.push(SCOPE_A1);
  assert.equal(outcome.revoked, true);
  const entries = await engine.getOutbox(SCOPE_A1);
  const byId = new Map(entries.map((entry) => [entry.eventId, entry]));
  assert.equal(byId.get(order.eventId)?.localState, "pending", "non financial work is kept, not sent");
  assert.equal(byId.get(payment.eventId)?.localState, "manual_review");
  assert.equal(byId.get(cash.eventId)?.localState, "manual_review");
  assert.equal(byId.get(payment.eventId)?.lastErrorCode, "DEVICE_REVOKED");
  assert.equal((await engine.getStatusSummary(SCOPE_A1)).scopeStatus, "revoked");
  await expectCode(engine.enqueue(orderInput(SCOPE_A1, "rev-new")), "SCOPE_REVOKED");
  await expectCode(engine.push(SCOPE_A1), "SCOPE_REVOKED");
  await expectCode(engine.pull(SCOPE_A1), "SCOPE_REVOKED");
  server.pushError = null;
  assert.equal((await engine.push(SCOPE_B1)).sent, 1, "other scopes keep working");
  assert.equal((await engine.getOutbox(SCOPE_B1)).find((entry) => entry.eventId === other.eventId)?.localState, "accepted");
});

test("un resultado AUTH_REVOKED del servidor revoca el scope y lleva el pago a manual_review", async () => {
  const { engine, server } = rig();
  const payment = await engine.enqueue({ ...orderInput(SCOPE_A1, "auth-pay"), entityType: "Payment" });
  const order = await engine.enqueue(orderInput(SCOPE_A1, "auth-order"));
  server.pushCodeOverride.set(payment.eventId, { status: "rejected", code: "AUTH_REVOKED" });
  server.pushCodeOverride.set(order.eventId, { status: "rejected", code: "AUTH_REVOKED" });
  const outcome = await engine.push(SCOPE_A1);
  assert.equal(outcome.revoked, true);
  const entries = await engine.getOutbox(SCOPE_A1);
  assert.deepEqual(entries.map((entry) => entry.localState), ["manual_review", "rejected"]);
  await expectCode(engine.enqueue(orderInput(SCOPE_A1, "auth-new")), "SCOPE_REVOKED");
});

test("conflict bloquea los eventos posteriores de la misma entidad y una resolucion los libera", async () => {
  const { engine, server } = rig({ maxBatchSize: 1 });
  const entityX = id(0x7001);
  const create = await engine.enqueue({ ...orderInput(SCOPE_A1, "x-create"), entityId: entityX });
  const update1 = await engine.enqueue({ ...orderInput(SCOPE_A1, "x-update-1"), entityId: entityX, operation: "update" });
  const update2 = await engine.enqueue({ ...orderInput(SCOPE_A1, "x-update-2"), entityId: entityX, operation: "update" });
  const free = await engine.enqueue({ ...orderInput(SCOPE_A1, "y-create"), entityId: id(0x7002) });
  server.conflictEntities.add(entityX);
  await engine.push(SCOPE_A1);
  assert.equal((await engine.getOutbox(SCOPE_A1))[0]?.localState, "conflict");

  await engine.push(SCOPE_A1);
  assert.deepEqual(server.pushRequests[1]?.events.map((event) => event.eventId), [free.eventId], "only the unrelated entity is sent");
  let summary = await engine.getStatusSummary(SCOPE_A1);
  assert.equal(summary.blockedPending, 2);
  assert.equal(summary.needsAttention, 1);
  const blocked = (await engine.getOutbox(SCOPE_A1)).filter((entry) => entry.entityId === entityX && entry.localState === "pending");
  assert.deepEqual(blocked.map((entry) => entry.blockedBy), [create.eventId, create.eventId]);
  assert.equal((await engine.push(SCOPE_A1)).sent, 0);

  const resolver = await engine.enqueue({ ...orderInput(SCOPE_A1, "x-compensate"), entityId: entityX, operation: "compensate" });
  await expectCode(engine.resolveBlockingEvent(SCOPE_A1, create.eventId, id(0xdead)), "RESOLUTION_INVALID");
  await expectCode(engine.resolveBlockingEvent(SCOPE_A1, create.eventId, free.eventId), "RESOLUTION_INVALID");
  await expectCode(engine.resolveBlockingEvent(SCOPE_A1, update1.eventId, resolver.eventId), "RESOLUTION_INVALID");
  server.conflictEntities.clear();
  await engine.resolveBlockingEvent(SCOPE_A1, create.eventId, resolver.eventId);
  await engine.push(SCOPE_A1);
  assert.deepEqual(server.pushRequests[2]?.events.map((event) => event.eventId), [update1.eventId]);
  summary = await engine.getStatusSummary(SCOPE_A1);
  assert.equal(summary.needsAttention, 0);
  assert.equal(summary.blockedPending, 0);
  await engine.push(SCOPE_A1);
  await engine.push(SCOPE_A1);
  assert.deepEqual((await engine.getOutbox(SCOPE_A1)).map((entry) => entry.localState), ["conflict", "accepted", "accepted", "accepted", "accepted"]);
  assert.equal(update2.entityId, entityX);
});

test("un evento manual_review del servidor tambien bloquea a los posteriores de su entidad", async () => {
  const { engine, server } = rig({ maxBatchSize: 1 });
  const entityX = id(0x7101);
  const first = await engine.enqueue({ ...orderInput(SCOPE_A1, "mr-1"), entityId: entityX });
  await engine.enqueue({ ...orderInput(SCOPE_A1, "mr-2"), entityId: entityX, operation: "update" });
  server.pushCodeOverride.set(first.eventId, { status: "manual_review", code: "AMBIGUOUS" });
  await engine.push(SCOPE_A1);
  const outcome = await engine.push(SCOPE_A1);
  assert.equal(outcome.sent, 0);
  assert.equal((await engine.getOutbox(SCOPE_A1))[1]?.blockedBy, first.eventId);
});

test("el resumen expone codigos y contadores, no frases de UI", async () => {
  const { engine } = rig();
  assert.equal((await engine.getStatusSummary(SCOPE_A1)).scopeStatus, "unregistered");
  await engine.enqueue(orderInput(SCOPE_A1, "sum-1"));
  const summary = await engine.getStatusSummary(SCOPE_A1);
  assert.deepEqual(Object.keys(summary).sort(), ["awaitingPush", "blockedPending", "counts", "hasPullCursor", "needsAttention", "scope", "scopeStatus"]);
  assert.equal(summary.awaitingPush, 1);
  assert.equal(summary.scopeStatus, "active");
  assert.equal(/\s/u.test(JSON.stringify([summary.scopeStatus, ...Object.keys(summary.counts)])), false);
});

test("envelopes, snapshots y estado hidratado quedan profundamente congelados", async () => {
  const { engine, build } = rig();
  const source = { lines: [{ qty: 1 }] };
  const entry = await engine.enqueue({ ...orderInput(SCOPE_A1, "frozen"), payload: source });
  source.lines[0]!.qty = 99;
  assert.deepEqual(entry.payload, { lines: [{ qty: 1 }] });
  const restarted = build();
  const [hydrated] = await restarted.getOutbox(SCOPE_A1);
  const replica = (await restarted.listReplica(SCOPE_A1))[0];
  for (const frozen of [entry, entry.payload, hydrated, hydrated?.payload, replica, replica?.snapshot]) {
    assert.equal(Object.isFrozen(frozen), true);
  }
  assert.throws(() => { (hydrated as { retryCount: number }).retryCount = 9; }, TypeError);
});

test("el generador por defecto produce UUID distintos y el motor funciona sin ids inyectados", async () => {
  const generator = createRandomIdGenerator();
  const first = generator.uuid();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.notEqual(first, generator.uuid());
  const engine = new DeviceSyncEngine({ deviceId: DEVICE, storage: new InMemorySyncStorage(), transport: new FakeServer() });
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "default-ids"));
  assert.equal(entry.localSequence, 1);
  assert.notEqual(entry.eventId, "");
});
