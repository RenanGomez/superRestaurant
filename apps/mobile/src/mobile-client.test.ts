import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope, type BranchScope } from "@super-restaurant/shared-types";

import * as client from "./mobile-client.js";
import {
  MOBILE_API_PATHS,
  MobileRequestError,
  addOrderItem,
  createOrder,
  getDiningLayout,
  getMenuCatalog,
  isAuthorizedMobilePath,
  listActiveTableOrders,
  listMemberships,
  listOperationalShifts,
  openOrder,
  selectBranchContext,
} from "./mobile-client.js";
import {
  FIXTURE_CURRENCY,
  FIXTURE_SHIFT,
  FIXTURE_TABLE,
  FIXTURE_TIME_ZONE,
  activeTableOrderListBody,
  branchOperationalContextBody,
  diningLayoutBody,
  failingFetcher,
  fixtureConfig,
  jsonFetcher,
  membershipListBody,
  menuCatalogStateBody,
  operationalShiftListBody,
  orderMutationSummaryBody,
  scopeA,
  scopeB,
  valueFetcher,
} from "./test-fixtures.js";

test("exposes exactly the operational reads and the three Order mutations", () => {
  assert.deepEqual(Object.keys(client).sort(), [
    "MOBILE_API_PATHS",
    "MobileRequestError",
    "addOrderItem",
    "createOrder",
    "getDiningLayout",
    "getMenuCatalog",
    "isAuthorizedMobilePath",
    "listActiveTableOrders",
    "listMemberships",
    "listOperationalShifts",
    "openOrder",
    "selectBranchContext",
  ]);
  assert.deepEqual(Object.values(MOBILE_API_PATHS).sort(), [
    "/api/v1/access/branch/context",
    "/api/v1/access/memberships",
    "/api/v1/catalog/menu",
    "/api/v1/dining/layout",
    "/api/v1/orders",
    "/api/v1/orders/active",
    "/api/v1/orders/items",
    "/api/v1/orders/open",
    "/api/v1/shifts/active",
  ]);
  // The write surface is exactly three paths. Nothing that settles, refunds,
  // moves cash or transitions a line is reachable from this app.
  for (const endpoint of Object.values(MOBILE_API_PATHS)) {
    for (const forbidden of ["payments", "cash", "refund", "transition", "cancel", "cfdi"]) {
      assert.equal(endpoint.includes(forbidden), false, endpoint);
    }
  }
});

test("refuses any path outside the authorized allowlist", () => {
  for (const path of Object.values(MOBILE_API_PATHS)) assert.equal(isAuthorizedMobilePath(path), true, path);
  assert.equal(isAuthorizedMobilePath(`${MOBILE_API_PATHS.diningLayout}?restaurantId=x`), true);
  for (const path of [
    "/api/v1/orders/items/cancel",
    "/api/v1/orders/items/transition",
    "/api/v1/payments",
    "/api/v1/cash-registers",
    "/api/v1/kds/tickets",
    "/api/v1/dining/tables",
    "/api/v1/access/memberships/../../orders",
    "",
  ]) assert.equal(isAuthorizedMobilePath(path), false, path);
});

