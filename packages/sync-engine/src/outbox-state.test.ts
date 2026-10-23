import assert from "node:assert/strict";
import test from "node:test";
import { OUTBOX_STATES, parseOutboxEntry, type OutboxEntry, type OutboxState } from "./contract.js";
import { SyncEngineError } from "./errors.js";
import { OUTBOX_TRANSITIONS, canTransition, isBlockingState, isTerminalState, transitionOutboxState, type OutboxEvent } from "./outbox-state.js";
import { ACTOR, DEVICE, id } from "./testkit.test.js";

function entryIn(state: OutboxState): OutboxEntry {
  const sending = state === "sending";
  const parsed = parseOutboxEntry({
    eventId: id(1), idempotencyKey: "k", deviceId: DEVICE, actorId: ACTOR, restaurantId: id(0xa0), branchId: id(0xa1),
    entityType: "Order", entityId: id(2), operation: "create", schemaVersion: "1", localSequence: 1, baseVersion: null,
    occurredAt: "2026-10-22T12:00:00.000Z", receivedAt: null, payload: { a: 1 }, retryCount: 0, localState: state,
    leaseUntil: sending ? 10 : null, attemptId: sending ? id(9) : null, nextAttemptAt: null, lastErrorCode: null,
    blockedBy: null, resolvedBy: null, outcome: null, updatedAt: 0,
  });
  if (!parsed.ok) throw new Error(`fixture invalid: ${parsed.field}`);
  return parsed.value;
}

const OUTCOME = { code: null, canonicalVersion: 1, auditId: null };

/** Event that attempts `from -> to`, using the dedicated transition per section 7.1. */
function eventFor(from: OutboxState, to: OutboxState): OutboxEvent | undefined {
  switch (to) {
    case "sending": return { type: "claim", attemptId: id(5), leaseUntil: 99, nowMs: 1 };
    case "pending": return { type: "lease_expired", nowMs: 1 };
    case "retry_wait": return { type: "retry", errorCode: "TIMEOUT", nextAttemptAt: 50, nowMs: 1 };
    case "manual_review":
      if (from === "conflict") return { type: "escalate", errorCode: "ESCALATED", nowMs: 1 };
      if (from === "sending") return { type: "result", status: "manual_review", outcome: OUTCOME, nowMs: 1 };
      return { type: "invalidate", errorCode: "LOCAL_INVALID", nowMs: 1 };
    default: return { type: "result", status: to, outcome: OUTCOME, nowMs: 1 };
  }
}

// Written independently from the implementation table, straight from section 7.1.
const ALLOWED: Readonly<Record<OutboxState, readonly OutboxState[]>> = {
  pending: ["sending", "manual_review"],
  sending: ["accepted", "duplicate", "rejected", "conflict", "manual_review", "retry_wait", "pending"],
  retry_wait: ["sending", "manual_review"],
  accepted: [], duplicate: [], rejected: [],
  conflict: ["manual_review"],
  manual_review: [],
};

test("la tabla de transiciones coincide con la seccion 7.1", () => {
  for (const from of OUTBOX_STATES) {
    assert.deepEqual([...OUTBOX_TRANSITIONS[from]].sort(), [...ALLOWED[from]].sort(), from);
  }
});

test("las 64 combinaciones estado a estado permiten solo lo que dice 7.1", () => {
  let allowed = 0;
  for (const from of OUTBOX_STATES) {
    for (const to of OUTBOX_STATES) {
      const event = eventFor(from, to);
      assert.ok(event);
      const expected = ALLOWED[from].includes(to);
      assert.equal(canTransition(from, to), expected, `${from}->${to}`);
      if (expected) {
        assert.equal(transitionOutboxState(entryIn(from), event).localState, to, `${from}->${to}`);
        allowed += 1;
      } else {
        assert.throws(() => transitionOutboxState(entryIn(from), event), SyncEngineError, `${from}->${to}`);
      }
    }
  }
  assert.equal(allowed, 12);
});

test("los estados terminales son inmutables ante cualquier evento", () => {
  const events: OutboxEvent[] = [
    { type: "claim", attemptId: id(5), leaseUntil: 9, nowMs: 1 },
    { type: "lease_expired", nowMs: 1 },
    { type: "retry", errorCode: "X", nextAttemptAt: 5, nowMs: 1 },
    { type: "result", status: "accepted", outcome: OUTCOME, nowMs: 1 },
    { type: "invalidate", errorCode: "X", nowMs: 1 },
    { type: "escalate", errorCode: "X", nowMs: 1 },
    { type: "block", blockedBy: id(3) },
    { type: "resolve", resolvedBy: id(4), nowMs: 1 },
  ];
  for (const state of ["accepted", "duplicate", "rejected"] as const) {
    assert.equal(isTerminalState(state), true);
    for (const event of events) {
      assert.throws(() => transitionOutboxState(entryIn(state), event), (error: unknown) => error instanceof SyncEngineError && error.code === "OUTBOX_TERMINAL_IMMUTABLE");
    }
  }
});

test("una transicion nunca altera identidad, scope, payload ni idempotencyKey", () => {
  const before = entryIn("sending");
  const after = transitionOutboxState(before, { type: "result", status: "accepted", outcome: OUTCOME, nowMs: 5 });
  for (const key of ["eventId", "idempotencyKey", "restaurantId", "branchId", "entityId", "payload", "localSequence"] as const) {
    assert.equal(after[key], before[key], key);
  }
  assert.equal(Object.isFrozen(after), true);
  assert.equal(before.localState, "sending");
});

test("conflict y manual_review requieren resolucion explicita y siguen bloqueando", () => {
  assert.equal(isBlockingState("conflict"), true);
  assert.equal(isBlockingState("manual_review"), true);
  const resolved = transitionOutboxState(entryIn("conflict"), { type: "resolve", resolvedBy: id(8), nowMs: 2 });
  assert.equal(resolved.localState, "conflict");
  assert.equal(resolved.resolvedBy, id(8));
  assert.throws(() => transitionOutboxState(entryIn("pending"), { type: "resolve", resolvedBy: id(8), nowMs: 2 }), SyncEngineError);
});

test("retry incrementa retryCount y claim limpia lease anterior", () => {
  const retried = transitionOutboxState(entryIn("sending"), { type: "retry", errorCode: "TIMEOUT", nextAttemptAt: 70, nowMs: 3 });
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.nextAttemptAt, 70);
  assert.equal(retried.attemptId, null);
  const claimed = transitionOutboxState(retried, { type: "claim", attemptId: id(6), leaseUntil: 100, nowMs: 80 });
  assert.equal(claimed.attemptId, id(6));
  assert.equal(claimed.leaseUntil, 100);
  assert.equal(claimed.retryCount, 1);
});
