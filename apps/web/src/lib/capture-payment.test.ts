import assert from "node:assert/strict";
import test from "node:test";
import { describePaymentMethod, parseMoneyInputToMinor, suggestTenderAmounts } from "./capture-payment.js";

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
