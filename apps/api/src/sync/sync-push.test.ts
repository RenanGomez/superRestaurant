import assert from "node:assert/strict";
import test from "node:test";

import { SyncPushService } from "./sync-push.service.js";
import { SyncMergeExecutor } from "./sync-merge-executor.js";
import { parseSyncEnvelopeV1 } from "@super-restaurant/shared-types";
import type { TransactionalDatabaseClientPort } from "../database.js";

const restaurantId = "44444444-4444-4444-8444-444444444444";
const branchId = "55555555-5555-4555-8555-555555555555";
const deviceId = "22222222-2222-4222-8222-222222222222";
const event = {
  eventId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "key-1", deviceId,
  actorId: "33333333-3333-4333-8333-333333333333", restaurantId, branchId,
  entityType: "Order", entityId: "66666666-6666-4666-8666-666666666666", operation: "create",
  schemaVersion: "1", localSequence: 1, baseVersion: null, occurredAt: "2026-11-23T00:00:00.000Z",
  receivedAt: null, payload: {}, retryCount: 0, localState: "pending",
};
const request = { protocolVersion: 1, deviceId, scope: { restaurantId, branchId }, events: [event] };

test("an omitted transient event is retried on the next push", async () => {
  let attempts = 0;
  let applied = 0;
  const logs: string[] = [];
  const service = new SyncPushService({ execute: async (_token, item) => {
    attempts += 1;
    if (attempts === 1) return null;
    applied += 1;
    return { eventId: item.eventId, idempotencyKey: item.idempotencyKey, status: "accepted", code: null, canonicalVersion: 1, auditId: null };
  } }, { omitted: (facts) => { logs.push(facts.code); } });
  assert.deepEqual((await service.push("token", request)).results, []);
  assert.equal(applied, 0);
  assert.equal((await service.push("token", request)).results[0]?.status, "accepted");
  assert.equal(applied, 1);
  assert.deepEqual(logs, ["TRANSIENT_RETRY"]);
});

test("a mismatched batch scope is rejected before execution", async () => {
  let called = false;
  const service = new SyncPushService({ execute: async () => { called = true; return null; } }, { omitted: () => undefined });
  await assert.rejects(service.push("token", { ...request, scope: { restaurantId, branchId: "77777777-7777-4777-8777-777777777777" } }));
  assert.equal(called, false);
});

test("a transient failure stops later events from advancing the device sequence", async () => {
  const attempted: string[] = [];
  const omitted: string[] = [];
  const service = new SyncPushService({ execute: async (_token, item) => {
    attempted.push(item.eventId);
    throw Object.assign(new Error("lock timeout"), { code: "55P03" });
  } }, { omitted: (facts) => { omitted.push(facts.code); } });
  const later = { ...event, eventId: "77777777-7777-4777-8777-777777777777", idempotencyKey: "key-2", localSequence: 2 };
  assert.deepEqual((await service.push("token", { ...request, events: [event, later] })).results, []);
  assert.deepEqual(attempted, [event.eventId]);
  assert.deepEqual(omitted, ["CONCURRENT_RETRY", "DEVICE_SEQUENCE_BLOCKED"]);
});

test("executor checks membership and device before processing an event", async () => {
  const parsed = parseSyncEnvelopeV1(event);
  assert.ok(parsed);
  let checks = 0;
  let state = { authorized: true, allowed: true, device: "revoked" };
  const database: TransactionalDatabaseClientPort = {
    query: async () => { throw new Error("unexpected pool query"); },
    transaction: async (operation) => operation({ query: async (sql) => { if (sql.startsWith("SET LOCAL")) return { rows: [] }; checks += 1; return { rows: [state] }; } }),
  };
  const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: event.actorId }) });
  assert.equal((await executor.execute("token", parsed))?.code, "DEVICE_REVOKED");
  state = { authorized: false, allowed: false, device: "unknown" };
  assert.equal((await executor.execute("token", parsed))?.code, "AUTH_REVOKED");
  assert.equal(checks, 2);
});

