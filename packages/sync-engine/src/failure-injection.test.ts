// Failure-injection suite for OFFLINE_CAPABILITY_AND_CONFLICT_MATRIX §5 scenarios that apply to
// DeviceSyncEngine. These tests exercise crash/commit boundaries, transport faults, clock drift,
// legacy schema queues, capability pre-flight and safe compaction without changing engine code.
import assert from "node:assert/strict";
import test from "node:test";
import { createExponentialBackoff } from "./backoff.js";
import type { SyncPullRequest, SyncPushRequest, SyncPushResponse } from "./contract.js";
import { DeviceSyncEngine, type SyncEngineOptions, type SyncTransportPort } from "./engine.js";
import { SyncEngineError, SyncTransportError } from "./errors.js";
import { InMemorySyncStorage } from "./in-memory-storage.js";
import { createSchemaMigrationRegistry } from "./schema-migration.js";
import { DEVICE, FakeClock, FakeServer, SCOPE_A1, SCOPE_B1, SequentialIds, id, orderInput } from "./testkit.js";

interface Rig {
  readonly storage: InMemorySyncStorage;
  readonly server: FakeServer;
  readonly clock: FakeClock;
  readonly ids: SequentialIds;
  readonly engine: DeviceSyncEngine;
  readonly build: (extra?: Partial<SyncEngineOptions>) => DeviceSyncEngine;
}

function rig(overrides: Partial<SyncEngineOptions> = {}): Rig {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const clock = new FakeClock();
  const ids = new SequentialIds();
  const build = (extra: Partial<SyncEngineOptions> = {}): DeviceSyncEngine => new DeviceSyncEngine({
    deviceId: DEVICE,
    clientType: "web_pos",
    storage,
    transport: server,
    ids,
    clock,
    backoff: createExponentialBackoff({ baseMs: 1_000, maxMs: 8_000, maxRetries: 3, jitterRatio: 0 }),
    ...overrides,
    ...extra,
  });
  return { storage, server, clock, ids, engine: build(), build };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof SyncEngineError && error.code === code, code);
}

/** Replays every push request twice, emulating an at-least-once resend of the same batch. */
class ReplayingTransport implements SyncTransportPort {
  public constructor(private readonly inner: FakeServer) {}

  public async push(request: SyncPushRequest): Promise<unknown> {
    await this.inner.push(request);
    return this.inner.push(request);
  }

  public pull(request: SyncPullRequest): Promise<unknown> {
    return this.inner.pull(request);
  }
}

/** Returns server results in reverse order to prove the engine maps outcomes by eventId. */
class ReversedResultsTransport implements SyncTransportPort {
  public constructor(private readonly inner: FakeServer) {}

  public async push(request: SyncPushRequest): Promise<unknown> {
    const response = (await this.inner.push(request)) as SyncPushResponse;
    return { ...response, results: [...response.results].reverse() };
  }

  public pull(request: SyncPullRequest): Promise<unknown> {
    return this.inner.pull(request);
  }
}

// ---- Atomic local commit -------------------------------------------------------------------

test("caida antes del commit local no deja nada; despues del commit replica y outbox sobreviven atomicos al reinicio", async () => {
  const { engine, storage, build } = rig();

  // Crash before the single persist: neither replica nor outbox may exist.
  storage.failNextPersist();
  await expectCode(engine.enqueue(orderInput(SCOPE_A1, "atomic-crash")), "STORAGE_COMMIT_FAILED");
  assert.equal(storage.rawState(DEVICE), null);
  assert.deepEqual(await engine.getOutbox(SCOPE_A1), []);
  assert.deepEqual(await engine.listReplica(SCOPE_A1), []);

  // After the atomic commit, replica + outbox + sequence land together exactly once.
  const persistsBefore = storage.persistCount;
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "atomic-crash", { replicaSnapshot: { note: "local" } }));
  assert.equal(storage.persistCount - persistsBefore, 1, "replica, outbox and sequence commit in one persist");
  const stored = storage.rawState(DEVICE) as {
    lastLocalSequence: number;
    outbox: { eventId: string }[];
    replica: { pendingEventId: string; snapshot: unknown }[];
  };
  assert.equal(stored.lastLocalSequence, entry.localSequence);
  assert.equal(stored.outbox[0]?.eventId, entry.eventId);
  assert.equal(stored.replica[0]?.pendingEventId, entry.eventId);
  assert.deepEqual(stored.replica[0]?.snapshot, { note: "local" });

  // Simulated forced close: a fresh engine hydrates both parts atomically.
  const restarted = build();
  const [recoveredOutbox] = await restarted.getOutbox(SCOPE_A1);
  const [recoveredReplica] = await restarted.listReplica(SCOPE_A1);
  assert.equal(recoveredOutbox?.eventId, entry.eventId);
  assert.equal(recoveredReplica?.pendingEventId, entry.eventId);
  assert.deepEqual(recoveredReplica?.snapshot, { note: "local" });
  assert.equal((await restarted.enqueue(orderInput(SCOPE_A1, "after-crash"))).localSequence, entry.localSequence + 1);
});

