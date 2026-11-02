import assert from "node:assert/strict";
import test from "node:test";
import type { CashPaymentQuoteV1 } from "@super-restaurant/shared-types";
import {
  buildReceiptHref,
  canCollectPayment,
  movementLabel,
  parseReceiptQuery,
  paymentAmountBounds,
  paymentMethodLabel,
  paymentShortfallMinor,
  quickCashAmounts,
  requiredCashTenderMinor,
  resolvePaymentAmountMinor,
} from "./caja-helpers.js";

test("receipt labels show a transfer reference only when one exists", () => {
  assert.equal(paymentMethodLabel({ method: "transfer", transferReference: "ABC123" }), "Transferencia · Ref. ABC123");
  assert.equal(paymentMethodLabel({ method: "transfer", transferReference: null }), "Transferencia");
  assert.equal(paymentMethodLabel({ method: "cash", transferReference: null }), "Efectivo");
  assert.equal(paymentMethodLabel({ method: "card_manual", transferReference: null }), "Tarjeta externa");
});

test("movement labels are operator-facing Spanish", () => {
  assert.equal(movementLabel("cash_sale"), "Venta en efectivo");
  assert.equal(movementLabel("tip_in"), "Propina");
  assert.equal(movementLabel("cash_in"), "Entrada");
  assert.equal(movementLabel("cash_out"), "Salida");
  assert.equal(movementLabel("cash_adjustment"), "Ajuste");
  assert.equal(movementLabel("cash_refund"), "Reembolso");
});

test("quick notes never offer less than the balance", () => {
  assert.deepEqual(quickCashAmounts(12_500), [20_000, 50_000]);
  assert.deepEqual(quickCashAmounts(50_001), []);
  assert.deepEqual(quickCashAmounts(10_000), [10_000, 20_000, 50_000]);
  assert.deepEqual(quickCashAmounts(9_900, 200), [20_000, 50_000]);
  assert.equal(requiredCashTenderMinor(12_500, 300), 12_800);
});

test("payment shortfall is returned only when received cash is lower than required", () => {
  assert.equal(paymentShortfallMinor(12_800, 12_799), 1);
  assert.equal(paymentShortfallMinor(12_800, 12_800), undefined);
  assert.equal(paymentShortfallMinor(12_800, 20_000), undefined);
});

test("paymentAmountBounds accepts one cent through the full remaining balance", () => {
  assert.equal(paymentAmountBounds(12_500, 1), true);
  assert.equal(paymentAmountBounds(12_500, 5_000), true);
  assert.equal(paymentAmountBounds(12_500, 12_500), true);
  assert.equal(paymentAmountBounds(12_500, 0), false);
  assert.equal(paymentAmountBounds(12_500, 12_501), false);
  assert.equal(paymentAmountBounds(12_500, null), false);
});

test("resolvePaymentAmountMinor handles full and split modes", () => {
  assert.equal(resolvePaymentAmountMinor("full", 13_000, null), 13_000);
  assert.equal(resolvePaymentAmountMinor("full", 13_000, 5_000), 13_000);
  assert.equal(resolvePaymentAmountMinor("full", 0, null), null);
  assert.equal(resolvePaymentAmountMinor("split", 13_000, 7_000), 7_000);
  assert.equal(resolvePaymentAmountMinor("split", 13_000, 13_000), 13_000);
  assert.equal(resolvePaymentAmountMinor("split", 13_000, 13_001), null);
  assert.equal(resolvePaymentAmountMinor("split", 13_000, 0), null);
  assert.equal(resolvePaymentAmountMinor("split", 13_000, null), null);
});

test("collect requires a current server quote and enough tender or card evidence", () => {
  const quote = { amountMinor: 12_500, tipMinor: 0, method: "cash", tenderedAmountMinor: 20_000, changeMinor: 7_500 } as CashPaymentQuoteV1;
  const input = { quote, remainingMinor: 12_500, amountMinor: 12_500, method: "cash" as const, receivedMinor: 20_000, tipMinor: 0, terminalId: "", reference: "", busy: false };
  assert.equal(canCollectPayment(input), true);
  assert.equal(canCollectPayment({ ...input, receivedMinor: 10_000 }), false);
  const partialQuote = { ...quote, amountMinor: 5_000, tenderedAmountMinor: 10_000, changeMinor: 5_000 } as CashPaymentQuoteV1;
  assert.equal(canCollectPayment({ ...input, quote: partialQuote, amountMinor: 5_000, receivedMinor: 10_000 }), true);
  assert.equal(canCollectPayment({ ...input, quote: partialQuote, amountMinor: 5_001, receivedMinor: 10_000 }), false);
  assert.equal(canCollectPayment({ ...input, quote: partialQuote, amountMinor: 12_501 }), false);
  const tippedQuote = { ...quote, tipMinor: 300, changeMinor: 0, tenderedAmountMinor: 12_800 } as CashPaymentQuoteV1;
  assert.equal(canCollectPayment({ ...input, quote: tippedQuote, tipMinor: 300, receivedMinor: 12_800 }), true);
  assert.equal(canCollectPayment({ ...input, quote: tippedQuote, tipMinor: 300, receivedMinor: 12_799 }), false);
  assert.equal(canCollectPayment({ ...input, tipMinor: 100 }), false);
  assert.equal(canCollectPayment({ ...input, busy: true }), false);
  assert.equal(canCollectPayment({ ...input, quote: { ...quote, method: "card_manual" } }), false);
  const card = { ...quote, method: "card_manual", tenderedAmountMinor: null } as CashPaymentQuoteV1;
  assert.equal(canCollectPayment({ ...input, quote: card, method: "card_manual", terminalId: "T1", reference: "ABC123" }), true);
  assert.equal(canCollectPayment({ ...input, quote: card, method: "card_manual", terminalId: "T1", reference: "ABC" }), false);
  // Transfer: no terminal, no reference required, no change; the quote must agree.
  const transfer = { ...quote, method: "transfer", tenderedAmountMinor: null, changeMinor: null } as CashPaymentQuoteV1;
  assert.equal(canCollectPayment({ ...input, quote: transfer, method: "transfer", receivedMinor: null, terminalId: "", reference: "" }), true);
  assert.equal(canCollectPayment({ ...input, quote: { ...transfer, changeMinor: 100 }, method: "transfer", receivedMinor: null }), false);
  assert.equal(canCollectPayment({ ...input, quote: { ...transfer, tenderedAmountMinor: 12_800 }, method: "transfer", receivedMinor: null }), false);
  assert.equal(canCollectPayment({ ...input, quote: transfer, method: "cash" }), false);
});

test("receipt href round-trips and rejects malformed ids", () => {
  const paymentId = "11111111-1111-4111-8111-111111111111";
  const orderId = "22222222-2222-4222-8222-222222222222";
  const href = buildReceiptHref(paymentId, orderId);
  assert.equal(href, `/app/caja?receipt=${paymentId}&orderId=${orderId}`);
  const params = Object.fromEntries(new URL(href ?? "", "http://x").searchParams);
  assert.deepEqual(parseReceiptQuery(params), { paymentId, orderId });
  assert.equal(buildReceiptHref("x", orderId), null);
  assert.equal(parseReceiptQuery({ receipt: paymentId }), null);
  assert.equal(parseReceiptQuery({ receipt: [paymentId], orderId }), null);
});
