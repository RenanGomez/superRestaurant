import {
  CUSTOMER_ORDER_HISTORY_SCHEMA_VERSION,
  CUSTOMER_RECENT_ORDER_LIMIT,
  parseCustomerRecentOrderListV1,
  parseCustomerRecentOrdersQueryV1,
  parseCustomerRepeatOrderPreviewQueryV1,
  parseCustomerRepeatOrderPreviewV1,
  parseCustomerRepeatOrderCaptureResultV1,
  parseRepeatCustomerOrderIntoCaptureCommandV1,
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

const previewQuery = parseCustomerRepeatOrderPreviewQueryV1({
  customerId,
  orderId,
  schemaVersion: 1,
  scope: query.scope,
});
if (previewQuery === undefined) throw new Error("valid repeat preview query rejected");
expect(previewQuery.orderId === orderId && Object.isFrozen(previewQuery.scope),
  "repeat preview query binds and freezes exact Customer, Order and Branch scope");
expect(parseCustomerRepeatOrderPreviewQueryV1({ ...previewQuery, limit: 20 }) === undefined,
  "repeat preview query rejects caller-controlled history bounds");

const warning = {
  code: "product_price_changed",
  currentAmountMinor: 19_000,
  groupId: null,
  historicalAmountMinor: 18_000,
  modifierId: null,
  severity: "warning",
};
const blocking = {
  code: "product_removed",
  currentAmountMinor: null,
  groupId: null,
  historicalAmountMinor: null,
  modifierId: null,
  severity: "blocking",
};
const preview = {
  blockedLineCount: 1,
  catalogVersion: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  currency: "MXN",
  customerId,
  hasPriceChanges: true,
  lines: [{
    currentName: "Pizza grande",
    currentUnitPriceMinor: 19_000,
    historicalName: "Pizza grande",
    issues: [warning],
    productId,
    quantity: 2,
    sourceOrderItemId: orderItemId,
    status: "ready",
  }, {
    currentName: null,
    currentUnitPriceMinor: null,
    historicalName: "Producto retirado",
    issues: [blocking],
    productId: "99999999-9999-4999-8999-999999999999",
    quantity: 1,
    sourceOrderItemId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    status: "blocked",
  }],
  readyLineCount: 1,
  schemaVersion: 1,
  scope: query.scope,
  sourceOrderId: orderId,
};
const parsedPreview = parseCustomerRepeatOrderPreviewV1(preview);
expect(parsedPreview?.readyLineCount === 1 && parsedPreview.blockedLineCount === 1
  && parsedPreview.lines[0]?.currentUnitPriceMinor === 19_000,
"repeat preview preserves only current public price and explicit reconciliation issues");
expect(Object.isFrozen(parsedPreview) && Object.isFrozen(parsedPreview?.lines)
  && Object.isFrozen(parsedPreview?.lines[0]?.issues),
"repeat preview is deeply frozen");
expect(parseCustomerRepeatOrderPreviewV1({ ...preview, readyLineCount: 2 }) === undefined,
  "repeat preview rejects divergent derived counts");
expect(parseCustomerRepeatOrderPreviewV1({ ...preview, hasPriceChanges: false }) === undefined,
  "repeat preview rejects hidden price changes");
expect(parseCustomerRepeatOrderPreviewV1({ ...preview, readyLineCount: 0, blockedLineCount: 2, lines: [{
  ...preview.lines[0], status: "blocked", currentUnitPriceMinor: null,
}, preview.lines[1]] }) === undefined, "blocked preview lines require a blocking issue");
expect(parseCustomerRepeatOrderPreviewV1({ ...preview, lines: [{
  ...preview.lines[0], issues: [{ ...warning, severity: "blocking" }],
}, preview.lines[1]] }) === undefined, "price changes cannot be mislabeled as blocking");

const variantBlocking = { ...blocking, code: "variant_required" };
const variantBlockedLine = {
  ...preview.lines[1],
  blockedReason: "variant_required",
  currentName: null,
  historicalName: "Pizza sin tamano",
  issues: [variantBlocking],
};
const variantPreview = { ...preview, lines: [preview.lines[0], variantBlockedLine] };
const parsedVariantPreview = parseCustomerRepeatOrderPreviewV1(variantPreview);
expect(parsedVariantPreview?.lines[1]?.blockedReason === "variant_required"
  && parsedVariantPreview.lines[0]?.blockedReason === null
  && parsedPreview?.lines[1]?.blockedReason === null,
"repeat preview carries blockedReason, normalized to null when absent");
expect(parseCustomerRepeatOrderPreviewV1({ ...variantPreview, lines: [preview.lines[0], {
  ...variantBlockedLine, issues: [blocking],
}] }) === undefined, "blockedReason must match a blocking issue of the line");
expect(parseCustomerRepeatOrderPreviewV1({ ...variantPreview, lines: [{
  ...preview.lines[0], blockedReason: "variant_required",
}, preview.lines[1]] }) === undefined, "a ready line cannot carry a blockedReason");

const repeatCommand = parseRepeatCustomerOrderIntoCaptureCommandV1({
  attentionLeaseId: "10000000-0000-4000-8000-000000000001",
  captureDraftId: "10000000-0000-4000-8000-000000000002",
  customerId,
  deviceId: "10000000-0000-4000-8000-000000000003",
  eventId: "10000000-0000-4000-8000-000000000004",
  expectedVersion: 7,
  idempotencyKey: "10000000-0000-4000-8000-000000000008",
  occurredAt: "2026-09-23T15:00:00.000Z",
  schemaVersion: 1,
  scope: query.scope,
  sourceOrderId: orderId,
});
if (repeatCommand === undefined) throw new Error("valid repeat-to-Capture command rejected");
expect(Object.isFrozen(repeatCommand) && repeatCommand.expectedVersion === 7,
  "repeat-to-Capture command freezes its CAS, lease and idempotency facts");
expect(parseRepeatCustomerOrderIntoCaptureCommandV1({ ...repeatCommand, currentPrice: 19_000 }) === undefined,
  "repeat-to-Capture command rejects client-supplied prices or selections");

const captureMutation = {
  detail: {
    attentionLeaseExpiresAt: "2026-09-23T15:05:00.000Z",
    attentionLeaseId: repeatCommand.attentionLeaseId,
    attentionStatus: "claimed",
    captureDraftId: repeatCommand.captureDraftId,
    confirmedOrderId: null,
    customerSnapshotRef: "10000000-0000-4000-8000-000000000005",
    folio: "CAP-0001",
    fulfillmentChannel: "delivery",
    fulfillmentSnapshotRef: "10000000-0000-4000-8000-000000000006",
    ownerMembershipId: "10000000-0000-4000-8000-000000000007",
    schemaVersion: 1,
    scope: query.scope,
    sourceChannel: "phone",
    status: "draft",
    updatedAt: "2026-09-23T15:00:00.000Z",
    version: 8,
  },
  replayed: false,
  schemaVersion: 1,
};
const captureResult = parseCustomerRepeatOrderCaptureResultV1({
  capture: captureMutation,
  preview,
  schemaVersion: 1,
});
expect(captureResult?.capture.detail.version === 8 && Object.isFrozen(captureResult),
  "repeat result combines the durable Capture mutation with the exact preview");
expect(parseCustomerRepeatOrderCaptureResultV1({ capture: captureMutation, preview, schemaVersion: 1, plan: {} }) === undefined,
  "repeat result rejects leaking the internal selection plan");