// ---- Timeout after server commit -----------------------------------------------------------

test("timeout despues del commit del servidor se recupera con duplicate y sin segundo cobro", async () => {
  const { engine, server, clock } = rig();
  const payment = await engine.enqueue({
    ...orderInput(SCOPE_A1, "timeout-pay"),
    entityType: "Payment",
    payload: { amountMinor: 12_500, currency: "MXN", method: "cash" },
  });

  server.timeoutAfterCommit = 1;
  const first = await engine.push(SCOPE_A1);
  assert.equal(first.failureCode, "TIMEOUT");
  assert.equal(server.effects.length, 1, "the server committed exactly once before the timeout");
  let [entry] = await engine.getOutbox(SCOPE_A1);
  assert.equal(entry?.localState, "retry_wait");
  assert.equal(await engine.getPullCursor(SCOPE_A1), null, "push never advances the cursor");

  clock.advance(1_000);
  const second = await engine.push(SCOPE_A1);
  [entry] = await engine.getOutbox(SCOPE_A1);
  assert.deepEqual(
    [entry?.localState, entry?.outcome?.canonicalVersion, entry?.retryCount],
    ["duplicate", 1, 1],
  );
  assert.equal(entry?.eventId, payment.eventId);
  assert.equal(server.effects.length, 1, "same idempotency key does not charge twice");
  assert.equal(second.pullRecommended, true);
  assert.deepEqual(
    server.pushRequests.map((request) => request.events[0]?.idempotencyKey),
    ["timeout-pay", "timeout-pay"],
  );

  await engine.pull(SCOPE_A1);
  const replica = await engine.getReplicaEntity(SCOPE_A1, "Payment", payment.entityId);
  assert.equal(replica?.canonicalVersion, 1);
  assert.equal(replica?.pendingEventId, null);
});

// ---- Push accepted + failed pull -----------------------------------------------------------

test("push accepted con pull posterior fallido conserva pullCursor y el pull siguiente recupera cambios concurrentes", async () => {
  const { engine, server } = rig();
  server.inject(SCOPE_A1, {
    entityType: "Order",
    entityId: id(0x1a01),
    canonicalVersion: 1,
    tombstone: false,
    snapshot: { note: "seed" },
  });
  await engine.pull(SCOPE_A1);
  const cursor = await engine.getPullCursor(SCOPE_A1);
  assert.notEqual(cursor, null);

  const entry = await engine.enqueue(orderInput(SCOPE_A1, "accepted-pull-fail"));
  const push = await engine.push(SCOPE_A1);
  assert.equal(push.events[0]?.state, "accepted");
  assert.equal(push.pullRecommended, true);
  assert.equal(await engine.getPullCursor(SCOPE_A1), cursor, "accepted push does not move the cursor");

  server.pullError = new SyncTransportError("UNAVAILABLE", true);
  const failed = await engine.pull(SCOPE_A1);
  assert.deepEqual([failed.status, failed.code], ["failed", "UNAVAILABLE"]);
  assert.equal(await engine.getPullCursor(SCOPE_A1), cursor);
  assert.equal((await engine.getOutbox(SCOPE_A1))[0]?.localState, "accepted", "outbox stays terminal");

  // A concurrent change that was not in the push response must still arrive on the next pull.
  server.inject(SCOPE_A1, {
    entityType: "Order",
    entityId: id(0x1a02),
    canonicalVersion: 1,
    tombstone: false,
    snapshot: { note: "concurrent" },
  });
  server.pullError = null;
  const recovered = await engine.pull(SCOPE_A1);
  assert.equal(recovered.status, "complete");
  assert.notEqual(await engine.getPullCursor(SCOPE_A1), cursor);
  assert.deepEqual((await engine.getReplicaEntity(SCOPE_A1, "Order", id(0x1a02)))?.snapshot, { note: "concurrent" });
  assert.equal((await engine.getReplicaEntity(SCOPE_A1, "Order", entry.entityId))?.pendingEventId, null);
});

