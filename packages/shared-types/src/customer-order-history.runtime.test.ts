import {
  CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
  CUSTOMER_RECENT_ORDER_LIMIT,
  parseCustomerRecentOrderListV1,
  parseCustomerRecentOrdersQueryV1,
} from "./index.js";

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const restaurantId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const orderItemId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";
const groupId = "77777777-7777-4777-8777-777777777777";
const modifierId = "88888888-8888-4888-8888-888888888888";

const query = {
  customerId,
  limit: 10,
  schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
  scope: { branchId, restaurantId },
};
const parsedQuery = parseCustomerRecentOrdersQueryV1({
  ...query,
  customerId: customerId.toUpperCase(),
  scope: { branchId: branchId.toUpperCase(), restaurantId: restaurantId.toUpperCase() },
});
expect(parsedQuery?.customerId === customerId && parsedQuery.scope.branchId === branchId,
  "history query normalizes exact UUID scope and customer identity");
expect(Object.isFrozen(parsedQuery) && Object.isFrozen(parsedQuery?.scope),
  "history query is detached and frozen");
expect(parseCustomerRecentOrdersQueryV1({ ...query, limit: 0 }) === undefined,
  "history query rejects a zero limit");
expect(parseCustomerRecentOrdersQueryV1({ ...query, limit: CUSTOMER_RECENT_ORDER_LIMIT + 1 }) === undefined,
  "history query caps result size");
expect(parseCustomerRecentOrdersQueryV1({ ...query, orderId }) === undefined,
  "history list cannot be widened to a caller-selected Order");

const recentOrder = {
  confirmedAt: "2026-09-23T12:00:00.000Z",
  currency: "MXN",
  fulfillmentChannel: "delivery",
  items: [{
    modifiers: [{
      groupId,
      groupName: "Ingredientes",
      modifierId,
      name: "Queso extra",
      quantity: 1,
      unitPriceMinor: 250,
    }],
    orderItemId,
    productId,
    productName: "Pizza grande",
    quantity: 2,
    status: "delivered",
    unit: "pieza",
    unitPriceMinor: 18_000,
  }],
  orderId,
  status: "closed",
};
const parsedList = parseCustomerRecentOrderListV1({
  customerId,
  orders: [recentOrder, {
    ...recentOrder,
    confirmedAt: "2026-09-22T12:00:00.000Z",
    orderId: "99999999-9999-4999-8999-999999999999",
  }],
  schemaVersion: CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
  scope: query.scope,
});
expect(parsedList?.orders.length === 2 && parsedList.orders[0]?.items[0]?.modifiers[0]?.unitPriceMinor === 250,
  "history list preserves bounded historical item and modifier facts");
expect(Object.isFrozen(parsedList) && Object.isFrozen(parsedList?.orders)
  && Object.isFrozen(parsedList?.orders[0]?.items) && Object.isFrozen(parsedList?.orders[0]?.items[0]?.modifiers),
"history result is deeply frozen at every public collection boundary");

expect(parseCustomerRecentOrderListV1({
  customerId,
  orders: [
    { ...recentOrder, confirmedAt: "2026-09-22T12:00:00.000Z" },
    { ...recentOrder, confirmedAt: "2026-09-23T12:00:00.000Z", orderId: "99999999-9999-4999-8999-999999999999" },
  ],
  schemaVersion: 1,
  scope: query.scope,
}) === undefined, "history must be newest-first");
expect(parseCustomerRecentOrderListV1({
  customerId,
  orders: [recentOrder, recentOrder],
  schemaVersion: 1,
  scope: query.scope,
}) === undefined, "history rejects duplicate Orders");
expect(parseCustomerRecentOrderListV1({
  customerId,
  orders: [{ ...recentOrder, items: [{ ...recentOrder.items[0], modifiers: [
    recentOrder.items[0]!.modifiers[0], recentOrder.items[0]!.modifiers[0],
  ] }] }],
  schemaVersion: 1,
  scope: query.scope,
}) === undefined, "history rejects duplicate modifier identity");
expect(parseCustomerRecentOrderListV1({
  customerId,
  orders: [{ ...recentOrder, items: [{ ...recentOrder.items[0], modifiers: [{
    ...recentOrder.items[0]!.modifiers[0], groupName: null,
  }] }] }],
  schemaVersion: 1,
  scope: query.scope,
}) === undefined, "history requires modifier group id and label together");
expect(parseCustomerRecentOrderListV1({
  customerId,
  orders: Array.from({ length: CUSTOMER_RECENT_ORDER_LIMIT + 1 }, (_, index) => ({
    ...recentOrder,
    orderId: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
  })),
  schemaVersion: 1,
  scope: query.scope,
}) === undefined, "history result cannot exceed its public bound");

let invoked = false;
const accessor = { ...query };
Object.defineProperty(accessor, "customerId", {
  enumerable: true,
  get: () => {
    invoked = true;
    return customerId;
  },
});
expect(parseCustomerRecentOrdersQueryV1(accessor) === undefined && !invoked,
  "history parser rejects accessors without invoking them");

const sparseOrders = new Array(1) as unknown[];
expect(parseCustomerRecentOrderListV1({
  customerId,
  orders: sparseOrders,
  schemaVersion: 1,
  scope: query.scope,
}) === undefined, "history parser rejects sparse arrays");
