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
    transaction: async (operation) => operation({ query: async () => { checks += 1; return { rows: [state] }; } }),
  };
  const executor = new SyncMergeExecutor(database, { verifyAccessToken: async () => ({ actorId: event.actorId }) });
  assert.equal((await executor.execute("token", parsed))?.code, "DEVICE_REVOKED");
  state = { authorized: false, allowed: false, device: "unknown" };
  assert.equal((await executor.execute("token", parsed))?.code, "AUTH_REVOKED");
  assert.equal(checks, 2);
});
