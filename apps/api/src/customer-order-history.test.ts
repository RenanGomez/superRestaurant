import assert from "node:assert/strict";
import test from "node:test";

import { Money, addOrderItem, createOrder } from "@super-restaurant/domain";
import {
  parseCustomerRecentOrderListV1,
  parseCustomerRecentOrdersQueryV1,
  parseCustomerRepeatOrderPreviewQueryV1,
  parseRepeatCustomerOrderIntoCaptureCommandV1,
  parseBranchScope,
  type MenuCatalogStateV1,
  type MembershipRoleCode,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import {
  CustomerOrderHistoryError,
  CustomerOrderHistoryService,
  CustomerOrderRepeatCaptureService,
  CustomerOrderRepeatPreviewService,
  PostgresCustomerOrderHistory,
  PostgresCustomerOrderRepeatCapture,
  type CaptureRepeatSelectionPlan,
  type CustomerOrderHistoryPort,
  type CustomerOrderRepeatCapturePort,
  type CustomerOrderRepeatSourcePort,
} from "./customer-order-history.js";
import type { DatabaseClientPort } from "./database.js";
import type { MenuCatalogPort } from "./menu-catalog.js";
import { encodeOrderRecord } from "./persistence/order-persistence-codec.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const customerId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const actorId = "2b99e67e-8bdd-42d9-bd2e-07ea4de87334";
const orderId = "2dc3ccda-aa8e-43b9-9784-61ab72e27055";
const orderItemId = "3e30ce7e-f786-4db7-88c0-a3e96820899b";
const productId = "42803a4d-44d2-49af-92a9-3e6d7f51dfd4";
const modifierId = "5d81b813-dfa4-417d-9784-60dbad82c541";
const groupId = "62fa5ebc-e713-4382-85bc-277abc5ae856";
const categoryId = "9e1bb2eb-6f99-49ae-a28a-b7fa951e03d9";
const catalogVersion = "47f7f293-b155-42b9-bdc7-f9be3846f44e";
const stationId = "9670f4ab-c871-43cd-b0fa-72a3f7cf8316";
const captureDraftId = "4c98955c-1934-4236-97d0-843e31481336";
const attentionLeaseId = "1ef2a6f5-a6cc-40c4-b105-5eb03ae5fb32";
const membershipId = "8009ad37-8424-4915-960b-b89096261cc7";
const confirmedAt = "2026-09-23T12:00:00.000Z";
const parsedScope = parseBranchScope({ branchId, restaurantId });
if (parsedScope === undefined) throw new Error("Invalid test scope");
const scope = parsedScope;
const principal: AuthenticatedPrincipal = Object.freeze({ actorId });

const query = parseCustomerRecentOrdersQueryV1({
  customerId,
  limit: 5,
  schemaVersion: 1,
  scope,
});
assert.ok(query);

const previewQuery = parseCustomerRepeatOrderPreviewQueryV1({
  customerId,
  orderId,
  schemaVersion: 1,
  scope,
});
assert.ok(previewQuery);

const repeatCommand = parseRepeatCustomerOrderIntoCaptureCommandV1({
  attentionLeaseId,
  captureDraftId,
  customerId,
  deviceId: "b81a6d8d-32eb-4425-a8cf-137048d26743",
  eventId: "cda1a49e-4e0a-435d-8d5f-7bc854946a90",
  expectedVersion: 7,
  idempotencyKey: "1ba05a96-fb26-4207-a8d3-a17f8327896f",
  occurredAt: confirmedAt,
  schemaVersion: 1,
  scope,
  sourceOrderId: orderId,
});
assert.ok(repeatCommand);

const order = addOrderItem(createOrder({
  branchId,
  channel: "delivery",
  currency: "MXN",
  orderId,
  restaurantId,
  timeZone: "America/Hermosillo",
}, audit("created")).order, {
  orderItemId,
  quantity: 2,
  snapshot: {
    catalogVersion: "catalog-v1",
    modifiers: [{
      groupCatalogVersion: "group-v1",
      groupId,
      groupName: "Extras",
      modifierId,
      name: "Queso",
      quantity: 1,
      unitPrice: new Money(500, "MXN"),
    }],
    name: "Tacos",
    productId,
    sku: "TACO-1",
    stationId: "station-1",
    unit: "piece",
    unitPrice: new Money(3_500, "MXN"),
  },
}, audit("line")).order;

const list = parseCustomerRecentOrderListV1({
  customerId,
  orders: [{
    confirmedAt,
    currency: "MXN",
    fulfillmentChannel: "delivery",
    items: [{
      modifiers: [{ groupId, groupName: "Extras", modifierId, name: "Queso", quantity: 1, unitPriceMinor: 500 }],
      orderItemId,
      productId,
      productName: "Tacos",
      quantity: 2,
      status: "pending",
      unit: "piece",
      unitPriceMinor: 3_500,
    }],
    orderId,
    status: "draft",
  }],
  schemaVersion: 1,
  scope,
});
assert.ok(list);

test("recent history authorizes both customer and order reads before calling its port", async () => {
  const calls: unknown[] = [];
  const port: CustomerOrderHistoryPort = { list: async (receivedActor, receivedQuery) => {
    calls.push({ receivedActor, receivedQuery });
    return list;
  } };
  const service = serviceFor(["waiter"], port);

  const result = await service.list(principal, { branchId, customerId, limit: "5", restaurantId });
  assert.equal(result.orders[0]?.items[0]?.unitPriceMinor, 3_500);
  assert.deepEqual(calls, [{ receivedActor: actorId, receivedQuery: query }]);
  assert.ok(Object.isFrozen(result.orders));

  for (const input of [
    { branchId, customerId: "bad", limit: "5", restaurantId },
    { branchId, customerId, limit: "21", restaurantId },
    { branchId, customerId, limit: "5", restaurantId, actorId },
  ]) {
    await assert.rejects(service.list(principal, input), isError("request"));
  }
  assert.equal(calls.length, 1);
});

test("recent history rejects partial authorization and sanitizes port outcomes", async () => {
  let calls = 0;
  const port: CustomerOrderHistoryPort = { list: async () => { calls += 1; return list; } };
  await assert.rejects(serviceFor(["kitchen"], port).list(principal,
    { branchId, customerId, limit: 5, restaurantId }), isError("authorization"));
  assert.equal(calls, 0);

  await assert.rejects(serviceFor(["waiter"], { list: async () => "forbidden" }).list(principal,
    { branchId, customerId, limit: 5, restaurantId }), isError("authorization"));
  await assert.rejects(serviceFor(["waiter"], { list: async () => { throw new Error("private detail"); } }).list(principal,
    { branchId, customerId, limit: 5, restaurantId }), isError("unavailable"));
  await assert.rejects(serviceFor(["waiter"], { list: async () => ({ ...list, customerId: orderId }) }).list(principal,
    { branchId, customerId, limit: 5, restaurantId }), isError("unavailable"));
});

test("PostgreSQL history adapter binds actor and canonical query and maps immutable snapshots", async () => {
  const outcome = { status: "ok", result: {
    customerId,
    orders: [{ confirmedAt, fulfillmentChannel: "delivery", order: encodeOrderRecord(order) }],
    schemaVersion: 1,
    scope,
  } };
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const database: DatabaseClientPort = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rows: [{ result: outcome }] };
  } };
  const result = await new PostgresCustomerOrderHistory(database).list(actorId, query);

  assert.notEqual(result, "forbidden");
  if (result === "forbidden") return;
  assert.deepEqual(result, list);
  assert.deepEqual(calls, [{
    parameters: [actorId, JSON.stringify(query)],
    sql: "select app_private.list_customer_recent_orders($1::uuid, $2::jsonb) as result",
  }]);
  assert.equal(result.orders[0]?.items[0]?.modifiers[0]?.unitPriceMinor, 500);
});

