import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  parseAddOrderItemCommandV1,
  parseBranchScope,
  parseCancelOrderItemCommandV1,
  parseCreateOrderCommandV1,
  parseCreateOrderCommandV2,
  parseKdsCursorV1,
  parseKdsEventPageV1,
  parseKdsEventV1,
  parseKdsTicketListV1,
  parseMenuCatalogStateV1,
  parseOpenOrderCommandV1,
  parseRealtimeSubscriptionV1,
  parseTransitionOrderItemCommandV1,
  type MenuCatalogStateV1,
} from "@super-restaurant/shared-types";
import { addOrderItem, cancelOrderItem, createOrder, Money, transitionOrderItemStatus, transitionOrderStatus, type Order, type OrderMutation } from "@super-restaurant/domain";

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
  type SendOrderToKitchenBatchResult,
} from "./orders.js";

/** Not exercised by these tests; `sendToKitchen` is tested separately against `fakeSendToKitchenPort`. */
const notImplementedSendOrderToKitchen: OrderPersistencePort["sendOrderToKitchen"] = async () => {
  throw new Error("sendOrderToKitchen not implemented by this fake");
};

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
const ticketList = parseKdsTicketListV1({
  schemaVersion: 1,
  scope,
  stationId: "kitchen",
  tickets: [{
    schemaVersion: 1,
    scope,
    stationId: "kitchen",
    orderId,
    orderItemId,
    orderVersion: 3,
    channel: "counter",
    tableId: null,
    quantity: 2,
    productName: "Hamburguesa",
    modifiers: [],
    note: null,
    status: "sent",
    queuedAt: "2026-09-02T22:00:01.000Z",
  }],
  truncated: false,
});
if (subscription === undefined || initialCursor === undefined || eventPage === undefined || ticketList === undefined) throw new Error("TEST_RECOVERY_INVALID");

test("PostgreSQL order adapter binds private functions and validates exact responses", async () => {
  const calls: { readonly parameters: readonly unknown[]; readonly sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      if (sql.includes("read_order")) return { rows: [{ result: readResult() }] };
      if (sql.includes("recover_kds_events")) return { rows: [{ result: eventPage }] };
      if (sql.includes("list_kds_tickets")) return { rows: [{ result: ticketList }] };
      return { rows: [{ result: persistResult("saved", null) }] };
    },
  };
  const adapter = new PostgresOrderPersistenceAdapter(database);
  const stored = await adapter.read(principal.actorId, scope, orderId);
  assert.notEqual(stored, "missing");
  assert.equal(stored === "missing" ? 0 : stored.version, 1);
  const persisted = await adapter.persist(principal.actorId, 0, domainMutation);
  assert.equal(persisted.status, "saved");
  const operationalShiftId = randomUUID();
  const operationalPersisted = await adapter.persist(principal.actorId, 0, domainMutation, operationalShiftId);
  assert.equal(operationalPersisted.status, "saved");
  assert.deepEqual(await adapter.recoverKds(principal.actorId, subscription, initialCursor, 50), eventPage);
  assert.deepEqual(await adapter.listKdsTickets(principal.actorId, subscription), ticketList);
  assert.match(calls[0]?.sql ?? "", /app_private\.read_order/u);
  assert.deepEqual(calls[0]?.parameters, [principal.actorId, scope.restaurantId, scope.branchId, orderId]);
  assert.deepEqual(calls[1]?.parameters?.slice(0, 2), [principal.actorId, 0]);
  assert.equal(typeof calls[1]?.parameters?.[2], "string");
  assert.match(calls[2]?.sql ?? "", /app_private\.create_operational_order/u);
  assert.deepEqual(calls[2]?.parameters?.slice(0, 2), [principal.actorId, operationalShiftId]);
  assert.equal(typeof calls[2]?.parameters?.[2], "string");
  assert.deepEqual(calls[3]?.parameters, [principal.actorId, scope.restaurantId, scope.branchId, "kitchen", "0", 50]);
  assert.deepEqual(calls[4]?.parameters, [principal.actorId, scope.restaurantId, scope.branchId, "kitchen"]);
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
  assert.equal(await nullAdapter.listKdsTickets(principal.actorId, subscription), "forbidden");
});

test("order service creates, snapshots catalog items, transitions, and only notifies fresh KDS events", async () => {
  const notifications: string[] = [];
  let cancellationMutation: OrderMutation | undefined;
  const storedMutation = domainMutation;
  let storedOrder = storedMutation.order;
  let storedVersion = 1;
  const orders: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => ticketList,
    persist: async (_actorId, _expectedVersion, mutation) => {
      storedOrder = mutation.order;
      storedVersion += 1;
      if (mutation.auditEvent.operation === "order_item.state_changed" && mutation.auditEvent.to === "cancelled") {
        cancellationMutation = mutation;
      }
      return { kdsEvent: mutation.auditEvent.operation === "order.created" ? null : kdsEvent, order: mutation.order, status: "saved", version: storedVersion };
    },
    read: async () => ({ order: storedOrder, version: storedVersion }),
    recoverKds: async () => eventPage,
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
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

  const pendingOrder = storedOrder;
  let pendingCancellation: OrderMutation | undefined;
  const pendingOrders: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => ticketList,
    persist: async (_actorId, expectedVersion, mutation) => {
      pendingCancellation = mutation;
      return { kdsEvent, order: mutation.order, status: "saved", version: expectedVersion + 1 };
    },
    read: async () => ({ order: pendingOrder, version: 2 }),
    recoverKds: async () => eventPage,
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const pendingCancelCommand = parseCancelOrderItemCommandV1({
    ...audit,
    eventId: randomUUID(),
    expectedVersion: 2,
    idempotencyKey: "orders-test-cancel-pending",
    orderId,
    orderItemId,
    reason: "Captura duplicada",
    schemaVersion: 1,
    scope,
  });
  if (pendingCancelCommand === undefined) throw new Error("TEST_PENDING_CANCEL_COMMAND_INVALID");
  assert.equal((await serviceFor(["waiter"], pendingOrders).cancelItem(principal, pendingCancelCommand)).version, 3);
  assert.equal(pendingCancellation?.order.items[0]?.cancellationAudit?.authorization, undefined);
  await assertCode(serviceFor(["supervisor"], {
    ...pendingOrders,
    read: async () => ({ order: { ...pendingOrder, status: "partially_paid" }, version: 2 }),
  }).cancelItem(principal, pendingCancelCommand), "conflict");

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

  const cancelCommand = parseCancelOrderItemCommandV1({
    ...audit,
    eventId: randomUUID(),
    expectedVersion: 3,
    idempotencyKey: "orders-test-cancel-sent",
    orderId,
    orderItemId,
    reason: "El cliente cambió su selección",
    schemaVersion: 1,
    scope,
  });
  if (cancelCommand === undefined) throw new Error("TEST_CANCEL_COMMAND_INVALID");
  await assertCode(serviceFor(["waiter"], orders).cancelItem(principal, cancelCommand), "authorization");
  const cancelled = await serviceFor(["supervisor"], orders, {
    notify: async (event) => { notifications.push(event.eventId); },
  }).cancelItem(principal, cancelCommand);
  assert.equal(cancelled.version, 4);
  assert.equal(storedOrder.items[0]?.status, "cancelled");
  assert.equal(storedOrder.items[0]?.cancellationAudit?.reason, "El cliente cambió su selección");
  assert.equal(storedOrder.items[0]?.cancellationAudit?.authorization?.actorId, principal.actorId);
  assert.equal(notifications.length, 3);
  if (cancellationMutation === undefined) throw new Error("TEST_CANCELLATION_MUTATION_MISSING");
  const cancellationCalls: string[] = [];
  const cancellationAdapter = new PostgresOrderPersistenceAdapter({
    query: async (sql) => {
      cancellationCalls.push(sql);
      return { rows: [{ result: { status: "conflict" } }] };
    },
  });
  assert.deepEqual(await cancellationAdapter.persist(principal.actorId, 3, cancellationMutation), { status: "conflict" });
  assert.match(cancellationCalls[0] ?? "", /app_private\.persist_order_item_cancellation/u);
  assert.deepEqual(await service.recoverKds(principal, subscription, initialCursor, "50"), eventPage);
  assert.deepEqual(await service.listKdsTickets(principal, subscription), ticketList);
});

