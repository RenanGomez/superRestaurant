import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryQuoteScheduledForInputValue, describePaymentMethod, parseMoneyInputToMinor,
  quoteMatchesRequestedTime, suggestTenderAmounts,
} from "./capture-payment.js";

const baseQuote = {
  schemaVersion: 1 as const, quoteId: "6e4b1f6a-5f0a-4e3f-9c8a-2d3b7a6c9e10",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  captureDraftId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  addressSnapshotRef: "9b2f1c1e-7f3a-4a2e-9d5e-1a2b3c4d5e6f",
  address: { postalCode: "83000", locality: "Hermosillo" },
  currency: "MXN", timeZone: "America/Hermosillo",
  quotedAt: "2026-09-27T12:00:00.000Z", scheduledFor: null as string | null, version: 1,
  coverageStatus: "covered" as const, zoneId: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
  feeMinor: 3000, promiseStart: "2026-09-27T12:00:00.000Z", promiseEnd: "2026-09-27T12:15:00.000Z",
  expiresAt: "2026-09-27T12:30:00.000Z", override: null,
};

test("quoteMatchesRequestedTime is vacuously true when there is no frozen quote yet", () => {
  assert.equal(quoteMatchesRequestedTime(null, ""), true);
  assert.equal(quoteMatchesRequestedTime(null, "2026-09-27T13:00"), true);
});

test("quoteMatchesRequestedTime matches an ASAP quote only to an empty scheduled field", () => {
  assert.equal(quoteMatchesRequestedTime(baseQuote, ""), true);
  assert.equal(quoteMatchesRequestedTime(baseQuote, "2026-09-27T13:00"), false);
});

test("quoteMatchesRequestedTime compares the server's scheduledFor to the field's parsed instant, not the raw text", () => {
  const fieldValue = "2026-09-27T13:00";
  const matchingInstant = new Date(fieldValue).toISOString();
  const scheduled = { ...baseQuote, scheduledFor: matchingInstant };
  assert.equal(quoteMatchesRequestedTime(scheduled, fieldValue), true);
  const different = { ...baseQuote, scheduledFor: new Date("2026-09-27T14:00").toISOString() };
  assert.equal(quoteMatchesRequestedTime(different, fieldValue), false);
});

test("quoteMatchesRequestedTime never matches an unparsable field, so confirm stays blocked", () => {
  const scheduled = { ...baseQuote, scheduledFor: "2026-09-27T19:00:00.000Z" };
  assert.equal(quoteMatchesRequestedTime(scheduled, "not-a-date"), false);
});

test("deliveryQuoteScheduledForInputValue is empty for no quote or an ASAP (null scheduledFor) quote", () => {
  assert.equal(deliveryQuoteScheduledForInputValue(null), "");
  assert.equal(deliveryQuoteScheduledForInputValue(baseQuote), "");
});

test("deliveryQuoteScheduledForInputValue round-trips through quoteMatchesRequestedTime for H15 rehydration", () => {
  const fieldValue = "2026-09-27T13:05";
  const scheduled = { ...baseQuote, scheduledFor: new Date(fieldValue).toISOString() };
  const derived = deliveryQuoteScheduledForInputValue(scheduled);
  assert.equal(derived, fieldValue);
  assert.equal(quoteMatchesRequestedTime(scheduled, derived), true);
});

test("deliveryQuoteScheduledForInputValue is empty for an unparsable scheduledFor", () => {
  assert.equal(deliveryQuoteScheduledForInputValue({ ...baseQuote, scheduledFor: "not-a-date" }), "");
});

test("suggestTenderAmounts always includes the exact total plus the next 100/200/500-peso roundings above it", () => {
  assert.deepEqual(suggestTenderAmounts(9_000), [9_000, 10_000, 20_000, 50_000]);
  assert.deepEqual(suggestTenderAmounts(12_000), [12_000, 20_000, 50_000]);
});

test("suggestTenderAmounts never duplicates a rounding that already equals the exact total", () => {
  assert.deepEqual(suggestTenderAmounts(10_000), [10_000, 20_000, 50_000]);
  assert.deepEqual(suggestTenderAmounts(20_000), [20_000, 50_000]);
  assert.deepEqual(suggestTenderAmounts(50_000), [50_000, 60_000]);
});

test("suggestTenderAmounts on a zero total has no distinct rounding above it", () => {
  assert.deepEqual(suggestTenderAmounts(0), [0]);
});

test("suggestTenderAmounts rejects negative or non-integer totals with no suggestions", () => {
  assert.deepEqual(suggestTenderAmounts(-1), []);
  assert.deepEqual(suggestTenderAmounts(1.5), []);
  assert.deepEqual(suggestTenderAmounts(Number.NaN), []);
});

test("describePaymentMethod labels cash by server-derived timing, never by client choice", () => {
  assert.deepEqual(describePaymentMethod("cash", "on_fulfillment"), { label: "Efectivo", notice: "Cobro contra entrega" });
  assert.deepEqual(describePaymentMethod("cash", "now"), { label: "Efectivo", notice: "Cobro en mostrador" });
});

test("describePaymentMethod describes card_manual and transfer independently of timing", () => {
  assert.deepEqual(describePaymentMethod("card_manual", "now"),
    { label: "Tarjeta", notice: "Se liquida con terminal manual al entregar" });
  assert.deepEqual(describePaymentMethod("card_manual", "on_fulfillment"),
    { label: "Tarjeta", notice: "Se liquida con terminal manual al entregar" });
  assert.deepEqual(describePaymentMethod("transfer", "now"),
    { label: "Transferencia", notice: "Pendiente de evidencia de pago" });
  assert.deepEqual(describePaymentMethod("transfer", "on_fulfillment"),
    { label: "Transferencia", notice: "Pendiente de evidencia de pago" });
});

test("parseMoneyInputToMinor converts whole pesos and two-decimal amounts with exact integer arithmetic", () => {
  assert.equal(parseMoneyInputToMinor("10"), 1_000);
  assert.equal(parseMoneyInputToMinor("10.5"), 1_050);
});

// H12: a field with no "." or "," at all (an absent fraction, not merely a short one) must never
// come out as NaN -- verified directly against Number.isNaN, not just a loose equality, so a
// regression that reintroduces NaN cannot slip past as some other falsy/incorrect value.
test("parseMoneyInputToMinor treats a whole-peso amount with no fraction as exactly zero cents, never NaN", () => {
  const result = parseMoneyInputToMinor("10");
  assert.equal(Number.isNaN(result), false);
  assert.equal(result, 1_000);
  assert.equal(parseMoneyInputToMinor("1234567"), 123_456_700);
});

test("parseMoneyInputToMinor accepts a comma as the decimal separator", () => {
  assert.equal(parseMoneyInputToMinor("10,50"), 1_050);
});

test("parseMoneyInputToMinor rejects a numeric prefix followed by non-digit trailing text", () => {
  assert.equal(parseMoneyInputToMinor("10abc"), null);
});

test("parseMoneyInputToMinor rejects more than two decimal digits instead of rounding them away", () => {
  assert.equal(parseMoneyInputToMinor("10.555"), null);
});

test("parseMoneyInputToMinor rejects an empty or whitespace-only field", () => {
  assert.equal(parseMoneyInputToMinor(""), null);
  assert.equal(parseMoneyInputToMinor("   "), null);
});