test("PostgreSQL history adapter fails closed for denied, malformed, foreign and ambiguous outcomes", async () => {
  const adapterFor = (rows: readonly unknown[]) => new PostgresCustomerOrderHistory({ query: async () => ({ rows }) });
  assert.equal(await adapterFor([{ result: { status: "denied" } }]).list(actorId, query), "forbidden");

  const validResult = {
    customerId,
    orders: [{ confirmedAt, fulfillmentChannel: "delivery", order: encodeOrderRecord(order) }],
    schemaVersion: 1,
    scope,
  };
  for (const rows of [
    [],
    [{ result: { status: "ok", result: validResult } }, { result: { status: "ok", result: validResult } }],
    [{ other: { status: "ok", result: validResult } }],
    [{ result: { status: "rejected" } }],
    [{ result: { status: "ok", result: { ...validResult, customerId: orderId } } }],
    [{ result: { status: "ok", result: { ...validResult, scope: { ...scope, branchId: customerId } } } }],
    [{ result: { status: "ok", result: { ...validResult, orders: [
      { confirmedAt, fulfillmentChannel: "delivery", order: { ...encodeOrderRecord(order), branchId: customerId } },
    ] } } }],
  ]) {
    await assert.rejects(adapterFor(rows).list(actorId, query), isError("unavailable"));
  }
});

