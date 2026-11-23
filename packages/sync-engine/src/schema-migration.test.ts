import assert from "node:assert/strict";
import test from "node:test";
import { DeviceSyncEngine } from "./engine.js";
import { SyncEngineError } from "./errors.js";
import { InMemorySyncStorage } from "./in-memory-storage.js";
import { createSchemaMigrationRegistry, migrateEnvelopeSchema } from "./schema-migration.js";
import { ACTOR, DEVICE, FakeClock, FakeServer, SCOPE_A1, SequentialIds, id, orderInput } from "./testkit.js";

function legacyEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: id(1),
    idempotencyKey: "legacy-k1",
    deviceId: DEVICE,
    actorId: ACTOR,
    restaurantId: SCOPE_A1.restaurantId,
    branchId: SCOPE_A1.branchId,
    entityType: "Order",
    entityId: id(2),
    operation: "create",
    schemaVersion: "0.9",
    localSequence: 1,
    baseVersion: null,
    occurredAt: "2026-10-22T12:00:00.000Z",
    receivedAt: null,
    payload: { oldNote: "sin cebolla" },
    retryCount: 0,
    localState: "pending",
    ...overrides,
  };
}

test("createSchemaMigrationRegistry rechaza rutas ambiguas y ciclos", () => {
  assert.throws(
    () => createSchemaMigrationRegistry("1", [
      { fromVersion: "0.8", toVersion: "0.9", safeForFinancial: false, migratePayload: ({ payload }) => payload },
      { fromVersion: "0.8", toVersion: "1", safeForFinancial: false, migratePayload: ({ payload }) => payload },
    ]),
    (error: unknown) => error instanceof SyncEngineError && error.code === "SCHEMA_MIGRATION_FAILED",
  );
  assert.throws(
    () => createSchemaMigrationRegistry("1", [
      { fromVersion: "0.8", toVersion: "0.9", safeForFinancial: false, migratePayload: ({ payload }) => payload },
      { fromVersion: "0.9", toVersion: "0.8", safeForFinancial: false, migratePayload: ({ payload }) => payload },
    ]),
    (error: unknown) => error instanceof SyncEngineError && error.code === "SCHEMA_MIGRATION_FAILED",
  );
});

test("migrateEnvelopeSchema migra en varios pasos de forma determinista preservando identidad, scope y auditoria", () => {
  const registry = createSchemaMigrationRegistry("1", [
    {
      fromVersion: "0.8",
      toVersion: "0.9",
      entityTypes: ["Order"],
      safeForFinancial: false,
      migratePayload: ({ payload }) => ({ oldNote: payload["legacyText"] ?? "", migratedStep: 1 }),
    },
    {
      fromVersion: "0.9",
      toVersion: "1",
      entityTypes: ["Order"],
      safeForFinancial: false,
      migratePayload: ({ payload }) => ({ note: payload["oldNote"] ?? "", versionTag: 1 }),
    },
  ]);

  const raw = legacyEnvelope({ schemaVersion: "0.8", payload: { legacyText: "mesa 4" } });
  const first = migrateEnvelopeSchema(raw, registry);
  const second = migrateEnvelopeSchema(raw, registry);
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  if (!first.ok) return;
  assert.equal(first.migratedFrom, "0.8");
  assert.deepEqual(first.appliedVersions, ["0.9", "1"]);
  assert.equal(first.envelope.schemaVersion, "1");
  assert.deepEqual(first.envelope.payload, { note: "mesa 4", versionTag: 1 });
  // Identity, scope, sequence and timestamps are untouched.
  assert.equal(first.envelope.eventId, raw["eventId"]);
  assert.equal(first.envelope.idempotencyKey, raw["idempotencyKey"]);
  assert.equal(first.envelope.actorId, raw["actorId"]);
  assert.equal(first.envelope.restaurantId, raw["restaurantId"]);
  assert.equal(first.envelope.branchId, raw["branchId"]);
  assert.equal(first.envelope.localSequence, 1);
  assert.equal(first.envelope.occurredAt, raw["occurredAt"]);
});

