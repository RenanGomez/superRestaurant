import {
  MANUAL_REVIEW_CASE_SCHEMA_VERSION,
  SYNC_CATALOG_VERSION,
  SYNC_CLIENT_TYPES,
  SYNC_CONNECTIVITY_STATES,
  SYNC_ENTITY_CATALOG_V1,
  SYNC_ENTITY_TYPES,
  SYNC_FINANCIAL_ENTITY_TYPES,
  SYNC_OPERATIONS,
  SYNC_OUTBOX_STATES,
  SYNC_PROTOCOL_VERSION,
  SYNC_SCHEMA_VERSION,
  SYNC_SERVER_RESULT_STATUSES,
  getSyncEntityCatalogEntryV1,
  isRfc3339UtcTimestamp,
  isStableSyncCode,
  isSyncEntityOperationAllowedV1,
  isSyncFinancialEntityTypeV1,
  isSyncId,
  parseManualReviewCaseV1,
  parseResolveManualReviewCaseCommandV1,
  parseSyncEnvelopeV1,
  parseSyncJsonObjectV1,
  parseSyncPullChangeV1,
  parseSyncPullRequestV1,
  parseSyncPullResponseV1,
  parseSyncPushRequestV1,
  parseSyncPushResponseV1,
  parseSyncScopeV1,
  parseSyncSnapshotResyncRequestV1,
  parseSyncSnapshotResyncResponseV1,
} from "./index.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const RESTAURANT_A = "1e37ae13-8507-484c-969f-2176f77b7000";
const BRANCH_A1 = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const BRANCH_A2 = "5e90fa33-b7bc-4a91-a2b1-a4cb12457711";
const DEVICE_1 = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const ACTOR_1 = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const EVENT_1 = "e74df54b-30a7-449b-a23f-c4ca6f93bda4";
const EVENT_2 = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";
const ENTITY_1 = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const CASE_1 = "9544c299-d25b-44ce-98ed-d30116610887";
const ULID_ID = "01J8Z9X2Y3ABCDEFGHJKMNPQRS";
const TS_1 = "2026-11-23T12:00:00.000Z";
const TS_2 = "2026-11-23T12:05:00.000Z";
const SCOPE = { restaurantId: RESTAURANT_A, branchId: BRANCH_A1 };

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: EVENT_1,
    idempotencyKey: "order-create-1",
    deviceId: DEVICE_1,
    actorId: ACTOR_1,
    restaurantId: RESTAURANT_A,
    branchId: BRANCH_A1,
    entityType: "Order",
    entityId: ENTITY_1,
    operation: "create",
    schemaVersion: SYNC_SCHEMA_VERSION,
    localSequence: 1,
    baseVersion: null,
    occurredAt: TS_1,
    receivedAt: null,
    payload: { totalMinor: 15000, currency: "MXN", lines: [{ quantity: 2 }] },
    retryCount: 0,
    localState: "pending",
    ...overrides,
  };
}

// 1. Versioned catalog & constants
expect(SYNC_PROTOCOL_VERSION === 1, "protocol version is 1");
expect(SYNC_SCHEMA_VERSION === "1", "schema version is '1'");
expect(SYNC_CATALOG_VERSION === 1, "catalog version is 1");
expect(MANUAL_REVIEW_CASE_SCHEMA_VERSION === 1, "manual review schema version is 1");
expect(Object.isFrozen(SYNC_ENTITY_CATALOG_V1), "catalog is frozen");
expect(Object.isFrozen(SYNC_ENTITY_TYPES), "entity types are frozen");
expect(Object.isFrozen(SYNC_FINANCIAL_ENTITY_TYPES), "financial entity types are frozen");
expect(Object.isFrozen(SYNC_OPERATIONS), "operations are frozen");
expect(Object.isFrozen(SYNC_OUTBOX_STATES), "outbox states are frozen");
expect(Object.isFrozen(SYNC_SERVER_RESULT_STATUSES), "result statuses are frozen");
expect(Object.isFrozen(SYNC_CLIENT_TYPES), "client types are frozen");
expect(Object.isFrozen(SYNC_CONNECTIVITY_STATES), "connectivity states are frozen");

