import assert from "node:assert/strict";
import test from "node:test";
import type { CashPaymentQuoteV1 } from "@super-restaurant/shared-types";
import { canCollectPayment, movementLabel, quickCashAmounts } from "./caja-helpers.js";

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
});

test("collect requires a current server quote and enough tender or card evidence", () => {
  const quote = { amountMinor: 12_500, tipMinor: 0, method: "cash", tenderedAmountMinor: 20_000 } as CashPaymentQuoteV1;
  const input = { quote, balanceMinor: 12_500, method: "cash" as const, receivedMinor: 20_000, tipMinor: 0, terminalId: "", reference: "", busy: false };
  assert.equal(canCollectPayment(input), true);
  assert.equal(canCollectPayment({ ...input, receivedMinor: 10_000 }), false);
  assert.equal(canCollectPayment({ ...input, tipMinor: 100 }), false);
  assert.equal(canCollectPayment({ ...input, busy: true }), false);
  assert.equal(canCollectPayment({ ...input, quote: { ...quote, method: "card_manual" } }), false);
  const card = { ...quote, method: "card_manual", tenderedAmountMinor: null } as CashPaymentQuoteV1;
  assert.equal(canCollectPayment({ ...input, quote: card, method: "card_manual", terminalId: "T1", reference: "ABC123" }), true);
  assert.equal(canCollectPayment({ ...input, quote: card, method: "card_manual", terminalId: "T1", reference: "ABC" }), false);
});