test("rejections travel with their own code and the reason stays in the structured log", async (t) => {
  const logged: string[] = [];
  t.mock.method(console, "info", (line: string) => { logged.push(line); });
  let state = { authorized: true, allowed: true, device: "unknown" };
  const database: TransactionalDatabaseClientPort = {
    query: async () => { throw new Error("unexpected pool query"); },
    transaction: async (operation) => operation({ query: async (sql) => {
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      return { rows: [state] };
    } }),
  };
  const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: event.actorId }) });
  const parsed = parseSyncEnvelopeV1(event);
  assert.ok(parsed);
  const token = "secret-token-should-never-be-logged";
  assert.equal((await executor.execute(token, parsed))?.code, "DEVICE_UNKNOWN");
  state = { authorized: true, allowed: true, device: "revoked" };
  assert.equal((await executor.execute(token, parsed))?.code, "DEVICE_REVOKED");
  const mismatched = { ...parsed, actorId: "99999999-9999-4999-8999-999999999999" };
  assert.equal((await executor.execute(token, mismatched))?.code, "ACTOR_MISMATCH");

  const records = logged.map((line) => JSON.parse(line) as Record<string, string>);
  assert.deepEqual(
    records.map((record) => [record.code, record.reason]),
    [["DEVICE_UNKNOWN", "DEVICE_UNKNOWN"], ["DEVICE_REVOKED", "DEVICE_REVOKED"], ["ACTOR_MISMATCH", "ACTOR_MISMATCH"]],
  );
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ["branchId", "code", "correlationId", "deviceId", "eventId", "reason", "restaurantId"]);
    assert.equal(record.eventId, parsed.eventId);
    assert.equal(record.deviceId, parsed.deviceId);
    assert.equal(record.restaurantId, parsed.restaurantId);
    assert.equal(record.branchId, parsed.branchId);
    assert.match(record.correlationId ?? "", /^[0-9a-f-]{36}$/u);
  }
  assert.ok(logged.every((line) => !line.includes(token)), "the access token never reaches the log");
});

test("unsupported events are recorded as permanent rejections and do not block the batch", async () => {
  const recorded: string[] = [];
  const database: TransactionalDatabaseClientPort = {
    query: async () => { throw new Error("unexpected pool query"); },
    transaction: async (operation) => operation({ query: async (sql, params) => {
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      if (sql.includes("sync_authorized")) return { rows: [{ authorized: true, allowed: true, device: "active" }] };
      if (sql.includes("sync_record_event")) {
        const candidate = JSON.parse(String(params[2])) as { code: string };
        recorded.push(candidate.code);
        return { rows: [{ result: { status: "recorded", result: candidate } }] };
      }
      throw new Error("unexpected query");
    } }),
  };
  const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: event.actorId }) });
  const entities = ["Payment", "CashMovement", "CashRegisterSession", "Refund", "OrderDiscount"] as const;
  for (const entityType of entities) {
    const parsed = parseSyncEnvelopeV1({ ...event, entityType });
    assert.ok(parsed);
    assert.equal((await executor.execute("token", parsed))?.code, "UNSUPPORTED_ENTITY");
  }
  const unsupportedOrder = parseSyncEnvelopeV1({ ...event, operation: "update", baseVersion: 1 });
  assert.ok(unsupportedOrder);
  assert.equal((await executor.execute("token", unsupportedOrder))?.code, "UNSUPPORTED_OPERATION");
  assert.deepEqual(recorded, [...entities.map(() => "UNSUPPORTED_ENTITY"), "UNSUPPORTED_OPERATION"]);
  const service = new SyncPushService(executor, { omitted: () => { throw new Error("unexpected omission"); } });
  const second = { ...event, eventId: "77777777-7777-4777-8777-777777777777", idempotencyKey: "key-2", localSequence: 2 };
  const response = await service.push("token", { ...request, events: [{ ...event, entityType: "Payment" }, second] });
  assert.deepEqual(response.results.map((result) => result.code), ["UNSUPPORTED_ENTITY", "UNSUPPORTED_OPERATION"]);
});

