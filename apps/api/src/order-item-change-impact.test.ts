import assert from "node:assert/strict";
import test from "node:test";

import {
  OrderItemChangeImpactApplicationError,
  projectOrderItemChangeImpact,
} from "./order-item-change-impact.js";

test("pending unpaid cancellation projects as eligible with standard authorization", () => {
  const impact = projectOrderItemChangeImpact({
    capturedAmountMinor: 0,
    inventoryCommitment: "none",
    itemStatus: "pending",
    operation: "cancel",
    orderStatus: "open",
    schemaVersion: 1,
  });
  assert.equal(impact.authorization, "standard");
  assert.equal(impact.execution, "eligible");
  assert.equal(impact.blockReason, null);
  assert.deepEqual(impact.policyDecisions, []);
  assert.equal(Object.isFrozen(impact), true);
});

test("sent replacement requires elevated authorization and a production correction", () => {
  const impact = projectOrderItemChangeImpact({
    capturedAmountMinor: 0,
    inventoryCommitment: "reserved",
    itemStatus: "sent",
    operation: "replace",
    orderStatus: "open",
    schemaVersion: 1,
  });
  assert.equal(impact.authorization, "elevated");
  assert.equal(impact.production, "correction_required");
  assert.equal(impact.inventory, "release_required");
  assert.equal(impact.replacementLineRequired, true);
  assert.equal(impact.execution, "eligible");
});

test("a change on a partially paid order is blocked pending financial compensation", () => {
  const impact = projectOrderItemChangeImpact({
    capturedAmountMinor: 15_900,
    inventoryCommitment: "consumed",
    itemStatus: "preparing",
    operation: "cancel",
    orderStatus: "partially_paid",
    schemaVersion: 1,
  });
  assert.equal(impact.execution, "blocked");
  assert.equal(impact.blockReason, "financial_compensation_required");
});

test("a delivered line requires a post-delivery adjustment instead of cancellation", () => {
  const impact = projectOrderItemChangeImpact({
    capturedAmountMinor: 0,
    inventoryCommitment: "unknown",
    itemStatus: "delivered",
    operation: "replace",
    orderStatus: "open",
    schemaVersion: 1,
  });
  assert.equal(impact.execution, "blocked");
  assert.equal(impact.blockReason, "post_delivery_adjustment_required");
});

test("resubmitting the same facts is idempotent and returns a bit-exact frozen result", () => {
  const request = {
    capturedAmountMinor: 0,
    inventoryCommitment: "none",
    itemStatus: "pending",
    operation: "cancel",
    orderStatus: "open",
    schemaVersion: 1,
  } as const;
  const first = projectOrderItemChangeImpact(request);
  const second = projectOrderItemChangeImpact(request);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(second), true);
});

test("the boundary never accepts a client-asserted authorization or destination decision", () => {
  const request = {
    authorization: "standard",
    capturedAmountMinor: 0,
    inventoryCommitment: "none",
    itemStatus: "sent",
    operation: "cancel",
    orderStatus: "open",
    schemaVersion: 1,
  };
  assert.throws(
    () => projectOrderItemChangeImpact(request),
    (error: unknown) => error instanceof OrderItemChangeImpactApplicationError && error.code === "request",
  );
});

test("hostile and malformed input maps to a request error", () => {
  for (const invalid of [
    {
      capturedAmountMinor: 0, inventoryCommitment: "none", itemStatus: "pending",
      operation: "invalid", orderStatus: "open", schemaVersion: 1,
    },
    {
      capturedAmountMinor: 0, inventoryCommitment: "none", itemStatus: "future_state",
      operation: "cancel", orderStatus: "open", schemaVersion: 1,
    },
    {
      capturedAmountMinor: -1, inventoryCommitment: "none", itemStatus: "pending",
      operation: "cancel", orderStatus: "open", schemaVersion: 1,
    },
    {
      capturedAmountMinor: 0, inventoryCommitment: "none", itemStatus: "pending",
      operation: "cancel", orderStatus: "open", schemaVersion: 2,
    },
    new Proxy(
      {
        capturedAmountMinor: 0, inventoryCommitment: "none", itemStatus: "pending",
        operation: "cancel", orderStatus: "open", schemaVersion: 1,
      },
      { ownKeys: () => { throw new Error("hostile"); } },
    ),
  ]) {
    assert.throws(
      () => projectOrderItemChangeImpact(invalid as never),
      (error: unknown) => error instanceof OrderItemChangeImpactApplicationError && error.code === "request",
    );
  }
});
