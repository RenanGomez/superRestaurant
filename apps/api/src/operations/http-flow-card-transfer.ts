import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { captureAndConfirm, checkout, createCoveredZone, createCustomerWithAddress, cutX, ok, openShiftAndRegister, publishCatalog, record, sendOrderToKitchen, type OpenRegister } from "./http-flow-support.js";
import { runHttpFlow, type HttpFlowContext, type Json } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const unitPriceMinor = 12_500;
const quantity = 2;
const billMinor = unitPriceMinor * quantity;
const cardMinor = 10_000;
const transferMinor = billMinor - cardMinor;
const openingFloatMinor = 10_000;
const feeMinor = 3_500;

async function collect(context: HttpFlowContext, register: OpenRegister, orderId: string, fields: Json): Promise<{ status: number; body: Json }> {
  const cash = await checkout(context, register, orderId);
  return context.send("cashier", "POST", "/payments/collect", { ...context.audit(), schemaVersion: 1, scope: context.scope,
    cashRegisterSessionId: register.cashRegisterSessionId, cashRegisterExpectedVersion: cash.cashRegisterVersion, orderId,
    orderExpectedVersion: cash.orderVersion, paymentId: randomUUID(), localSequence: cash.nextLocalSequence, ...fields });
}

/** Split tender: external card terminal for part, bank transfer for the rest; transfers on a delivery in transit are refused. */
export async function cardTransferFlow(): Promise<void> {
  await runHttpFlow({ databasePrefix: "superrestaurant_http_tender", marker, stage: "http_flow_card_transfer" }, async (context) => {
    const { scope, fixtures } = context;
    const categoryId = randomUUID();
    const productId = randomUUID();
    const { catalogVersion } = await publishCatalog(context, {
      categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Hamburguesa", sku: "HAM-001", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece", unitPriceMinor, tax: null }],
      modifierGroups: [],
    });
    const register = await openShiftAndRegister(context, openingFloatMinor);

    // Counter order for two units, sent to the kitchen.
    const counter = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId, lines: [{ lineId: randomUUID(), productId, variantId: null, quantity }] });
    await sendOrderToKitchen(context, counter.orderId);

    const card = ok(await collect(context, register, counter.orderId, { amountMinor: cardMinor, method: "card_manual",
      cardManualEvidence: { externalConfirmed: true, provider: "terminal-externa", reference: "AUTH-0042", terminalId: "TERM-01" } }), "card_manual");
    assert.equal(card.orderStatus, "partially_paid");
    assert.equal(card.remainingBalanceMinor, transferMinor);
    // A card payment without terminal evidence is rejected before it can touch the order.
    assert.ok((await collect(context, register, counter.orderId, { amountMinor: transferMinor, method: "card_manual", cardManualEvidence: null })).status >= 400);
    context.check("card_manual_partial_with_terminal_and_reference");

    const transferFields = { amountMinor: transferMinor, method: "transfer", cardManualEvidence: null, transferReference: "SPEI-778899" };
    const transfer = ok(await collect(context, register, counter.orderId, transferFields), "transfer");
    assert.equal(transfer.orderStatus, "paid");
    assert.equal(transfer.remainingBalanceMinor, 0);
    assert.equal(transfer.changeMinor, null);
    context.check("transfer_with_reference_closes_order_paid");

    const report = await cutX(context, register);
    assert.equal(report.paymentCount, 2);
    assert.equal(report.cardManualCapturedMinor, cardMinor);
    assert.equal(report.transferCapturedMinor, transferMinor);
    assert.equal(report.cashCapturedMinor, 0);
    assert.equal(report.totalCapturedMinor, billMinor);
    assert.equal(record(report.register).expectedCashBalanceMinor, openingFloatMinor);
    assert.deepEqual((report.movements as Json[]).filter((movement) => movement.type === "cash_sale"), []);
    context.check("x_cut_transfer_captured_and_no_cash_expected_change");

    // Delivery in transit: a transfer cannot be collected until the courier marks it delivered.
    await createCoveredZone(context, feeMinor, "83000");
    const customer = await createCustomerWithAddress(context, "83000");
    const delivery = await captureAndConfirm(context, { catalogVersion, customer, shiftId: register.shiftId,
      lines: [{ lineId: randomUUID(), productId, variantId: null, quantity: 1 }], paymentIntent: { method: "transfer", tenderedAmountMinor: null, tipMinor: 0 } });
    await sendOrderToKitchen(context, delivery.orderId);
    const assigned = record(record(ok(await context.send("cashier", "POST", "/deliveries/assign", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId,
      expectedVersion: 0, courierUserId: fixtures.actorIds.courier }), "assign")).delivery);
    const dispatched = record(record(ok(await context.send("courier", "POST", "/deliveries/dispatch", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId,
      expectedVersion: assigned.version }), "dispatch")).delivery);
    assert.equal(dispatched.state, "en_route");
    const refused = await collect(context, register, delivery.orderId, { amountMinor: unitPriceMinor + feeMinor, method: "transfer", cardManualEvidence: null, transferReference: "SPEI-000111" });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "DELIVERY_NOT_DELIVERED");
    context.check("transfer_on_en_route_delivery_409_delivery_not_delivered");
    return { billMinor, cardMinor, transferMinor };
  });
}