test("order service keeps v1 compatible and binds only v2 creation to an operational shift", async () => {
  const receivedShiftIds: (string | null | undefined)[] = [];
  const orders: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => ticketList,
    persist: async (_actorId, expectedVersion, mutation, operationalShiftId) => {
      receivedShiftIds.push(operationalShiftId);
      return { kdsEvent: null, order: mutation.order, status: "saved", version: expectedVersion + 1 };
    },
    read: async () => ({ order: domainMutation.order, version: 1 }),
    recoverKds: async () => eventPage,
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const service = serviceFor(["manager"], orders);
  await service.create(principal, createCommand);

  const shiftId = randomUUID();
  const v2 = parseCreateOrderCommandV2({
    channel: "table",
    currency: "MXN",
    deviceId: randomUUID(),
    eventId: randomUUID(),
    idempotencyKey: "orders-test-operational-v2",
    occurredAt: "2026-09-05T20:30:00.000Z",
    orderId: randomUUID(),
    schemaVersion: 2,
    scope,
    shiftId,
    tableId: randomUUID(),
    timeZone: "America/Hermosillo",
  });
  if (v2 === undefined) throw new Error("TEST_OPERATIONAL_CREATE_COMMAND_INVALID");
  assert.equal((await service.create(principal, v2)).orderStatus, "draft");
  assert.deepEqual(receivedShiftIds, [undefined, shiftId]);
});

test("order service passes a null shiftId to SQL untouched; SQL resolves the shift after its idempotency lookup", async () => {
  const receivedShiftIds: (string | null | undefined)[] = [];
  let outcome: "saved" | "conflict" = "saved";
  const orders: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => ticketList,
    persist: async (_actorId, expectedVersion, mutation, operationalShiftId) => {
      receivedShiftIds.push(operationalShiftId);
      return outcome === "saved"
        ? { kdsEvent: null, order: mutation.order, status: "saved", version: expectedVersion + 1 }
        : { status: "conflict" };
    },
    read: async () => ({ order: domainMutation.order, version: 1 }),
    recoverKds: async () => eventPage,
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const service = serviceFor(["manager"], orders);
  const v2 = parseCreateOrderCommandV2({
    channel: "table", currency: "MXN", deviceId: randomUUID(), eventId: randomUUID(),
    idempotencyKey: "orders-test-null-shift", occurredAt: "2026-09-05T20:30:00.000Z",
    orderId: randomUUID(), schemaVersion: 2, scope, shiftId: null, tableId: randomUUID(),
    timeZone: "America/Hermosillo",
  });
  if (v2 === undefined) throw new Error("TEST_NULL_SHIFT_CREATE_COMMAND_INVALID");
  assert.equal((await service.create(principal, v2)).orderStatus, "draft");
  assert.deepEqual(receivedShiftIds, [null]);

  outcome = "conflict";
  await assert.rejects(service.create(principal, v2), (error: unknown) => {
    assert.ok(error instanceof OrderApplicationError);
    assert.equal(error.code, "conflict");
    return true;
  });
});

