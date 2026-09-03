import {
  KDS_INITIAL_CURSOR,
  REALTIME_SCHEMA_VERSION,
  parseKdsCursorV1,
  parseKdsEventPageV1,
  parseKdsEventV1,
  parseRealtimeNotificationV1,
  parseRealtimeSubscriptionAckV1,
  parseRealtimeSubscriptionV1,
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

const accessor = { schemaVersion: 1, scope, stationId: "kitchen" };
Object.defineProperty(accessor, "stationId", { enumerable: true, get: () => { throw new Error("must not run"); } });
expect(parseRealtimeSubscriptionV1(accessor) === undefined, "accessor fails without invocation");
expect(parseKdsEventV1(new Proxy(event(), { ownKeys: () => { throw new Error("hostile"); } })) === undefined, "hostile proxy fails closed");
