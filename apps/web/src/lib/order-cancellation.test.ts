import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchScope, parseCancelOrderCommandV1, type CancelledWorkItemV1, type CancelOrderResultV1 } from "@super-restaurant/shared-types";
import {
  buildCancelOrderCommand,
  cancelOrderErrorMessage,
  cancelOrderResultMessage,
  cancelOrderWarning,
  cancelledItemKey,
  cancelledItemRefundLabel,
  cancelledItemTitle,
  cancelledItemTotalLabel,
  conflictErrorFromBody,
  mergeCancelledItems,
  orderHasCapturedMoney,
  refundObligationMessage,
  validCancelReason,
} from "./order-cancellation";

const scope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (scope === undefined) throw new Error("Invalid test scope.");
const ORDER_ID = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const ACTOR = "9d1a1e5c-2f3b-4c0e-8a55-3b9a0d1c2e41";

test("buildCancelOrderCommand trims the reason and yields a command the server parser accepts", () => {
  const command = buildCancelOrderCommand({
    deviceId: "9D1A1E5C-2F3B-4C0E-8A55-3B9A0D1C2E42", eventId: "5f0a1e5c-2f3b-4c0e-8a55-3b9a0d1c2e43",
    expectedVersion: 4, idempotencyKey: "key-1", occurredAt: "2026-10-06T15:00:00.000Z", orderId: ORDER_ID,
    reason: "  Cliente se arrepintió  ", scope,
  });
  assert.equal(command.reason, "Cliente se arrepintió");
  assert.equal(command.deviceId, "9d1a1e5c-2f3b-4c0e-8a55-3b9a0d1c2e42");
  assert.notEqual(parseCancelOrderCommandV1(command), undefined);
});

test("validCancelReason enforces 1..200 after trimming and rejects control characters", () => {
  assert.equal(validCancelReason("   "), undefined);
  assert.equal(validCancelReason(" ok "), "ok");
  assert.equal(validCancelReason("a".repeat(200)), "a".repeat(200));
  assert.equal(validCancelReason("a".repeat(201)), undefined);
  assert.equal(validCancelReason("uno\u0000dos"), undefined);
});

test("conflict bodies map to the specific blocker and everything else is a stale version", () => {
  assert.equal(conflictErrorFromBody({ code: "DELIVERY_ACTIVE" }), "delivery_active");
  assert.equal(conflictErrorFromBody({ code: "PAYMENT_IN_FLIGHT" }), "payment_in_flight");
  assert.equal(conflictErrorFromBody({ code: "OTHER" }), "conflict");
  assert.equal(conflictErrorFromBody(undefined), "conflict");
  assert.equal(conflictErrorFromBody([]), "conflict");
  assert.equal(cancelOrderErrorMessage("delivery_active"), "Primero marca la entrega como no realizada o liquídala.");
  assert.match(cancelOrderErrorMessage("payment_in_flight"), /cobro en proceso/u);
});

test("the warning and obligation message appear only when money was captured", () => {
  assert.equal(orderHasCapturedMoney({ status: "open" }), false);
  assert.equal(orderHasCapturedMoney({ status: "partially_paid" }), true);
  assert.equal(cancelOrderWarning({ status: "draft" }), undefined);
  assert.match(cancelOrderWarning({ status: "paid" }) ?? "", /pendiente devolverlo en caja/u);
  assert.equal(refundObligationMessage({ capturedMinor: 0, capturedTipMinor: 0, currency: "MXN", status: "none" }), undefined);
  const withMoney = refundObligationMessage({ capturedMinor: 25_000, capturedTipMinor: 0, currency: "MXN", status: "pending" }) ?? "";
  assert.match(withMoney, /^Queda pendiente devolver .*250\.00 en caja\.$/u);
  const withTip = refundObligationMessage({ capturedMinor: 25_000, capturedTipMinor: 2_500, currency: "MXN", status: "pending" }) ?? "";
  assert.match(withTip, /275\.00/u);
  assert.match(withTip, /incluye .*25\.00 de propina/u);
});

test("cancelOrderResultMessage distinguishes a replay and includes the obligation", () => {
  const base = {
    kdsEvents: [], orderId: ORDER_ID, orderStatus: "cancelled", replayed: false, schemaVersion: 1, scope, version: 5,
    refundObligation: { capturedMinor: 10_000, capturedTipMinor: 0, currency: "MXN", status: "pending" },
  } as const satisfies CancelOrderResultV1;
  assert.match(cancelOrderResultMessage(base), /^Orden cancelada\. Queda pendiente devolver/u);
  assert.match(cancelOrderResultMessage({ ...base, replayed: true }), /^La orden ya estaba cancelada/u);
  const none = { ...base, refundObligation: { capturedMinor: 0, capturedTipMinor: 0, currency: "MXN", status: "none" } } as const;
  assert.equal(cancelOrderResultMessage(none), "Orden cancelada.");
});

const orderItem: CancelledWorkItemV1 = {
  cancelledAt: "2026-10-06T21:30:00.000Z", cancelledByActorId: ACTOR, channel: "delivery", customerLabel: null,
  fromStatus: "paid", kind: "order", lineCount: 2, orderId: ORDER_ID, reason: "Duplicada",
  refundObligation: { capturedMinor: 30_000, capturedTipMinor: 0, currency: "MXN", status: "pending" },
  timeZone: "America/Mexico_City", totalMinor: 30_000, version: 6,
};
const captureItem: CancelledWorkItemV1 = {
  cancelledAt: "2026-10-06T20:00:00.000Z", cancelledByActorId: ACTOR, captureDraftId: "7a1a1e5c-2f3b-4c0e-8a55-3b9a0d1c2e44",
  folio: "C-0012", fulfillmentChannel: "delivery", kind: "capture", reason: "No contestó", sourceChannel: "phone",
};

test("cancelled list labels cover orders and captures", () => {
  assert.equal(cancelledItemTitle(orderItem), "Orden · Domicilio");
  assert.equal(cancelledItemTitle(captureItem), "Captura C-0012 · Teléfono");
  assert.match(cancelledItemRefundLabel(orderItem) ?? "", /^Devolución pendiente .*300\.00$/u);
  assert.equal(cancelledItemRefundLabel(captureItem), undefined);
  assert.equal(cancelledItemRefundLabel({ ...orderItem, fromStatus: "open", refundObligation: { capturedMinor: 0, capturedTipMinor: 0, currency: "MXN", status: "none" } }), undefined);
  assert.match(cancelledItemTotalLabel(orderItem) ?? "", /300\.00/u);
  assert.equal(cancelledItemTotalLabel(captureItem), undefined);
  assert.equal(cancelledItemTotalLabel({ ...orderItem, totalMinor: null }), undefined);
});

test("mergeCancelledItems appends only unseen rows and keys separate orders from captures", () => {
  assert.notEqual(cancelledItemKey(orderItem), cancelledItemKey(captureItem));
  const merged = mergeCancelledItems([orderItem], [orderItem, captureItem]);
  assert.deepEqual(merged.map(cancelledItemKey), [cancelledItemKey(orderItem), cancelledItemKey(captureItem)]);
});