// ---- Replayed batches, out-of-order results ------------------------------------------------

test("repetir el mismo lote conserva un solo efecto, el ultimo estado es duplicate y la secuencia no se reutiliza", async () => {
  const { server, build } = rig();
  const engine = build({ transport: new ReplayingTransport(server) });
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "replay-batch"));

  const outcome = await engine.push(SCOPE_A1);
  assert.equal(outcome.events[0]?.state, "duplicate");
  assert.equal(server.effects.length, 1, "server dedup keeps a single effect");
  assert.equal(server.pushRequests.length, 2, "the replayed batch reached the server twice");
  assert.deepEqual(
    server.pushRequests.map((request) => request.events.map((event) => event.eventId)),
    [[entry.eventId], [entry.eventId]],
  );
  assert.deepEqual(
    server.pushRequests.map((request) => request.events[0]?.idempotencyKey),
    ["replay-batch", "replay-batch"],
  );

  const [after] = await engine.getOutbox(SCOPE_A1);
  assert.equal(after?.localState, "duplicate");
  assert.equal(after?.outcome?.canonicalVersion, 1);
  assert.equal(await engine.getPullCursor(SCOPE_A1), null);
  const next = await engine.enqueue(orderInput(SCOPE_A1, "after-replay"));
  assert.equal(next.localSequence, entry.localSequence + 1);
});

test("resultados fuera de orden se mapean por eventId y los huecos cross-scope no crean causalidad", async () => {
  const { server, build } = rig();
  const engine = build({ transport: new ReversedResultsTransport(server) });

  const first = await engine.enqueue(orderInput(SCOPE_A1, "ooo-a1"));
  const crossScope = await engine.enqueue(orderInput(SCOPE_B1, "ooo-b1"));
  const second = await engine.enqueue(orderInput(SCOPE_A1, "ooo-a2"));
  assert.deepEqual([first.localSequence, crossScope.localSequence, second.localSequence], [1, 2, 3]);

  const accepted = await engine.enqueue({ ...orderInput(SCOPE_A1, "ooo-ok"), entityId: id(0x2b01) });
  const rejected = await engine.enqueue({ ...orderInput(SCOPE_A1, "ooo-bad"), entityId: id(0x2b02) });
  server.pushCodeOverride.set(rejected.eventId, { status: "rejected", code: "VALIDATION_FAILED" });

  const outcome = await engine.push(SCOPE_A1);
  assert.equal(outcome.sent, 4);
  assert.deepEqual(
    server.pushRequests[0]?.events.map((event) => event.localSequence),
    [1, 3, 4, 5],
    "cross-scope gap (2) and response order do not change local sequence ordering",
  );

  const byId = new Map((await engine.getOutbox(SCOPE_A1)).map((entry) => [entry.eventId, entry]));
  assert.equal(byId.get(accepted.eventId)?.localState, "accepted");
  assert.equal(byId.get(rejected.eventId)?.localState, "rejected");
  assert.equal((await engine.getOutbox(SCOPE_B1))[0]?.localSequence, 2, "the other scope is untouched");
  assert.equal((await engine.push(SCOPE_A1)).sent, 0, "terminal events are never resent");
});

// ---- Concurrent resends --------------------------------------------------------------------

test("20 reenvios concurrentes del mismo lote producen un unico efecto", async () => {
  const { engine, server, clock } = rig();
  const entry = await engine.enqueue(orderInput(SCOPE_A1, "concurrent-20"));

  server.timeoutAfterCommit = 1;
  await engine.push(SCOPE_A1);
  assert.equal(server.effects.length, 1);
  clock.advance(2_000);

  const outcomes = await Promise.all(Array.from({ length: 20 }, () => engine.push(SCOPE_A1)));
  const sent = outcomes.filter((outcome) => outcome.sent > 0);
  assert.equal(sent.length, 1, "only one concurrent push claims the batch");
  assert.equal(sent[0]?.sent, 1);
  assert.equal(server.effects.length, 1, "20 resends still produce a single effect");
  assert.equal(server.pushRequests.length, 2, "initial timeout plus one resend reached the transport");

  const [after] = await engine.getOutbox(SCOPE_A1);
  assert.equal(after?.localState, "duplicate");
  assert.equal(after?.eventId, entry.eventId);
});

