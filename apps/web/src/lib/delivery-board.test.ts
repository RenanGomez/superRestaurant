import assert from "node:assert/strict";
import test from "node:test";

import type { BranchDeliveryItemV1 } from "@super-restaurant/shared-types";

import {
  canReassign, courierCollectionMessage, courierInitials, groupDeliveriesByState, paymentMethodLabel, prefillTenderedMinor, prefillTipMinor, settlesInCaja,
} from "./delivery-board.js";

function item(state: string, extra: Partial<BranchDeliveryItemV1> = {}, attemptCount = 0): BranchDeliveryItemV1 {
  return { delivery: { state, attemptCount }, orderStatus: "open", paymentIntent: null, ...extra } as unknown as BranchDeliveryItemV1;
}

test("groupDeliveriesByState maps delivered to the settlement column and drops pending and settled", () => {
  const grouped = groupDeliveriesByState([
    item("assigned"), item("en_route"), item("delivered"), item("failed"), item("settled"), item("pending"), item("delivered"),
  ]);
  assert.equal(grouped.assigned.length, 1);
  assert.equal(grouped.en_route.length, 1);
  assert.equal(grouped.to_settle.length, 2);
  assert.equal(grouped.failed.length, 1);
});

test("paymentMethodLabel names every method", () => {
  assert.equal(paymentMethodLabel("cash"), "Efectivo");
  assert.equal(paymentMethodLabel("card_manual"), "Tarjeta");
  assert.equal(paymentMethodLabel("transfer"), "Transferencia");
});

test("courier collection message reserves cash collection for positive cash intent only", () => {
  assert.deepEqual(courierCollectionMessage("cash", 8_000), { kind: "cash", label: "Cobrar en efectivo" });
  assert.deepEqual(courierCollectionMessage("card_manual", 8_000), { kind: "caja", label: "Pago pendiente en Caja (tarjeta)" });
  assert.deepEqual(courierCollectionMessage("transfer", 8_000), { kind: "caja", label: "Pago pendiente en Caja (transferencia)" });
  assert.deepEqual(courierCollectionMessage("cash", 0), { kind: "paid", label: "Pagado" });
  assert.deepEqual(courierCollectionMessage("card_manual", 0), { kind: "paid", label: "Pagado" });
  assert.deepEqual(courierCollectionMessage(null, 8_000), { kind: "undefined", label: "Pago pendiente por definir" });
});

test("courierInitials uses up to two words and a placeholder without a name", () => {
  assert.equal(courierInitials("ana lópez ruiz"), "AL");
  assert.equal(courierInitials("  Luis "), "L");
  assert.equal(courierInitials(null), "?");
  assert.equal(courierInitials("   "), "?");
});

test("prefillTenderedMinor only pre-fills a positive cash tender", () => {
  assert.equal(prefillTenderedMinor(item("delivered", { paymentIntent: { method: "cash", tenderedAmountMinor: 50_000, tipMinor: 0 } })), 50_000);
  assert.equal(prefillTenderedMinor(item("delivered", { paymentIntent: { method: "cash", tenderedAmountMinor: 0, tipMinor: 0 } })), null);
  assert.equal(prefillTenderedMinor(item("delivered", { paymentIntent: { method: "cash", tenderedAmountMinor: null, tipMinor: 0 } })), null);
  assert.equal(prefillTenderedMinor(item("delivered", { paymentIntent: { method: "transfer", tenderedAmountMinor: 9_000, tipMinor: 0 } })), null);
  assert.equal(prefillTenderedMinor(item("delivered")), null);
});

test("prefillTipMinor follows only a cash intent", () => {
  assert.equal(prefillTipMinor(item("delivered", { paymentIntent: { method: "cash", tenderedAmountMinor: null, tipMinor: 2_000 } })), 2_000);
  assert.equal(prefillTipMinor(item("delivered", { paymentIntent: { method: "card_manual", tenderedAmountMinor: null, tipMinor: 2_000 } })), 0);
  assert.equal(prefillTipMinor(item("delivered")), 0);
});

test("settlesInCaja is true for card or transfer unless the order is already paid", () => {
  assert.equal(settlesInCaja(item("delivered", { paymentIntent: { method: "card_manual", tenderedAmountMinor: null, tipMinor: 0 } })), true);
  assert.equal(settlesInCaja(item("delivered", { orderStatus: "paid", paymentIntent: { method: "transfer", tenderedAmountMinor: null, tipMinor: 0 } })), false);
  assert.equal(settlesInCaja(item("delivered", { paymentIntent: { method: "cash", tenderedAmountMinor: null, tipMinor: 0 } })), false);
  assert.equal(settlesInCaja(item("delivered")), false);
});

test("canReassign requires a failed delivery with attempts left", () => {
  assert.equal(canReassign(item("failed", {}, 1), 2), true);
  assert.equal(canReassign(item("failed", {}, 2), 2), false);
  assert.equal(canReassign(item("assigned", {}, 0), 2), false);
});
