import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidPaymentIntentError,
  Money,
  buildPaymentIntentQuote,
} from "./index.js";

test("cash tender quote calculates exact remaining balance and change without financial effects", () => {
  const quote = buildPaymentIntentQuote({
    capturedAmount: new Money(2_500, "MXN"),
    method: "cash",
    orderTotal: new Money(12_500, "MXN"),
    plannedAmount: new Money(10_000, "MXN"),
    tenderedAmount: new Money(20_000, "MXN"),
    timing: "on_fulfillment",
  });
  assert.equal(quote.remainingBeforePlan.amountMinor, 10_000);
  assert.equal(quote.remainingAfterPlan.amountMinor, 0);
  assert.equal(quote.changeDue?.amountMinor, 10_000);
  assert.equal(quote.timing, "on_fulfillment");
  assert.equal(Object.isFrozen(quote), true);
  assert.notEqual(quote.orderTotal, quote.remainingBeforePlan);
});

test("mixed plan exposes the outstanding amount after one intended part", () => {
  const quote = buildPaymentIntentQuote({
    capturedAmount: new Money(0, "MXN"),
    method: "card_manual",
    orderTotal: new Money(12_500, "MXN"),
    plannedAmount: new Money(5_000, "MXN"),
    tenderedAmount: null,
    timing: "now",
  });
  assert.equal(quote.remainingBeforePlan.amountMinor, 12_500);
  assert.equal(quote.remainingAfterPlan.amountMinor, 7_500);
  assert.equal(quote.changeDue, null);
});

test("cash without a tendered amount remains an intention with no invented change", () => {
  const quote = buildPaymentIntentQuote({
    capturedAmount: new Money(0, "MXN"), method: "cash", orderTotal: new Money(500, "MXN"),
    plannedAmount: new Money(500, "MXN"), tenderedAmount: null, timing: "now",
  });
  assert.equal(quote.changeDue, null);
});

test("quote rejects overpayment, insufficient tender and captured totals above the order", () => {
  const base = {
    capturedAmount: new Money(0, "MXN"), method: "cash" as const, orderTotal: new Money(1_000, "MXN"),
    plannedAmount: new Money(1_000, "MXN"), tenderedAmount: new Money(1_000, "MXN"), timing: "now" as const,
  };
  for (const invalid of [
    { ...base, plannedAmount: new Money(1_001, "MXN") },
    { ...base, tenderedAmount: new Money(999, "MXN") },
    { ...base, capturedAmount: new Money(1_001, "MXN") },
    { ...base, plannedAmount: new Money(0, "MXN") },
  ]) assert.throws(() => buildPaymentIntentQuote(invalid), InvalidPaymentIntentError);
});

test("quote rejects mixed currency and tendered amounts for non-cash methods", () => {
  const base = {
    capturedAmount: new Money(0, "MXN"), method: "transfer" as const, orderTotal: new Money(1_000, "MXN"),
    plannedAmount: new Money(1_000, "MXN"), tenderedAmount: null, timing: "now" as const,
  };
  assert.throws(() => buildPaymentIntentQuote({ ...base, plannedAmount: new Money(1_000, "USD") }), InvalidPaymentIntentError);
  assert.throws(() => buildPaymentIntentQuote({ ...base, tenderedAmount: new Money(1_000, "MXN") }), InvalidPaymentIntentError);
});

test("quote boundary rejects extra fields, accessors, prototypes and hostile proxies", () => {
  const valid = {
    capturedAmount: new Money(0, "MXN"), method: "cash" as const, orderTotal: new Money(1_000, "MXN"),
    plannedAmount: new Money(1_000, "MXN"), tenderedAmount: null, timing: "now" as const,
  };
  for (const invalid of [
    { ...valid, extra: true },
    Object.assign(Object.create({}), valid),
    Object.defineProperty({ ...valid }, "method", { get: () => "cash", enumerable: true }),
    new Proxy(valid, { ownKeys: () => { throw new Error("hostile"); } }),
  ]) {
    assert.throws(
      () => buildPaymentIntentQuote(invalid as never),
      (error: unknown) => error instanceof InvalidPaymentIntentError && error.code === "INVALID_PAYMENT_INTENT",
    );
  }
});