// ---- Clock manipulation --------------------------------------------------------------------

test("reloj y occurredAt manipulados no deciden el orden: manda localSequence y se conservan ambos tiempos", async () => {
  const { engine, server, clock } = rig();
  const future = "2099-12-31T23:59:59.000Z";
  const past = "2020-01-01T00:00:00.000Z";
  const early = await engine.enqueue({ ...orderInput(SCOPE_A1, "clock-early"), entityId: id(0x3c01), occurredAt: future });
  const late = await engine.enqueue({ ...orderInput(SCOPE_A1, "clock-late"), entityId: id(0x3c02), occurredAt: past });
  assert.deepEqual([early.localSequence, late.localSequence], [1, 2]);

  // A clock far in the past must neither reorder events nor reuse a sequence.
  clock.now = Date.UTC(1999, 0, 1);
  await engine.push(SCOPE_A1);
  assert.deepEqual(server.pushRequests[0]?.events.map((event) => event.localSequence), [1, 2]);
  assert.deepEqual(server.pushRequests[0]?.events.map((event) => event.occurredAt), [future, past], "client times preserved for audit");

  const next = await engine.enqueue(orderInput(SCOPE_A1, "clock-after"));
  assert.equal(next.localSequence, 3, "a backwards clock never reuses a sequence");
  assert.equal(next.occurredAt, new Date(clock.now).toISOString(), "the injected clock stamps the new event");
});

// ---- Legacy schemaVersion ------------------------------------------------------------------

test("schemaVersion atrasada detiene la hidratacion sin corromper la cola y solo migra lo compatible", async () => {
  const { storage, server, clock, ids } = rig();
  const writer = new DeviceSyncEngine({ deviceId: DEVICE, clientType: "web_pos", storage, transport: server, ids, clock });
  const order = await writer.enqueue(orderInput(SCOPE_A1, "legacy-order"));
  const payment = await writer.enqueue({
    ...orderInput(SCOPE_A1, "legacy-pay"),
    entityType: "Payment",
    payload: { amountMinor: 900, currency: "MXN" },
  });
  const raw = structuredClone(storage.rawState(DEVICE)) as { outbox: { eventId: string; schemaVersion: string }[] };
  for (const entry of raw.outbox) entry.schemaVersion = "0.9";
  storage.seedRaw(DEVICE, raw);
  const before = JSON.stringify(storage.rawState(DEVICE));

  // Without a migration path hydration stops; the rejected queue is never rewritten.
  const strict = new DeviceSyncEngine({ deviceId: DEVICE, storage, transport: server, ids, clock });
  await expectCode(strict.init(), "STATE_CORRUPT");
  assert.equal(JSON.stringify(storage.rawState(DEVICE)), before);

  const registry = createSchemaMigrationRegistry("1", [
    {
      fromVersion: "0.9",
      toVersion: "1",
      entityTypes: ["Order"],
      safeForFinancial: false,
      migratePayload: () => ({ note: "migrated" }),
    },
  ]);
  const upgraded = new DeviceSyncEngine({
    deviceId: DEVICE,
    clientType: "web_pos",
    storage,
    transport: server,
    ids,
    clock,
    schemaMigrations: registry,
  });
  await upgraded.init();
  assert.deepEqual(upgraded.getHydrationMigrationSummary(), { migratedCount: 1, quarantinedCount: 1 });

  const outbox = await upgraded.getOutbox(SCOPE_A1);
  const byId = new Map(outbox.map((entry) => [entry.eventId, entry]));
  assert.equal(outbox.length, 2, "the queue keeps both events; nothing is dropped");
  assert.equal(byId.get(order.eventId)?.schemaVersion, "1");
  assert.equal(byId.get(order.eventId)?.localState, "pending");
  assert.equal(byId.get(payment.eventId)?.localState, "manual_review");
  assert.equal(byId.get(payment.eventId)?.lastErrorCode, "SCHEMA_UNSUPPORTED");
  assert.equal(byId.get(payment.eventId)?.eventId, payment.eventId);

  const pushed = await upgraded.push(SCOPE_A1);
  assert.equal(pushed.sent, 1);
  assert.equal(pushed.events[0]?.eventId, order.eventId);
});

// ---- Large queue with backoff --------------------------------------------------------------