expect(isSyncEntityOperationAllowedV1("Order", "create"), "Order create allowed");
expect(!isSyncEntityOperationAllowedV1("Order", "delete"), "Order delete forbidden");
expect(isSyncEntityOperationAllowedV1("Payment", "create"), "Payment create allowed");
expect(!isSyncEntityOperationAllowedV1("Payment", "update"), "Payment update forbidden");
expect(!isSyncEntityOperationAllowedV1("Payment", "delete"), "Payment delete forbidden");
expect(isSyncEntityOperationAllowedV1("CashMovement", "compensate"), "CashMovement compensate allowed");
expect(isSyncEntityOperationAllowedV1("DiningTable", "delete"), "DiningTable tombstone delete allowed");
expect(!isSyncEntityOperationAllowedV1("UnknownEntity", "create"), "unknown entity rejected");
expect(!isSyncEntityOperationAllowedV1("__proto__", "create"), "prototype key rejected");
expect(getSyncEntityCatalogEntryV1("Payment")?.financial === true, "Payment is financial");
expect(getSyncEntityCatalogEntryV1("Payment")?.allowTombstone === false, "Payment cannot be tombstoned");
expect(isSyncFinancialEntityTypeV1("CashMovement"), "CashMovement is financial");
expect(isSyncFinancialEntityTypeV1("OrderDiscount"), "OrderDiscount is financial");
expect(!isSyncFinancialEntityTypeV1("Order"), "Order is not financial entity type");

// 2. Identifiers & timestamps
expect(isSyncId(EVENT_1), "UUID is valid sync id");
expect(isSyncId(ULID_ID), "ULID is valid sync id");
expect(!isSyncId("not-an-id"), "plain string is not sync id");
expect(isStableSyncCode("AUTH_REVOKED"), "stable code valid");
expect(!isStableSyncCode("auth_revoked"), "lowercase code rejected");
expect(isRfc3339UtcTimestamp("2026-11-23T12:00:00Z"), "RFC 3339 UTC without fractional seconds valid");
expect(isRfc3339UtcTimestamp("2026-11-23T12:00:00.123456Z"), "RFC 3339 UTC with micros valid");
expect(!isRfc3339UtcTimestamp("2026-02-30T12:00:00Z"), "impossible date rejected");
expect(!isRfc3339UtcTimestamp("2026-11-23T12:00:00+02:00"), "non-UTC offset rejected");

// 3. Scope mandatory & exact keys
const parsedScope = parseSyncScopeV1(SCOPE);
expect(parsedScope !== undefined && Object.isFrozen(parsedScope), "valid scope parses frozen");
expect(parseSyncScopeV1({ restaurantId: RESTAURANT_A }) === undefined, "missing branchId rejected");
expect(parseSyncScopeV1({ branchId: BRANCH_A1 }) === undefined, "missing restaurantId rejected");
expect(parseSyncScopeV1({ ...SCOPE, extra: 1 }) === undefined, "extra key on scope rejected");
expect(parseSyncScopeV1({ restaurantId: "bad", branchId: BRANCH_A1 }) === undefined, "non-uuid/ulid scope rejected");

// 4. Payload JSON: no floats, depth, exact plain objects
expect(parseSyncJsonObjectV1({ amountMinor: 1050, items: [{ qty: 2 }] }) !== undefined, "integer JSON object parses");
expect(parseSyncJsonObjectV1({ total: 10.5 }) === undefined, "float in payload rejected");
expect(parseSyncJsonObjectV1({ nested: { arr: [0.1] } }) === undefined, "nested float in array rejected");
expect(parseSyncJsonObjectV1({ bad: Number.NaN }) === undefined, "NaN rejected");
expect(parseSyncJsonObjectV1({ bad: Number.POSITIVE_INFINITY }) === undefined, "Infinity rejected");
expect(parseSyncJsonObjectV1({ bad: Number.MAX_SAFE_INTEGER + 1 }) === undefined, "unsafe integer rejected");
let deep: Record<string, unknown> = { leaf: 1 };
for (let i = 1; i < 9; i += 1) deep = { child: deep };
expect(parseSyncJsonObjectV1(deep) === undefined, "payload exceeding depth 8 rejected");

