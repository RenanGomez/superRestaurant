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
test("historical review without facts fails closed", async () => {
  const db: TransactionalDatabaseClientPort = { query: async () => { throw Error("unexpected"); }, transaction: async (f) => f({ query: async () => ({ rows: [{ case_data: {}, event_data: {}, facts: null }] }) }) };
  await assert.rejects(new SyncManualReviewService(db).list(actor, scope));
});
