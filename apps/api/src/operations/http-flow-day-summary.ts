import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { captureAndConfirm, checkout, createCoveredZone, createCustomerWithAddress, ok, openShiftAndRegister, publishCatalog, record, sendOrderToKitchen, TIME_ZONE, type OpenRegister } from "./http-flow-support.js";
import { runHttpFlow, type HttpFlowContext, type Json } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const unitPriceMinor = 12_500;
const feeMinor = 3_500;
const openingFloatMinor = 10_000;
const cashTipMinor = 1_000;
const cardMinor = 10_000;
const deliveryTotalMinor = unitPriceMinor + feeMinor;

function dateIn(zone: string, offsetDays: number): string {
  const instant = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

async function collect(context: HttpFlowContext, register: OpenRegister, orderId: string, fields: Json): Promise<Json> {
  const cash = await checkout(context, register, orderId);
  return ok(await context.send("cashier", "POST", "/payments/collect", { ...context.audit(), schemaVersion: 1, scope: context.scope,
    cashRegisterSessionId: register.cashRegisterSessionId, cashRegisterExpectedVersion: cash.cashRegisterVersion, orderId,
    orderExpectedVersion: cash.orderVersion, paymentId: randomUUID(), localSequence: cash.nextLocalSequence, cardManualEvidence: null, ...fields }), "collect");
}

function sales(rows: unknown, key: string, value: string): Json {
  const row = (rows as Json[]).find((candidate) => candidate[key] === value);
  assert.ok(row !== undefined, `${key}=${value} in ${JSON.stringify(rows)}`);
  return row;
}

/** Day summary after cash, card+transfer, delivery settle and a cancellation: figures must equal the captured payments. */
export async function daySummaryFlow(): Promise<void> {
  await runHttpFlow({ databasePrefix: "superrestaurant_http_summary", marker, stage: "http_flow_day_summary" }, async (context) => {
    const { scope, fixtures } = context;
    const categoryId = randomUUID();
    const productId = randomUUID();
    const { catalogVersion } = await publishCatalog(context, {
      categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Hamburguesa", sku: "HAM-001", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece", unitPriceMinor, tax: null }],
      modifierGroups: [],
    });
    const register = await openShiftAndRegister(context, openingFloatMinor);
    const line = (quantity: number) => [{ lineId: randomUUID(), productId, variantId: null, quantity }];

    // Cash with change and tip (counter, 2 units).
    const cashOrder = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId, lines: line(2) });
    await sendOrderToKitchen(context, cashOrder.orderId);
    const cash = await collect(context, register, cashOrder.orderId, { amountMinor: 2 * unitPriceMinor, method: "cash", tenderedAmountMinor: 30_000, tipMinor: cashTipMinor });
    assert.equal(cash.orderStatus, "paid");

    // Card + transfer split (counter, 2 units).
    const splitOrder = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId, lines: line(2) });
    await sendOrderToKitchen(context, splitOrder.orderId);
    await collect(context, register, splitOrder.orderId, { amountMinor: cardMinor, method: "card_manual", tenderedAmountMinor: null, tipMinor: 0,
      cardManualEvidence: { externalConfirmed: true, provider: "terminal-externa", reference: "AUTH-0042", terminalId: "TERM-01" } });
    await collect(context, register, splitOrder.orderId, { amountMinor: 2 * unitPriceMinor - cardMinor, method: "transfer", tenderedAmountMinor: null, tipMinor: 0, transferReference: "SPEI-778899" });

    // Delivery settled in cash (1 unit + fee).
    await createCoveredZone(context, feeMinor, "83000");
    const customer = await createCustomerWithAddress(context, "83000");
    const delivery = await captureAndConfirm(context, { catalogVersion, customer, shiftId: register.shiftId, lines: line(1) });
    await sendOrderToKitchen(context, delivery.orderId);
    const assigned = record(record(ok(await context.send("cashier", "POST", "/deliveries/assign", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId,
      expectedVersion: 0, courierUserId: fixtures.actorIds.courier }), "assign")).delivery);
    const dispatched = record(record(ok(await context.send("courier", "POST", "/deliveries/dispatch", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId,
      expectedVersion: assigned.version }), "dispatch")).delivery);
    const completed = record(record(ok(await context.send("courier", "POST", "/deliveries/complete", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId,
      expectedVersion: dispatched.version }), "complete")).delivery);
    const deliveryCash = await checkout(context, register, delivery.orderId);
    ok(await context.send("cashier", "POST", "/deliveries/settle", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId, expectedVersion: completed.version,
      orderExpectedVersion: deliveryCash.orderVersion, cashRegisterSessionId: register.cashRegisterSessionId, cashRegisterExpectedVersion: deliveryCash.cashRegisterVersion,
      paymentId: randomUUID(), localSequence: deliveryCash.nextLocalSequence, tenderedAmountMinor: null, tipMinor: null }), "settle");

    // One cancelled order today.
    const cancelledOrder = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId, lines: line(1) });
    await sendOrderToKitchen(context, cancelledOrder.orderId);
    const detail = ok(await context.send("manager", "POST", "/orders/detail", { schemaVersion: 1, scope, orderId: cancelledOrder.orderId }), "detail");
    ok(await context.send("manager", "POST", "/orders/cancel", { ...context.audit(), schemaVersion: 1, scope, orderId: cancelledOrder.orderId,
      expectedVersion: detail.version, reason: "Error de captura" }), "cancel");
    context.check("fixtures_cash_card_transfer_delivery_cancel");

    const today = dateIn(TIME_ZONE, 0);
    const request = (date: string) => ({ schemaVersion: 1, scope, date });
    const summary = ok(await context.send("manager", "POST", "/reports/day-summary", request(today)), "day_summary");
    const cashSales = 2 * unitPriceMinor + deliveryTotalMinor;
    const transferMinor = 2 * unitPriceMinor - cardMinor;
    const totalSales = cashSales + 2 * unitPriceMinor;
    assert.equal(summary.timeZone, TIME_ZONE);
    assert.equal(summary.currency, "MXN");
    assert.equal(record(sales(summary.salesByMethod, "method", "cash")).amountMinor, cashSales);
    assert.equal(record(sales(summary.salesByMethod, "method", "card_manual")).amountMinor, cardMinor);
    assert.equal(record(sales(summary.salesByMethod, "method", "transfer")).amountMinor, transferMinor);
    assert.equal(record(sales(summary.salesByChannel, "channel", "counter")).amountMinor, 4 * unitPriceMinor);
    assert.equal(record(sales(summary.salesByChannel, "channel", "delivery")).amountMinor, deliveryTotalMinor);
    const totals = record(summary.totals);
    assert.equal(totals.salesMinor, totalSales);
    assert.equal(totals.tipsMinor, cashTipMinor);
    assert.equal(totals.cashTipsMinor, cashTipMinor);
    assert.equal(totals.paymentCount, 4);
    context.check("day_summary_sales_by_method_and_channel_equal_captured_payments");

    assert.deepEqual(summary.deliveryFees, { orderCount: 1, amountMinor: feeMinor });
    assert.deepEqual(summary.deliveriesSettled, { count: 1, cashCollectedMinor: deliveryTotalMinor });
    assert.deepEqual(summary.ordersPaid, { count: 3, amountMinor: totalSales });
    assert.deepEqual(summary.cancellations, { orders: 1, captures: 0 });
    const shift = record((summary.shifts as Json[])[0]);
    const summaryRegister = record((shift.registers as Json[])[0]);
    assert.equal(summaryRegister.openingFloatMinor, openingFloatMinor);
    assert.equal(summaryRegister.expectedCashBalanceMinor, openingFloatMinor + cashSales + cashTipMinor);
    context.check("day_summary_tips_delivery_fee_settled_cancelled_and_shift_expected");

    assert.equal((await context.send("viewer", "POST", "/reports/day-summary", request(today))).status, 201);
    assert.equal((await context.send("cashier", "POST", "/reports/day-summary", request(today))).status, 403);
    context.check("day_summary_viewer_ok_cashier_403");

    const empty = ok(await context.send("manager", "POST", "/reports/day-summary", request(dateIn(TIME_ZONE, 1))), "day_summary_tomorrow");
    assert.equal(record(empty.totals).salesMinor, 0);
    assert.equal(record(empty.totals).paymentCount, 0);
    assert.deepEqual(empty.cancellations, { orders: 0, captures: 0 });
    assert.deepEqual(empty.ordersPaid, { count: 0, amountMinor: 0 });
    // Product observation: a shift still open from today also appears on tomorrow's summary (with its running cash movements).
    assert.ok((empty.shifts as Json[]).every((candidate) => candidate.status === "open"));
    context.check("day_summary_tomorrow_is_zeros");
    return { totalSales, cashSales };
  });
}
