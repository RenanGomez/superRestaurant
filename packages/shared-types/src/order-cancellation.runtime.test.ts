import {
  ORDER_DETAIL_ACTIONS,
  RBAC_PERMISSION_CODES,
  parseCancelOrderCommandV1,
  parseCancelOrderResultV1,
  parseCancelledWorkItemV1,
  parseCancelledWorkTrayRequestV1,
  parseCancelledWorkTrayV1,
  parseOrderDetailV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const restaurantId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
const scope = { restaurantId, branchId };

const command = {
  schemaVersion: 1, scope, orderId, expectedVersion: 3, reason: "Cliente se arrepintio",
  eventId: "55555555-5555-4555-8555-555555555555", idempotencyKey: "cancel-1",
  deviceId: "66666666-6666-4666-8666-666666666666", occurredAt: "2026-10-06T12:00:00.000Z",
};
expect(Object.isFrozen(parseCancelOrderCommandV1(command)), "valid cancel command parses frozen");
for (const invalid of [
  { ...command, extra: true },
  { ...command, reason: "" },
  { ...command, reason: " padded " },
  { ...command, reason: "x".repeat(201) },
  { ...command, reason: "tab\there" },
  { ...command, expectedVersion: 0 },
  { ...command, expectedVersion: 1.5 },
  { ...command, occurredAt: "2026-10-06T12:00:00Z" },
  { ...command, orderId: "nope" },
  { ...command, authorization: { approved: true } },
  { ...command, schemaVersion: 2 },
]) expect(parseCancelOrderCommandV1(invalid) === undefined, `cancel command rejects ${JSON.stringify(invalid)}`);
expect(parseCancelOrderCommandV1({ ...command, reason: "x".repeat(200) }) !== undefined, "200 character reason is allowed");
const { reason: _reason, ...withoutReason } = command;
expect(parseCancelOrderCommandV1(withoutReason) === undefined, "reason is mandatory");
expect(
  parseCancelOrderCommandV1(new Proxy(command, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "hostile proxy fails closed",
);

const kdsEvent = {
  schemaVersion: 1, scope, cursor: "v1:7", eventId: "77777777-7777-4777-8777-777777777777", orderId,
  orderItemId: "88888888-8888-4888-8888-888888888888", stationId: "kitchen", operation: "order_item.status_changed",
  status: "cancelled", occurredAt: "2026-10-06T12:00:00.000Z", receivedAt: "2026-10-06T12:00:00.100Z",
};
const obligation = { status: "pending", capturedMinor: 4500, capturedTipMinor: 200, currency: "MXN" };
const result = {
  schemaVersion: 1, scope, orderId, orderStatus: "cancelled", version: 5, replayed: false,
  refundObligation: obligation, kdsEvents: [kdsEvent],
};
expect(parseCancelOrderResultV1(result) !== undefined, "valid result parses");
for (const invalid of [
  { ...result, orderStatus: "open" },
  { ...result, version: 1 },
  { ...result, refundObligation: { ...obligation, status: "none" } },
  { ...result, refundObligation: { ...obligation, currency: "mxn" } },
  { ...result, kdsEvents: [{ ...kdsEvent, status: "sent" }] },
  { ...result, kdsEvents: [{ ...kdsEvent, orderId: other }] },
  { ...result, kdsEvents: [{ ...kdsEvent, scope: { restaurantId, branchId: other } }] },
  { ...result, extra: 1 },
]) expect(parseCancelOrderResultV1(invalid) === undefined, `result rejects ${JSON.stringify(invalid).slice(0, 80)}`);
expect(
  parseCancelOrderResultV1({ ...result, refundObligation: { status: "none", capturedMinor: 0, capturedTipMinor: 0, currency: "MXN" } }) !== undefined,
  "none obligation with zero money parses",
);

const request = { schemaVersion: 1, scope, limit: 20, cursor: null };
expect(parseCancelledWorkTrayRequestV1(request) !== undefined, "tray request parses");
expect(
  parseCancelledWorkTrayRequestV1({ ...request, cursor: { at: "2026-10-06T12:00:00.123456Z", id: other } }) !== undefined,
  "microsecond cursor parses",
);
for (const invalid of [
  { ...request, limit: 0 }, { ...request, limit: 101 }, { ...request, cursor: { at: "2026-10-06T12:00:00.123Z", id: other } },
  { ...request, cursor: { at: "2026-10-06T12:00:00.123456Z" } }, { ...request, extra: 1 },
]) expect(parseCancelledWorkTrayRequestV1(invalid) === undefined, `tray request rejects ${JSON.stringify(invalid).slice(0, 80)}`);

const orderItem = {
  kind: "order", orderId, channel: "counter", fromStatus: "paid", version: 5, cancelledAt: "2026-10-06T12:00:00.000Z",
  reason: "Pedido duplicado", cancelledByActorId: other, refundObligation: obligation, totalMinor: 9800, lineCount: 2,
  customerLabel: null, timeZone: "America/Hermosillo",
};
const captureItem = {
  kind: "capture", captureDraftId: "99999999-9999-4999-8999-999999999999", folio: "C-0001", sourceChannel: "phone",
  fulfillmentChannel: null, cancelledAt: "2026-10-06T11:00:00.000Z", reason: "Cliente colgo", cancelledByActorId: other,
};
expect(parseCancelledWorkItemV1(orderItem) !== undefined && parseCancelledWorkItemV1(captureItem) !== undefined, "both kinds parse");
for (const invalid of [
  { ...orderItem, refundObligation: { ...obligation, status: "none", capturedMinor: 0, capturedTipMinor: 0 } },
  { ...orderItem, fromStatus: "closed" }, { ...orderItem, totalMinor: -1 }, { ...orderItem, customerLabel: "" },
  { ...orderItem, extra: 1 }, { ...captureItem, sourceChannel: "fax" }, { ...captureItem, reason: "" },
  { ...captureItem, kind: "other" },
]) expect(parseCancelledWorkItemV1(invalid) === undefined, `item rejects ${JSON.stringify(invalid).slice(0, 80)}`);

const tray = { schemaVersion: 1, scope, items: [orderItem, captureItem], nextCursor: null };
expect(parseCancelledWorkTrayV1(tray) !== undefined, "tray parses");
expect(parseCancelledWorkTrayV1({ ...tray, items: [orderItem, orderItem] }) === undefined, "duplicate ids fail");
expect(parseCancelledWorkTrayV1({ ...tray, items: [{ ...orderItem, extra: 1 }] }) === undefined, "hostile item fails the page");
expect(parseCancelledWorkTrayV1({ ...tray, nextCursor: { at: "bad", id: other } }) === undefined, "bad cursor fails");

expect((ORDER_DETAIL_ACTIONS as readonly string[]).includes("cancelOrder"), "detail offers cancelOrder");
expect((RBAC_PERMISSION_CODES as readonly string[]).includes("orders.cancel.order"), "permission code exists");
expect(typeof parseOrderDetailV1 === "function", "detail parser still exported");
