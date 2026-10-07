import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { captureAndConfirm, checkout, createCoveredZone, createCustomerWithAddress, ok, openShiftAndRegister, publishCatalog, record, sendOrderToKitchen, type OpenRegister } from "./http-flow-support.js";
import { runHttpFlow, type HttpFlowContext, type Json } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const unitPriceMinor = 12_500;
const feeMinor = 3_500;
const partialMinor = 10_000;
const reason = "Cliente se retiro";

async function cancel(context: HttpFlowContext, actor: "manager" | "cashier", orderId: string, expectedVersion: unknown): Promise<{ status: number; body: Json }> {
  return context.send(actor, "POST", "/orders/cancel", { ...context.audit(), schemaVersion: 1, scope: context.scope, orderId, expectedVersion, reason });
}

async function version(context: HttpFlowContext, orderId: string): Promise<number> {
  return record(ok(await context.send("manager", "POST", "/orders/detail", { schemaVersion: 1, scope: context.scope, orderId }), "order_detail")).version as number;
}

async function kdsOrderIds(context: HttpFlowContext): Promise<string[]> {
  const tickets = ok(await context.send("manager", "GET", `/kds/tickets${context.query({ ...context.scope, stationId: "kitchen" })}`), "kds_tickets");
  return (tickets.tickets as Json[]).map((ticket) => ticket.orderId as string);
}

async function collectCash(context: HttpFlowContext, register: OpenRegister, orderId: string, amountMinor: number): Promise<Json> {
  const cash = await checkout(context, register, orderId);
  return ok(await context.send("cashier", "POST", "/payments/collect", { ...context.audit(), schemaVersion: 1, scope: context.scope,
    cashRegisterSessionId: register.cashRegisterSessionId, cashRegisterExpectedVersion: cash.cashRegisterVersion, orderId,
    orderExpectedVersion: cash.orderVersion, paymentId: randomUUID(), localSequence: cash.nextLocalSequence, amountMinor,
    method: "cash", tenderedAmountMinor: amountMinor, tipMinor: 0, cardManualEvidence: null }), "collect_cash");
}

/** Whole-order cancellation over HTTP: no obligation, pending obligation with the captured amount, active delivery, replay, role and tray. */
export async function cancellationFlow(): Promise<void> {
  await runHttpFlow({ databasePrefix: "superrestaurant_http_cancel", marker, stage: "http_flow_cancellation" }, async (context) => {
    const { scope, fixtures } = context;
    const categoryId = randomUUID();
    const productId = randomUUID();
    const { catalogVersion } = await publishCatalog(context, {
      categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Hamburguesa", sku: "HAM-001", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece", unitPriceMinor, tax: null }],
      modifierGroups: [],
    });
    const register = await openShiftAndRegister(context, 0);
    const lines = () => [
      { lineId: randomUUID(), productId, variantId: null, quantity: 1 },
      { lineId: randomUUID(), productId, variantId: null, quantity: 1 },
    ];

    // 1. Counter order, two lines sent to the kitchen, cancelled by the manager: no refund obligation.
    const unpaid = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId, lines: lines() });
    await sendOrderToKitchen(context, unpaid.orderId);
    assert.ok((await kdsOrderIds(context)).includes(unpaid.orderId));
    const unpaidVersion = await version(context, unpaid.orderId);
    assert.equal((await cancel(context, "cashier", unpaid.orderId, unpaidVersion)).status, 403);
    const command = { ...context.audit(), schemaVersion: 1, scope, orderId: unpaid.orderId, expectedVersion: unpaidVersion, reason };
    const cancelled = ok(await context.send("manager", "POST", "/orders/cancel", command), "cancel_unpaid");
    assert.equal(cancelled.orderStatus, "cancelled");
    assert.equal(cancelled.replayed, false);
    assert.equal(record(cancelled.refundObligation).status, "none");
    assert.equal(record(cancelled.refundObligation).capturedMinor, 0);
    assert.equal((cancelled.kdsEvents as Json[]).length, 2);
    context.check("cancel_unpaid_two_lines_no_obligation_cashier_403");

    // 2. Idempotent replay of the identical command.
    const replay = ok(await context.send("manager", "POST", "/orders/cancel", command), "cancel_replay");
    assert.equal(replay.replayed, true);
    context.check("cancel_replay_identical_is_replayed");

    // 3. Partially paid order: the captured amount becomes a pending obligation.
    const partial = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId, lines: lines() });
    await sendOrderToKitchen(context, partial.orderId);
    assert.equal((await collectCash(context, register, partial.orderId, partialMinor)).orderStatus, "partially_paid");
    const partialCancelled = ok(await cancel(context, "manager", partial.orderId, await version(context, partial.orderId)), "cancel_partial");
    const obligation = record(partialCancelled.refundObligation);
    assert.equal(obligation.status, "pending");
    assert.equal(obligation.capturedMinor, partialMinor);
    context.check("cancel_partially_paid_pending_obligation_with_captured");

    // 4. Delivery in transit cannot be cancelled.
    await createCoveredZone(context, feeMinor, "83000");
    const customer = await createCustomerWithAddress(context, "83000");
    const delivery = await captureAndConfirm(context, { catalogVersion, customer, shiftId: register.shiftId, lines: lines().slice(0, 1) });
    await sendOrderToKitchen(context, delivery.orderId);
    const assigned = record(record(ok(await context.send("cashier", "POST", "/deliveries/assign", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId,
      expectedVersion: 0, courierUserId: fixtures.actorIds.courier }), "assign")).delivery);
    const dispatched = record(record(ok(await context.send("courier", "POST", "/deliveries/dispatch", { ...context.audit(), schemaVersion: 1, scope, orderId: delivery.orderId,
      expectedVersion: assigned.version }), "dispatch")).delivery);
    assert.equal(dispatched.state, "en_route");
    const refused = await cancel(context, "manager", delivery.orderId, await version(context, delivery.orderId));
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "DELIVERY_ACTIVE");
    context.check("cancel_en_route_delivery_409_delivery_active");

    // 5. "Canceladas" lists both with the reason; KDS no longer shows their lines.
    const tray = ok(await context.send("manager", "POST", "/orders/cancelled", { schemaVersion: 1, scope, limit: 50, cursor: null }), "cancelled_tray");
    const items = tray.items as Json[];
    const byId = (orderId: string) => items.find((item) => item.orderId === orderId);
    for (const orderId of [unpaid.orderId, partial.orderId]) {
      assert.equal(record(byId(orderId)).reason, reason, `tray item for ${orderId}: ${JSON.stringify(tray).slice(0, 600)}`);
    }
    assert.equal(record(record(byId(partial.orderId)).refundObligation).status, "pending");
    assert.equal(byId(delivery.orderId), undefined);
    const kds = await kdsOrderIds(context);
    assert.ok(!kds.includes(unpaid.orderId) && !kds.includes(partial.orderId));
    assert.ok(kds.includes(delivery.orderId));
    context.check("cancelled_tray_lists_both_with_reason_and_kds_clears_lines");
    return { partialMinor };
  });
}