test("PostgreSQL history adapter resolves a repeat source only inside the bounded recent history", async () => {
  const database: DatabaseClientPort = { query: async () => ({ rows: [{ result: {
    status: "ok",
    result: {
      customerId,
      orders: [{ confirmedAt, fulfillmentChannel: "delivery", order: encodeOrderRecord(order) }],
      schemaVersion: 1,
      scope,
    },
  } }] }) };
  const adapter = new PostgresCustomerOrderHistory(database);
  assert.deepEqual(await adapter.read(actorId, previewQuery), order);
  assert.equal(await adapter.read(actorId, { ...previewQuery,
    orderId: "fb0379c4-9dde-4f2e-bb6e-21f47c627f69" }), "missing");
});

test("repeat preview rebuilds lines from current catalog facts and reports price changes", async () => {
  const sourceCalls: unknown[] = [];
  const catalogCalls: unknown[] = [];
  const source: CustomerOrderRepeatSourcePort = { read: async (receivedActor, receivedQuery) => {
    sourceCalls.push({ receivedActor, receivedQuery });
    return order;
  } };
  const catalogs = catalogPort(async (receivedActor, receivedScope) => {
    catalogCalls.push({ receivedActor, receivedScope });
    return catalogState();
  });
  const service = previewServiceFor(["waiter"], source, catalogs);

  const result = await service.preview(principal, { branchId, customerId, orderId, restaurantId });
  assert.equal(result.readyLineCount, 1);
  assert.equal(result.blockedLineCount, 0);
  assert.equal(result.hasPriceChanges, true);
  assert.equal(result.lines[0]?.currentUnitPriceMinor, 4_000);
  assert.deepEqual(result.lines[0]?.issues.map(({ code }) => code),
    ["product_price_changed", "modifier_price_changed"]);
  assert.deepEqual(sourceCalls, [{ receivedActor: actorId, receivedQuery: previewQuery }]);
  assert.deepEqual(catalogCalls, [{ receivedActor: actorId, receivedScope: scope }]);
  assert.ok(Object.isFrozen(result.lines[0]?.issues));
});

test("repeat preview blocks removed products and fails closed before data access without every permission", async () => {
  let sourceCalls = 0;
  let catalogCalls = 0;
  const source: CustomerOrderRepeatSourcePort = { read: async () => { sourceCalls += 1; return order; } };
  const removedCatalog = catalogState({ modifierGroups: [], products: [] });
  const catalogs = catalogPort(async () => { catalogCalls += 1; return removedCatalog; });

  const blocked = await previewServiceFor(["waiter"], source, catalogs).preview(principal,
    { branchId, customerId, orderId, restaurantId });
  assert.equal(blocked.lines[0]?.status, "blocked");
  assert.equal(blocked.lines[0]?.currentUnitPriceMinor, null);
  assert.deepEqual(blocked.lines[0]?.issues.map(({ code }) => code), ["product_removed"]);

  sourceCalls = 0;
  catalogCalls = 0;
  await assert.rejects(previewServiceFor(["kitchen"], source, catalogs).preview(principal,
    { branchId, customerId, orderId, restaurantId }), isError("authorization"));
  assert.equal(sourceCalls, 0);
  assert.equal(catalogCalls, 0);
});

test("repeat preview distinguishes an absent recent order and sanitizes catalog failures", async () => {
  const catalog = catalogPort(async () => catalogState());
  await assert.rejects(previewServiceFor(["waiter"], { read: async () => "missing" }, catalog).preview(principal,
    { branchId, customerId, orderId, restaurantId }), isError("not_found"));
  await assert.rejects(previewServiceFor(["waiter"], { read: async () => order },
    catalogPort(async () => ({ catalog: null, schemaVersion: 1, scope }))).preview(principal,
    { branchId, customerId, orderId, restaurantId }), isError("unavailable"));
  await assert.rejects(previewServiceFor(["waiter"], { read: async () => order },
    catalogPort(async () => { throw new Error("private detail"); })).preview(principal,
    { branchId, customerId, orderId, restaurantId }), isError("unavailable"));
  await assert.rejects(previewServiceFor(["waiter"], { read: async () => order }, catalog).preview(principal,
    { branchId, customerId, orderId: "bad", restaurantId }), isError("request"));
});