test("order service accepts the mobile handoff sequence through v2 create, item mutations, and open", async () => {
  const operationalOrderId = randomUUID();
  const operationalShiftId = randomUUID();
  const tableId = randomUUID();
  const calls: {
    readonly eventId: string;
    readonly expectedVersion: number;
    readonly operation: OrderMutation["auditEvent"]["operation"];
    readonly shiftId: string | null | undefined;
  }[] = [];
  let stored: { readonly order: OrderMutation["order"]; readonly version: number } | undefined;
  const orders: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => ticketList,
    persist: async (_actorId, expectedVersion, mutation, shiftId) => {
      assert.equal(expectedVersion, stored?.version ?? 0);
      calls.push({
        eventId: mutation.auditEvent.eventId,
        expectedVersion,
        operation: mutation.auditEvent.operation,
        shiftId,
      });
      stored = { order: mutation.order, version: expectedVersion + 1 };
      return { kdsEvent: null, order: mutation.order, status: "saved", version: stored.version };
    },
    read: async (_actorId, receivedScope, receivedOrderId) => {
      assert.deepEqual(receivedScope, scope);
      return stored !== undefined && receivedOrderId === stored.order.orderId ? stored : "missing";
    },
    recoverKds: async () => eventPage,
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const service = serviceFor(["waiter"], orders);
  const createEventId = randomUUID();
  const create = parseCreateOrderCommandV2({
    channel: "table",
    currency: menuState.catalog?.currency,
    deviceId: randomUUID(),
    eventId: createEventId,
    idempotencyKey: `mobile-handoff:${operationalOrderId}:create`,
    occurredAt: "2026-09-06T18:00:00.000Z",
    orderId: operationalOrderId,
    schemaVersion: 2,
    scope,
    shiftId: operationalShiftId,
    tableId,
    timeZone: "America/Hermosillo",
  });
  if (create === undefined) throw new Error("TEST_MOBILE_CREATE_COMMAND_INVALID");
  assert.equal((await service.create(principal, create)).version, 1);

  const itemEventIds: string[] = [];
  for (const [index, quantity] of [2, 1].entries()) {
    const eventId = randomUUID();
    itemEventIds.push(eventId);
    const add = parseAddOrderItemCommandV1({
      deviceId: create.deviceId,
      eventId,
      expectedVersion: index + 1,
      idempotencyKey: `mobile-handoff:${operationalOrderId}:line:${index + 1}`,
      modifierGroups: [],
      occurredAt: `2026-09-06T18:00:0${index + 1}.000Z`,
      orderId: operationalOrderId,
      orderItemId: randomUUID(),
      productId,
      quantity,
      schemaVersion: 1,
      scope,
    });
    if (add === undefined) throw new Error("TEST_MOBILE_ADD_COMMAND_INVALID");
    assert.equal((await service.addItem(principal, add)).version, index + 2);
  }

  const openEventId = randomUUID();
  const open = parseOpenOrderCommandV1({
    deviceId: create.deviceId,
    eventId: openEventId,
    expectedVersion: 3,
    idempotencyKey: `mobile-handoff:${operationalOrderId}:open`,
    occurredAt: "2026-09-06T18:00:03.000Z",
    orderId: operationalOrderId,
    schemaVersion: 1,
    scope,
  });
  if (open === undefined) throw new Error("TEST_MOBILE_OPEN_COMMAND_INVALID");
  const opened = await service.open(principal, open);

  assert.equal(opened.version, 4);
  assert.equal(opened.orderStatus, "open");
  assert.equal(stored?.order.items.length, 2);
  assert.deepEqual(stored?.order.items.map((item) => ({
    currency: item.snapshot.unitPrice.currency,
    quantity: item.quantity,
    unitPriceMinor: item.snapshot.unitPrice.amountMinor,
  })), [
    { currency: "MXN", quantity: 2, unitPriceMinor: 12_500 },
    { currency: "MXN", quantity: 1, unitPriceMinor: 12_500 },
  ]);
  assert.deepEqual(calls.map(({ expectedVersion, operation, shiftId }) => ({ expectedVersion, operation, shiftId })), [
    { expectedVersion: 0, operation: "order.created", shiftId: operationalShiftId },
    { expectedVersion: 1, operation: "order.item_added", shiftId: undefined },
    { expectedVersion: 2, operation: "order.item_added", shiftId: undefined },
    { expectedVersion: 3, operation: "order.state_changed", shiftId: undefined },
  ]);
  assert.deepEqual(calls.map(({ eventId }) => eventId), [createEventId, ...itemEventIds, openEventId]);
});

test("order service enforces permission, optimistic version, and domain transitions", async () => {
  const port: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => ({ order: domainMutation.order, version: 1 }),
    recoverKds: async () => "forbidden",
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
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
  await assertCode(serviceFor(["viewer"], port).listKdsTickets(principal, subscription), "authorization");
  await assertCode(serviceFor(["manager"], port).listKdsTickets(principal, subscription), "authorization");
  await assertCode(serviceFor(["manager"], port).listKdsTickets(principal, { ...subscription, stationId: " kitchen" }), "request");
});

