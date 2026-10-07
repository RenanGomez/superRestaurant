import assert from "node:assert/strict";
import test from "node:test";

import type { BranchDaySummaryV1 } from "@super-restaurant/shared-types";

import { buildDaySummaryView, isCalendarDate, todayInZone } from "./day-summary";

const id = "11111111-1111-4111-8111-111111111111";
const summary = {
  cancellations: { captures: 1, orders: 2, refundPendingMinor: 5500 },
  currency: "MXN",
  date: "2026-10-06",
  deliveriesSettled: { cashCollectedMinor: 30000, count: 1 },
  deliveryFees: { amountMinor: 3500, orderCount: 1 },
  ordersPaid: { amountMinor: 120000, count: 2 },
  salesByChannel: [
    { amountMinor: 90000, channel: "table", paymentCount: 1, tipMinor: 5000 },
    { amountMinor: 0, channel: "counter", paymentCount: 0, tipMinor: 0 },
    { amountMinor: 0, channel: "takeout", paymentCount: 0, tipMinor: 0 },
    { amountMinor: 30000, channel: "delivery", paymentCount: 1, tipMinor: 0 },
  ],
  salesByMethod: [
    { amountMinor: 100000, method: "cash", paymentCount: 1, tipMinor: 5000 },
    { amountMinor: 20000, method: "card_manual", paymentCount: 1, tipMinor: 0 },
    { amountMinor: 0, method: "transfer", paymentCount: 0, tipMinor: 0 },
  ],
  schemaVersion: 1,
  scope: { branchId: id, restaurantId: id },
  shifts: [{
    closedAt: null, name: "Matutino", openedAt: "2026-10-06T15:00:00.000Z", status: "open",
    registers: [{
      cashRegisterSessionId: id, cashierId: id, closedAt: null, countedClosingBalanceMinor: null, differenceMinor: null,
      expectedCashBalanceMinor: 150050, movements: [{ amountMinor: 5000, count: 2, direction: "out", type: "cash_out" }],
      openedAt: "2026-10-06T15:00:00.000Z", openingFloatMinor: 50000, registerId: id, status: "open",
    }],
    shiftId: id,
  }],
  timeZone: "America/Hermosillo",
  totals: { cashTipsMinor: 5000, paymentCount: 2, salesMinor: 120000, tipsMinor: 5000 },
} as unknown as BranchDaySummaryV1;

const norm = (text: string): string => text.replace(/ /gu, " ");

test("the view shows the server's figures in pesos without recomputing", () => {
  const view = buildDaySummaryView(summary);
  assert.equal(view.salesTotal, "$1,200.00");
  assert.deepEqual(view.cards.map((card) => card.value), ["$1,200.00", "$50.00", "$35.00", "2 órdenes"]);
  assert.deepEqual(view.channels.map((row) => row.label), ["Mesa", "Mostrador", "Para llevar", "Entrega a domicilio"]);
  assert.equal(view.cards[3]?.detail, "1 captura cerrada · Devoluciones pendientes $55.00");
  assert.equal(view.methods[1]?.amount, "$200.00");
  assert.equal(view.methods[1]?.label, "Tarjeta");
  const shift = view.shifts[0];
  assert.deepEqual(
    [shift?.closed, shift?.counted, shift?.difference, shift?.expected, shift?.float, shift?.status],
    ["—", "—", "—", "$1,500.50", "$500.00", "Abierta"],
  );
  assert.deepEqual(shift?.movements.map(norm), ["Salida (2): −$50.00"]);
  assert.equal(view.empty, false);
});

test("an empty day is flagged", () => {
  const empty = { ...summary, cancellations: { captures: 0, orders: 0, refundPendingMinor: 0 }, shifts: [], totals: { cashTipsMinor: 0, paymentCount: 0, salesMinor: 0, tipsMinor: 0 } } as unknown as BranchDaySummaryV1;
  assert.equal(buildDaySummaryView(empty).empty, true);
});

test("dates are validated and today is resolved in the restaurant zone", () => {
  assert.equal(isCalendarDate("2026-10-06"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("06/10/2026"), false);
  assert.equal(todayInZone(new Date("2026-10-07T03:30:00Z"), "America/Hermosillo"), "2026-10-06");
  assert.equal(todayInZone(new Date("2026-10-07T03:30:00Z"), "Asia/Tokyo"), "2026-10-07");
});
