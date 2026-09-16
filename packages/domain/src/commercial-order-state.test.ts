import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidCommercialOrderTransitionError,
  InvalidOrderPreparationStateError,
  ORDER_FULFILLMENT_CHANNELS,
  ORDER_SOURCE_CHANNELS,
  deriveOrderPreparationStatus,
  transitionCommercialOrder,
  type CommercialOrderStatusSnapshot,
} from "./index.js";

test("source and fulfillment channels are separate closed vocabularies", () => {
  assert.deepEqual(ORDER_SOURCE_CHANNELS, [
    "phone", "whatsapp_manual", "counter", "table", "self_service", "integration",
  ]);
  assert.deepEqual(ORDER_FULFILLMENT_CHANNELS, ["dine_in", "counter", "pickup", "delivery"]);
  assert.equal(Object.isFrozen(ORDER_SOURCE_CHANNELS), true);
  assert.equal(Object.isFrozen(ORDER_FULFILLMENT_CHANNELS), true);
});

test("commercial lifecycle does not encode kitchen, fulfillment or payment progress", () => {
  assert.equal(transitionCommercialOrder("draft", "confirmed"), "confirmed");
  assert.equal(transitionCommercialOrder("confirmed", "completed"), "completed");
  assert.throws(
    () => transitionCommercialOrder("completed", "confirmed"),
    (error: unknown) => error instanceof InvalidCommercialOrderTransitionError
      && error.code === "INVALID_COMMERCIAL_ORDER_TRANSITION",
  );
  assert.throws(
    () => transitionCommercialOrder("invalid" as never, "confirmed"),
    (error: unknown) => error instanceof InvalidCommercialOrderTransitionError,
  );

  const independent: CommercialOrderStatusSnapshot = Object.freeze({
    attention: "held",
    fulfillment: "scheduled",
    order: "confirmed",
    payment: "ambiguous",
    preparation: "partially_ready",
  });
  assert.equal(independent.order, "confirmed");
  assert.equal(independent.payment, "ambiguous");
});

test("preparation is projected from active item states without treating delivery as payment", () => {
  assert.equal(deriveOrderPreparationStatus([]), "not_sent");
  assert.equal(deriveOrderPreparationStatus(["pending", "pending"]), "not_sent");
  assert.equal(deriveOrderPreparationStatus(["sent", "pending"]), "queued");
  assert.equal(deriveOrderPreparationStatus(["preparing", "sent"]), "preparing");
  assert.equal(deriveOrderPreparationStatus(["ready", "preparing"]), "partially_ready");
  assert.equal(deriveOrderPreparationStatus(["ready", "delivered", "cancelled"]), "ready");
  assert.equal(deriveOrderPreparationStatus(["cancelled", "cancelled"]), "cancelled");
  assert.throws(
    () => deriveOrderPreparationStatus(["unknown" as never]),
    (error: unknown) => error instanceof InvalidOrderPreparationStateError,
  );
});