test("order service detail scopes access, reduces PII, and computes actions from state and roles", async () => {
  const secondItemId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
  const withPendingItem = addOrderItem(domainMutation.order, {
    orderItemId,
    quantity: 2,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
      modifiers: [],
      name: "Hamburguesa",
      productId,
      stationId: "kitchen",
      unit: "piece",
      unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order;
  const withTwoItems = addOrderItem(withPendingItem, {
    orderItemId: secondItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
      modifiers: [],
      name: "Refresco",
      productId,
      stationId: "kitchen",
      unit: "piece",
      unitPrice: new Money(3_000, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order;
  const sentSecondItem = transitionOrderItemStatus(withTwoItems, secondItemId, "sent", { ...audit, actorId: principal.actorId }).order;

  const port: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => ({ order: sentSecondItem, version: 4 }),
    recoverKds: async () => "forbidden",
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const detailRequest = { orderId, schemaVersion: 1 as const, scope };

  await assertCode(serviceFor([], port).detail(principal, detailRequest), "authorization");

  const asViewer = await serviceFor(["viewer"], port).detail(principal, detailRequest);
  assert.deepEqual(asViewer.availableActions, []);
  assert.equal(asViewer.fulfillment.customerLabel, null);
  assert.equal(asViewer.fulfillment.addressLabel, null);
  assert.equal(asViewer.totals.itemsTotalMinor, 28_000);
  assert.equal(asViewer.totals.totalMinor, 28_000);
  assert.deepEqual(asViewer.items.map((item) => ({ availableActions: item.availableActions, lineTotalMinor: item.lineTotalMinor, status: item.status })), [
    { availableActions: [], lineTotalMinor: 25_000, status: "pending" },
    { availableActions: [], lineTotalMinor: 3_000, status: "sent" },
  ]);

  const asKitchen = await serviceFor(["kitchen"], port).detail(principal, detailRequest);
  assert.deepEqual(asKitchen.availableActions, []);
  assert.deepEqual(asKitchen.items.map((item) => item.availableActions), [[], ["markReady"]]);

  const asManager = await serviceFor(["manager"], port).detail(principal, detailRequest);
  // The order already has a pending line, so "sendToKitchen" alone covers it -- "open" is never
  // offered alongside it for the same draft order.
  assert.deepEqual(asManager.availableActions, ["addItem", "sendToKitchen", "cancelOrder"]);
  assert.deepEqual(asManager.items.map((item) => item.availableActions), [["cancelItem"], ["markReady", "cancelItem"]]);

  // A role with only orders.cancel.pending (waiter) never sees cancelItem on a line that already
  // reached KDS, even though the order-level state would otherwise allow it.
  const asWaiter = await serviceFor(["waiter"], port).detail(principal, detailRequest);
  assert.deepEqual(asWaiter.items.map((item) => item.availableActions), [["cancelItem"], []]);

  const missingPort: OrderPersistencePort = { ...port, read: async () => "missing" };
  await assertCode(serviceFor(["manager"], missingPort).detail(principal, detailRequest), "not_found");
  await assertCode(serviceFor(["manager"], port).detail(principal, { ...detailRequest, orderId: "not-a-uuid" }), "request");
});

/**
 * A minimal, in-memory stand-in for `app_private.send_order_to_kitchen` (S9.1 r12): the whole
 * batch is applied atomically (one call, one outcome), and a byte-identical retry (same
 * idempotencyKey, same command payload) replays the stored result instead of re-applying anything.
 * A reused key with a different payload, a version that no longer matches, or any listed line no
 * longer actually pending is a conflict with zero effect -- there is no partial application to
 * observe from outside this function, matching the real SQL function's own atomicity.
 */
function fakeSendToKitchenPort(initialOrder: Order, initialVersion: number): {
  readonly port: OrderPersistencePort;
  readonly currentOrder: () => Order;
  readonly currentVersion: () => number;
  readonly applyExternalMutation: (next: Order) => void;
} {
  let order = initialOrder;
  let version = initialVersion;
  const commandsByKey = new Map<string, { readonly payload: unknown; readonly result: SendOrderToKitchenBatchResult }>();
  const port: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => "forbidden",
    persist: async () => { throw new Error("persist is not used by sendToKitchen's atomic port method"); },
    read: async () => ({ order, version }),
    recoverKds: async () => "forbidden",
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: async (_actorId, expectedVersion, command, steps) => {
      const existing = commandsByKey.get(command.idempotencyKey);
      if (existing !== undefined) {
        if (JSON.stringify(existing.payload) !== JSON.stringify(command)) return { status: "conflict" };
        return existing.result.status === "conflict" ? existing.result : { ...existing.result, status: "replayed" };
      }
      if (version !== expectedVersion || steps.length === 0) {
        commandsByKey.set(command.idempotencyKey, { payload: command, result: { status: "conflict" } });
        return { status: "conflict" };
      }
      let cursorOrder = order;
      let cursorVersion = version;
      const kdsEvents: null[] = [];
      for (const step of steps) {
        cursorOrder = step.order;
        cursorVersion += 1;
        kdsEvents.push(null);
      }
      order = cursorOrder;
      version = cursorVersion;
      const result: SendOrderToKitchenBatchResult = Object.freeze({
        kdsEvents: Object.freeze(kdsEvents), order, status: "saved" as const, version,
      });
      commandsByKey.set(command.idempotencyKey, { payload: command, result });
      return result;
    },
  };
  return {
    applyExternalMutation: (next) => { order = next; version += 1; },
    currentOrder: () => order,
    currentVersion: () => version,
    port,
  };
}

function sendToKitchenCommand(orderId: string, expectedVersion: number, eventId: string, idempotencyKey: string, orderItemIds: readonly string[]) {
  return { ...audit, eventId, expectedVersion, idempotencyKey, orderId, orderItemIds, schemaVersion: 1 as const, scope };
}

test("sendToKitchen opens a draft order and sends every pending line", async () => {
  const threeLines = [1, 2, 3].reduce((current, index) => addOrderItem(current, {
    orderItemId: `1e37ae13-8507-484c-969f-2176f77b70${String(index).padStart(2, "0")}`,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: `Línea ${index}`,
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(1_000 * index, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, domainMutation.order);
  const fake = fakeSendToKitchenPort(threeLines, 1);
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 1, randomUUID(), "send-to-kitchen-3-lines", threeLines.items.map((item) => item.orderItemId));

  const summary = await service.sendToKitchen(principal, command);
  assert.equal(summary.orderStatus, "open");
  assert.equal(fake.currentOrder().status, "open");
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["sent", "sent", "sent"]);
  assert.equal(fake.currentVersion(), 5); // 1 (open) + 3 (each line), applied atomically in one call
});

test("sendToKitchen on a still-draft order reports conflict, never opens the account, when every listed line was cancelled by another actor first", async () => {
  const withPendingLine = addOrderItem(domainMutation.order, {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: "Hamburguesa",
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order;
  // Between the operator's detail load and this request, another actor (not this command) cancelled
  // the only line the command lists -- the draft must not be opened for an empty, obsolete send.
  const cancelledByAnotherActor = cancelOrderItem(withPendingLine, orderItemId, { ...audit, actorId: randomUUID(), reason: "Cliente canceló el pedido" }).order;
  const fake = fakeSendToKitchenPort(cancelledByAnotherActor, 1);
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 1, randomUUID(), "send-to-kitchen-obsolete-draft", [orderItemId]);

  await assertCode(service.sendToKitchen(principal, command), "conflict");
  assert.equal(fake.currentOrder().status, "draft");
  assert.equal(fake.currentVersion(), 1);
});

test("sendToKitchen reports conflict, without sending anything, when a third actor cancels one of two listed lines after the version was captured", async () => {
  const twoLines = [1, 2].reduce((current, index) => addOrderItem(current, {
    orderItemId: `6f8a3c71-4e52-4b9d-8e13-7a2c9f6d50${String(index).padStart(2, "0")}`,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: `Línea ${index}`,
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(1_000 * index, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, domainMutation.order);
  const opened = transitionOrderStatus(twoLines, "open", { ...audit, actorId: principal.actorId }).order;
  const [firstLineId, secondLineId] = opened.items.map((item) => item.orderItemId) as [string, string];
  // The operator captured `expectedVersion` (2, right after opening) listing both lines as pending.
  // Before the request reaches the server, a third actor cancels the first line, advancing the
  // version to 3. This is a brand-new idempotencyKey, so there is nothing to replay -- the version
  // mismatch alone is a conflict.
  const cancelledByThirdActor = cancelOrderItem(opened, firstLineId, { ...audit, actorId: randomUUID(), reason: "Cliente canceló esa línea" }).order;
  const fake = fakeSendToKitchenPort(cancelledByThirdActor, 3);
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 2, randomUUID(), "send-to-kitchen-third-actor-cancel", [firstLineId, secondLineId]);

  await assertCode(service.sendToKitchen(principal, command), "conflict");
  assert.equal(fake.currentVersion(), 3);
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["cancelled", "pending"]);
});

test("sendToKitchen replays a byte-identical resend at the exact same expectedVersion (e.g. a double click) without duplicating any step", async () => {
  const twoLines = [1, 2].reduce((current, index) => addOrderItem(current, {
    orderItemId: `7e5c9a31-4d68-4b2f-8a93-6c1d8e4f70${String(index).padStart(2, "0")}`,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: `Línea ${index}`,
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(1_000 * index, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, domainMutation.order);
  const fake = fakeSendToKitchenPort(twoLines, 1);
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 1, randomUUID(), "send-to-kitchen-double-click", twoLines.items.map((item) => item.orderItemId));

  const first = await service.sendToKitchen(principal, command);
  assert.equal(first.replayed, false);
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["sent", "sent"]);
  const versionAfterFirst = fake.currentVersion();

  // The second "click" resends the exact same command: the stored command identity recognizes it
  // and replays the stored result verbatim, never re-applying anything.
  const second = await service.sendToKitchen(principal, command);
  assert.equal(second.replayed, true);
  assert.equal(second.version, versionAfterFirst);
  assert.equal(fake.currentVersion(), versionAfterFirst);
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["sent", "sent"]);
});

test("sendToKitchen on an already-open order only transitions its pending lines", async () => {
  const opened = transitionOrderStatus(addOrderItem(domainMutation.order, {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: "Hamburguesa",
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, "open", { ...audit, actorId: principal.actorId }).order;
  const fake = fakeSendToKitchenPort(opened, 2);
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 2, randomUUID(), "send-to-kitchen-already-open", [orderItemId]);

  const summary = await service.sendToKitchen(principal, command);
  assert.equal(summary.orderStatus, "open");
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["sent"]);
  assert.equal(fake.currentVersion(), 3); // only the one pending line, no "open" step
});

test("sendToKitchen rejects an orderItemId that does not belong to the order", async () => {
  const opened = transitionOrderStatus(addOrderItem(domainMutation.order, {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: "Hamburguesa",
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, "open", { ...audit, actorId: principal.actorId }).order;
  const fake = fakeSendToKitchenPort(opened, 2);
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 2, randomUUID(), "send-to-kitchen-foreign-id", [randomUUID()]);

  await assertCode(service.sendToKitchen(principal, command), "not_found");
});

test("sendToKitchen rejects a listed line that is already sent as a conflict, without calling SQL", async () => {
  const opened = transitionOrderStatus(addOrderItem(domainMutation.order, {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: "Hamburguesa",
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, "open", { ...audit, actorId: principal.actorId }).order;
  const alreadySent = transitionOrderItemStatus(opened, orderItemId, "sent", { ...audit, actorId: principal.actorId }).order;
  const fake = fakeSendToKitchenPort(alreadySent, 3);
  let calls = 0;
  const originalSendOrderToKitchen = fake.port.sendOrderToKitchen.bind(fake.port);
  fake.port.sendOrderToKitchen = async (...args) => { calls += 1; return originalSendOrderToKitchen(...args); };
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 3, randomUUID(), "send-to-kitchen-already-sent-line", [orderItemId]);

  await assertCode(service.sendToKitchen(principal, command), "conflict");
  assert.equal(calls, 0);
  assert.equal(fake.currentVersion(), 3);
});

test("sendToKitchen rejects a listed line that was cancelled as a conflict, without calling SQL", async () => {
  const withPendingLine = addOrderItem(domainMutation.order, {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: "Hamburguesa",
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order;
  const cancelled = cancelOrderItem(withPendingLine, orderItemId, { ...audit, actorId: randomUUID(), reason: "Cliente canceló el pedido" }).order;
  const fake = fakeSendToKitchenPort(cancelled, 1);
  let calls = 0;
  const originalSendOrderToKitchen = fake.port.sendOrderToKitchen.bind(fake.port);
  fake.port.sendOrderToKitchen = async (...args) => { calls += 1; return originalSendOrderToKitchen(...args); };
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 1, randomUUID(), "send-to-kitchen-cancelled-line", [orderItemId]);

  await assertCode(service.sendToKitchen(principal, command), "conflict");
  assert.equal(calls, 0);
  assert.equal(fake.currentOrder().status, "draft");
  assert.equal(fake.currentVersion(), 1);
});

test("sendToKitchen rejects a reused idempotencyKey carrying a different orderItemIds list as a conflict, never as a new batch", async () => {
  const twoLines = [1, 2].reduce((current, index) => addOrderItem(current, {
    orderItemId: `5e4d9f32-8c67-4b1a-9ed3-9f4a0b6c21${String(index).padStart(2, "0")}`,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: `Línea ${index}`,
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(1_000 * index, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, domainMutation.order);
  const [firstLineId, secondLineId] = twoLines.items.map((item) => item.orderItemId) as [string, string];
  const fake = fakeSendToKitchenPort(twoLines, 1);
  const service = serviceFor(["manager"], fake.port);
  const sharedIdempotencyKey = "send-to-kitchen-reused-key";
  const sharedEventId = randomUUID();

  const first = sendToKitchenCommand(orderId, 1, sharedEventId, sharedIdempotencyKey, [firstLineId]);
  const firstSummary = await service.sendToKitchen(principal, first);
  assert.equal(firstSummary.replayed, false);
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["sent", "pending"]);

  const second = sendToKitchenCommand(orderId, 1, sharedEventId, sharedIdempotencyKey, [firstLineId, secondLineId]);
  await assertCode(service.sendToKitchen(principal, second), "conflict");
  // The second line was never touched by the key-reuse attempt.
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["sent", "pending"]);
});

test("sendToKitchen recovers correctly from a lost response: the batch committed, so a byte-identical retry replays instead of guessing", async () => {
  const twoLines = [1, 2].reduce((current, index) => addOrderItem(current, {
    orderItemId: `23723e10-c0bf-49fd-9363-4f0e2c60e9${String(index).padStart(2, "0")}`,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: `Línea ${index}`,
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(1_000 * index, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order, domainMutation.order);
  const [firstLineId, secondLineId] = twoLines.items.map((item) => item.orderItemId) as [string, string];
  const fake = fakeSendToKitchenPort(twoLines, 1);
  const service = serviceFor(["manager"], fake.port);
  const command = sendToKitchenCommand(orderId, 1, randomUUID(), "send-to-kitchen-lost-response", [firstLineId, secondLineId]);

  // The batch is applied by the port (as the real SQL transaction would commit it), but the
  // response back to the service never arrives.
  const originalSendOrderToKitchen = fake.port.sendOrderToKitchen.bind(fake.port);
  let calls = 0;
  fake.port.sendOrderToKitchen = async (actorId, expectedVersion, batchCommand, steps) => {
    calls += 1;
    const result = await originalSendOrderToKitchen(actorId, expectedVersion, batchCommand, steps);
    if (calls === 1) throw new Error("simulated dropped connection after commit");
    return result;
  };
  await assert.rejects(service.sendToKitchen(principal, command), (error: unknown) => error instanceof OrderApplicationError && error.code === "unavailable");
  assert.deepEqual(fake.currentOrder().items.map((item) => item.status), ["sent", "sent"]);
  const versionAfterCommit = fake.currentVersion();

  // A byte-identical retry recognizes the already-committed batch by its own idempotencyKey and
  // replays it -- it never re-applies, and never reports a conflict for "no longer pending" lines
  // that this very command already sent.
  const retried = await service.sendToKitchen(principal, command);
  assert.equal(retried.replayed, true);
  assert.equal(retried.version, versionAfterCommit);
  assert.equal(fake.currentVersion(), versionAfterCommit);
});

test("order service detail never offers open and sendToKitchen together for the same draft order", async () => {
  const tableOrder = createOrder({
    branchId: scope.branchId, channel: "table", currency: "MXN", orderId,
    restaurantId: scope.restaurantId, tableId: randomUUID(), timeZone: "America/Mexico_City",
  }, { ...audit, actorId: principal.actorId }).order;
  const emptyPort: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => ({ order: tableOrder, version: 1 }),
    recoverKds: async () => "forbidden",
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const emptyDetail = await serviceFor(["manager"], emptyPort).detail(principal, { orderId, schemaVersion: 1 as const, scope });
  // A table draft with no lines yet only offers "open" ("Abrir cuenta").
  assert.deepEqual(emptyDetail.availableActions, ["addItem", "open", "cancelOrder"]);

  const withPendingLine = addOrderItem(tableOrder, {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: "Hamburguesa",
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, actorId: principal.actorId }).order;
  const pendingPort: OrderPersistencePort = { ...emptyPort, read: async () => ({ order: withPendingLine, version: 2 }) };
  const pendingDetail = await serviceFor(["manager"], pendingPort).detail(principal, { orderId, schemaVersion: 1 as const, scope });
  // Once a line exists, only "sendToKitchen" is offered -- never "open" alongside it.
  assert.deepEqual(pendingDetail.availableActions, ["addItem", "sendToKitchen", "cancelOrder"]);
});

test("order service detail reports the frozen line tax as taxMinor", async () => {
  const draft = createOrder({
    branchId: scope.branchId,
    channel: "delivery",
    currency: "MXN",
    deliveryCharge: { amount: new Money(4_000, "MXN"), quoteId: randomUUID() },
    orderId,
    restaurantId: scope.restaurantId,
    timeZone: "America/Mexico_City",
  }, { ...audit, actorId: principal.actorId }).order;
  const taxed = addOrderItem(draft, {
    orderItemId,
    quantity: 1,
    snapshot: {
      catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", modifiers: [], name: "Hamburguesa",
      productId, stationId: "kitchen", unit: "piece", unitPrice: new Money(10_000, "MXN"),
      tax: { taxId: randomUUID(), name: "IVA", taxRuleVersion: "mx-2026", rate: { numerator: 16n, denominator: 100n }, inclusion: "excluded" },
    },
  }, { ...audit, actorId: principal.actorId }).order;
  const port: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => ({ order: taxed, version: 2 }),
    recoverKds: async () => "forbidden",
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const detail = await serviceFor(["manager"], port).detail(principal, { orderId, schemaVersion: 1 as const, scope });
  assert.equal(detail.totals.taxMinor, 1_600);
  assert.equal(detail.totals.itemsTotalMinor, 11_600);
  assert.equal(detail.items[0]?.stationId, "kitchen");
});

test("order service detail on a cancelled order with a frozen delivery charge never reports it in totals", async () => {
  const withCharge = createOrder({
    branchId: scope.branchId,
    channel: "delivery",
    currency: "MXN",
    deliveryCharge: { amount: new Money(4_000, "MXN"), quoteId: randomUUID() },
    orderId,
    restaurantId: scope.restaurantId,
    timeZone: "America/Mexico_City",
  }, { ...audit, actorId: principal.actorId }).order;
  const cancelled = transitionOrderStatus(withCharge, "cancelled", {
    ...audit, actorId: principal.actorId, reason: "Cliente canceló el pedido",
    authorization: { actorId: principal.actorId, approved: true },
  }).order;
  const port: OrderPersistencePort = {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => ({ order: cancelled, version: 2 }),
    recoverKds: async () => "forbidden",
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
  const detail = await serviceFor(["manager"], port).detail(principal, { orderId, schemaVersion: 1 as const, scope });
  assert.deepEqual(detail.totals, { currency: "MXN", deliveryChargeMinor: 0, itemsTotalMinor: 0, taxMinor: 0, tipMinor: 0, totalMinor: 0 });
  assert.deepEqual(detail.availableActions, []);
});

function serviceFor(
  roles: readonly ("manager" | "supervisor" | "viewer" | "waiter" | "cashier" | "kitchen")[],
  orders: OrderPersistencePort,
  notifications: RealtimeNotificationPort = { notify: async () => undefined },
  state: MenuCatalogStateV1 = menuState,
): OrderService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope }) };
  const catalogs: MenuCatalogPort = { read: async () => state, save: async () => ({ status: "conflict" }) };
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

const sizeSmall = "6a1d2c3e-4f50-4a61-8b72-93a4b5c6d7e8";
const sizeLarge = "7b2e3d4f-5061-4b72-9c83-a4b5c6d7e8f9";
const sizeRetired = "5a1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";

const sizedMenuState: MenuCatalogStateV1 = (() => {
  const catalog = menuState.catalog;
  if (catalog === null) throw new Error("TEST_MENU_INVALID");
  const state = parseMenuCatalogStateV1({
    ...menuState,
    catalog: {
      ...catalog,
      products: [{
        ...catalog.products[0]!,
        variants: [
          { variantId: sizeSmall, name: "Chica", sku: null, unitPriceMinor: 9_000, active: true, displayOrder: 0 },
          { variantId: sizeLarge, name: "Grande", sku: "HAM-G", unitPriceMinor: 15_000, active: true, displayOrder: 1 },
          { variantId: sizeRetired, name: "Gigante", sku: null, unitPriceMinor: 30_000, active: false, displayOrder: 2 },
        ],
      }],
    },
  });
  if (state === undefined) throw new Error("TEST_SIZED_MENU_INVALID");
  return state;
})();

function sizedAddCommand(extra: Record<string, unknown>) {
  const command = parseAddOrderItemCommandV1({
    ...audit,
    eventId: randomUUID(),
    expectedVersion: 1,
    idempotencyKey: randomUUID(),
    modifierGroups: [],
    orderId,
    orderItemId,
    productId,
    quantity: 1,
    schemaVersion: 1,
    scope,
    ...extra,
  });
  if (command === undefined) throw new Error("TEST_SIZED_ADD_INVALID");
  return command;
}

function capturingOrders(saved: { order?: Order }): OrderPersistencePort {
  return {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => ticketList!,
    persist: async (_actorId, expectedVersion, mutation) => {
      saved.order = mutation.order;
      return { kdsEvent: kdsEvent!, order: mutation.order, status: "saved", version: expectedVersion + 1 };
    },
    read: async () => ({ order: saved.order ?? domainMutation.order, version: saved.order === undefined ? 1 : 2 }),
    recoverKds: async () => eventPage!,
    readAssignedToCourier: async () => "missing" as const,
    sendOrderToKitchen: notImplementedSendOrderToKitchen,
  };
}

test("addItem freezes the size price, id, name and the line note; detail exposes variantName and addItem", async () => {
  const saved: { order?: Order } = {};
  const manager = serviceFor(["manager"], capturingOrders(saved), undefined, sizedMenuState);
  await manager.addItem(principal, sizedAddCommand({ note: "sin jitomate", variantId: sizeLarge }));
  const item = saved.order?.items[0];
  assert.equal(item?.snapshot.unitPrice.amountMinor, 15_000);
  assert.equal(item?.snapshot.variantId, sizeLarge);
  assert.equal(item?.snapshot.variantName, "Grande");
  assert.equal(item?.snapshot.sku, "HAM-G");
  assert.equal(item?.note, "sin jitomate");

  const request = { orderId, schemaVersion: 1, scope };
  const detail = await manager.detail(principal, request);
  assert.equal(detail.items[0]?.variantName, "Grande");
  assert.equal(detail.items[0]?.stationId, "kitchen");
  assert.equal(detail.items[0]?.unitPriceMinor, 15_000);
  assert.equal(detail.items[0]?.note, "sin jitomate");
  assert.ok(detail.availableActions.includes("addItem"));
  const viewer = await serviceFor(["viewer"], capturingOrders(saved), undefined, sizedMenuState).detail(principal, request);
  assert.equal(viewer.availableActions.includes("addItem"), false);

  // A plain product keeps no variant keys and a null variantName.
  const plainSaved: { order?: Order } = {};
  const plain = serviceFor(["manager"], capturingOrders(plainSaved));
  await plain.addItem(principal, sizedAddCommand({}));
  assert.equal(plainSaved.order?.items[0]?.snapshot.variantId, undefined);
  assert.equal(plainSaved.order?.items[0]?.note, undefined);
  assert.equal((await plain.detail(principal, request)).items[0]?.variantName, null);
});

test("addItem answers 409 for a missing, unknown, inactive or unexpected variant and never persists", async () => {
  let persisted = 0;
  const base = capturingOrders({});
  const counting: OrderPersistencePort = { ...base, persist: async (...args) => { persisted += 1; return base.persist(...args); } };
  const sized = serviceFor(["manager"], counting, undefined, sizedMenuState);
  await assertCode(sized.addItem(principal, sizedAddCommand({})), "conflict");
  await assertCode(sized.addItem(principal, sizedAddCommand({ variantId: randomUUID() })), "conflict");
  await assertCode(sized.addItem(principal, sizedAddCommand({ variantId: sizeRetired })), "conflict");
  await assertCode(serviceFor(["manager"], counting).addItem(principal, sizedAddCommand({ variantId: sizeSmall })), "conflict");
  assert.equal(persisted, 0);
});

test("PostgreSQL order adapter persists and decodes a sized line through the real { result } row", async () => {
  const saved: { order?: Order } = {};
  await serviceFor(["manager"], capturingOrders(saved), undefined, sizedMenuState)
    .addItem(principal, sizedAddCommand({ variantId: sizeSmall }));
  const mutation = { ...domainMutation, order: saved.order! };
  let sent: unknown;
  const database: DatabaseClientPort = {
    query: async (_sql, parameters) => {
      sent = JSON.parse(String(parameters[2]));
      return { rows: [{ result: { ...persistResult("saved", null), order: sent } }] };
    },
  };
  const persisted = await new PostgresOrderPersistenceAdapter(database).persist(principal.actorId, 0, mutation);
  assert.equal(persisted.status, "saved");
  const snapshot = (sent as { items: { snapshot: Record<string, unknown> }[] }).items[0]!.snapshot;
  assert.equal(snapshot.variantId, sizeSmall);
  assert.equal(snapshot.variantName, "Chica");
  assert.equal((snapshot.unitPrice as { amountMinor: number }).amountMinor, 9_000);
  if (persisted.status !== "saved") throw new Error("TEST_PERSIST_NOT_SAVED");
  assert.equal(persisted.order.items[0]?.snapshot.variantName, "Chica");
  assert.equal(persisted.order.items[0]?.snapshot.unitPrice.amountMinor, 9_000);
});

const flavorGroupId = "8c3f4e50-6172-4c83-8d94-b5c6d7e8f900";
const extraGroupId = "8c3f4e50-6172-4c83-8d94-b5c6d7e8f901";
const flavorPepperoni = "9d405f61-7283-4d94-9ea5-c6d7e8f90a10";
const flavorHawaiana = "9d405f61-7283-4d94-9ea5-c6d7e8f90a11";
const flavorSoldOut = "9d405f61-7283-4d94-9ea5-c6d7e8f90a12";
const extraCheese = "9d405f61-7283-4d94-9ea5-c6d7e8f90a13";

const halvesMenuState: MenuCatalogStateV1 = (() => {
  const catalog = sizedMenuState.catalog;
  if (catalog === null) throw new Error("TEST_MENU_INVALID");
  const state = parseMenuCatalogStateV1({
    ...sizedMenuState,
    catalog: {
      ...catalog,
      modifierGroups: [
        ...catalog.modifierGroups,
        {
          active: true, displayOrder: 50, groupId: flavorGroupId, maximumQuantity: 2, minimumQuantity: 0, name: "Sabor", productId,
          options: [
            { active: true, imagePath: null, maximumQuantity: null, name: "Pepperoni", optionId: flavorPepperoni, unitPriceMinor: 0 },
            { active: true, imagePath: null, maximumQuantity: null, name: "Hawaiana", optionId: flavorHawaiana, unitPriceMinor: 17_000 },
            { active: false, imagePath: null, maximumQuantity: null, name: "Agotada", optionId: flavorSoldOut, unitPriceMinor: 19_000 },
          ],
        },
        {
          active: true, displayOrder: 51, groupId: extraGroupId, maximumQuantity: 5, minimumQuantity: 0, name: "Extras", productId,
          options: [{ active: true, imagePath: null, maximumQuantity: null, name: "Queso extra", optionId: extraCheese, unitPriceMinor: 2_501 }],
        },
      ],
      products: [{
        ...catalog.products[0]!,
        variants: catalog.products[0]!.variants!.map((variant) => variant.variantId === sizeLarge
          ? { ...variant, fraction: { enabled: true, excludableIngredientIds: ["cebolla"], extraGroupId, flavorGroupId } }
          : variant),
      }],
    },
  });
  if (state === undefined) throw new Error("TEST_HALVES_MENU_INVALID");
  return state;
})();

function halvesFraction(overrides: { readonly flavorB?: string; readonly extrasA?: string[]; readonly excludedA?: string[] } = {}) {
  return {
    geometry: "halves",
    slots: [
      { excludedIngredientIds: overrides.excludedA ?? [], extraOptionIds: overrides.extrasA ?? [], flavorOptionId: flavorPepperoni, fraction: "half-a" },
      { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: overrides.flavorB ?? flavorHawaiana, fraction: "half-b" },
    ],
  };
}

test("addItem prices a halves line at the greater flavor plus half-priced extras and detail exposes the breakdown", async () => {
  const saved: { order?: Order } = {};
  const manager = serviceFor(["manager"], capturingOrders(saved), undefined, halvesMenuState);
  await manager.addItem(principal, sizedAddCommand({
    fraction: halvesFraction({ excludedA: ["cebolla"], extrasA: [extraCheese] }), variantId: sizeLarge,
  }));
  const snapshot = saved.order?.items[0]?.snapshot;
  assert.equal(snapshot?.unitPrice.amountMinor, 17_000);
  assert.equal(snapshot?.geometry, "halves");
  assert.deepEqual(snapshot?.fractionBreakdown?.map((entry) => [entry.fraction, entry.flavorName, entry.amountMinor]), [
    ["half-a", "Pepperoni", 15_000],
    ["half-b", "Hawaiana", 17_000],
  ]);
  assert.equal(snapshot?.modifiers.find((modifier) => modifier.modifierId === `extra:half-a:${extraCheese}`)?.unitPrice.amountMinor, 1_251);

  const detail = await manager.detail(principal, { orderId, schemaVersion: 1, scope });
  const item = detail.items[0];
  assert.equal(item?.geometry, "halves");
  assert.deepEqual(item?.fractionBreakdown?.map((half) => [half.fraction, half.flavorName, half.extras, half.exclusions]), [
    ["half-a", "Pepperoni", ["Queso extra"], ["cebolla"]],
    ["half-b", "Hawaiana", [], []],
  ]);
  assert.deepEqual(item?.fractionBreakdown?.map((half) => [half.fraction, half.flavorOptionId, half.extraOptionIds, half.excludedIngredientIds]), [
    ["half-a", flavorPepperoni, [extraCheese], ["cebolla"]],
    ["half-b", flavorHawaiana, [], []],
  ]);
  const wholeSaved: { order?: Order } = {};
  const wholeService = serviceFor(["manager"], capturingOrders(wholeSaved), undefined, halvesMenuState);
  await wholeService.addItem(principal, sizedAddCommand({ variantId: sizeLarge, fraction: null }));
  const whole = await wholeService.detail(principal, { orderId, schemaVersion: 1, scope });
  assert.equal(whole.items[0]?.geometry, null);
  assert.deepEqual(whole.items[0]?.fractionBreakdown, []);
});

test("addItem answers 409 for an inactive or foreign flavor, an unknown exclusion, or halves on a size without them", async () => {
  let persisted = 0;
  const base = capturingOrders({});
  const counting: OrderPersistencePort = { ...base, persist: async (...args) => { persisted += 1; return base.persist(...args); } };
  const service = serviceFor(["manager"], counting, undefined, halvesMenuState);
  await assertCode(service.addItem(principal, sizedAddCommand({ fraction: halvesFraction({ flavorB: flavorSoldOut }), variantId: sizeLarge })), "conflict");
  await assertCode(service.addItem(principal, sizedAddCommand({ fraction: halvesFraction({ flavorB: extraCheese }), variantId: sizeLarge })), "conflict");
  await assertCode(service.addItem(principal, sizedAddCommand({ fraction: halvesFraction({ excludedA: ["jamon"] }), variantId: sizeLarge })), "conflict");
  await assertCode(service.addItem(principal, sizedAddCommand({ fraction: halvesFraction(), variantId: sizeSmall })), "conflict");
  // The transport parser normalizes slot order (half-a first), so the strict domain check never sees half-b first from HTTP.
  const reversedSlots = halvesFraction().slots.reverse();
  const normalized = sizedAddCommand({ fraction: { geometry: "halves", slots: reversedSlots }, variantId: sizeLarge });
  assert.deepEqual(normalized.fraction?.slots.map((slot) => slot.fraction), ["half-a", "half-b"]);
  assert.equal(persisted, 0);
});

test("PostgreSQL order adapter persists and decodes a halves line through the real { result } row", async () => {
  const saved: { order?: Order } = {};
  await serviceFor(["manager"], capturingOrders(saved), undefined, halvesMenuState)
    .addItem(principal, sizedAddCommand({ fraction: halvesFraction({ extrasA: [extraCheese] }), variantId: sizeLarge }));
  const mutation = { ...domainMutation, order: saved.order! };
  let sent: unknown;
  const database: DatabaseClientPort = {
    query: async (_sql, parameters) => {
      sent = JSON.parse(String(parameters[2]));
      return { rows: [{ result: { ...persistResult("saved", null), order: sent } }] };
    },
  };
  const persisted = await new PostgresOrderPersistenceAdapter(database).persist(principal.actorId, 0, mutation);
  assert.equal(persisted.status, "saved");
  const snapshot = (sent as { items: { snapshot: Record<string, unknown> }[] }).items[0]!.snapshot;
  assert.equal(snapshot.geometry, "halves");
  assert.deepEqual(snapshot.fractionBreakdown, [
    { amountMinor: 15_000, flavorName: "Pepperoni", flavorOptionId: flavorPepperoni, fraction: "half-a" },
    { amountMinor: 17_000, flavorName: "Hawaiana", flavorOptionId: flavorHawaiana, fraction: "half-b" },
  ]);
  if (persisted.status !== "saved") throw new Error("TEST_PERSIST_NOT_SAVED");
  const decoded = persisted.order.items[0]?.snapshot;
  assert.equal(decoded?.unitPrice.amountMinor, 17_000);
  assert.equal(decoded?.fractionBreakdown?.[1]?.flavorName, "Hawaiana");
});

test("addItem replay of the same halves command freezes an identical snapshot (idempotent pricing)", async () => {
  const command = sizedAddCommand({ fraction: halvesFraction({ extrasA: [extraCheese] }), variantId: sizeLarge });
  const first: { order?: Order } = {};
  const second: { order?: Order } = {};
  await serviceFor(["manager"], capturingOrders(first), undefined, halvesMenuState).addItem(principal, command);
  await serviceFor(["manager"], capturingOrders(second), undefined, halvesMenuState).addItem(principal, command);
  assert.deepEqual(first.order?.items[0]?.snapshot, second.order?.items[0]?.snapshot);
  assert.equal(first.order?.items[0]?.snapshot.fractionBreakdown?.length, 2);
});
