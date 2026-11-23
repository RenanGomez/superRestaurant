import {
  KDS_INITIAL_CURSOR,
  REALTIME_SCHEMA_VERSION,
  decodeKitchenReadyWireFrame,
  encodeKitchenReadySubscribeFrame,
  encodeRealtimeConnectFrame,
  kitchenReadyMatchesSubscription,
  parseKdsCursorV1,
  parseKdsEventPageV1,
  parseKdsEventV1,
  parseKdsTicketListV1,
  parseKitchenReadyNotificationV1,
  parseKitchenReadySubscriptionAckV1,
  parseKitchenReadySubscriptionV1,
  parseRealtimeNotificationV1,
  parseRealtimeSubscriptionAckV1,
  parseRealtimeSubscriptionV1,
  realtimeWebSocketUrl,
} from "./index.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const eventId = "e74df54b-30a7-449b-a23f-c4ca6f93bda4";
const orderId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const orderItemId = "9544c299-d25b-44ce-98ed-d30116610887";
const scope = { restaurantId, branchId };

function event(cursor = "v1:1"): Record<string, unknown> {
  return {
    schemaVersion: REALTIME_SCHEMA_VERSION,
    scope,
    cursor,
    eventId,
    orderId,
    orderItemId,
    stationId: "kitchen",
    operation: "order_item.status_changed",
    status: "preparing",
    occurredAt: "2026-09-02T22:00:00.000Z",
    receivedAt: "2026-09-02T22:00:00.100Z",
  };
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const subscription = parseRealtimeSubscriptionV1({ schemaVersion: 1, scope, stationId: "kitchen" });
expect(subscription !== undefined && Object.isFrozen(subscription) && Object.isFrozen(subscription.scope), "valid subscription parses frozen");
expect(parseRealtimeSubscriptionV1({ schemaVersion: 1, scope, stationId: " kitchen" }) === undefined, "non-canonical station fails");
expect(parseRealtimeSubscriptionV1({ schemaVersion: 1, scope, stationId: "kitchen", extra: true }) === undefined, "extra subscription key fails");

expect(parseKdsCursorV1(KDS_INITIAL_CURSOR) === "v1:0", "initial cursor parses");
expect(parseKdsCursorV1("v1:9223372036854775807") !== undefined, "maximum bigint cursor parses");
for (const invalid of ["0", "v2:0", "v1:01", "v1:-1", "v1:9223372036854775808", 1]) {
  expect(parseKdsCursorV1(invalid) === undefined, `invalid cursor ${String(invalid)} fails`);
}

const parsedEvent = parseKdsEventV1(event());
expect(parsedEvent !== undefined && Object.isFrozen(parsedEvent), "valid event parses frozen");
expect(parseKdsEventV1({ ...event(), status: "invented" }) === undefined, "unknown status fails");
expect(parseKdsEventV1({ ...event(), receivedAt: "2026-09-02" }) === undefined, "non-canonical timestamp fails");
expect(parseKdsEventV1({ ...event(), stationId: "other", scope: { ...scope, branchId: restaurantId } }) !== undefined, "independent valid scope parses");

const page = parseKdsEventPageV1({
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
  events: [event("v1:1"), { ...event("v1:2"), eventId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83" }],
  nextCursor: "v1:2",
  hasMore: false,
});
expect(page !== undefined && Object.isFrozen(page.events), "ordered page parses frozen");
expect(parseKdsEventPageV1({ ...page, events: [event("v1:2"), event("v1:1")] }) === undefined, "descending cursors fail");
expect(parseKdsEventPageV1({ ...page, events: [{ ...event(), stationId: "bar" }] }) === undefined, "cross-station event fails");
expect(parseKdsEventPageV1({ ...page, events: [{ ...event(), scope: { ...scope, branchId: restaurantId } }] }) === undefined, "cross-branch event fails");

expect(parseRealtimeSubscriptionAckV1({ schemaVersion: 1, scope, stationId: "kitchen", cursor: "v1:2", status: "subscribed" }) !== undefined, "ack parses");
expect(parseRealtimeNotificationV1({ schemaVersion: 1, scope, stationId: "kitchen", cursor: "v1:2", eventId, eventType: "kds.changed" }) !== undefined, "notification parses");

const ticket = {
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
  orderId,
  orderItemId,
  orderVersion: 4,
  channel: "table",
  tableId: "f62229e6-b84f-4c34-9f16-a891b11c6143",
  quantity: 2,
  productName: "Hamburguesa",
  modifiers: [{ name: "Sin cebolla", quantity: 1 }],
  note: "sin cebolla",
  status: "preparing",
  queuedAt: "2026-09-02T22:00:00.100Z",
};
const ticketList = parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [ticket], truncated: false });
expect(ticketList !== undefined && Object.isFrozen(ticketList.tickets) && Object.isFrozen(ticketList.tickets[0]?.modifiers), "ticket list parses deeply frozen");
expect(parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [{ ...ticket, stationId: "bar" }], truncated: false }) === undefined, "cross-station ticket fails");
expect(parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [{ ...ticket, channel: "counter", tableId: ticket.tableId }], truncated: false }) === undefined, "counter ticket with table fails");
expect(parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [{ ...ticket, orderVersion: 0 }], truncated: false }) === undefined, "non-positive order version fails");
expect(parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [ticket, ticket], truncated: false }) === undefined, "duplicate ticket item fails");
expect(parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [{ ...ticket, note: null }], truncated: false }) !== undefined, "null ticket note parses");
expect(parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [{ ...ticket, note: "" }], truncated: false }) === undefined, "empty ticket note fails");
expect(parseKdsTicketListV1({ schemaVersion: 1, scope, stationId: "kitchen", tickets: [{ ...ticket, note: "a".repeat(201) }], truncated: false }) === undefined, "oversized ticket note fails");

