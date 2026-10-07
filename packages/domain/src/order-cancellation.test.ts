import assert from "node:assert/strict";
import test from "node:test";

import {
  assessOrderCancellation,
  InvalidOrderCancellationAssessmentError,
} from "./index.js";
import type { AssessOrderCancellationInput } from "./index.js";

function input(overrides: Partial<AssessOrderCancellationInput> = {}): AssessOrderCancellationInput {
  return {
    orderStatus: "open",
    items: [
      { orderItemId: "a", status: "pending" },
      { orderItemId: "b", status: "sent" },
      { orderItemId: "c", status: "ready" },
      { orderItemId: "d", status: "cancelled" },
    ],
    deliveryStatus: null,
    capturedAmountMinor: 0,
    ...overrides,
  };
}

test("an open order with kitchen lines is eligible: every live line is cancelled, kitchen lines get a correction", () => {
  assert.deepEqual(assessOrderCancellation(input()), {
    eligible: true,
    blockReason: null,
    refundObligation: "none",
    itemsToCancel: ["a", "b", "c"],
    itemsNeedingKitchenCorrection: ["b", "c"],
  });
});

test("captured money or a paid state never blocks: it creates a pending refund obligation", () => {
  assert.equal(assessOrderCancellation(input({ orderStatus: "partially_paid", capturedAmountMinor: 5000 })).refundObligation, "pending");
  assert.equal(assessOrderCancellation(input({ orderStatus: "paid", capturedAmountMinor: 0 })).refundObligation, "pending");
  assert.equal(assessOrderCancellation(input({ orderStatus: "open", capturedAmountMinor: 1 })).refundObligation, "pending");
  assert.equal(assessOrderCancellation(input({ orderStatus: "paid", capturedAmountMinor: 9000 })).eligible, true);
  assert.equal(assessOrderCancellation(input({ orderStatus: "draft" })).refundObligation, "none");
});

test("terminal states, an active delivery and delivered lines block with a reason and no consequences", () => {
  for (const [overrides, reason] of [
    [{ orderStatus: "cancelled" }, "already_cancelled"],
    [{ orderStatus: "closed" }, "closed"],
    [{ deliveryStatus: "assigned" }, "delivery_active"],
    [{ deliveryStatus: "en_route" }, "delivery_active"],
    [{ items: [{ orderItemId: "a", status: "delivered" }] }, "items_delivered"],
  ] as const) {
    const result = assessOrderCancellation(input(overrides as Partial<AssessOrderCancellationInput>));
    assert.equal(result.eligible, false);
    assert.equal(result.blockReason, reason);
    assert.deepEqual(result.itemsToCancel, []);
    assert.deepEqual(result.itemsNeedingKitchenCorrection, []);
  }
});

test("a failed, settled or delivered delivery row does not block; terminal order states win over delivery state", () => {
  for (const deliveryStatus of ["failed", "settled", "delivered"] as const) {
    assert.equal(assessOrderCancellation(input({ deliveryStatus })).eligible, true);
  }
  assert.equal(assessOrderCancellation(input({ orderStatus: "closed", deliveryStatus: "en_route" })).blockReason, "closed");
  assert.equal(assessOrderCancellation(input({ deliveryStatus: "en_route", items: [{ orderItemId: "a", status: "delivered" }] })).blockReason, "delivery_active");
});

test("the assessment is deeply frozen and fails closed on malformed input", () => {
  const result = assessOrderCancellation(input());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.itemsToCancel), true);
  for (const bad of [
    null,
    {},
    input({ orderStatus: "nope" as never }),
    input({ capturedAmountMinor: -1 }),
    input({ capturedAmountMinor: 1.5 }),
    input({ deliveryStatus: "lost" as never }),
    input({ items: [{ orderItemId: "a", status: "pending" }, { orderItemId: "a", status: "pending" }] }),
    input({ items: [{ orderItemId: " ", status: "pending" }] }),
    input({ items: [{ orderItemId: "a", status: "weird" as never }] }),
    input({ items: "x" as never }),
  ]) {
    assert.throws(() => assessOrderCancellation(bad as never), InvalidOrderCancellationAssessmentError);
  }
});