test("executor preserves ledger deduplication, reuse and sequence results without persisting again", async () => {
  const parsed = parseSyncEnvelopeV1({ ...event, operation: "transition", baseVersion: 1, payload: { targetStatus: "open" } });
  assert.ok(parsed);
  let reply: unknown = { status: "duplicate", result: { status: "accepted", code: null, canonicalVersion: 1, auditId: null } };
  let persists = 0;
  const database: TransactionalDatabaseClientPort = {
    query: async () => { throw new Error("unexpected pool query"); },
    transaction: async (operation) => operation({ query: async (sql) => {
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      if (sql.includes("sync_authorized")) return { rows: [{ authorized: true, allowed: true, device: "active" }] };
      if (sql.includes("read_branch_operational_context")) return { rows: [{ result: { schemaVersion: 1, scope: { restaurantId, branchId }, roles: ["cashier"], timeZone: "America/Hermosillo" } }] };
      if (sql.includes("read_order")) return { rows: [{ result: null }] };
      if (sql.includes("sync_record_event")) return { rows: [{ result: reply }] };
      if (sql.includes("persist_order_mutation")) persists += 1;
      throw new Error("unexpected query");
    } }),
  };
  const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: event.actorId }) });
  assert.equal((await executor.execute("token", parsed))?.status, "duplicate");
  for (const code of ["EVENT_ID_REUSE", "IDEMPOTENCY_KEY_REUSE", "LOCAL_SEQUENCE_REUSE"]) {
    reply = { status: "rejected", code };
    assert.equal((await executor.execute("token", parsed))?.code, code);
  }
  reply = { status: "retry_wait", code: "SEQUENCE_OUT_OF_ORDER" };
  assert.equal(await executor.execute("token", parsed), null);
  assert.equal(persists, 0);
});

test("invalid IDs and forbidden or mismatched context are rejected through the ledger", async () => {
  let context: unknown = { schemaVersion: 1, scope: { restaurantId, branchId }, roles: ["cashier"], timeZone: "America/Hermosillo" };
  let catalog: unknown = { schemaVersion: 1, scope: { restaurantId, branchId }, catalog: null };
  let invalidLedger = false;
  const codes: string[] = [];
  const database: TransactionalDatabaseClientPort = {
    query: async () => { throw new Error("unexpected pool query"); },
    transaction: async (operation) => operation({ query: async (sql, params) => {
      if (sql.startsWith("SET LOCAL")) return { rows: [] };
      if (sql.includes("sync_authorized")) return { rows: [{ authorized: true, allowed: true, device: "active" }] };
      if (sql.includes("read_branch_operational_context")) return { rows: [{ result: context }] };
      if (sql.includes("get_menu_catalog")) return { rows: [{ state: catalog }] };
      if (sql.includes("sync_record_event")) {
        const candidate = JSON.parse(String(params[2])) as { code: string };
        codes.push(candidate.code);
        if (invalidLedger) return { rows: [{ result: { status: "rejected" } }] };
        return { rows: [{ result: { status: "recorded", result: candidate } }] };
      }
      throw new Error("unexpected query");
    } }),
  };
  const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: event.actorId }) });
  const valid = parseSyncEnvelopeV1({ ...event, payload: { channel: "counter", currency: "MXN", timeZone: "America/Hermosillo" } });
  assert.ok(valid);
  assert.equal((await executor.execute("token", { ...valid, entityId: "01arz3ndektsv4rrffq69g5fav" }))?.code, "INVALID_PAYLOAD");
  invalidLedger = true;
  assert.equal((await executor.execute("token", { ...valid, entityId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }))?.code, "INVALID_PAYLOAD");
  invalidLedger = false;
  context = null;
  assert.equal((await executor.execute("token", valid))?.code, "AUTH_REVOKED");
  context = { schemaVersion: 1, scope: { restaurantId, branchId }, roles: ["cashier"], timeZone: "UTC" };
  assert.equal((await executor.execute("token", valid))?.code, "TIMEZONE_MISMATCH");
  context = { schemaVersion: 1, scope: { restaurantId, branchId }, roles: ["cashier"], timeZone: "America/Hermosillo" };
  catalog = null;
  assert.equal((await executor.execute("token", valid))?.code, "AUTH_REVOKED");
  catalog = { schemaVersion: 1, scope: { restaurantId, branchId }, catalog: null };
  assert.equal(await executor.execute("token", valid), null);
  assert.deepEqual(codes, ["INVALID_PAYLOAD", "INVALID_PAYLOAD", "AUTH_REVOKED", "TIMEZONE_MISMATCH", "AUTH_REVOKED"]);
});