test("repeat-to-Capture reauthorizes every boundary and persists only current IDs and quantities", async () => {
  const plans: CaptureRepeatSelectionPlan[] = [];
  const persistence: CustomerOrderRepeatCapturePort = { apply: async (receivedActor, receivedCommand, plan) => {
    assert.equal(receivedActor, actorId);
    assert.deepEqual(receivedCommand, repeatCommand);
    plans.push(plan);
    return { status: "applied", record: captureRecord(8) };
  } };
  const result = await repeatCaptureServiceFor(["waiter"], { read: async () => order },
    catalogPort(async () => catalogState()), persistence).apply(
    principal, repeatCommand, customerId, orderId,
  );

  assert.equal(result.capture.detail.version, 8);
  assert.equal(result.capture.replayed, false);
  assert.equal(result.preview.readyLineCount, 1);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0], {
    catalogVersion,
    customerId,
    lines: [{
      modifierGroups: [{ groupId, selections: [{ optionId: modifierId, quantity: 1 }] }],
      productId,
      quantity: 2,
      sourceOrderItemId: orderItemId,
    }],
    schemaVersion: 1,
    sourceOrderId: orderId,
  });
  assert.equal(/price|amount|name/iu.test(JSON.stringify(plans[0])), false);
  assert.ok(Object.isFrozen(plans[0]?.lines[0]?.modifierGroups[0]?.selections));
});

test("repeat-to-Capture rejects route mismatch, incomplete authorization and zero ready lines before persistence", async () => {
  let reads = 0;
  let writes = 0;
  const source: CustomerOrderRepeatSourcePort = { read: async () => { reads += 1; return order; } };
  const persistence: CustomerOrderRepeatCapturePort = { apply: async () => { writes += 1; return {}; } };
  const service = repeatCaptureServiceFor(["waiter"], source, catalogPort(async () => catalogState()), persistence);
  await assert.rejects(service.apply(principal, repeatCommand, customerId,
    "fb0379c4-9dde-4f2e-bb6e-21f47c627f69"), isError("request"));
  assert.equal(reads, 0);
  assert.equal(writes, 0);

  await assert.rejects(repeatCaptureServiceFor(["kitchen"], source,
    catalogPort(async () => catalogState()), persistence).apply(
    principal, repeatCommand, customerId, orderId,
  ), isError("authorization"));
  assert.equal(reads, 0);
  assert.equal(writes, 0);

  await assert.rejects(repeatCaptureServiceFor(["waiter"], source,
    catalogPort(async () => catalogState({ modifierGroups: [], products: [] })), persistence).apply(
    principal, repeatCommand, customerId, orderId,
  ), isError("conflict"));
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});

test("repeat-to-Capture maps replay and persistence failures without trusting divergent Capture facts", async () => {
  const replay = await repeatCaptureServiceFor(["waiter"], { read: async () => order },
    catalogPort(async () => catalogState()), { apply: async () => ({ status: "replayed", record: captureRecord(8) }) }).apply(
    principal, repeatCommand, customerId, orderId,
  );
  assert.equal(replay.capture.replayed, true);

  for (const [raw, code] of [
    [{ status: "denied" }, "authorization"],
    [{ status: "conflict" }, "conflict"],
    [{ status: "rejected" }, "request"],
    [{ status: "applied", record: captureRecord(9) }, "unavailable"],
  ] as const) {
    await assert.rejects(repeatCaptureServiceFor(["waiter"], { read: async () => order },
      catalogPort(async () => catalogState()), { apply: async () => raw }).apply(
      principal, repeatCommand, customerId, orderId,
    ), isError(code));
  }
});