// 5. SyncEnvelopeV1: exact keys, no floats, catalog checks, hostile inputs
const parsedEnvelope = parseSyncEnvelopeV1(validEnvelope());
expect(parsedEnvelope !== undefined && Object.isFrozen(parsedEnvelope) && Object.isFrozen(parsedEnvelope.payload), "valid envelope parses deeply frozen");
expect(parseSyncEnvelopeV1(validEnvelope({ eventId: ULID_ID, restaurantId: ULID_ID, branchId: ULID_ID })) !== undefined, "ULIDs accepted in envelope");
expect(parseSyncEnvelopeV1(validEnvelope({ extra: true })) === undefined, "extra key on envelope rejected");
const missingField = validEnvelope();
delete missingField["branchId"];
expect(parseSyncEnvelopeV1(missingField) === undefined, "missing branchId on envelope rejected");
expect(parseSyncEnvelopeV1(validEnvelope({ localSequence: 1.5 })) === undefined, "float localSequence rejected");
expect(parseSyncEnvelopeV1(validEnvelope({ payload: { price: 12.34 } })) === undefined, "float inside envelope payload rejected");
expect(parseSyncEnvelopeV1(validEnvelope({ entityType: "Ticket" })) === undefined, "non-catalog entityType rejected");
expect(parseSyncEnvelopeV1(validEnvelope({ entityType: "Payment", operation: "delete", baseVersion: 1 })) === undefined, "disallowed catalog operation rejected");
expect(parseSyncEnvelopeV1(validEnvelope({ operation: "update", baseVersion: null })) === undefined, "update with null baseVersion rejected");
expect(parseSyncEnvelopeV1(validEnvelope({ operation: "create", baseVersion: 0 })) === undefined, "create with non-null baseVersion rejected");
expect(parseSyncEnvelopeV1(validEnvelope({ schemaVersion: "2" })) === undefined, "unsupported schemaVersion rejected");

const getterEnvelope = validEnvelope();
Object.defineProperty(getterEnvelope, "actorId", { enumerable: true, get: () => { throw new Error("must not run"); } });
expect(parseSyncEnvelopeV1(getterEnvelope) === undefined, "accessor rejected without invocation");
expect(parseSyncEnvelopeV1(new Proxy(validEnvelope(), { ownKeys: () => { throw new Error("hostile"); } })) === undefined, "hostile proxy fails closed");

// 6. SyncPushRequest & SyncPushResponse
const pushReq = parseSyncPushRequestV1({
  protocolVersion: 1,
  deviceId: DEVICE_1,
  scope: SCOPE,
  events: [
    validEnvelope({ eventId: EVENT_1, localSequence: 1 }),
    validEnvelope({ eventId: EVENT_2, idempotencyKey: "order-update-2", operation: "update", baseVersion: 0, localSequence: 2 }),
  ],
});
expect(pushReq !== undefined && Object.isFrozen(pushReq.events), "valid SyncPushRequest parses frozen");
expect(parseSyncPushRequestV1({ protocolVersion: 1, deviceId: DEVICE_1, scope: SCOPE, events: [] }) === undefined, "empty push batch rejected");
expect(parseSyncPushRequestV1({
  protocolVersion: 1,
  deviceId: DEVICE_1,
  scope: SCOPE,
  events: [validEnvelope({ branchId: BRANCH_A2 })],
}) === undefined, "cross-branch event inside push batch rejected");
expect(parseSyncPushRequestV1({
  protocolVersion: 1,
  deviceId: DEVICE_1,
  scope: SCOPE,
  events: [validEnvelope({ eventId: EVENT_1, localSequence: 2 }), validEnvelope({ eventId: EVENT_2, localSequence: 2 })],
}) === undefined, "non-ascending localSequence in push batch rejected");
expect(parseSyncPushRequestV1({
  protocolVersion: 1,
  deviceId: DEVICE_1,
  scope: SCOPE,
  events: [validEnvelope({ eventId: EVENT_1, localSequence: 1 })],
  extra: 1,
}) === undefined, "extra key on push request rejected");

