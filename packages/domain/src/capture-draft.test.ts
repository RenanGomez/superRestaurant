import assert from "node:assert/strict";
import test from "node:test";

import {
  CaptureDraftConfirmationFactsRequiredError,
  CaptureDraftOwnershipError,
  InvalidCaptureDraftError,
  InvalidCaptureDraftOperationError,
  autosaveCaptureDraft,
  claimCaptureDraft,
  closeCaptureNoSale,
  confirmCaptureDraft,
  createCaptureDraft,
  holdCaptureDraft,
  resumeCaptureDraft,
  transferCaptureDraft,
  type CaptureAuditContext,
  type CaptureDraft,
} from "./index.js";

const input = Object.freeze({
  captureDraftId: "capture-1",
  restaurantId: "restaurant-1",
  branchId: "branch-1",
  folio: "C-0001",
});

function audit(actorId = "operator-1", suffix = "1"): CaptureAuditContext {
  return Object.freeze({
    eventId: `event-${suffix}`,
    idempotencyKey: `key-${suffix}`,
    actorId,
    deviceId: "device-1",
    occurredAt: "2026-09-15T12:00:00.000Z",
  });
}

test("create returns an immutable, claimed draft with inseparable audit evidence", () => {
  const result = createCaptureDraft(input, audit());

  assert.deepEqual(result.captureDraft, {
    ...input,
    state: "draft",
    attention: "claimed",
    ownerActorId: "operator-1",
  });
  assert.deepEqual(result.auditEvent, {
    schemaVersion: 1,
    ...audit(),
    type: "capture.created",
    captureDraftId: "capture-1",
    restaurantId: "restaurant-1",
    branchId: "branch-1",
    fromState: null,
    toState: "draft",
    fromAttention: null,
    toAttention: "claimed",
    ownerActorId: "operator-1",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.captureDraft), true);
  assert.equal(Object.isFrozen(result.auditEvent), true);
  assert.equal("version" in result.captureDraft, false);
  assert.equal("expectedVersion" in result.auditEvent, false);
  assert.equal("payment" in result.captureDraft, false);
  assert.equal("preparation" in result.captureDraft, false);
});

test("autosave snapshots source and fulfillment without mutating the previous draft", () => {
  const created = createCaptureDraft(input, audit()).captureDraft;
  const saved = autosaveCaptureDraft(created, Object.freeze({
    sourceChannel: "phone" as const,
    fulfillmentChannel: "pickup" as const,
  }), audit("operator-1", "2"));

  assert.equal(created.sourceChannel, undefined);
  assert.equal(saved.captureDraft.sourceChannel, "phone");
  assert.equal(saved.captureDraft.fulfillmentChannel, "pickup");
  assert.equal(saved.auditEvent.type, "capture.autosaved");
  assert.equal(saved.auditEvent.previousOwnerActorId, "operator-1");
  assert.equal(saved.auditEvent.ownerActorId, "operator-1");
  assert.equal(saved.auditEvent.sourceChannel, "phone");
  assert.equal(saved.auditEvent.fulfillmentChannel, "pickup");

  const cleared = autosaveCaptureDraft(saved.captureDraft, Object.freeze({ fulfillmentChannel: null }), audit("operator-1", "3"));
  assert.equal(cleared.captureDraft.sourceChannel, "phone");
  assert.equal(cleared.captureDraft.fulfillmentChannel, undefined);
  assert.equal(Object.hasOwn(cleared.captureDraft, "fulfillmentChannel"), false);
});

test("hold releases ownership and claim/resume acquire only available drafts", () => {
  const created = createCaptureDraft(input, audit()).captureDraft;
  const held = holdCaptureDraft(created, audit("operator-1", "2"));
  assert.equal(held.captureDraft.attention, "held");
  assert.equal(held.captureDraft.ownerActorId, undefined);
  assert.equal(held.auditEvent.previousOwnerActorId, "operator-1");
  assert.equal(held.auditEvent.ownerActorId, undefined);

  const claimed = claimCaptureDraft(held.captureDraft, audit("operator-2", "3"));
  assert.equal(claimed.captureDraft.ownerActorId, "operator-2");
  assert.equal(claimed.auditEvent.type, "capture.claimed");
  assert.throws(
    () => claimCaptureDraft(claimed.captureDraft, audit("operator-3", "4")),
    (error: unknown) => error instanceof InvalidCaptureDraftOperationError,
  );

  const heldAgain = holdCaptureDraft(claimed.captureDraft, audit("operator-2", "5")).captureDraft;
  const resumed = resumeCaptureDraft(heldAgain, audit("operator-2", "6"));
  assert.equal(resumed.captureDraft.attention, "claimed");
  assert.equal(resumed.captureDraft.ownerActorId, "operator-2");

  const unclaimed = Object.freeze({ ...heldAgain, attention: "unclaimed" as const });
  const claimedUnowned = claimCaptureDraft(unclaimed, audit("operator-3", "7"));
  assert.equal(claimedUnowned.captureDraft.ownerActorId, "operator-3");
  assert.throws(
    () => resumeCaptureDraft(unclaimed, audit("operator-3", "8")),
    (error: unknown) => error instanceof InvalidCaptureDraftOperationError,
  );
});