const accessor = { schemaVersion: 1, scope, stationId: "kitchen" };
Object.defineProperty(accessor, "stationId", { enumerable: true, get: () => { throw new Error("must not run"); } });
expect(parseRealtimeSubscriptionV1(accessor) === undefined, "accessor fails without invocation");
expect(parseKdsEventV1(new Proxy(event(), { ownKeys: () => { throw new Error("hostile"); } })) === undefined, "hostile proxy fails closed");

const readyStationSub = parseKitchenReadySubscriptionV1({ schemaVersion: 1, scope, stationId: "kitchen" });
const readyBranchSub = parseKitchenReadySubscriptionV1({ schemaVersion: 1, scope, stationId: null });
expect(readyStationSub !== undefined && readyStationSub.stationId === "kitchen" && Object.isFrozen(readyStationSub), "station-scoped ready subscription parses frozen");
expect(readyBranchSub !== undefined && readyBranchSub.stationId === null && Object.isFrozen(readyBranchSub), "branch-scoped ready subscription parses frozen");
expect(parseKitchenReadySubscriptionV1({ schemaVersion: 1, scope, stationId: "" }) === undefined, "empty ready station fails");
expect(parseKitchenReadySubscriptionV1({ schemaVersion: 1, scope, stationId: " kitchen" }) === undefined, "non-canonical ready station fails");
expect(parseKitchenReadySubscriptionV1({ schemaVersion: 1, scope, stationId: null, extra: true }) === undefined, "extra ready subscription key fails");
expect(parseKitchenReadySubscriptionV1(accessor) === undefined, "ready subscription rejects getter without invocation");

expect(parseKitchenReadySubscriptionAckV1({ schemaVersion: 1, scope, stationId: "kitchen", cursor: "v1:0", status: "subscribed" }) !== undefined, "station ready ack parses");
expect(parseKitchenReadySubscriptionAckV1({ schemaVersion: 1, scope, stationId: null, cursor: "v1:4", status: "subscribed" }) !== undefined, "branch ready ack parses");
expect(parseKitchenReadySubscriptionAckV1({ schemaVersion: 1, scope, stationId: null, cursor: "v1:4", status: "other" }) === undefined, "invalid ready ack status fails");