test("entidades financieras rechazan pasos sin safeForFinancial y requieren manual_review", () => {
  const unsafeRegistry = createSchemaMigrationRegistry("1", [
    {
      fromVersion: "0.9",
      toVersion: "1",
      safeForFinancial: false,
      migratePayload: ({ payload }) => ({ ...payload, migrated: true }),
    },
  ]);
  const res = migrateEnvelopeSchema(
    legacyEnvelope({
      entityType: "Payment",
      payload: { amountMinor: 1500, currency: "MXN" },
    }),
    unsafeRegistry,
  );
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "SCHEMA_UNSUPPORTED");
  assert.equal(res.requiresManualReview, true);

  const safeRegistry = createSchemaMigrationRegistry("1", [
    {
      fromVersion: "0.9",
      toVersion: "1",
      entityTypes: ["Payment"],
      safeForFinancial: true,
      migratePayload: ({ payload }) => ({ ...payload, method: "cash" }),
    },
  ]);
  const okRes = migrateEnvelopeSchema(
    legacyEnvelope({
      entityType: "Payment",
      payload: { amountMinor: 1500, currency: "MXN" },
    }),
    safeRegistry,
  );
  assert.equal(okRes.ok, true);
});

test("si un paso devuelve float o dato sensible la migracion falla cerrado", () => {
  const badFloat = createSchemaMigrationRegistry("1", [
    {
      fromVersion: "0.9",
      toVersion: "1",
      safeForFinancial: false,
      migratePayload: () => ({ total: 10.5 }),
    },
  ]);
  const res = migrateEnvelopeSchema(legacyEnvelope(), badFloat);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "SCHEMA_MIGRATION_FAILED");
});

test("hidratacion en DeviceSyncEngine migra compatibles, lleva incompatibles a manual_review y conserva terminales inmutables", async () => {
  const storage = new InMemorySyncStorage();
  const server = new FakeServer();
  const clock = new FakeClock();
  const ids = new SequentialIds();

  // Seed durable state via normal engine, then downgrade schemaVersion of entries in raw storage.
  const writer = new DeviceSyncEngine({ deviceId: DEVICE, storage, transport: server, ids, clock });
  const acceptedOrder = await writer.enqueue(orderInput(SCOPE_A1, "term-1"));
  await writer.push(SCOPE_A1);
  const pendingOrder = await writer.enqueue(orderInput(SCOPE_A1, "mig-order"));
  const pendingPayment = await writer.enqueue({
    ...orderInput(SCOPE_A1, "unsafe-pay"),
    entityType: "Payment",
    payload: { amountMinor: 2500, currency: "MXN" },
  });

  const raw = structuredClone(storage.rawState(DEVICE)) as {
    outbox: { eventId: string; schemaVersion: string; payload: Record<string, unknown> }[];
  };
  for (const entry of raw.outbox) {
    entry.schemaVersion = "0.9";
    if (entry.eventId === pendingOrder.eventId) entry.payload = { oldNote: "pendiente" };
  }
  storage.seedRaw(DEVICE, raw);

  const registry = createSchemaMigrationRegistry("1", [
    {
      fromVersion: "0.9",
      toVersion: "1",
      safeForFinancial: false,
      migratePayload: ({ payload }) => ({ note: payload["oldNote"] ?? "ok" }),
    },
  ]);

  const upgraded = new DeviceSyncEngine({
    deviceId: DEVICE,
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

  // Terminal entry kept immutable even with legacy schemaVersion.
  assert.equal(byId.get(acceptedOrder.eventId)?.localState, "accepted");
  assert.equal(byId.get(acceptedOrder.eventId)?.schemaVersion, "0.9");

  // Pending Order was migrated and can now push cleanly!
  assert.equal(byId.get(pendingOrder.eventId)?.schemaVersion, "1");
  assert.deepEqual(byId.get(pendingOrder.eventId)?.payload, { note: "pendiente" });
  assert.equal(byId.get(pendingOrder.eventId)?.localState, "pending");

  // Pending Payment was NOT silently transformed; quarantined to manual_review with SCHEMA_UNSUPPORTED.
  assert.equal(byId.get(pendingPayment.eventId)?.localState, "manual_review");
  assert.equal(byId.get(pendingPayment.eventId)?.lastErrorCode, "SCHEMA_UNSUPPORTED");

  const pushed = await upgraded.push(SCOPE_A1);
  assert.equal(pushed.sent, 1);
  assert.equal(pushed.events[0]?.eventId, pendingOrder.eventId);
  assert.equal(pushed.events[0]?.state, "accepted");
});
