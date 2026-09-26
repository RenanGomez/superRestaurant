import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidPaymentObligationError,
  Money,
  derivePaymentObligation,
} from "./index.js";

const money = (amountMinor: number, currency = "MXN") => new Money(amountMinor, currency);

test("unpaid and partial obligations expose only the authoritative remaining balance as collectible", () => {
  const unpaid = derivePaymentObligation({
    ambiguousAmount: money(0), capturedAmount: money(0), orderTotal: money(12_500), pendingAmount: money(0),
  });
  assert.equal(unpaid.paymentStatus, "unpaid");
  assert.equal(unpaid.collectibleAmount?.amountMinor, 12_500);
  const partial = derivePaymentObligation({
    ambiguousAmount: money(0), capturedAmount: money(5_000), orderTotal: money(12_500), pendingAmount: money(0),
  });
  assert.equal(partial.paymentStatus, "partially_paid");
  assert.equal(partial.remainingBalance.amountMinor, 7_500);
  assert.equal(partial.collectibleAmount?.amountMinor, 7_500);
});

test("fully captured obligation is paid with zero collectible balance", () => {
  const projection = derivePaymentObligation({
    ambiguousAmount: money(0), capturedAmount: money(12_500), orderTotal: money(12_500), pendingAmount: money(0),
  });
  assert.equal(projection.paymentStatus, "paid");
  assert.equal(projection.remainingBalance.amountMinor, 0);
  assert.equal(projection.collectibleAmount?.amountMinor, 0);
});

test("pending and ambiguous attempts remain exposure and block a new safe collection", () => {
  const pending = derivePaymentObligation({
    ambiguousAmount: money(0), capturedAmount: money(2_500), orderTotal: money(12_500), pendingAmount: money(4_000),
  });
  assert.equal(pending.paymentStatus, "pending");
  assert.equal(pending.remainingBalance.amountMinor, 10_000);
  assert.equal(pending.unresolvedExposure.amountMinor, 4_000);
  assert.equal(pending.collectibleAmount, null);

  const ambiguous = derivePaymentObligation({
    ambiguousAmount: money(8_000), capturedAmount: money(2_500), orderTotal: money(12_500), pendingAmount: money(4_000),
  });
  assert.equal(ambiguous.paymentStatus, "ambiguous");
  assert.equal(ambiguous.unresolvedExposure.amountMinor, 12_000);
  assert.equal(ambiguous.overexposureAmount.amountMinor, 2_000);
  assert.equal(ambiguous.collectibleAmount, null);
});

test("obligation snapshots are detached and deeply immutable money values", () => {
  const total = money(1_000);
  const projection = derivePaymentObligation({
    ambiguousAmount: money(0), capturedAmount: money(0), orderTotal: total, pendingAmount: money(0),
  });
  assert.equal(Object.isFrozen(projection), true);
  assert.notEqual(projection.orderTotal, total);
  assert.equal(Object.isFrozen(projection.orderTotal), true);
});

test("obligation rejects captured over total, negative facts, mixed currency and overflow", () => {
  const valid = { ambiguousAmount: money(0), capturedAmount: money(0), orderTotal: money(1_000), pendingAmount: money(0) };
  for (const invalid of [
    { ...valid, capturedAmount: money(1_001) },
    { ...valid, pendingAmount: money(-1) },
    { ...valid, ambiguousAmount: money(1, "USD") },
    { ...valid, pendingAmount: money(Number.MAX_SAFE_INTEGER), ambiguousAmount: money(1) },
  ]) assert.throws(() => derivePaymentObligation(invalid), InvalidPaymentObligationError);
});

test("obligation boundary rejects extra fields, accessors, prototypes and hostile proxies", () => {
  const valid = { ambiguousAmount: money(0), capturedAmount: money(0), orderTotal: money(1_000), pendingAmount: money(0) };
  for (const invalid of [
    { ...valid, extra: true },
    Object.assign(Object.create({}), valid),
    Object.defineProperty({ ...valid }, "pendingAmount", { get: () => money(0), enumerable: true }),
    new Proxy(valid, { ownKeys: () => { throw new Error("hostile"); } }),
  ]) assert.throws(() => derivePaymentObligation(invalid as never), InvalidPaymentObligationError);
});
