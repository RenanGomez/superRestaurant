import {
  parseOperationalWorkItemV1,
  parseOperationalWorkTrayRequestV1,
  parseOperationalWorkTrayV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const scope = {
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
};
const captureId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const orderId = "2ee5f057-7971-468d-b197-f946911743eb";

const request = { cursor: null, filters: ["all"], limit: 50, schemaVersion: 1, scope } as const;
expect(parseOperationalWorkTrayRequestV1(request) !== undefined, "exact request parses");
for (const invalid of [
  { ...request, filters: [] },
  { ...request, filters: ["all", "all"] },
  { ...request, limit: 101 },
  { ...request, extra: true },
]) expect(parseOperationalWorkTrayRequestV1(invalid) === undefined, "request rejects invalid filters and bounds");

const capture = {
  attentionStatus: "claimed",
  availableActions: ["open_capture", "transfer"],
  captureDraftId: captureId,
  customerLabel: "Cliente identificado",
  fulfillmentChannel: "delivery",
  fulfillmentStatus: null,
  humanFolio: "CAP-000042",
  itemType: "capture",
  needsAttention: [],
  orderId: null,
  orderStatus: null,
  ownerLabel: "Operador asignado",
  paymentStatus: null,
  preparationStatus: null,
  promisedFor: null,
  scheduledFor: null,
  shiftId: null,
  sourceChannel: "phone",
  tableId: null,
  updatedAt: "2026-09-26T18:00:00.000Z",
  version: 8,
  workItemId: captureId,
} as const;
const parsedCapture = parseOperationalWorkItemV1(capture);
expect(parsedCapture !== undefined && Object.isFrozen(parsedCapture.availableActions), "capture item parses frozen");
expect(parseOperationalWorkItemV1({ ...capture, fulfillmentChannel: "dine_in" }) !== undefined,
  "dine-in capture remains valid before table selection at confirmation");

const order = {
  ...capture,
  attentionStatus: null,
  availableActions: ["open_order"],
  captureDraftId: null,
  customerLabel: null,
  fulfillmentChannel: "dine_in",
  fulfillmentStatus: "confirmed",
  humanFolio: null,
  itemType: "order",
  orderId,
  orderStatus: "confirmed",
  ownerLabel: null,
  paymentStatus: "unpaid",
  preparationStatus: "not_sent",
  shiftId: "db7bcd0c-61f3-4c65-8280-dd8d78fa39cf",
  sourceChannel: null,
  tableId: "3eb31aaa-a466-4b1b-9b37-2f4736106a1d",
  workItemId: orderId,
} as const;
expect(parseOperationalWorkItemV1(order) !== undefined, "order item keeps absent facts explicit");

for (const invalid of [
  { ...capture, workItemId: orderId },
  { ...capture, orderId },
  { ...capture, attentionStatus: null },
  { ...capture, tableId: "3eb31aaa-a466-4b1b-9b37-2f4736106a1d" },
  { ...order, attentionStatus: "claimed" },
  { ...order, fulfillmentChannel: "delivery" },
  { ...order, availableActions: ["open_order", "open_order"] },
  { ...order, extra: true },
]) expect(parseOperationalWorkItemV1(invalid) === undefined, "item rejects contradictory identity or state");

const tray = {
  generatedAt: "2026-09-26T18:01:00.000Z",
  items: [capture, order],
  nextCursor: null,
  schemaVersion: 1,
  scope,
} as const;
const parsedTray = parseOperationalWorkTrayV1(tray);
expect(parsedTray !== undefined && Object.isFrozen(parsedTray.items) && Object.isFrozen(parsedTray.scope),
  "tray parses deeply frozen boundary collections");
expect(parseOperationalWorkTrayV1({ ...tray, items: [capture, capture] }) === undefined, "duplicate work identity rejected");
expect(parseOperationalWorkTrayV1({ ...tray, generatedAt: "2026-09-26" }) === undefined, "non-canonical time rejected");
expect(parseOperationalWorkTrayV1(new Proxy(tray, { ownKeys: () => { throw new Error("hostile"); } })) === undefined,
  "hostile proxy fails closed");