const readyPayload = {
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
  cursor: "v1:5",
  eventId,
  eventType: "kitchen.item_ready",
  orderId,
  orderItemId,
  occurredAt: "2026-09-02T22:00:00.000Z",
  receivedAt: "2026-09-02T22:00:00.100Z",
};
const readyNotification = parseKitchenReadyNotificationV1(readyPayload);
expect(readyNotification !== undefined && Object.isFrozen(readyNotification), "ready notification parses frozen");
expect(parseKitchenReadyNotificationV1({ ...readyPayload, eventType: "kds.changed" }) === undefined, "wrong ready eventType fails");
expect(parseKitchenReadyNotificationV1({ ...readyPayload, stationId: null }) === undefined, "null ready notification station fails");
expect(parseKitchenReadyNotificationV1({ ...readyPayload, extra: 1 }) === undefined, "extra ready notification key fails");
expect(parseKitchenReadyNotificationV1(new Proxy(readyPayload, { ownKeys: () => { throw new Error("hostile"); } })) === undefined, "hostile ready proxy fails closed");

if (readyStationSub === undefined || readyBranchSub === undefined || readyNotification === undefined) {
  throw new Error("expected valid ready fixtures");
}
expect(kitchenReadyMatchesSubscription(readyStationSub, readyNotification), "exact station ready subscription matches");
expect(!kitchenReadyMatchesSubscription(readyStationSub, { ...readyNotification, stationId: "bar" }), "different station rejected");
expect(kitchenReadyMatchesSubscription(readyBranchSub, { ...readyNotification, stationId: "bar" }), "branch-scoped subscription matches any station in branch");
const otherBranch = parseKitchenReadyNotificationV1({ ...readyPayload, scope: { restaurantId, branchId: restaurantId } });
if (otherBranch === undefined) throw new Error("expected otherBranch fixture");
expect(!kitchenReadyMatchesSubscription(readyBranchSub, otherBranch), "different branch rejected");

expect(realtimeWebSocketUrl("http://127.0.0.1:4000/") === "ws://127.0.0.1:4000/socket.io/?EIO=4&transport=websocket", "http ws url");
expect(realtimeWebSocketUrl("https://api.example.com") === "wss://api.example.com/socket.io/?EIO=4&transport=websocket", "https wss url");
expect(encodeRealtimeConnectFrame("tok") === '40/realtime/v1,{"accessToken":"tok"}', "connect frame");
expect(encodeKitchenReadySubscribeFrame(readyStationSub).startsWith('42/realtime/v1,1["kitchen.ready.subscribe.v1",'), "subscribe frame");
expect(decodeKitchenReadyWireFrame("2").kind === "ping", "ping decodes");
expect(decodeKitchenReadyWireFrame('0{"sid":"abc"}').kind === "open", "open decodes");
expect(decodeKitchenReadyWireFrame('40/realtime/v1,{"sid":"x"}').kind === "connected", "connected decodes");
expect(decodeKitchenReadyWireFrame("44/realtime/v1,{}").kind === "closed", "closed decodes");
const ackFrame = decodeKitchenReadyWireFrame(`43/realtime/v1,1[${JSON.stringify({ schemaVersion: 1, scope, stationId: "kitchen", cursor: "v1:0", status: "subscribed" })}]`);
expect(ackFrame.kind === "ack" && ackFrame.ack?.stationId === "kitchen", "ack decodes");
const readyFrame = decodeKitchenReadyWireFrame(`42/realtime/v1,${JSON.stringify(["kitchen.ready.v1", readyPayload])}`);
expect(readyFrame.kind === "ready" && readyFrame.notification?.orderItemId === orderItemId, "ready event decodes");