const pushRes = parseSyncPushResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  results: [
    { eventId: EVENT_1, idempotencyKey: "order-create-1", status: "accepted", code: null, canonicalVersion: 1, auditId: "audit-1" },
    { eventId: EVENT_2, idempotencyKey: "order-update-2", status: "manual_review", code: "AMBIGUOUS_PAYMENT", canonicalVersion: null, auditId: null },
  ],
});
expect(pushRes !== undefined && Object.isFrozen(pushRes.results), "valid SyncPushResponse parses frozen");
expect(parseSyncPushResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  results: [
    { eventId: EVENT_1, idempotencyKey: "order-create-1", status: "accepted", code: null, canonicalVersion: 1.5, auditId: null },
  ],
}) === undefined, "float canonicalVersion in push response rejected");
expect(parseSyncPushResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  results: [
    { eventId: EVENT_1, idempotencyKey: "order-create-1", status: "accepted", code: null, canonicalVersion: 1, auditId: null },
    { eventId: EVENT_1, idempotencyKey: "order-create-1", status: "accepted", code: null, canonicalVersion: 1, auditId: null },
  ],
}) === undefined, "duplicate eventId in push response rejected");

// 7. SyncPullRequest, SyncPullChange & SyncPullResponse
const pullReq = parseSyncPullRequestV1({ protocolVersion: 1, scope: SCOPE, cursor: null, limit: 100 });
expect(pullReq !== undefined && Object.isFrozen(pullReq), "valid SyncPullRequest parses frozen");
expect(parseSyncPullRequestV1({ protocolVersion: 1, scope: SCOPE, cursor: "", limit: 100 }) === undefined, "empty cursor rejected");
expect(parseSyncPullRequestV1({ protocolVersion: 1, scope: SCOPE, cursor: null, limit: 10.5 }) === undefined, "float limit rejected");
expect(parseSyncPullRequestV1({ protocolVersion: 1, scope: SCOPE, cursor: null, limit: 0 }) === undefined, "zero limit rejected");

const pullChange = {
  entityType: "DiningTable",
  entityId: ENTITY_1,
  restaurantId: RESTAURANT_A,
  branchId: BRANCH_A1,
  canonicalVersion: 2,
  tombstone: true,
  snapshot: null,
};
expect(parseSyncPullChangeV1(pullChange) !== undefined, "valid tombstone change on DiningTable parses");
expect(parseSyncPullChangeV1({ ...pullChange, entityType: "Payment" }) === undefined, "tombstone on financial Payment rejected");
expect(parseSyncPullChangeV1({ ...pullChange, entityType: "Order" }) === undefined, "tombstone on Order rejected");
expect(parseSyncPullChangeV1({ ...pullChange, snapshot: { name: "T1" } }) === undefined, "tombstone with non-null snapshot rejected");
expect(parseSyncPullChangeV1({ ...pullChange, tombstone: false, snapshot: { price: 1.25 } }) === undefined, "float in pull snapshot rejected");

const pullRes = parseSyncPullResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  changes: [pullChange],
  nextCursor: "v1:opaque-cursor",
  hasMore: true,
});
expect(pullRes !== undefined && Object.isFrozen(pullRes.changes), "valid SyncPullResponse parses frozen");
expect(parseSyncPullResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  changes: [],
  nextCursor: null,
  hasMore: true,
}) === undefined, "hasMore without nextCursor rejected");
expect(parseSyncPullResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  changes: [{ ...pullChange, branchId: BRANCH_A2 }],
  nextCursor: "v1:opaque",
  hasMore: false,
}) === undefined, "cross-branch change in pull response rejected");

// 8. Snapshot Resync Request & Response
expect(parseSyncSnapshotResyncRequestV1({ protocolVersion: 1, scope: SCOPE }) !== undefined, "valid snapshot request parses");
const snapshotRes = parseSyncSnapshotResyncResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  snapshotCursor: "v1:snap-42",
  entities: [
    {
      entityType: "Order",
      entityId: ENTITY_1,
      restaurantId: RESTAURANT_A,
      branchId: BRANCH_A1,
      canonicalVersion: 3,
      tombstone: false,
      snapshot: { totalMinor: 2500, currency: "MXN" },
    },
  ],
  generatedAt: TS_1,
});
expect(snapshotRes !== undefined && Object.isFrozen(snapshotRes.entities), "valid snapshot resync response parses frozen");
expect(parseSyncSnapshotResyncResponseV1({
  protocolVersion: 1,
  scope: SCOPE,
  snapshotCursor: "v1:snap-42",
  entities: [
    { entityType: "Order", entityId: ENTITY_1, restaurantId: RESTAURANT_A, branchId: BRANCH_A1, canonicalVersion: 3, tombstone: false, snapshot: { a: 1 } },
    { entityType: "Order", entityId: ENTITY_1, restaurantId: RESTAURANT_A, branchId: BRANCH_A1, canonicalVersion: 4, tombstone: false, snapshot: { a: 2 } },
  ],
  generatedAt: TS_1,
}) === undefined, "duplicate entity in snapshot response rejected");

