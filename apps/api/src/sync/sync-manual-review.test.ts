import assert from "node:assert/strict";
import test from "node:test";
import { SyncManualReviewService } from "./sync-manual-review.service.js";
import type { TransactionalDatabaseClientPort } from "../database.js";
const actor = "33333333-3333-4333-8333-333333333333";
const scope = { restaurantId: "44444444-4444-4444-8444-444444444444", branchId: "55555555-5555-4555-8555-555555555555" };
const command = { schemaVersion: 1, scope, caseId: "66666666-6666-4666-8666-666666666666", decision: "reject", reason: "duplicate", compensatingEventId: null, idempotencyKey: "request-1", deviceId: "22222222-2222-4222-8222-222222222222", occurredAt: "2026-11-23T00:00:00.000Z" };
test("review resolution preserves idempotency and rejects revocation", async () => {
  let outcome = "resolved";
  const db: TransactionalDatabaseClientPort = { query: async () => { throw Error("unexpected"); }, transaction: async (f) => f({ query: async () => ({ rows: [{ result: outcome }] }) }) };
  const service = new SyncManualReviewService(db);
  assert.equal((await service.resolve(actor, command)).status, "resolved");
  outcome = "duplicate"; assert.equal((await service.resolve(actor, command)).status, "duplicate");
  outcome = "denied"; await assert.rejects(service.resolve(actor, command));
  outcome = "idempotency_conflict"; await assert.rejects(service.resolve(actor, command));
});
test("historical review without facts remains visible and resolvable", async () => {
  const row = { case_data: { case_id: command.caseId, event_id: "77777777-7777-4777-8777-777777777777", reason_code: "PAYMENT_UNCERTAIN", status: "open", opened_at: "2026-11-23T00:00:00.000Z", resolved_at: null, resolved_by_actor_id: null, resolution_reason: null, compensating_event_id: null }, event_data: { idempotency_key: "old-key", device_id: command.deviceId, actor_id: actor, entity_type: "Payment", entity_id: "88888888-8888-4888-8888-888888888888", operation: "compensate", financial: true, result: {} }, facts: null };
  const db: TransactionalDatabaseClientPort = { query: async () => { throw Error("unexpected"); }, transaction: async (f) => f({ query: async (sql) => ({ rows: sql.includes("sync_read_reviews") ? [row] : [{ result: "resolved" }] }) }) };
  const service = new SyncManualReviewService(db);
  const items = await service.list(actor, scope);
  assert.equal((items[0] as { factsAvailable: boolean }).factsAvailable, false);
  assert.equal((await service.resolve(actor, command)).status, "resolved");
});

test("resolution maps invalid and missing cases to 422 and 404", async () => {
  let outcome = "invalid";
  const db: TransactionalDatabaseClientPort = { query: async () => { throw Error("unexpected"); }, transaction: async (f) => f({ query: async () => ({ rows: [{ result: outcome }] }) }) };
  const service = new SyncManualReviewService(db);
  await assert.rejects(service.resolve(actor, command), (error: unknown) => (error as { getStatus(): number }).getStatus() === 422);
  outcome = "not_found";
  await assert.rejects(service.resolve(actor, command), (error: unknown) => (error as { getStatus(): number }).getStatus() === 404);
});