test("lists memberships with a bearer token and no body", async () => {
  const { calls, fetcher } = jsonFetcher(membershipListBody([scopeA, scopeB]));
  const list = await listMemberships(fixtureConfig, "token-1", fetcher);

  assert.equal(list.memberships.length, 2);
  assert.equal(list.memberships[0]?.scope.restaurantId, scopeA.restaurantId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${fixtureConfig.apiBaseUrl}/api/v1/access/memberships`);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.body, undefined);
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.deepEqual(calls[0]?.init?.headers, { authorization: "Bearer token-1" });
});

test("reads the layout of the requested branch only", async () => {
  const { calls, fetcher } = jsonFetcher(diningLayoutBody(scopeA));
  const layout = await getDiningLayout(fixtureConfig, "token-1", scopeA, fetcher);

  assert.equal(layout.zones.length, 1);
  assert.equal(layout.zones[0]?.tables[0]?.name, "Mesa 1");
  assert.equal(
    calls[0]?.url,
    `${fixtureConfig.apiBaseUrl}/api/v1/dining/layout?branchId=${scopeA.branchId}&restaurantId=${scopeA.restaurantId}`,
  );

  const crossed = jsonFetcher(diningLayoutBody(scopeB));
  await assert.rejects(
    () => getDiningLayout(fixtureConfig, "token-1", scopeA, crossed.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("lists only open operational shifts for the exact authorized branch", async () => {
  const { calls, fetcher } = jsonFetcher(operationalShiftListBody(scopeA));
  const list = await listOperationalShifts(fixtureConfig, "token-1", scopeA, fetcher);
  assert.equal(list.shifts.length, 1);
  assert.equal(list.shifts[0]?.status, "open");
  assert.equal(
    calls[0]?.url,
    `${fixtureConfig.apiBaseUrl}/api/v1/shifts/active?branchId=${scopeA.branchId}&restaurantId=${scopeA.restaurantId}`,
  );

  await assert.rejects(
    () => listOperationalShifts(fixtureConfig, "token-1", scopeA, jsonFetcher(operationalShiftListBody(scopeB)).fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("reads the published catalog with the currency and minor units it carries", async () => {
  const { calls, fetcher } = jsonFetcher(menuCatalogStateBody(scopeA));
  const state = await getMenuCatalog(fixtureConfig, "token-1", scopeA, fetcher);

  assert.equal(state.catalog?.currency, FIXTURE_CURRENCY);
  assert.equal(state.catalog?.products[0]?.unitPriceMinor, 12_500);
  assert.equal(Number.isSafeInteger(state.catalog?.products[0]?.unitPriceMinor), true);
  assert.equal(
    calls[0]?.url,
    `${fixtureConfig.apiBaseUrl}/api/v1/catalog/menu?branchId=${scopeA.branchId}&restaurantId=${scopeA.restaurantId}`,
  );

  const empty = jsonFetcher({ catalog: null, schemaVersion: 1, scope: { ...scopeA } });
  const emptyState = await getMenuCatalog(fixtureConfig, "token-1", scopeA, empty.fetcher);
  assert.equal(emptyState.catalog, null);

  const crossed = jsonFetcher(menuCatalogStateBody(scopeB));
  await assert.rejects(
    () => getMenuCatalog(fixtureConfig, "token-1", scopeA, crossed.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("fails closed on a body that does not match the shared contract", async () => {
  for (const body of [
    { memberships: [], schemaVersion: 2 },
    { memberships: [{ branchName: "b", restaurantName: "r", roles: ["waiter"], scope: { branchId: "x", restaurantId: "y" } }], schemaVersion: 1 },
    { memberships: [], schemaVersion: 1, extra: true },
    [],
    null,
  ]) {
    const { fetcher } = jsonFetcher(body);
    await assert.rejects(
      () => listMemberships(fixtureConfig, "token-1", fetcher),
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
      JSON.stringify(body),
    );
  }
});

test("separates a network failure from a protocol failure", async () => {
  await assert.rejects(
    () => listMemberships(fixtureConfig, "token-1", failingFetcher()),
    (error: unknown) => error instanceof MobileRequestError && error.status === "network",
  );

  const notJson = ((): Promise<Response> => Promise.resolve(new Response("<html></html>", { status: 200 }))) as typeof fetch;
  await assert.rejects(
    () => listMemberships(fixtureConfig, "token-1", notJson),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("never sends a malformed pair or an empty token to the network", async () => {
  const { calls, fetcher } = jsonFetcher(diningLayoutBody(scopeA));
  for (const scope of [
    { branchId: "not-a-uuid", restaurantId: scopeA.restaurantId },
    { branchId: scopeA.branchId, restaurantId: "" },
  ]) {
    await assert.rejects(
      () => getDiningLayout(fixtureConfig, "token-1", scope, fetcher),
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
    );
  }
  await assert.rejects(
    () => listMemberships(fixtureConfig, "", fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === 401,
  );
  assert.equal(calls.length, 0);
});

const DEVICE_ID = "d0000000-0000-4000-8000-000000000001";
const ORDER_ID = "c0000000-0000-4000-8000-000000000001";
const ORDER_ITEM_ID = "c0000000-0000-4000-8000-000000000002";
const EVENT_ID = "c0000000-0000-4000-8000-000000000003";
const IDEMPOTENCY_KEY = "c0000000-0000-4000-8000-000000000004";
const OCCURRED_AT = "2026-09-06T18:00:00.000Z";

/** A real branded `BranchScope`, produced by the shared parser and nothing else. */
function branchScope(scope = scopeA): BranchScope {
  const parsed = parseBranchScope({ branchId: scope.branchId, restaurantId: scope.restaurantId });
  assert.ok(parsed !== undefined);
  return parsed;
}

test("selects the operational context of the exact pair and requires the same pair back", async () => {
  const { calls, fetcher } = jsonFetcher(branchOperationalContextBody(scopeA));
  const context = await selectBranchContext(fixtureConfig, "token-1", scopeA, fetcher);

  assert.deepEqual(context, {
    roles: ["waiter"],
    schemaVersion: 1,
    scope: branchScope(),
    timeZone: FIXTURE_TIME_ZONE,
  });
  assert.equal(calls[0]?.url, `${fixtureConfig.apiBaseUrl}/api/v1/access/branch/context`);
  assert.equal(calls[0]?.init?.method, "POST");
  // The exact body: the pair, and nothing else. Key order is not part of the
  // contract, so the parsed body is what is compared.
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    branchId: scopeA.branchId,
    restaurantId: scopeA.restaurantId,
  });
  assert.deepEqual(calls[0]?.init?.headers, {
    authorization: "Bearer token-1",
    "content-type": "application/json",
  });

  const crossed = jsonFetcher(branchOperationalContextBody(scopeB));
  await assert.rejects(
    () => selectBranchContext(fixtureConfig, "token-1", scopeA, crossed.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("the branch time zone is never invented: an unusable one is a protocol failure", async () => {
  // Validated by the shared parser, which is the only contract this app knows.
  for (const timeZone of ["", "  America/Hermosillo", "Marte/Olimpo", 7]) {
    const body = { ...(branchOperationalContextBody(scopeA) as object), timeZone };
    await assert.rejects(
      () => selectBranchContext(fixtureConfig, "token-1", scopeA, valueFetcher(body)),
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
      JSON.stringify(timeZone),
    );
  }
});

test("a revoked pair keeps its authorization status through the context endpoint", async () => {
  const { fetcher } = jsonFetcher({ code: "SCOPE_AUTHORIZATION_REJECTED" }, 403);
  await assert.rejects(
    () => selectBranchContext(fixtureConfig, "token-1", scopeA, fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === 403,
  );
});

test("creating an order sends the exact v2 command and requires its own answer back", async () => {
  const { calls, fetcher } = jsonFetcher(orderMutationSummaryBody({ orderId: ORDER_ID, scope: scopeA, version: 1 }));
  const command = {
    channel: "table",
    currency: FIXTURE_CURRENCY,
    deviceId: DEVICE_ID,
    eventId: EVENT_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    occurredAt: OCCURRED_AT,
    orderId: ORDER_ID,
    schemaVersion: 2,
    scope: branchScope(),
    shiftId: FIXTURE_SHIFT,
    tableId: FIXTURE_TABLE,
    timeZone: FIXTURE_TIME_ZONE,
  } as const;

  const summary = await createOrder(fixtureConfig, "token-1", command, fetcher);
  assert.equal(summary.orderId, ORDER_ID);
  assert.equal(summary.version, 1);
  assert.equal(summary.replayed, false);
  assert.equal(calls[0]?.url, `${fixtureConfig.apiBaseUrl}/api/v1/orders`);
  assert.equal(calls[0]?.init?.method, "POST");
  // The body is the normalized command the shared parser accepted: exactly
  // these keys and these values, with nothing added by this client.
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { ...command });

  const other = jsonFetcher(orderMutationSummaryBody({ orderId: ORDER_ITEM_ID, scope: scopeA, version: 1 }));
  await assert.rejects(
    () => createOrder(fixtureConfig, "token-1", command, other.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
    "an answer about another order",
  );

  const crossed = jsonFetcher(orderMutationSummaryBody({ orderId: ORDER_ID, scope: scopeB, version: 1 }));
  await assert.rejects(
    () => createOrder(fixtureConfig, "token-1", command, crossed.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
    "an answer about another branch",
  );
});

test("a command this client got wrong never becomes a request", async () => {
  const { calls, fetcher } = jsonFetcher(orderMutationSummaryBody({ orderId: ORDER_ID, scope: scopeA, version: 1 }));
  // `table` without a `tableId` is exactly what the shared parser refuses.
  await assert.rejects(
    () => createOrder(fixtureConfig, "token-1", {
      channel: "table",
      currency: FIXTURE_CURRENCY,
      deviceId: DEVICE_ID,
      eventId: EVENT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      occurredAt: OCCURRED_AT,
      orderId: ORDER_ID,
      schemaVersion: 2,
      scope: branchScope(),
      shiftId: FIXTURE_SHIFT,
      tableId: null,
      timeZone: FIXTURE_TIME_ZONE,
    } as never, fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
  assert.equal(calls.length, 0, "an invalid command reached the network");
});

test("adding a line and opening an order chain their expected version", async () => {
  const added = jsonFetcher(orderMutationSummaryBody({ orderId: ORDER_ID, scope: scopeA, version: 2 }));
  const item = await addOrderItem(fixtureConfig, "token-1", {
    deviceId: DEVICE_ID,
    eventId: EVENT_ID,
    expectedVersion: 1,
    idempotencyKey: IDEMPOTENCY_KEY,
    modifierGroups: [],
    occurredAt: OCCURRED_AT,
    orderId: ORDER_ID,
    orderItemId: ORDER_ITEM_ID,
    productId: FIXTURE_TABLE,
    quantity: 2,
    schemaVersion: 1,
    scope: branchScope(),
  }, added.fetcher);
  assert.equal(item.version, 2);
  assert.equal(added.calls[0]?.url, `${fixtureConfig.apiBaseUrl}/api/v1/orders/items`);
  assert.equal(added.calls[0]?.init?.method, "POST");

  const opened = jsonFetcher(orderMutationSummaryBody({
    orderId: ORDER_ID,
    orderStatus: "open",
    scope: scopeA,
    version: 3,
  }));
  const summary = await openOrder(fixtureConfig, "token-1", {
    deviceId: DEVICE_ID,
    eventId: EVENT_ID,
    expectedVersion: 2,
    idempotencyKey: IDEMPOTENCY_KEY,
    occurredAt: OCCURRED_AT,
    orderId: ORDER_ID,
    schemaVersion: 1,
    scope: branchScope(),
  }, opened.fetcher);
  assert.equal(summary.orderStatus, "open");
  assert.equal(summary.version, 3);
  assert.equal(opened.calls[0]?.url, `${fixtureConfig.apiBaseUrl}/api/v1/orders/open`);
});

test("a version conflict keeps its own status, distinct from unavailable", async () => {
  const { fetcher } = jsonFetcher({ code: "ORDER_CONFLICT" }, 409);
  await assert.rejects(
    () => openOrder(fixtureConfig, "token-1", {
      deviceId: DEVICE_ID,
      eventId: EVENT_ID,
      expectedVersion: 2,
      idempotencyKey: IDEMPOTENCY_KEY,
      occurredAt: OCCURRED_AT,
      orderId: ORDER_ID,
      schemaVersion: 1,
      scope: branchScope(),
    }, fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === 409,
  );
});

test("the active list is read for one table and must answer about that table", async () => {
  const body = activeTableOrderListBody({ orders: [{}, { shiftId: null, status: "partially_paid" }], scope: scopeA });
  const { calls, fetcher } = jsonFetcher(body);
  const list = await listActiveTableOrders(fixtureConfig, "token-1", scopeA, FIXTURE_TABLE, fetcher);

  assert.equal(list.orders.length, 2, "a table may carry more than one active order");
  assert.equal(list.orders[1]?.shiftId, null, "a historic order without a shift is valid");
  assert.equal(list.orders[0]?.items[0]?.unitPrice.amountMinor, 12_500);
  assert.equal(
    calls[0]?.url,
    `${fixtureConfig.apiBaseUrl}/api/v1/orders/active?branchId=${scopeA.branchId}`
      + `&restaurantId=${scopeA.restaurantId}&tableId=${FIXTURE_TABLE}`,
  );
  assert.equal(calls[0]?.init?.method, "GET");
  assert.deepEqual(calls[0]?.init?.headers, { authorization: "Bearer token-1" });

  const otherTable = jsonFetcher(activeTableOrderListBody({
    scope: scopeA,
    tableId: "66666666-6666-4666-8666-666666666667",
  }));
  await assert.rejects(
    () => listActiveTableOrders(fixtureConfig, "token-1", scopeA, FIXTURE_TABLE, otherTable.fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("an empty active list is an answer, not a failure", async () => {
  const { fetcher } = jsonFetcher(activeTableOrderListBody({ orders: [], scope: scopeA }));
  const list = await listActiveTableOrders(fixtureConfig, "token-1", scopeA, FIXTURE_TABLE, fetcher);
  assert.deepEqual(list.orders, []);
});

test("a table id that is not a UUID never reaches the network", async () => {
  const { calls, fetcher } = jsonFetcher(activeTableOrderListBody({ scope: scopeA }));
  await assert.rejects(
    () => listActiveTableOrders(fixtureConfig, "token-1", scopeA, "mesa-1", fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
  assert.equal(calls.length, 0);
});
