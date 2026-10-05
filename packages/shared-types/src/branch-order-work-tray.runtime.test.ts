import {
  parseBranchOrderWorkItemV1,
  parseBranchOrderWorkTrayRequestV1,
  parseBranchOrderWorkTrayV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const scope = {
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
};
const orderId = "2ee5f057-7971-468d-b197-f946911743eb";

const request = { channel: null, cursor: null, limit: 25, schemaVersion: 1, scope } as const;
expect(parseBranchOrderWorkTrayRequestV1(request) !== undefined, "exact request parses");
for (const invalid of [
  { ...request, limit: 0 },
  { ...request, limit: 101 },
  { ...request, extra: true },
  { ...request, cursor: { orderId, updatedAt: "" } },
  { ...request, channel: "unknown" },
]) expect(parseBranchOrderWorkTrayRequestV1(invalid) === undefined, "request rejects invalid bounds and shapes");
expect(parseBranchOrderWorkTrayRequestV1({ ...request, cursor: { orderId, updatedAt: "2026-09-26T18:00:00.000000Z" } }) !== undefined,
  "request accepts a cursor");
expect(parseBranchOrderWorkTrayRequestV1({ ...request, channel: "delivery" }) !== undefined,
  "request accepts a single-channel filter");

const deliveryItem = {
  addressLabel: "Casa · Col. Centro",
  channel: "delivery",
  createdAt: "2026-09-26T18:00:00.000Z",
  customerLabel: "Ana ****1234",
  fulfillmentChannel: "delivery",
  hasNotes: true,
  lineCount: 3,
  orderId,
  paymentIntent: { method: "cash", tenderedAmountMinor: 50000, tipMinor: 1000 },
  preparation: "preparing",
  status: "open",
  timeZone: "America/Hermosillo",
  totals: { currency: "MXN", deliveryChargeMinor: 3000, itemsTotalMinor: 20000, tipMinor: 0, totalMinor: 23000 },
  updatedAt: "2026-09-26T18:05:00.000Z",
} as const;
expect(parseBranchOrderWorkItemV1(deliveryItem) !== undefined, "delivery item parses");
expect(parseBranchOrderWorkItemV1({ ...deliveryItem, timeZone: "Not/AZone" }) === undefined,
  "item rejects an invalid IANA time zone");

const tableItem = {
  ...deliveryItem,
  addressLabel: null,
  channel: "table",
  customerLabel: null,
  fulfillmentChannel: "dine_in",
  paymentIntent: null,
  totals: { ...deliveryItem.totals, deliveryChargeMinor: 0, totalMinor: 20000 },
} as const;
expect(parseBranchOrderWorkItemV1(tableItem) !== undefined, "table item parses without payment intent or address");

const counterItemWithoutSnapshot = {
  ...deliveryItem,
  addressLabel: null,
  channel: "counter",
  customerLabel: null,
  fulfillmentChannel: null,
  paymentIntent: null,
  totals: { ...deliveryItem.totals, deliveryChargeMinor: 0, totalMinor: 20000 },
} as const;
expect(parseBranchOrderWorkItemV1(counterItemWithoutSnapshot) !== undefined,
  "a counter/takeout/delivery Order with no fulfillment snapshot parses with a null fulfillmentChannel");
expect(parseBranchOrderWorkItemV1({ ...counterItemWithoutSnapshot, channel: "table" }) !== undefined,
  "a table Order with no fulfillment snapshot also parses with a null fulfillmentChannel");

for (const invalid of [
  { ...deliveryItem, extra: true },
  { ...deliveryItem, channel: "table", fulfillmentChannel: "delivery" },
  { ...deliveryItem, totals: { ...deliveryItem.totals, currency: "mxn" } },
  { ...deliveryItem, paymentIntent: { method: "unknown", tenderedAmountMinor: null, tipMinor: 0 } },
  { ...deliveryItem, orderId: "not-a-uuid" },
  { ...deliveryItem, totals: { ...deliveryItem.totals, tipMinor: 1000 } },
]) expect(parseBranchOrderWorkItemV1(invalid) === undefined, "item rejects malformed facts");

expect(parseBranchOrderWorkItemV1({
  ...deliveryItem,
  totals: { currency: "MXN", deliveryChargeMinor: 3000, itemsTotalMinor: 20000, tipMinor: 1500, totalMinor: 24500 },
}) !== undefined, "totals with a tip parse when items + delivery + tip == total");

const tray = { items: [deliveryItem], nextCursor: null, schemaVersion: 1, scope } as const;
expect(parseBranchOrderWorkTrayV1(tray) !== undefined, "tray parses");
expect(parseBranchOrderWorkTrayV1({ ...tray, items: [deliveryItem, deliveryItem] }) === undefined,
  "tray rejects duplicate order ids");

// deliveries-unassigned-tray: additive `unassignedDeliveriesOnly` request flag and `deliveryState` item field.
const flagged = parseBranchOrderWorkTrayRequestV1({ ...request, channel: "delivery", unassignedDeliveriesOnly: true });
expect(flagged?.unassignedDeliveriesOnly === true, "request keeps the unassignedDeliveriesOnly flag");
expect(parseBranchOrderWorkTrayRequestV1({ ...request, unassignedDeliveriesOnly: false })?.unassignedDeliveriesOnly === false,
  "request keeps an explicit false flag");
const unflagged = parseBranchOrderWorkTrayRequestV1(request);
expect(unflagged !== undefined && !Object.hasOwn(unflagged, "unassignedDeliveriesOnly"),
  "a request without the flag stays without it");
for (const invalid of ["true", 1, null, undefined]) {
  expect(parseBranchOrderWorkTrayRequestV1({ ...request, unassignedDeliveriesOnly: invalid }) === undefined,
    "request rejects a non-boolean unassignedDeliveriesOnly (fail closed)");
}

expect(parseBranchOrderWorkItemV1(deliveryItem)?.deliveryState === null, "an item without deliveryState defaults it to null");
for (const state of ["assigned", "en_route", "delivered", "failed", "settled"]) {
  expect(parseBranchOrderWorkItemV1({ ...deliveryItem, deliveryState: state })?.deliveryState === state,
    `item accepts deliveryState ${state}`);
}
expect(parseBranchOrderWorkItemV1({ ...deliveryItem, deliveryState: null })?.deliveryState === null,
  "item accepts null deliveryState");
for (const invalid of ["pending", "ASSIGNED", 1, ""]) {
  expect(parseBranchOrderWorkItemV1({ ...deliveryItem, deliveryState: invalid }) === undefined,
    "item rejects an unknown deliveryState (fail closed)");
}
expect(parseBranchOrderWorkItemV1({ ...deliveryItem, status: "paid", deliveryState: null })?.status === "paid",
  "item accepts a prepaid (paid) delivery Order");
expect(parseBranchOrderWorkItemV1({ ...deliveryItem, status: "cancelled" }) === undefined,
  "item still rejects other statuses");