test("cola grande con backoff: progreso observable, orden monotono, limite de reintentos y recuperacion sin duplicados", async () => {
  const { engine, server, clock } = rig({
    maxBatchSize: 5,
    backoff: createExponentialBackoff({ baseMs: 1_000, maxMs: 8_000, maxRetries: 2, jitterRatio: 0 }),
  });
  const keys = Array.from({ length: 25 }, (_, index) => `bulk-${index}`);
  const entries = [];
  for (const key of keys) entries.push(await engine.enqueue(orderInput(SCOPE_A1, key)));
  assert.deepEqual(entries.map((entry) => entry.localSequence), Array.from({ length: 25 }, (_, index) => index + 1));

  server.pushError = new SyncTransportError("UNAVAILABLE", true);
  await engine.push(SCOPE_A1);
  let summary = await engine.getStatusSummary(SCOPE_A1);
  assert.equal(summary.counts.retry_wait, 5);
  assert.equal(summary.counts.pending, 20);
  const retry = (await engine.getOutbox(SCOPE_A1)).find((entry) => entry.retryCount > 0);
  assert.equal(retry?.nextAttemptAt, clock.now + 1_000);

  clock.advance(1_000);
  await engine.push(SCOPE_A1);
  assert.equal((await engine.getStatusSummary(SCOPE_A1)).counts.retry_wait, 5);

  // Reconnect: the exhausted batch is invalidated before sending, then the queue moves on to
  // the next pending batch, so progress never stalls behind a poison batch.
  clock.advance(2_000);
  server.pushError = null;
  const resumed = await engine.push(SCOPE_A1);
  assert.equal(resumed.sent, 5);
  summary = await engine.getStatusSummary(SCOPE_A1);
  assert.equal(summary.counts.manual_review, 5);
  assert.equal(summary.counts.accepted, 5);
  assert.equal(summary.counts.pending, 15);
  assert.equal(summary.needsAttention, 5);

  let guard = 0;
  while ((await engine.getStatusSummary(SCOPE_A1)).counts.pending > 0 && guard < 10) {
    await engine.push(SCOPE_A1);
    guard += 1;
  }
  summary = await engine.getStatusSummary(SCOPE_A1);
  assert.equal(summary.counts.accepted, 20);
  assert.equal(summary.counts.manual_review, 5);
  assert.equal(server.effects.length, 20, "no event is applied twice");
  assert.deepEqual(server.effects, keys.slice(5), "accepted events keep local sequence order");

  const acceptedSequences = (await engine.getOutbox(SCOPE_A1))
    .filter((entry) => entry.localState === "accepted")
    .map((entry) => entry.localSequence);
  assert.deepEqual(acceptedSequences, Array.from({ length: 20 }, (_, index) => index + 6));
});

// ---- Sensitive payloads --------------------------------------------------------------------

test("PAN, CVV y secretos se rechazan antes de encolar sin dejar evento huerfano", async () => {
  const { engine, storage } = rig();
  const persistsBefore = storage.persistCount;
  const payloads: readonly Record<string, unknown>[] = [
    { note: "4111111111111111" },
    { cardNumber: "4111111111111111" },
    { cvv: "123" },
    { nested: { clientSecret: "x" } },
    { password: "hunter2" },
    { token: "abc" },
  ];

  for (const [index, payload] of payloads.entries()) {
    await expectCode(
      engine.enqueue({ ...orderInput(SCOPE_A1, `sensitive-${index}`), payload }),
      "PAYLOAD_SENSITIVE_DATA",
    );
  }
  assert.equal(storage.persistCount, persistsBefore, "rejected payloads never commit");
  assert.equal(storage.rawState(DEVICE), null);
  assert.deepEqual(await engine.getOutbox(SCOPE_A1), []);
  assert.deepEqual(await engine.listReplica(SCOPE_A1), []);

  const safe = await engine.enqueue({ ...orderInput(SCOPE_A1, "safe-note"), payload: { note: "sin datos de tarjeta" } });
  assert.equal(safe.localSequence, 1, "the rejected attempts never consume a sequence");
  assert.equal((await engine.getOutbox(SCOPE_A1)).length, 1);
});

// ---- Capability pre-flight before enqueue --------------------------------------------------

