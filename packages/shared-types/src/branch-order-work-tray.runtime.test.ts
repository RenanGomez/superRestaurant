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

const request = { cursor: null, limit: 25, schemaVersion: 1, scope } as const;
expect(parseBranchOrderWorkTrayRequestV1(request) !== undefined, "exact request parses");
for (const invalid of [
  { ...request, limit: 0 },
  { ...request, limit: 101 },
  { ...request, extra: true },
  { ...request, cursor: { orderId, updatedAt: "" } },
]) expect(parseBranchOrderWorkTrayRequestV1(invalid) === undefined, "request rejects invalid bounds and shapes");
expect(parseBranchOrderWorkTrayRequestV1({ ...request, cursor: { orderId, updatedAt: "2026-09-26T18:00:00.000000Z" } }) !== undefined,
  "request accepts a cursor");

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
  totals: { currency: "MXN", deliveryChargeMinor: 3000, itemsTotalMinor: 20000, totalMinor: 23000 },
  updatedAt: "2026-09-26T18:05:00.000Z",
} as const;
expect(parseBranchOrderWorkItemV1(deliveryItem) !== undefined, "delivery item parses");

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

for (const invalid of [
  { ...deliveryItem, extra: true },
  { ...deliveryItem, channel: "table", fulfillmentChannel: "delivery" },
  { ...deliveryItem, totals: { ...deliveryItem.totals, currency: "mxn" } },
  { ...deliveryItem, paymentIntent: { method: "unknown", tenderedAmountMinor: null, tipMinor: 0 } },
  { ...deliveryItem, orderId: "not-a-uuid" },
]) expect(parseBranchOrderWorkItemV1(invalid) === undefined, "item rejects malformed facts");

const tray = { items: [deliveryItem], nextCursor: null, schemaVersion: 1, scope } as const;
expect(parseBranchOrderWorkTrayV1(tray) !== undefined, "tray parses");
expect(parseBranchOrderWorkTrayV1({ ...tray, items: [deliveryItem, deliveryItem] }) === undefined,
  "tray rejects duplicate order ids");
