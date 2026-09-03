import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAddOrderItemCommandV1,
  parseBranchScope,
  parseCreateOrderCommandV1,
  parseKdsCursorV1,
  parseKdsEventPageV1,
  parseKdsEventV1,
  parseMenuCatalogStateV1,
  parseOpenOrderCommandV1,
  parseRealtimeSubscriptionV1,
  parseTransitionOrderItemCommandV1,
  type MenuCatalogStateV1,
} from "@super-restaurant/shared-types";
import { createOrder } from "@super-restaurant/domain";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import type { MenuCatalogPort } from "./menu-catalog.js";
import {
  OrderApplicationError,
  OrderService,
  PostgresOrderPersistenceAdapter,
  type OrderPersistencePort,
  type RealtimeNotificationPort,
} from "./orders.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const parsedScope = parseBranchScope({
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
});
if (parsedScope === undefined) throw new Error("TEST_SCOPE_INVALID");
const scope = parsedScope;

const audit = Object.freeze({
  deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
  eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  idempotencyKey: "orders-test-create",
  occurredAt: "2026-09-02T22:00:00.000Z",
});
const orderId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const orderItemId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const productId = "9544c299-d25b-44ce-98ed-d30116610887";
const createCommand = parseCreateOrderCommandV1({
  ...audit,
  channel: "counter",
  currency: "MXN",
  orderId,
  schemaVersion: 1,
  scope,
  tableId: null,
  timeZone: "America/Mexico_City",
});
if (createCommand === undefined) throw new Error("TEST_CREATE_COMMAND_INVALID");

const domainMutation = createOrder({
  branchId: scope.branchId,
  channel: "counter",
  currency: "MXN",
  orderId,
  restaurantId: scope.restaurantId,
  timeZone: "America/Mexico_City",
}, { ...audit, actorId: principal.actorId });

const parsedKdsEvent = parseKdsEventV1({
  cursor: "v1:1",
  eventId: audit.eventId,
  occurredAt: audit.occurredAt,
  operation: "order_item.created",
  orderId,
  orderItemId,
  receivedAt: "2026-09-02T22:00:01.000Z",
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
  status: "pending",
});
if (parsedKdsEvent === undefined) throw new Error("TEST_KDS_EVENT_INVALID");
const kdsEvent = parsedKdsEvent;

const subscription = parseRealtimeSubscriptionV1({ schemaVersion: 1, scope, stationId: "kitchen" });
const initialCursor = parseKdsCursorV1("v1:0");
const eventPage = parseKdsEventPageV1({
  events: [kdsEvent],
  hasMore: false,
  nextCursor: "v1:1",
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
});
if (subscription === undefined || initialCursor === undefined || eventPage === undefined) throw new Error("TEST_RECOVERY_INVALID");

test("PostgreSQL order adapter binds private functions and validates exact responses", async () => {
  const calls: { readonly parameters: readonly unknown[]; readonly sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      if (sql.includes("read_order")) return { rows: [{ result: readResult() }] };
      if (sql.includes("recover_kds_events")) return { rows: [{ result: eventPage }] };
      return { rows: [{ result: persistResult("saved", null) }] };
    },
  };
  const adapter = new PostgresOrderPersistenceAdapter(database);
  const stored = await adapter.read(principal.actorId, scope, orderId);
  assert.notEqual(stored, "missing");
  assert.equal(stored === "missing" ? 0 : stored.version, 1);
  const persisted = await adapter.persist(principal.actorId, 0, domainMutation);
  assert.equal(persisted.status, "saved");
  assert.deepEqual(await adapter.recoverKds(principal.actorId, subscription, initialCursor, 50), eventPage);
  assert.match(calls[0]?.sql ?? "", /app_private\.read_order/u);
  assert.deepEqual(calls[0]?.parameters, [principal.actorId, scope.restaurantId, scope.branchId, orderId]);
  assert.deepEqual(calls[1]?.parameters?.slice(0, 2), [principal.actorId, 0]);
  assert.equal(typeof calls[1]?.parameters?.[2], "string");
  assert.deepEqual(calls[2]?.parameters, [principal.actorId, scope.restaurantId, scope.branchId, "kitchen", "0", 50]);
});

test("PostgreSQL order adapter fails closed for ambiguous, malformed, or forbidden output", async () => {
  for (const rows of [[], [{ result: readResult() }, { result: readResult() }], [{ result: readResult(), extra: true }]]) {
    await assert.rejects(
      new PostgresOrderPersistenceAdapter({ query: async () => ({ rows }) }).read(principal.actorId, scope, orderId),
      OrderApplicationError,
    );
  }
  assert.equal(
    await new PostgresOrderPersistenceAdapter({ query: async () => ({ rows: [{ result: null }] }) }).read(principal.actorId, scope, orderId),
    "missing",
  );
  const forbiddenAdapter = new PostgresOrderPersistenceAdapter({ query: async () => ({ rows: [{ result: { status: "forbidden" } }] }) });
  assert.deepEqual(await forbiddenAdapter.persist(principal.actorId, 0, domainMutation), { status: "forbidden" });
  const nullAdapter = new PostgresOrderPersistenceAdapter({ query: async () => ({ rows: [{ result: null }] }) });
  assert.equal(await nullAdapter.recoverKds(principal.actorId, subscription, initialCursor, 50), "forbidden");
});

