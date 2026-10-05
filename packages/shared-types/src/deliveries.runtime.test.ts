import {
  MEMBERSHIP_ROLE_CODES,
  parseAssignDeliveryCommandV1,
  parseBranchDeliveriesRequestV1,
  parseBranchDeliveriesV1,
  parseBranchMembersRequestV1,
  parseBranchMembersV1,
  parseCompleteDeliveryCommandV1,
  parseDispatchDeliveryCommandV1,
  parseFailDeliveryCommandV1,
  parseOrderDeliveryResultV1,
  parseOrderDeliveryV1,
  parseOrderDetailV1,
  parseSettleDeliveryCommandV1,
  parseSettleDeliveryResultV1,
  RBAC_PERMISSION_CODES,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const restaurantId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const courierId = "44444444-4444-4444-8444-444444444444";
const scope = { branchId, restaurantId };
const audit = {
  deviceId: "55555555-5555-4555-8555-555555555555",
  eventId: "66666666-6666-4666-8666-666666666666",
  idempotencyKey: "delivery-key-1",
  occurredAt: "2026-10-06T18:00:00.000Z",
};

expect((MEMBERSHIP_ROLE_CODES as readonly string[]).includes("courier"), "courier is a membership role");
for (const permission of ["deliveries.read", "deliveries.update.own", "deliveries.manage", "memberships.read"]) {
  expect((RBAC_PERMISSION_CODES as readonly string[]).includes(permission), `${permission} is a permission`);
}

const base = { ...audit, expectedVersion: 0, orderId, schemaVersion: 1, scope };
expect(parseAssignDeliveryCommandV1({ ...base, courierUserId: courierId }) !== undefined, "assign parses");
expect(parseAssignDeliveryCommandV1({ ...base, courierUserId: "x" }) === undefined, "assign rejects a non-UUID courier");
expect(parseAssignDeliveryCommandV1({ ...base }) === undefined, "assign requires a courier");
expect(parseAssignDeliveryCommandV1({ ...base, courierUserId: courierId, extra: 1 }) === undefined, "assign is exact");
expect(parseDispatchDeliveryCommandV1({ ...base, expectedVersion: 0 }) === undefined, "dispatch needs an existing row");
expect(parseDispatchDeliveryCommandV1({ ...base, expectedVersion: 1 }) !== undefined, "dispatch parses");
expect(parseCompleteDeliveryCommandV1({ ...base, expectedVersion: 2 }) !== undefined, "complete parses");
expect(parseFailDeliveryCommandV1({ ...base, expectedVersion: 2, reason: "Nadie abrio" }) !== undefined, "fail parses");
expect(parseFailDeliveryCommandV1({ ...base, expectedVersion: 2, reason: " " }) === undefined, "fail requires a reason");
expect(parseFailDeliveryCommandV1({ ...base, expectedVersion: 2 }) === undefined, "fail requires the reason key");

const settle = {
  ...base,
  cashRegisterExpectedVersion: 3,
  cashRegisterSessionId: "77777777-7777-4777-8777-777777777777",
  expectedVersion: 3,
  localSequence: 4,
  orderExpectedVersion: 5,
  paymentId: "88888888-8888-4888-8888-888888888888",
  tenderedAmountMinor: null,
  tipMinor: null,
};
expect(parseSettleDeliveryCommandV1(settle) !== undefined, "settle parses with null tender/tip (use intent)");
expect(parseSettleDeliveryCommandV1({ ...settle, tenderedAmountMinor: 50_000, tipMinor: 2_000 }) !== undefined, "settle parses with explicit tender/tip");
expect(parseSettleDeliveryCommandV1({ ...settle, tipMinor: -1 }) === undefined, "settle rejects a negative tip");
expect(parseSettleDeliveryCommandV1({ ...settle, tenderedAmountMinor: 10.5 }) === undefined, "settle rejects a float tender");
expect(parseSettleDeliveryCommandV1({ ...settle, amountMinor: 100 }) === undefined, "settle never accepts a client amount");
expect(parseSettleDeliveryCommandV1({ ...settle, method: "cash" }) === undefined, "settle never accepts a client method");

const delivery = {
  assignedAt: "2026-10-06T18:00:00.000Z",
  attemptCount: 0,
  courierUserId: courierId,
  deliveredAt: null,
  dispatchedAt: null,
  failedReason: null,
  orderId,
  schemaVersion: 1,
  scope,
  settledAt: null,
  settledPaymentId: null,
  state: "assigned",
  version: 1,
};
expect(parseOrderDeliveryV1(delivery) !== undefined, "assigned delivery parses");
expect(parseOrderDeliveryV1({ ...delivery, state: "pending", version: 0, courierUserId: null, assignedAt: null }) !== undefined, "virtual pending parses");
expect(parseOrderDeliveryV1({ ...delivery, state: "pending" }) === undefined, "pending with a version is invalid");
expect(parseOrderDeliveryV1({ ...delivery, state: "settled" }) === undefined, "settled needs a payment");
expect(parseOrderDeliveryV1({ ...delivery, state: "failed" }) === undefined, "failed needs a reason");
expect(parseOrderDeliveryV1({ ...delivery, attemptCount: 3 }) === undefined, "attempts are capped at two");
expect(parseOrderDeliveryV1({ ...delivery, state: "teleported" }) === undefined, "unknown state rejected");
expect(parseOrderDeliveryResultV1({ delivery, replayed: false, schemaVersion: 1 }) !== undefined, "result parses");
expect(parseOrderDeliveryResultV1({ delivery, replayed: "no", schemaVersion: 1 }) === undefined, "result replayed is boolean");

const payment = {
  amountMinor: 25_000, cashRegisterSessionId: settle.cashRegisterSessionId, cashRegisterVersion: 4,
  changeMinor: 5_000, currency: "MXN", method: "cash", orderId, orderStatus: "paid", orderVersion: 6,
  paymentId: settle.paymentId, paymentState: "captured", remainingBalanceMinor: 0, replayed: false,
  schemaVersion: 1, scope, tenderedAmountMinor: 30_000, tipMinor: 1_000,
};
const settledDelivery = {
  ...delivery, deliveredAt: "2026-10-06T18:30:00.000Z", dispatchedAt: "2026-10-06T18:10:00.000Z",
  settledAt: "2026-10-06T18:40:00.000Z", settledPaymentId: settle.paymentId, state: "settled", version: 4,
  attemptCount: 1,
};
expect(parseSettleDeliveryResultV1({ delivery: settledDelivery, payment, replayed: false, schemaVersion: 1 }) !== undefined, "settle result parses");
expect(parseSettleDeliveryResultV1({ delivery: settledDelivery, replayed: false, schemaVersion: 1 }) === undefined, "settle result needs a payment");

expect(parseBranchDeliveriesRequestV1({ schemaVersion: 1, scope }) !== undefined, "list request parses");
expect(parseBranchDeliveriesRequestV1({ schemaVersion: 1, scope, extra: true }) === undefined, "list request is exact");
const item = {
  addressLabel: null, courierLabel: null, currency: "MXN", customerLabel: null, delivery, orderStatus: "open",
  paymentIntent: { method: "cash", tenderedAmountMinor: null, tipMinor: 0 },
  promiseEnd: null, promiseStart: null, totalMinor: 25_000,
};
expect(parseBranchDeliveriesV1({ items: [item], schemaVersion: 1, scope }) !== undefined, "branch deliveries parse");
expect(parseBranchDeliveriesV1({ items: [item, item], schemaVersion: 1, scope }) === undefined, "duplicate orders rejected");
expect(
  parseBranchDeliveriesV1({ items: [{ ...item, delivery: { ...delivery, scope: { branchId: restaurantId, restaurantId } } }], schemaVersion: 1, scope }) === undefined,
  "items outside the envelope scope rejected",
);
expect(parseBranchDeliveriesV1({ items: [{ ...item, orderStatus: "paid" }], schemaVersion: 1, scope }) === undefined, "settled orders are not listed");

expect(parseBranchMembersRequestV1({ roles: ["courier"], schemaVersion: 1, scope }) !== undefined, "members request parses");
expect(parseBranchMembersRequestV1({ roles: null, schemaVersion: 1, scope }) !== undefined, "members request accepts all roles");
expect(parseBranchMembersRequestV1({ roles: ["pirate"], schemaVersion: 1, scope }) === undefined, "unknown role rejected");
expect(parseBranchMembersRequestV1({ roles: ["courier", "courier"], schemaVersion: 1, scope }) === undefined, "duplicate role rejected");
expect(parseBranchMembersRequestV1({ roles: [], schemaVersion: 1, scope }) === undefined, "empty role list rejected");
const members = { members: [{ displayName: null, roles: ["courier"], userId: courierId }], schemaVersion: 1, scope };
expect(parseBranchMembersV1(members) !== undefined, "members parse");
expect(parseBranchMembersV1({ ...members, members: [members.members[0], members.members[0]] }) === undefined, "duplicate member rejected");
expect(parseBranchMembersV1({ ...members, members: [{ ...members.members[0], email: "a@b.c" }] }) === undefined, "members never carry email");

const detail = {
  availableActions: [], channel: "delivery", createdAt: null, currency: "MXN",
  fulfillment: { addressLabel: null, channel: "delivery", customerLabel: null, paymentIntent: null, tableId: null },
  items: [], orderId, schemaVersion: 1, scope, status: "open", tableId: null, timeZone: "America/Mexico_City",
  totals: { currency: "MXN", deliveryChargeMinor: 0, itemsTotalMinor: 0, tipMinor: 0, totalMinor: 0 },
  updatedAt: null, version: 1,
};
expect(parseOrderDetailV1(detail) !== undefined, "detail without the additive keys still parses");
expect(parseOrderDetailV1({ ...detail, delivery: null }) !== undefined, "detail accepts delivery null");
expect(parseOrderDetailV1({ ...detail, delivery }) !== undefined, "detail accepts a delivery");
expect(parseOrderDetailV1({ ...detail, delivery: { ...delivery, orderId: courierId } }) === undefined, "detail delivery must match the order");
expect(parseOrderDetailV1({ ...detail, channel: "counter", fulfillment: { ...detail.fulfillment, channel: "counter" }, delivery }) === undefined, "only delivery orders carry a delivery");
expect(
  parseOrderDetailV1({ ...detail, fulfillment: { ...detail.fulfillment, quote: { feeMinor: 3_000, promiseEnd: null, promiseStart: null, zoneId: null } } }) !== undefined,
  "detail accepts a frozen quote",
);
expect(
  parseOrderDetailV1({ ...detail, fulfillment: { ...detail.fulfillment, quote: { feeMinor: 1.5, promiseEnd: null, promiseStart: null, zoneId: null } } }) === undefined,
  "detail quote fee is an integer",
);
