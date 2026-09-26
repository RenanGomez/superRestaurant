import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidOrderItemChangeImpactError,
  assessOrderItemChangeImpact,
} from "./index.js";

test("pending unpaid changes are eligible without production or compensating effects", () => {
  const impact = assessOrderItemChangeImpact({
    capturedAmountMinor: 0,
    financialCompensationPending: false,
    inventoryCommitment: "none",
    itemStatus: "pending",
    operation: "cancel",
    orderStatus: "open",
  });
  assert.deepEqual(impact, {
    authorization: "standard",
    blockReason: null,
    execution: "eligible",
    financial: "none",
    inventory: "none",
    operation: "cancel",
    policyDecisions: [],
    production: "none",
    productionDestination: null,
    refundObligation: "none",
    reprintAvailable: false,
    replacementLineRequired: false,
  });
  assert.equal(Object.isFrozen(impact), true);
  assert.equal(Object.isFrozen(impact.policyDecisions), true);
});

test("sent replacement exposes correction, authorization and reserved inventory without selecting policy", () => {
  assert.deepEqual(assessOrderItemChangeImpact({
    capturedAmountMinor: 0,
    financialCompensationPending: false,
    inventoryCommitment: "reserved",
    itemStatus: "sent",
    operation: "replace",
    orderStatus: "open",
  }), {
    authorization: "elevated",
    blockReason: null,
    execution: "eligible",
    financial: "none",
    inventory: "release_required",
    operation: "replace",
    policyDecisions: ["authorization_role", "inventory_disposition"],
    production: "correction_required",
    productionDestination: "kds_primary",
    refundObligation: "none",
    reprintAvailable: true,
    replacementLineRequired: true,
  });
});

test("a partially paid cancellation with captured money remains eligible and only creates a refund obligation", () => {
  const impact = assessOrderItemChangeImpact({
    capturedAmountMinor: 15900,
    financialCompensationPending: false,
    inventoryCommitment: "consumed",
    itemStatus: "preparing",
    operation: "cancel",
    orderStatus: "partially_paid",
  });
  assert.equal(impact.execution, "eligible");
  assert.equal(impact.blockReason, null);
  assert.equal(impact.financial, "none");
  assert.equal(impact.refundObligation, "pending");
  assert.equal(impact.inventory, "compensation_required");
  assert.deepEqual(impact.policyDecisions, ["authorization_role", "inventory_disposition"]);
});

test("a fully paid order without captured money on this line still owes a refund obligation", () => {
  const impact = assessOrderItemChangeImpact({
    capturedAmountMinor: 0,
    financialCompensationPending: false,
    inventoryCommitment: "none",
    itemStatus: "pending",
    operation: "cancel",
    orderStatus: "paid",
  });
  assert.equal(impact.execution, "eligible");
  assert.equal(impact.refundObligation, "pending");
});

test("a change is blocked only when a compensation is already pending as an input fact", () => {
  const impact = assessOrderItemChangeImpact({
    capturedAmountMinor: 15900,
    financialCompensationPending: true,
    inventoryCommitment: "consumed",
    itemStatus: "preparing",
    operation: "cancel",
    orderStatus: "partially_paid",
  });
  assert.equal(impact.execution, "blocked");
  assert.equal(impact.blockReason, "financial_compensation_required");
  assert.equal(impact.financial, "compensation_required");
  assert.equal(impact.refundObligation, "pending");
  assert.deepEqual(impact.policyDecisions, [
    "authorization_role", "financial_atomicity", "inventory_disposition",
  ]);
});

test("delivered lines require a post-delivery adjustment instead of cancellation", () => {
  const impact = assessOrderItemChangeImpact({
    capturedAmountMinor: 0,
    financialCompensationPending: false,
    inventoryCommitment: "unknown",
    itemStatus: "delivered",
    operation: "replace",
    orderStatus: "open",
  });
  assert.equal(impact.execution, "blocked");
  assert.equal(impact.blockReason, "post_delivery_adjustment_required");
  assert.equal(impact.production, "post_delivery_adjustment_required");
  assert.equal(impact.productionDestination, "kds_primary");
  assert.equal(impact.reprintAvailable, true);
  assert.equal(impact.replacementLineRequired, true);
});

test("cancelled and terminal orders remain blocked", () => {
  assert.equal(assessOrderItemChangeImpact({
    capturedAmountMinor: 0, financialCompensationPending: false, inventoryCommitment: "none",
    itemStatus: "cancelled", operation: "cancel", orderStatus: "open",
  }).blockReason, "already_cancelled");
  assert.equal(assessOrderItemChangeImpact({
    capturedAmountMinor: 0, financialCompensationPending: false, inventoryCommitment: "none",
    itemStatus: "pending", operation: "cancel", orderStatus: "closed",
  }).blockReason, "order_terminal");
});

test("impact boundary rejects extra fields, accessors, hostile prototypes and invalid values", () => {
  const valid = {
    capturedAmountMinor: 0,
    financialCompensationPending: false,
    inventoryCommitment: "none",
    itemStatus: "pending",
    operation: "cancel",
    orderStatus: "draft",
  } as const;
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, capturedAmountMinor: -1 },
    { ...valid, capturedAmountMinor: 1.5 },
    { ...valid, financialCompensationPending: "false" },
    { ...valid, inventoryCommitment: "maybe" },
    Object.assign(Object.create({}), valid),
    Object.defineProperty({ ...valid }, "operation", { get: () => "cancel", enumerable: true }),
    new Proxy(valid, { ownKeys: () => { throw new Error("hostile"); } }),
  ]) {
    assert.throws(
      () => assessOrderItemChangeImpact(invalid as never),
      (error: unknown) => error instanceof InvalidOrderItemChangeImpactError
        && error.code === "INVALID_ORDER_ITEM_CHANGE_IMPACT",
    );
  }
});
