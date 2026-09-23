import assert from "node:assert/strict";
import test from "node:test";

import { Money, addOrderItem, createOrder } from "@super-restaurant/domain";
import {
  parseCustomerRecentOrderListV1,
  parseCustomerRecentOrdersQueryV1,
  parseBranchScope,
  type MembershipRoleCode,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import {
  CustomerOrderHistoryError,
  CustomerOrderHistoryService,
  PostgresCustomerOrderHistory,
  type CustomerOrderHistoryPort,
} from "./customer-order-history.js";
import type { DatabaseClientPort } from "./database.js";
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

function serviceFor(roles: readonly MembershipRoleCode[], port: CustomerOrderHistoryPort): CustomerOrderHistoryService {
  return new CustomerOrderHistoryService(new MembershipAuthorizationService({
    findActiveMembership: async () => ({ roles, scope }),
  }), port);
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
