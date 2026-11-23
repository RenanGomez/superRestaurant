import assert from "node:assert/strict";
import test from "node:test";

import { parseSyncEnvelopeV1 } from "@super-restaurant/shared-types";
import { syncLedgerResult } from "./sync-result.js";

const event = parseSyncEnvelopeV1({
  eventId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "key-1", deviceId: "22222222-2222-4222-8222-222222222222", actorId: "33333333-3333-4333-8333-333333333333",
  restaurantId: "44444444-4444-4444-8444-444444444444", branchId: "55555555-5555-4555-8555-555555555555", entityType: "Order", entityId: "66666666-6666-4666-8666-666666666666",
  operation: "create", schemaVersion: "1", localSequence: 1, baseVersion: null,
  occurredAt: "2026-11-23T00:00:00.000Z", receivedAt: null, payload: {}, retryCount: 0, localState: "pending",
});
if (event === undefined) throw new Error("INVALID_FIXTURE");

test("transient ledger outcomes are omitted", () => {
  assert.equal(syncLedgerResult(event, { status: "retry_wait", code: "SEQUENCE_OUT_OF_ORDER" }), null);
  assert.equal(syncLedgerResult(event, { status: "rejected", code: "CONCURRENT_RETRY" }), null);
});

test("replay uses the current request identifiers", () => {
  const actual = syncLedgerResult(event, { status: "duplicate", result: {
    eventId: "old-event", idempotencyKey: "old-key", status: "accepted", code: null, canonicalVersion: 1, auditId: null,
  } });
  assert.deepEqual(actual, { eventId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "key-1", status: "duplicate", code: null, canonicalVersion: 1, auditId: null });
});

test("a ledger denial does not invent a revocation reason", () => {
  assert.equal(syncLedgerResult(event, { status: "denied" })?.code, "ACTION_NOT_AUTHORIZED");
});