test("order service creates, snapshots catalog items, transitions, and only notifies fresh KDS events", async () => {
  const notifications: string[] = [];
  const storedMutation = domainMutation;
  let storedOrder = storedMutation.order;
  let storedVersion = 1;
  const orders: OrderPersistencePort = {
    persist: async (_actorId, _expectedVersion, mutation) => {
      storedOrder = mutation.order;
      storedVersion += 1;
      return { kdsEvent: mutation.auditEvent.operation === "order.created" ? null : kdsEvent, order: mutation.order, status: "saved", version: storedVersion };
    },
    read: async () => ({ order: storedOrder, version: storedVersion }),
    recoverKds: async () => eventPage,
  };
  const service = serviceFor(["manager"], orders, {
    notify: async (event) => { notifications.push(event.eventId); },
  });
  const created = await service.create(principal, createCommand);
  assert.equal(created.orderStatus, "draft");

  storedVersion = 1;
  const addCommand = parseAddOrderItemCommandV1({
    ...audit,
    eventId: "5c6ae1b4-d33c-4510-b633-b160bf3abef1",
    expectedVersion: 1,
    idempotencyKey: "orders-test-add",
    modifierGroups: [],
    orderId,
    orderItemId,
    productId,
    quantity: 2,
    schemaVersion: 1,
    scope,
  });
  if (addCommand === undefined) throw new Error("TEST_ADD_COMMAND_INVALID");
  const added = await service.addItem(principal, addCommand);
  assert.equal(added.version, 2);
  assert.equal(storedOrder.items[0]?.snapshot.unitPrice.amountMinor, 12_500);

  const itemTransition = parseTransitionOrderItemCommandV1({
    ...audit,
    eventId: "fa859575-a48f-47d0-bc2e-e3520723968a",
    expectedVersion: 2,
    idempotencyKey: "orders-test-sent",
    orderId,
    orderItemId,
    schemaVersion: 1,
    scope,
    to: "sent",
  });
  if (itemTransition === undefined) throw new Error("TEST_TRANSITION_COMMAND_INVALID");
  assert.equal((await service.transitionItem(principal, itemTransition)).version, 3);
  assert.equal(notifications.length, 2);
  assert.deepEqual(await service.recoverKds(principal, subscription, initialCursor, "50"), eventPage);
});

test("order service enforces permission, optimistic version, and domain transitions", async () => {
  const port: OrderPersistencePort = {
    persist: async () => ({ status: "conflict" }),
    read: async () => ({ order: domainMutation.order, version: 1 }),
    recoverKds: async () => "forbidden",
  };
  await assertCode(serviceFor(["viewer"], port).create(principal, createCommand), "authorization");
  await assertCode(serviceFor(["manager"], port).create(principal, createCommand), "conflict");
  const openCommand = parseOpenOrderCommandV1({
    ...audit,
    eventId: "c483b6e7-e102-4cc5-a887-d30712c85e52",
    expectedVersion: 2,
    idempotencyKey: "orders-test-open",
    orderId,
    schemaVersion: 1,
    scope,
  });
  if (openCommand === undefined) throw new Error("TEST_OPEN_COMMAND_INVALID");
  await assertCode(serviceFor(["manager"], port).open(principal, openCommand), "conflict");
  await assertCode(serviceFor(["viewer"], port).recoverKds(principal, subscription, initialCursor, 50), "authorization");
  await assertCode(serviceFor(["manager"], port).recoverKds(principal, subscription, initialCursor, 50), "authorization");
  await assertCode(serviceFor(["manager"], port).recoverKds(principal, subscription, "bad", 50), "request");
});

function serviceFor(
  roles: readonly ("manager" | "viewer")[],
  orders: OrderPersistencePort,
  notifications: RealtimeNotificationPort = { notify: async () => undefined },
): OrderService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope }) };
  const catalogs: MenuCatalogPort = { read: async () => menuState, save: async () => ({ status: "conflict" }) };
  return new OrderService(new MembershipAuthorizationService(memberships), orders, catalogs, notifications);
}

const menuState: MenuCatalogStateV1 = (() => {
  const state = parseMenuCatalogStateV1({
    catalog: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
      categories: [{ active: true, categoryId: "52e0ac1f-555a-4e31-9dd7-155cf2119b6a", displayOrder: 0, name: "Alimentos" }],
      currency: "MXN",
      modifierGroups: [],
      products: [{
        active: true,
        categoryId: "52e0ac1f-555a-4e31-9dd7-155cf2119b6a",
        displayOrder: 0,
        name: "Hamburguesa",
        productId,
        sku: "HAM-001",
        stationId: "kitchen",
        tax: null,
        unit: "piece",
        unitPriceMinor: 12_500,
      }],
      replayed: false,
      updatedAt: "2026-09-02T21:00:00.000Z",
      updatedBy: principal.actorId,
      version: 1,
    },
    schemaVersion: 1,
    scope,
  });
  if (state === undefined) throw new Error("TEST_MENU_INVALID");
  return state;
})();

function readResult(): unknown {
  return {
    order: persistResult("saved", null).order,
    schemaVersion: 1,
    scope,
    updatedAt: "2026-09-02T22:00:01.000Z",
    version: 1,
  };
}

function persistResult(status: "replayed" | "saved", event: typeof kdsEvent | null) {
  return {
    kdsEvent: event,
    order: {
      branchId: scope.branchId,
      channel: "counter",
      currency: "MXN",
      items: [],
      orderId,
      restaurantId: scope.restaurantId,
      schemaVersion: 1,
      status: "draft",
      timeZone: "America/Mexico_City",
    },
    schemaVersion: 1,
    scope,
    status,
    version: 1,
  };
}

async function assertCode(promise: Promise<unknown>, code: OrderApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof OrderApplicationError && error.code === code);
}