test("transfer requires current ownership and a distinct new owner", () => {
  const created = createCaptureDraft(input, audit()).captureDraft;
  const transferred = transferCaptureDraft(created, "operator-2", audit("operator-1", "2"));
  assert.equal(transferred.captureDraft.ownerActorId, "operator-2");
  assert.equal(transferred.auditEvent.previousOwnerActorId, "operator-1");
  assert.equal(transferred.auditEvent.ownerActorId, "operator-2");
  assert.throws(
    () => transferCaptureDraft(transferred.captureDraft, "operator-3", audit("operator-1", "3")),
    (error: unknown) => error instanceof CaptureDraftOwnershipError,
  );
  assert.throws(
    () => transferCaptureDraft(transferred.captureDraft, "operator-2", audit("operator-2", "4")),
    (error: unknown) => error instanceof InvalidCaptureDraftOperationError,
  );
});

test("confirm requires a claimed owner plus source and fulfillment and releases capture ownership", () => {
  const created = createCaptureDraft(input, audit()).captureDraft;
  assert.throws(
    () => confirmCaptureDraft(created, "order-1", audit()),
    (error: unknown) => error instanceof CaptureDraftConfirmationFactsRequiredError,
  );

  const ready = autosaveCaptureDraft(created, Object.freeze({
    sourceChannel: "phone" as const,
    fulfillmentChannel: "delivery" as const,
  }), audit("operator-1", "2")).captureDraft;
  const confirmed = confirmCaptureDraft(ready, "order-1", audit("operator-1", "3"));
  assert.equal(confirmed.captureDraft.state, "confirmed");
  assert.equal(confirmed.captureDraft.attention, "unclaimed");
  assert.equal(confirmed.captureDraft.ownerActorId, undefined);
  assert.equal(confirmed.captureDraft.sourceChannel, "phone");
  assert.equal(confirmed.captureDraft.fulfillmentChannel, "delivery");
  assert.equal(confirmed.captureDraft.confirmedOrderId, "order-1");
  assert.equal(confirmed.auditEvent.confirmedOrderId, "order-1");
  assert.throws(
    () => closeCaptureNoSale(confirmed.captureDraft, "duplicate", audit("operator-1", "4")),
    (error: unknown) => error instanceof InvalidCaptureDraftOperationError,
  );
});

test("no-sale requires the claimed owner and a reason before confirmation", () => {
  const created = createCaptureDraft(input, audit()).captureDraft;
  const held = holdCaptureDraft(created, audit("operator-1", "2")).captureDraft;
  assert.throws(
    () => closeCaptureNoSale(held, "Cliente desistió", audit("operator-2", "3")),
    (error: unknown) => error instanceof InvalidCaptureDraftOperationError,
  );
  assert.throws(
    () => closeCaptureNoSale(created, " ", audit("operator-1", "4")),
    (error: unknown) => error instanceof InvalidCaptureDraftError && error.field === "reason",
  );
  const reclaimed = claimCaptureDraft(held, audit("operator-2", "5")).captureDraft;
  const closed = closeCaptureNoSale(reclaimed, "Cliente desistió", audit("operator-2", "6"));
  assert.equal(closed.captureDraft.state, "no_sale");
  assert.equal(closed.captureDraft.attention, "unclaimed");
  assert.equal(closed.auditEvent.reason, "Cliente desistió");
  assert.equal("payment" in closed.captureDraft, false);
  assert.equal("preparation" in closed.captureDraft, false);
  assert.throws(
    () => claimCaptureDraft(closed.captureDraft, audit("operator-2", "7")),
    (error: unknown) => error instanceof InvalidCaptureDraftOperationError,
  );
});

test("ownership protects edits and hostile or mutable aggregate inputs fail closed", () => {
  const created = createCaptureDraft(input, audit()).captureDraft;
  assert.throws(
    () => autosaveCaptureDraft(created, Object.freeze({ sourceChannel: "phone" }), audit("intruder", "2")),
    (error: unknown) => error instanceof CaptureDraftOwnershipError,
  );

  const mutable = { ...created } as CaptureDraft;
  assert.throws(
    () => holdCaptureDraft(mutable, audit()),
    (error: unknown) => error instanceof InvalidCaptureDraftError && error.field === "aggregate",
  );

  let getterRead = false;
  const hostile = Object.freeze(Object.defineProperty({}, "captureDraftId", {
    enumerable: true,
    get() {
      getterRead = true;
      return "capture-1";
    },
  })) as CaptureDraft;
  assert.throws(
    () => holdCaptureDraft(hostile, audit()),
    (error: unknown) => error instanceof InvalidCaptureDraftError,
  );
  assert.equal(getterRead, false);
  assert.throws(
    () => createCaptureDraft(Object.freeze({ ...input, sourceChannel: "email" as never }), audit()),
    (error: unknown) => error instanceof InvalidCaptureDraftError && error.field === "sourceChannel",
  );
});