// 9. ManualReviewCaseV1 & ResolveManualReviewCaseCommandV1
function validReviewCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: MANUAL_REVIEW_CASE_SCHEMA_VERSION,
    caseId: CASE_1,
    scope: SCOPE,
    eventId: EVENT_1,
    idempotencyKey: "pay-cash-1",
    deviceId: DEVICE_1,
    actorId: ACTOR_1,
    entityType: "Payment",
    entityId: ENTITY_1,
    operation: "create",
    reasonCode: "AMBIGUOUS_PAYMENT",
    financial: true,
    status: "open",
    baseVersion: null,
    canonicalVersion: 1,
    amountMinor: 12500,
    currency: "MXN",
    openedAt: TS_1,
    resolvedAt: null,
    resolvedByActorId: null,
    resolutionReason: null,
    compensatingEventId: null,
    auditId: "audit-mr-1",
    ...overrides,
  };
}

const openCase = parseManualReviewCaseV1(validReviewCase());
expect(openCase !== undefined && Object.isFrozen(openCase), "valid open ManualReviewCaseV1 parses frozen");
const compensatedCase = parseManualReviewCaseV1(validReviewCase({
  status: "resolved_compensated",
  resolvedAt: TS_2,
  resolvedByActorId: ACTOR_1,
  resolutionReason: "Ajuste compensatorio aprobado por gerente",
  compensatingEventId: EVENT_2,
}));
expect(compensatedCase !== undefined, "valid compensated ManualReviewCaseV1 parses");
const rejectedCase = parseManualReviewCaseV1(validReviewCase({
  status: "resolved_rejected",
  resolvedAt: TS_2,
  resolvedByActorId: ACTOR_1,
  resolutionReason: "Cobro duplicado descartado tras arqueo",
  compensatingEventId: null,
}));
expect(rejectedCase !== undefined, "valid rejected ManualReviewCaseV1 parses");

expect(parseManualReviewCaseV1(validReviewCase({ financial: false })) === undefined, "financial entity cannot set financial=false");
expect(parseManualReviewCaseV1(validReviewCase({ amountMinor: 125.5 })) === undefined, "float amountMinor rejected");
expect(parseManualReviewCaseV1(validReviewCase({ amountMinor: 12500, currency: null })) === undefined, "amountMinor without currency rejected");
expect(parseManualReviewCaseV1(validReviewCase({ status: "open", resolvedAt: TS_2 })) === undefined, "open case with resolvedAt rejected");
expect(parseManualReviewCaseV1(validReviewCase({
  status: "resolved_compensated",
  resolvedAt: TS_2,
  resolvedByActorId: ACTOR_1,
  resolutionReason: "Motivo valido",
  compensatingEventId: null,
})) === undefined, "compensated case without compensatingEventId rejected");
expect(parseManualReviewCaseV1(validReviewCase({ extra: true })) === undefined, "extra key on ManualReviewCaseV1 rejected");

const resolveCmd = parseResolveManualReviewCaseCommandV1({
  schemaVersion: 1,
  scope: SCOPE,
  caseId: CASE_1,
  decision: "compensate",
  reason: "Se emite movimiento compensatorio verificado",
  compensatingEventId: EVENT_2,
  idempotencyKey: "resolve-case-1",
  deviceId: DEVICE_1,
  occurredAt: TS_2,
});
expect(resolveCmd !== undefined && Object.isFrozen(resolveCmd), "valid ResolveManualReviewCaseCommandV1 parses frozen");
expect(parseResolveManualReviewCaseCommandV1({
  schemaVersion: 1,
  scope: SCOPE,
  caseId: CASE_1,
  decision: "reject",
  reason: "Descartado",
  compensatingEventId: EVENT_2,
  idempotencyKey: "resolve-case-1",
  deviceId: DEVICE_1,
  occurredAt: TS_2,
}) === undefined, "reject decision with compensatingEventId rejected");
