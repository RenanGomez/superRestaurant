import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { PaymentCollectionSummaryV1 } from "@super-restaurant/shared-types";
import { decodeReceiptCookie, encodeReceiptCookie } from "./receipt.js";

const secret = "s".repeat(40);
const userId = "user-1";
const now = 1_800_000_000_000;
const summary: PaymentCollectionSummaryV1 = {
  amountMinor: 10_000, cashRegisterSessionId: "33333333-3333-4333-8333-333333333333", cashRegisterVersion: 2,
  changeMinor: 5_000, currency: "MXN", method: "cash", orderId: "22222222-2222-4222-8222-222222222222",
  orderStatus: "paid", orderVersion: 3, paymentId: "11111111-1111-4111-8111-111111111111",
  paymentState: "captured", remainingBalanceMinor: 0, replayed: false, schemaVersion: 1,
  scope: { restaurantId: "44444444-4444-4444-8444-444444444444", branchId: "55555555-5555-4555-8555-555555555555" } as unknown as PaymentCollectionSummaryV1["scope"],
  tenderedAmountMinor: 15_000, tipMinor: 0,
  transferReference: null,
};

test("receipt cookie round-trips for the same user and secret", () => {
  const cookie = encodeReceiptCookie(summary, userId, secret, now);
  assert.deepEqual(decodeReceiptCookie(cookie, userId, secret, now + 1_000), summary);
});

test("receipt cookie preserves a transfer reference", () => {
  const transfer = { ...summary, method: "transfer" as const, tenderedAmountMinor: null, changeMinor: null, transferReference: "ABC123" };
  const cookie = encodeReceiptCookie(transfer, userId, secret, now);
  assert.deepEqual(decodeReceiptCookie(cookie, userId, secret, now + 1_000), transfer);
});

test("receipt cookie accepts a signed legacy summary without transferReference", () => {
  const transfer = { ...summary, method: "transfer" as const, tenderedAmountMinor: null, changeMinor: null };
  const payload = Buffer.from(JSON.stringify({ issuedAt: now, summary: { ...transfer, transferReference: undefined } }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(userId).update("\n").update(payload).digest("base64url");
  assert.deepEqual(decodeReceiptCookie(`${payload}.${signature}`, userId, secret, now), transfer);
});

test("receipt cookie rejects tampering, other users, other secrets, expiry and future issue time", () => {
  const cookie = encodeReceiptCookie(summary, userId, secret, now);
  const [payload = "", signature = ""] = cookie.split(".");
  const flipped = `${payload}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
  assert.equal(decodeReceiptCookie(flipped, userId, secret, now), undefined);
  assert.equal(decodeReceiptCookie(cookie, "user-2", secret, now), undefined);
  assert.equal(decodeReceiptCookie(cookie, userId, "t".repeat(40), now), undefined);
  assert.equal(decodeReceiptCookie(cookie, userId, secret, now + 3_600_001), undefined);
  assert.equal(decodeReceiptCookie(encodeReceiptCookie(summary, userId, secret, now + 60_000), userId, secret, now), undefined);
  assert.equal(decodeReceiptCookie(undefined, userId, secret, now), undefined);
});