test("PostgreSQL repeat-to-Capture adapter binds the verified actor, command and server-built plan", async () => {
  const plan: CaptureRepeatSelectionPlan = Object.freeze({
    catalogVersion,
    customerId,
    lines: Object.freeze([Object.freeze({
      modifierGroups: Object.freeze([]), productId, quantity: 2, sourceOrderItemId: orderItemId,
    })]),
    schemaVersion: 1,
    sourceOrderId: orderId,
  });
  const calls: unknown[] = [];
  const adapter = new PostgresCustomerOrderRepeatCapture({ query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rows: [{ result: { status: "applied", record: captureRecord(8) } }] };
  } });
  assert.deepEqual(await adapter.apply(actorId, repeatCommand, plan),
    { status: "applied", record: captureRecord(8) });
  assert.deepEqual(calls, [{
    parameters: [actorId, JSON.stringify(repeatCommand), JSON.stringify(plan)],
    sql: "select app_private.repeat_customer_order_into_capture($1::uuid, $2::jsonb, $3::jsonb) as result",
  }]);
  await assert.rejects(new PostgresCustomerOrderRepeatCapture({ query: async () => ({ rows: [] }) })
    .apply(actorId, repeatCommand, plan), isError("unavailable"));
});

function serviceFor(roles: readonly MembershipRoleCode[], port: CustomerOrderHistoryPort): CustomerOrderHistoryService {
  return new CustomerOrderHistoryService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope }),
  }), port);
}

function previewServiceFor(
  roles: readonly MembershipRoleCode[],
  source: CustomerOrderRepeatSourcePort,
  catalogs: MenuCatalogPort,
): CustomerOrderRepeatPreviewService {
  return new CustomerOrderRepeatPreviewService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope }),
  }), source, catalogs);
}

function repeatCaptureServiceFor(
  roles: readonly MembershipRoleCode[],
  source: CustomerOrderRepeatSourcePort,
  catalogs: MenuCatalogPort,
  persistence: CustomerOrderRepeatCapturePort,
): CustomerOrderRepeatCaptureService {
  return new CustomerOrderRepeatCaptureService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope }),
  }), source, catalogs, persistence);
}

function catalogPort(read: MenuCatalogPort["read"]): MenuCatalogPort {
  return { read, save: async () => { throw new Error("Unexpected save"); } };
}

function catalogState(overrides: Partial<NonNullable<MenuCatalogStateV1["catalog"]>> = {}): MenuCatalogStateV1 {
  return Object.freeze({
    catalog: Object.freeze({
      catalogVersion,
      categories: [{ active: true, categoryId, displayOrder: 0, name: "Comida" }],
      currency: "MXN",
      modifierGroups: [{
        active: true,
        displayOrder: 0,
        groupId,
        maximumQuantity: 1,
        minimumQuantity: 0,
        name: "Extras",
        options: [{ active: true, maximumQuantity: 1, name: "Queso", optionId: modifierId, unitPriceMinor: 600 }],
        productId,
      }],
      products: [{
        active: true,
        categoryId,
        displayOrder: 0,
        name: "Tacos actuales",
        productId,
        sku: "TACO-1",
        stationId,
        tax: null,
        unit: "piece",
        unitPriceMinor: 4_000,
      }],
      replayed: false,
      updatedAt: confirmedAt,
      updatedBy: actorId,
      version: 2,
      ...overrides,
    }),
    schemaVersion: 1,
    scope,
  });
}

function captureRecord(version: number) {
  return {
    detail: {
      attentionLeaseExpiresAt: "2026-09-23T12:05:00.000Z",
      attentionLeaseId,
      attentionStatus: "claimed",
      captureDraftId,
      confirmedOrderId: null,
      customerSnapshotRef: "0e22dfd1-9064-4fa8-86da-8fcce41fe821",
      folio: "CAP-REPEAT-1",
      fulfillmentChannel: "delivery",
      fulfillmentSnapshotRef: "e2a6113b-d5cb-4e26-8f65-a0bc9065b08c",
      ownerMembershipId: membershipId,
      schemaVersion: 1,
      scope,
      sourceChannel: "phone",
      status: "draft",
      updatedAt: confirmedAt,
      version,
    },
    recoveryPolicy: {
      autoRenewSelected: false,
      recoveryExpiresAt: "2026-09-23T12:30:00.000Z",
      schemaVersion: 1,
    },
    schemaVersion: 1,
  };
}

function audit(suffix: string) {
  return {
    actorId,
    deviceId: "device-1",
    eventId: `event-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    occurredAt: confirmedAt,
  };
}

function isError(code: CustomerOrderHistoryError["code"]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof CustomerOrderHistoryError && error.code === code;
}
