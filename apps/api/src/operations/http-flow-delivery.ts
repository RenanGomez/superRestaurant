import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { captureAndConfirm, checkout, createCoveredZone, createCustomerWithAddress, cutX, ok, openShiftAndRegister, publishCatalog, record, sendOrderToKitchen } from "./http-flow-support.js";
import { runHttpFlow } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const unitPriceMinor = 12_500;
const quantity = 2;
const feeMinor = 3_500;
const openingFloatMinor = 10_000;
const tenderedMinor = 30_000;
const tipMinor = 500;
const itemsMinor = unitPriceMinor * quantity;
const totalMinor = itemsMinor + feeMinor;
const changeMinor = tenderedMinor - totalMinor - tipMinor;

/** Phone delivery: capture with covered address -> tray -> assign -> dispatch -> courier detail -> complete -> cash settle -> X cut. */
export async function deliveryFlow(): Promise<void> {
  await runHttpFlow({ databasePrefix: "superrestaurant_http_delivery", marker, stage: "http_flow_delivery" }, async (context) => {
    const { scope, fixtures } = context;
    const categoryId = randomUUID();
    const productId = randomUUID();
    const { catalogVersion } = await publishCatalog(context, {
      categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Hamburguesa", sku: "HAM-001", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece", unitPriceMinor, tax: null }],
      modifierGroups: [],
    });
    await createCoveredZone(context, feeMinor, "83000");
    const register = await openShiftAndRegister(context, openingFloatMinor);
    const customer = await createCustomerWithAddress(context, "83000");
    context.check("zone_customer_address_validated");

    const captured = await captureAndConfirm(context, { catalogVersion, customer, shiftId: register.shiftId,
      lines: [{ lineId: randomUUID(), productId, variantId: null, quantity }],
      paymentIntent: { method: "cash", tenderedAmountMinor: tenderedMinor, tipMinor } });
    const orderId = captured.orderId;
    const projection = record(captured.workspace.paymentProjection);
    assert.equal(projection.orderTotalMinor, totalMinor);
    assert.equal(projection.deliveryFeeMinor, feeMinor);
    context.check("phone_capture_confirmed_with_delivery_fee");

    await sendOrderToKitchen(context, orderId);
    const tray = ok(await context.send("cashier", "POST", "/branch-orders/tray", { schemaVersion: 1, scope, cursor: null, limit: 50, channel: null, unassignedDeliveriesOnly: true }), "tray");
    const items = tray.items as Record<string, unknown>[];
    assert.ok(items.some((item) => JSON.stringify(item).includes(orderId)), `tray lists the delivery order: ${JSON.stringify(tray).slice(0, 700)}`);
    context.check("tray_unassigned_deliveries_lists_order");

    const assigned = record(record(ok(await context.send("cashier", "POST", "/deliveries/assign", { ...context.audit(), schemaVersion: 1, scope, orderId,
      expectedVersion: 0, courierUserId: fixtures.actorIds.courier }), "assign")).delivery);
    assert.equal(assigned.state, "assigned");
    const dispatched = record(record(ok(await context.send("courier", "POST", "/deliveries/dispatch", { ...context.audit(), schemaVersion: 1, scope, orderId,
      expectedVersion: assigned.version }), "dispatch")).delivery);
    assert.equal(dispatched.state, "en_route");
    context.check("assign_and_dispatch");

    const detail = { schemaVersion: 1, scope, orderId };
    ok(await context.send("courier", "POST", "/deliveries/order-detail", detail), "courier_detail");
    assert.equal((await context.send("courier_other", "POST", "/deliveries/order-detail", detail)).status, 403);
    assert.ok((await context.send("courier_other", "POST", "/deliveries/complete", { ...context.audit(), schemaVersion: 1, scope, orderId, expectedVersion: dispatched.version })).status >= 400);
    context.check("order_detail_assigned_courier_200_other_courier_403");

    const completed = record(record(ok(await context.send("courier", "POST", "/deliveries/complete", { ...context.audit(), schemaVersion: 1, scope, orderId,
      expectedVersion: dispatched.version }), "complete")).delivery);
    assert.equal(completed.state, "delivered");
    const cash = await checkout(context, register, orderId);
    assert.equal(cash.orderTotalMinor, totalMinor);
    const settleCommand = { ...context.audit(), schemaVersion: 1, scope, orderId, expectedVersion: completed.version, orderExpectedVersion: cash.orderVersion,
      cashRegisterSessionId: register.cashRegisterSessionId, cashRegisterExpectedVersion: cash.cashRegisterVersion, paymentId: randomUUID(),
      localSequence: cash.nextLocalSequence, tenderedAmountMinor: null, tipMinor: null };
    const settled = ok(await context.send("cashier", "POST", "/deliveries/settle", settleCommand), "settle");
    const payment = record(settled.payment);
    assert.equal(payment.amountMinor, totalMinor);
    assert.equal(payment.tenderedAmountMinor, tenderedMinor);
    assert.equal(payment.tipMinor, tipMinor);
    assert.equal(payment.changeMinor, changeMinor);
    assert.equal(payment.orderStatus, "paid");
    assert.equal(record(settled.delivery).state, "settled");
    const replay = ok(await context.send("cashier", "POST", "/deliveries/settle", settleCommand), "settle_replay");
    assert.equal(replay.replayed, true);
    context.check("complete_and_cash_settle_with_change_replay_identical");

    const report = await cutX(context, register);
    assert.equal(report.paymentCount, 1);
    assert.equal(report.cashCapturedMinor, totalMinor);
    assert.equal(report.cashTipsMinor, tipMinor);
    assert.equal(record(report.register).expectedCashBalanceMinor, openingFloatMinor + totalMinor + tipMinor);
    context.check("x_cut_includes_delivery_cash");
    return { totalMinor, changeMinor, tipMinor, expectedCashBalanceMinor: openingFloatMinor + totalMinor + tipMinor };
  });
}