test("operaciones no habilitadas por matriz se bloquean antes de encolar y canEnqueue no persiste", async () => {
  const { storage, clock } = rig();
  const mobileOffline = new DeviceSyncEngine({
    deviceId: DEVICE,
    clientType: "mobile",
    connectivity: "offline",
    storage,
    transport: new FakeServer(),
    ids: new SequentialIds(),
    clock,
  });
  const persistsBefore = storage.persistCount;

  const gatewayInput = {
    ...orderInput(SCOPE_A1, "cap-gateway"),
    entityType: "Payment",
    payload: { amountMinor: 500, currency: "MXN", method: "card_gateway" },
  } as const;
  const gateway = await mobileOffline.canEnqueue(gatewayInput);
  assert.equal(gateway.allowed, false);
  assert.equal(gateway.reasonCode, "PHASE3_UNSUPPORTED");
  await expectCode(mobileOffline.enqueue(gatewayInput), "CAPABILITY_BLOCKED");

  await expectCode(
    mobileOffline.enqueue({
      ...orderInput(SCOPE_A1, "cap-cash"),
      entityType: "Payment",
      payload: { amountMinor: 500, currency: "MXN", method: "cash" },
    }),
    "CAPABILITY_BLOCKED",
  );

  const remoteEditInput = {
    ...orderInput(SCOPE_A1, "cap-remote"),
    entityId: id(0x4d01),
    operation: "update",
    baseVersion: 1,
    preconditions: { originatedOnThisDevice: false },
  } as const;
  const remoteEdit = await mobileOffline.canEnqueue(remoteEditInput);
  assert.equal(remoteEdit.allowed, false);
  assert.equal(remoteEdit.reasonCode, "REMOTE_ORIGIN_OFFLINE_BLOCKED");
  await expectCode(mobileOffline.enqueue(remoteEditInput), "CAPABILITY_BLOCKED");

  const kds = new DeviceSyncEngine({
    deviceId: DEVICE,
    clientType: "kds",
    connectivity: "online",
    storage,
    transport: new FakeServer(),
    ids: new SequentialIds(),
    clock,
  });
  const kdsInput = orderInput(SCOPE_A1, "cap-kds");
  const kdsDecision = await kds.canEnqueue(kdsInput);
  assert.equal(kdsDecision.allowed, false);
  assert.equal(kdsDecision.reasonCode, "CLIENT_NOT_SUPPORTED");
  await expectCode(kds.enqueue(kdsInput), "CAPABILITY_BLOCKED");

  assert.equal(storage.persistCount, persistsBefore, "blocked operations are never queued");
  assert.deepEqual(await mobileOffline.getOutbox(SCOPE_A1), []);
});

// ---- Financial events are never purged -----------------------------------------------------

test("la compactacion nunca purga eventos financieros terminales aunque sean viejos y solo elimina el resto", async () => {
  const { engine, clock } = rig();
  const order = await engine.enqueue(orderInput(SCOPE_A1, "cmp-order"));
  const payment = await engine.enqueue({
    ...orderInput(SCOPE_A1, "cmp-payment"),
    entityType: "Payment",
    payload: { amountMinor: 1_000, currency: "MXN" },
  });
  const cash = await engine.enqueue({
    ...orderInput(SCOPE_A1, "cmp-cash"),
    entityType: "CashMovement",
    payload: { amountMinor: 500, currency: "MXN" },
  });
  const discount = await engine.enqueue({
    ...orderInput(SCOPE_A1, "cmp-discount"),
    entityType: "OrderDiscount",
    payload: { amountMinor: 100, currency: "MXN" },
  });
  await engine.push(SCOPE_A1);
  assert.deepEqual(
    (await engine.getOutbox(SCOPE_A1)).map((entry) => entry.localState),
    ["accepted", "accepted", "accepted", "accepted"],
  );

  clock.advance(24 * 60 * 60 * 1_000);
  const outcome = await engine.compact({ scope: SCOPE_A1, olderThanMs: clock.now });
  assert.deepEqual(
    [outcome.removedOutboxCount, outcome.retainedOutboxCount, outcome.skippedFinancialCount],
    [1, 3, 3],
  );
  assert.equal((await engine.getOutbox(SCOPE_A1)).some((entry) => entry.eventId === order.eventId), false);

  const remaining = await engine.getOutbox(SCOPE_A1);
  const remainingIds = new Set(remaining.map((entry) => entry.eventId));
  assert.equal(remainingIds.has(payment.eventId), true, "Payment is never purged");
  assert.equal(remainingIds.has(cash.eventId), true, "CashMovement is never purged");
  assert.equal(remainingIds.has(discount.eventId), true, "OrderDiscount is never purged");
  assert.deepEqual(remaining.map((entry) => entry.entityType).sort(), ["CashMovement", "OrderDiscount", "Payment"]);
});
