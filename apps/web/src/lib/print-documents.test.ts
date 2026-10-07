import assert from "node:assert/strict";
import test from "node:test";
import type { OrderDetailV1, PaymentCollectionSummaryV1 } from "@super-restaurant/shared-types";
import { buildCustomerTicket, buildKitchenDocuments } from "./print-documents.js";

const scope = { restaurantId: "restaurant", branchId: "branch" };
const order = {
  orderId: "12345678-aaaa-bbbb-cccc-dddddddddddd", scope, currency: "MXN", timeZone: "America/Mexico_City",
  channel: "counter", tableId: null, createdAt: "2026-10-06T12:00:00.000Z",
  fulfillment: { channel: "counter", tableId: null, customerLabel: "Ana", addressLabel: null },
  totals: { itemsTotalMinor: 15450, deliveryChargeMinor: 0, tipMinor: 0, totalMinor: 15450, currency: "MXN" },
  items: [
    { orderItemId: "a", status: "sent", stationId: "horno", quantity: 2, name: "Pizza", variantName: "Grande", note: "Bien cocida", lineTotalMinor: 15450,
      modifiers: [], fractionBreakdown: [{ fraction: "half-a", flavorName: "Queso", extras: ["Aceitunas"], exclusions: ["Cebolla"] }] },
    { orderItemId: "b", status: "sent", stationId: "barra", quantity: 1, name: "Agua", variantName: null, note: null, lineTotalMinor: 1000, modifiers: [], fractionBreakdown: [] },
    { orderItemId: "c", status: "cancelled", stationId: "horno", quantity: 1, name: "Cancelada", variantName: null, note: null, lineTotalMinor: 0, modifiers: [], fractionBreakdown: [] },
  ],
} as unknown as OrderDetailV1;

test("kitchen documents use historical station when projected and omit cancelled lines", () => {
  const documents = buildKitchenDocuments(order);
  assert.equal(documents.length, 2);
  assert.match(documents[0]!.title, /horno/u);
  assert.match(documents[0]!.lines.join(" "), /Mitad A: Queso.*Aceitunas.*Sin Cebolla.*Bien cocida/u);
  assert.doesNotMatch(documents.flatMap((document) => document.lines).join(" "), /Cancelada/u);
});

test("customer ticket uses server amounts and receipt balance", () => {
  const payment = { orderId: order.orderId, scope, method: "cash", amountMinor: 10000, tenderedAmountMinor: 12000,
    changeMinor: 2000, remainingBalanceMinor: 5450, transferReference: null } as PaymentCollectionSummaryV1;
  const ticket = buildCustomerTicket(order, [payment], { restaurantName: "Restaurante", branchName: "Centro" });
  const text = ticket.lines.join("\n");
  assert.match(text, /Total: \$154\.50/u);
  assert.match(text, /Recibido: \$120\.00/u);
  assert.match(text, /Saldo: \$54\.50/u);
  assert.doesNotMatch(text, /Cancelada/u);
});
