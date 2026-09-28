import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidCapturePaymentIntentError,
  buildCapturePaymentIntentProjection,
  deriveCapturePaymentIntentTiming,
} from "./index.js";

test("timing derives on_fulfillment for delivery and pickup, now for dine_in and counter", () => {
  assert.equal(deriveCapturePaymentIntentTiming("delivery"), "on_fulfillment");
  assert.equal(deriveCapturePaymentIntentTiming("pickup"), "on_fulfillment");
  assert.equal(deriveCapturePaymentIntentTiming("dine_in"), "now");
  assert.equal(deriveCapturePaymentIntentTiming("counter"), "now");
});

test("timing rejects a channel outside the known set", () => {
  assert.throws(
    () => deriveCapturePaymentIntentTiming("unknown" as never),
    InvalidCapturePaymentIntentError,
  );
});

test("projection totals items subtotal plus the frozen delivery fee, excluding tip", () => {
  const projection = buildCapturePaymentIntentProjection({
    currency: "MXN",
    deliveryFeeMinor: 3_000,
    fulfillmentChannel: "delivery",
    itemsSubtotalMinor: 12_500,
    method: "card_manual",
    tenderedAmountMinor: null,
    tipMinor: 2_000,
  });
  assert.equal(projection.orderTotalMinor, 15_500);
  assert.equal(projection.tipMinor, 2_000);
  assert.equal(projection.timing, "on_fulfillment");
  assert.equal(projection.status, "ready");
  assert.equal(projection.changeDueMinor, null);
  assert.equal(Object.isFrozen(projection), true);
});

test("cash tender exactly covering the total yields zero change and ready status", () => {
  const projection = buildCapturePaymentIntentProjection({
    currency: "MXN",
    deliveryFeeMinor: 0,
    fulfillmentChannel: "counter",
    itemsSubtotalMinor: 10_000,
    method: "cash",
    tenderedAmountMinor: 10_000,
    tipMinor: 0,
  });
  assert.equal(projection.status, "ready");
  assert.equal(projection.changeDueMinor?.amountMinor, 0);
  assert.equal(projection.timing, "now");
});

test("cash tender above the total yields the exact change, tip never entering the calculation", () => {
  const projection = buildCapturePaymentIntentProjection({
    currency: "MXN",
    deliveryFeeMinor: 1_500,
    fulfillmentChannel: "pickup",
    itemsSubtotalMinor: 8_500,
    method: "cash",
    tenderedAmountMinor: 20_000,
    tipMinor: 5_000,
  });
  assert.equal(projection.orderTotalMinor, 10_000);
  assert.equal(projection.changeDueMinor?.amountMinor, 10_000);
  assert.equal(projection.status, "ready");
});

test("cash tender below the total is insufficient and never reports a negative change", () => {
  const projection = buildCapturePaymentIntentProjection({
    currency: "MXN",
    deliveryFeeMinor: 0,
    fulfillmentChannel: "dine_in",
    itemsSubtotalMinor: 10_000,
    method: "cash",
    tenderedAmountMinor: 9_999,
    tipMinor: 0,
  });
  assert.equal(projection.status, "insufficient");
  assert.equal(projection.changeDueMinor, null);
});

test("a tendered amount is rejected for any method other than cash", () => {
  assert.throws(() => buildCapturePaymentIntentProjection({
    currency: "MXN",
    deliveryFeeMinor: 0,
    fulfillmentChannel: "counter",
    itemsSubtotalMinor: 1_000,
    method: "transfer",
    tenderedAmountMinor: 1_000,
    tipMinor: 0,
  }), InvalidCapturePaymentIntentError);
});

test("negative or non-integer money-shaped inputs are rejected", () => {
  const base = {
    currency: "MXN",
    deliveryFeeMinor: 0,
    fulfillmentChannel: "counter" as const,
    itemsSubtotalMinor: 1_000,
    method: "card_manual" as const,
    tenderedAmountMinor: null,
    tipMinor: 0,
  };
  for (const invalid of [
    { ...base, itemsSubtotalMinor: -1 },
    { ...base, deliveryFeeMinor: -1 },
    { ...base, tipMinor: -1 },
    { ...base, itemsSubtotalMinor: 1.5 },
    { ...base, method: "cash" as const, tenderedAmountMinor: -1 },
  ]) assert.throws(() => buildCapturePaymentIntentProjection(invalid), InvalidCapturePaymentIntentError);
});
