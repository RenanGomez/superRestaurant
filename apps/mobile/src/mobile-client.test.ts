import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope, parseActiveTableOrderListV2, type BranchDaySummaryV1, type BranchScope } from "@super-restaurant/shared-types";

import * as client from "./mobile-client.js";
import { kitchenAttempt, kitchenCommand } from "./order-kitchen.js";
import { branchDate, openRegisters } from "./register-selection.js";
import {
  MOBILE_API_PATHS,
  MobileRequestError,
  addOrderItem,
  collectPayment,
  createOrder,
  getCashRegisterReport,
  getCheckoutOrder,
  getDiningLayout,
  getMenuCatalog,
  getTableBoard,
  isAuthorizedMobilePath,
  listActiveTableOrders,
  listMemberships,
  listOperationalShifts,
  openOrder,
  quoteCashPayment,
  selectBranchContext,
} from "./mobile-client.js";
import {
  FIXTURE_CURRENCY,
  FIXTURE_ORDER,
  FIXTURE_PAYMENT,
  FIXTURE_REGISTER,
  FIXTURE_REGISTER_SESSION,
  FIXTURE_SHIFT,
  FIXTURE_TABLE,
  FIXTURE_TIME_ZONE,
  activeTableOrderItemBody,
  activeTableOrderListBody,
  branchOperationalContextBody,
  cashPaymentQuoteBody,
  cashRegisterReportBody,
  checkoutOrderSummaryBody,
  diningLayoutBody,
  failingFetcher,
  fixtureConfig,
  jsonFetcher,
  membershipListBody,
  menuCatalogStateBody,
  operationalShiftListBody,
  orderMutationSummaryBody,
  paymentCollectionSummaryBody,
  scopeA,
  scopeA2,
  scopeB,
  valueFetcher,
} from "./test-fixtures.js";

test("exposes exactly the operational reads, Order mutations and payment endpoints", () => {
  assert.deepEqual(Object.keys(client).sort(), [
    "MOBILE_API_PATHS",
    "MobileRequestError",
    "addOrderItem",
    "collectPayment",
    "createOrder",
    "getCashRegisterReport",
    "getCheckoutOrder",
    "getDaySummary",
    "getDiningLayout",
    "getMenuCatalog",
    "getTableBoard",
    "isAuthorizedMobilePath",
    "listActiveTableOrders",
    "listMemberships",
    "listOperationalShifts",
    "openOrder",
    "quoteCashPayment",
    "selectBranchContext",
    "sendToKitchen",
  ]);
  assert.deepEqual(Object.values(MOBILE_API_PATHS).sort(), [
    "/api/v1/access/branch/context",
    "/api/v1/access/memberships",
    "/api/v1/cash-registers/report",
    "/api/v1/catalog/menu",
    "/api/v1/dining/layout",
    "/api/v1/orders",
    "/api/v1/orders/active",
    "/api/v1/orders/items",
    "/api/v1/orders/open",
    "/api/v1/orders/send-to-kitchen",
    "/api/v1/payments/checkout",
    "/api/v1/payments/collect",
    "/api/v1/payments/quote",
    "/api/v1/reports/day-summary",
    "/api/v1/shifts/active",
    "/api/v1/tables/board",
  ]);
  for (const endpoint of Object.values(MOBILE_API_PATHS)) {
    for (const forbidden of ["refund", "transition", "cancel", "cfdi"]) {
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

test("reads cash register report, checkout summary, quotes and collects payment via shared contracts", async () => {
  const reportMock = jsonFetcher(cashRegisterReportBody(scopeA, FIXTURE_REGISTER));
  const report = await getCashRegisterReport(
    fixtureConfig,
    "token-1",
    { cashRegisterSessionId: null, deviceId: DEVICE_ID, registerId: FIXTURE_REGISTER, scope: scopeA },
    reportMock.fetcher,
  );
  assert.equal(report.register.cashRegisterSessionId, FIXTURE_REGISTER_SESSION);

  const checkoutMock = jsonFetcher(checkoutOrderSummaryBody(scopeA));
  const checkout = await getCheckoutOrder(
    fixtureConfig,
    "token-1",
    { cashRegisterSessionId: FIXTURE_REGISTER_SESSION, deviceId: DEVICE_ID, orderId: FIXTURE_ORDER, registerId: FIXTURE_REGISTER, scope: scopeA },
    checkoutMock.fetcher,
  );
  assert.equal(checkout.remainingBalanceMinor, 12_500);

  const quoteMock = jsonFetcher(cashPaymentQuoteBody(scopeA));
  const quote = await quoteCashPayment(fixtureConfig, "token-1", {
    amountMinor: 12_500,
    cashRegisterSessionId: FIXTURE_REGISTER_SESSION,
    method: "cash",
    orderId: FIXTURE_ORDER,
    schemaVersion: 1,
    scope: branchScope(),
    tenderedAmountMinor: 20_000,
    tipMinor: 0,
  }, quoteMock.fetcher);
  assert.equal(quote.changeMinor, 7_500);

  const collectMock = jsonFetcher(paymentCollectionSummaryBody(scopeA));
  const receipt = await collectPayment(fixtureConfig, "token-1", {
    amountMinor: 12_500,
    cardManualEvidence: null,
    cashRegisterExpectedVersion: 1,
    cashRegisterSessionId: FIXTURE_REGISTER_SESSION,
    deviceId: DEVICE_ID,
    eventId: EVENT_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    localSequence: 1,
    method: "cash",
    occurredAt: OCCURRED_AT,
    orderExpectedVersion: 3,
    orderId: FIXTURE_ORDER,
    paymentId: FIXTURE_PAYMENT,
    schemaVersion: 1,
    scope: branchScope(),
    tenderedAmountMinor: 20_000,
    tipMinor: 0,
  }, collectMock.fetcher);
  assert.equal(receipt.orderStatus, "paid");

  await assert.rejects(
    () => getCheckoutOrder(
      fixtureConfig,
      "token-1",
      { cashRegisterSessionId: FIXTURE_REGISTER_SESSION, deviceId: DEVICE_ID, orderId: FIXTURE_ORDER, registerId: FIXTURE_REGISTER, scope: scopeA },
      jsonFetcher(checkoutOrderSummaryBody(scopeB)).fetcher,
    ),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
  );
});

test("refuses a same-restaurant other-branch answer for every scoped read", async () => {
  // The finest §15.1 boundary: the same tenant, another branch. `scopeA` and
  // `scopeA2` share every id but `branchId`, so only the branch check can catch
  // it — a client that compared the restaurant alone would accept every case.
  const cases: readonly (readonly [string, () => Promise<unknown>])[] = [
    ["layout", () => getDiningLayout(fixtureConfig, "token-1", scopeA, jsonFetcher(diningLayoutBody(scopeA2)).fetcher)],
    ["catalog", () => getMenuCatalog(fixtureConfig, "token-1", scopeA, jsonFetcher(menuCatalogStateBody(scopeA2)).fetcher)],
    ["shifts", () => listOperationalShifts(fixtureConfig, "token-1", scopeA, jsonFetcher(operationalShiftListBody(scopeA2)).fetcher)],
    ["context", () => selectBranchContext(fixtureConfig, "token-1", scopeA, jsonFetcher(branchOperationalContextBody(scopeA2)).fetcher)],
    ["active orders", () => listActiveTableOrders(
      fixtureConfig, "token-1", scopeA, FIXTURE_TABLE,
      jsonFetcher(activeTableOrderListBody({ scope: scopeA2, tableId: FIXTURE_TABLE })).fetcher,
    )],
    ["checkout", () => getCheckoutOrder(
      fixtureConfig, "token-1",
      { cashRegisterSessionId: FIXTURE_REGISTER_SESSION, deviceId: DEVICE_ID, orderId: FIXTURE_ORDER, registerId: FIXTURE_REGISTER, scope: scopeA },
      jsonFetcher(checkoutOrderSummaryBody(scopeA2)).fetcher,
    )],
    ["cash report", () => getCashRegisterReport(
      fixtureConfig, "token-1",
      { cashRegisterSessionId: null, deviceId: DEVICE_ID, registerId: FIXTURE_REGISTER, scope: scopeA },
      jsonFetcher(cashRegisterReportBody(scopeA2, FIXTURE_REGISTER)).fetcher,
    )],
  ];
  for (const [label, run] of cases) {
    await assert.rejects(
      run,
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
      label,
    );
  }
});

test("the active-order list only carries non-terminal statuses, so no terminal order offers a write action", async () => {
  // `ACTIVE_TABLE_ORDER_STATUSES` is draft/open/partially_paid. A paid, closed or
  // cancelled order is terminal and is not part of this list at all, so it can
  // never render a card and therefore never offer a collect/write action.
  for (const status of ["draft", "open", "partially_paid"] as const) {
    const parsed = parseActiveTableOrderListV2(activeTableOrderListBody({ orders: [{ status }], scope: scopeA }));
    assert.ok(parsed !== undefined, status);
    assert.equal(parsed.orders[0]?.status, status);
  }
  for (const status of ["paid", "closed", "cancelled"] as const) {
    assert.equal(
      parseActiveTableOrderListV2(activeTableOrderListBody({ orders: [{ status }], scope: scopeA })),
      undefined,
      `${status} is not representable in the active list`,
    );
    await assert.rejects(
      () => listActiveTableOrders(
        fixtureConfig, "token-1", scopeA, FIXTURE_TABLE,
        jsonFetcher(activeTableOrderListBody({ orders: [{ status }], scope: scopeA })).fetcher,
      ),
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
      `${status} response must be refused before it is applied`,
    );
  }
  // An item that was cancelled *is* representable: it stays a line of the order,
  // carried with its own status so the screen can label it «cancelado».
  const cancelledItem = parseActiveTableOrderListV2(activeTableOrderListBody({
    orders: [{ items: [activeTableOrderItemBody({ status: "cancelled" })] }],
    scope: scopeA,
  }));
  assert.equal(cancelledItem?.orders[0]?.items[0]?.status, "cancelled");
});

test("fails closed on an unknown schemaVersion or a removed required field, per endpoint", async () => {
  const withSchema = (body: unknown, version: number): unknown => ({ ...(body as object), schemaVersion: version });
  const without = (body: unknown, key: string): unknown => {
    const copy = { ...(body as Record<string, unknown>) };
    delete copy[key];
    return copy;
  };
  const collectCommand = {
    amountMinor: 12_500,
    cardManualEvidence: null,
    cashRegisterExpectedVersion: 1,
    cashRegisterSessionId: FIXTURE_REGISTER_SESSION,
    deviceId: DEVICE_ID,
    eventId: EVENT_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    localSequence: 1,
    method: "cash" as const,
    occurredAt: OCCURRED_AT,
    orderExpectedVersion: 3,
    orderId: FIXTURE_ORDER,
    paymentId: FIXTURE_PAYMENT,
    schemaVersion: 1 as const,
    scope: branchScope(),
    tenderedAmountMinor: 20_000,
    tipMinor: 0,
  };

  const cases: readonly (readonly [string, () => Promise<unknown>])[] = [
    // A future schema the app does not understand, and a field a migration removed.
    ["layout schemaVersion 2", () => getDiningLayout(fixtureConfig, "token-1", scopeA, jsonFetcher(withSchema(diningLayoutBody(scopeA), 2)).fetcher)],
    ["layout missing zones", () => getDiningLayout(fixtureConfig, "token-1", scopeA, jsonFetcher(without(diningLayoutBody(scopeA), "zones")).fetcher)],
    ["catalog schemaVersion 2", () => getMenuCatalog(fixtureConfig, "token-1", scopeA, jsonFetcher(withSchema(menuCatalogStateBody(scopeA), 2)).fetcher)],
    ["catalog missing catalog", () => getMenuCatalog(fixtureConfig, "token-1", scopeA, jsonFetcher(without(menuCatalogStateBody(scopeA), "catalog")).fetcher)],
    ["shifts schemaVersion 2", () => listOperationalShifts(fixtureConfig, "token-1", scopeA, jsonFetcher(withSchema(operationalShiftListBody(scopeA), 2)).fetcher)],
    ["shifts missing shifts", () => listOperationalShifts(fixtureConfig, "token-1", scopeA, jsonFetcher(without(operationalShiftListBody(scopeA), "shifts")).fetcher)],
    ["context schemaVersion 2", () => selectBranchContext(fixtureConfig, "token-1", scopeA, jsonFetcher(withSchema(branchOperationalContextBody(scopeA), 2)).fetcher)],
    ["context missing timeZone", () => selectBranchContext(fixtureConfig, "token-1", scopeA, jsonFetcher(without(branchOperationalContextBody(scopeA), "timeZone")).fetcher)],
    ["active orders schemaVersion 3", () => listActiveTableOrders(fixtureConfig, "token-1", scopeA, FIXTURE_TABLE, jsonFetcher(withSchema(activeTableOrderListBody({ scope: scopeA }), 3)).fetcher)],
    ["active orders missing orders", () => listActiveTableOrders(fixtureConfig, "token-1", scopeA, FIXTURE_TABLE, jsonFetcher(without(activeTableOrderListBody({ scope: scopeA }), "orders")).fetcher)],
    ["checkout schemaVersion 2", () => getCheckoutOrder(fixtureConfig, "token-1", { cashRegisterSessionId: FIXTURE_REGISTER_SESSION, deviceId: DEVICE_ID, orderId: FIXTURE_ORDER, registerId: FIXTURE_REGISTER, scope: scopeA }, jsonFetcher(withSchema(checkoutOrderSummaryBody(scopeA), 2)).fetcher)],
    ["checkout missing remainingBalanceMinor", () => getCheckoutOrder(fixtureConfig, "token-1", { cashRegisterSessionId: FIXTURE_REGISTER_SESSION, deviceId: DEVICE_ID, orderId: FIXTURE_ORDER, registerId: FIXTURE_REGISTER, scope: scopeA }, jsonFetcher(without(checkoutOrderSummaryBody(scopeA), "remainingBalanceMinor")).fetcher)],
    ["collect schemaVersion 2", () => collectPayment(fixtureConfig, "token-1", collectCommand, jsonFetcher(withSchema(paymentCollectionSummaryBody(scopeA), 2)).fetcher)],
    ["collect missing paymentId", () => collectPayment(fixtureConfig, "token-1", collectCommand, jsonFetcher(without(paymentCollectionSummaryBody(scopeA), "paymentId")).fetcher)],
  ];
  for (const [label, run] of cases) {
    await assert.rejects(
      run,
      (error: unknown) => error instanceof MobileRequestError && error.status === "protocol",
      label,
    );
  }
});

test("table board posts scope and rejects another branch", async () => {
  const body = { schemaVersion: 1, scope: scopeA, tables: [], unassignedOrders: [] };
  const { calls, fetcher } = jsonFetcher(body);
  assert.equal((await getTableBoard(fixtureConfig, "token", scopeA, fetcher)).tables.length, 0);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), scopeA);
  await assert.rejects(getTableBoard(fixtureConfig, "token", scopeB, jsonFetcher(body).fetcher),
    (error: unknown) => error instanceof MobileRequestError && error.status === "protocol");
});


test("kitchen command snapshots pending lines, version and retry identity", async () => {
  const order = parseActiveTableOrderListV2(activeTableOrderListBody({ scope: scopeA, orders: [{ orderId: FIXTURE_ORDER, status: "open", version: 7, items: [
    activeTableOrderItemBody({ status: "pending" }),
    activeTableOrderItemBody({ orderItemId: "a0000000-0000-4000-8000-000000000002", status: "sent" }),
  ] }] }))?.orders[0];
  assert.ok(order);
  const command = kitchenCommand({ order, scope: scopeA, deviceId: DEVICE_ID, eventId: "f0000000-0000-4000-8000-000000000001", idempotencyKey: "kitchen-attempt-123", occurredAt: "2026-09-06T18:30:45.123Z" });
  assert.ok(command);
  assert.equal(kitchenAttempt(command, { order: { ...order, version: 99 }, scope: scopeA, deviceId: DEVICE_ID, eventId: "f0000000-0000-4000-8000-000000000002", idempotencyKey: "another-attempt-123", occurredAt: "2026-09-06T18:30:46.123Z" }), command);
  assert.equal(command.expectedVersion, 7);
  assert.deepEqual(command.orderItemIds, [order.items[0]!.orderItemId]);
  const { calls, fetcher } = jsonFetcher(orderMutationSummaryBody({ orderId: FIXTURE_ORDER, orderStatus: "open", scope: scopeA, version: 8 }));
  await client.sendToKitchen(fixtureConfig, "token", command, fetcher);
  await client.sendToKitchen(fixtureConfig, "token", command, fetcher);
  assert.deepEqual(calls[0]?.init?.body, calls[1]?.init?.body);
  assert.match(calls[0]!.url, /orders\/send-to-kitchen$/u);
  assert.equal(kitchenCommand({ order: { ...order, items: [] }, scope: scopeA, deviceId: DEVICE_ID, eventId: "f0000000-0000-4000-8000-000000000001", idempotencyKey: "kitchen-attempt-123", occurredAt: "2026-09-06T18:30:45.123Z" }), undefined);
});

test("register selection uses only open sessions of the chosen shift and the branch date", () => {
  const register = { registerId: FIXTURE_REGISTER, cashRegisterSessionId: FIXTURE_REGISTER_SESSION, cashierId: FIXTURE_ORDER, status: "open" };
  const summary = { shifts: [ { shiftId: FIXTURE_SHIFT, status: "open", registers: [register, { ...register, status: "closed" }] }, { shiftId: FIXTURE_TABLE, status: "open", registers: [register] } ] } as unknown as BranchDaySummaryV1;
  assert.deepEqual(openRegisters(summary, FIXTURE_SHIFT), [{ registerId: FIXTURE_REGISTER, cashRegisterSessionId: FIXTURE_REGISTER_SESSION, cashierId: FIXTURE_ORDER }]);
  assert.deepEqual(openRegisters(summary, "missing"), []);
  assert.equal(branchDate(new Date("2026-10-07T03:30:00Z"), "America/Hermosillo"), "2026-10-06");
  assert.equal(branchDate(new Date(), "invalid/timezone"), undefined);
});


test("day summary requires the requested branch and date and propagates denied access", async () => {
  const emptySales = { amountMinor: 0, paymentCount: 0, tipMinor: 0 };
  const body = {
    schemaVersion: 1, scope: scopeA, date: "2026-10-06", timeZone: "America/Hermosillo", currency: "MXN",
    salesByChannel: ["table", "counter", "takeout", "delivery"].map((channel) => ({ ...emptySales, channel })),
    salesByMethod: ["cash", "card_manual", "transfer"].map((method) => ({ ...emptySales, method })),
    totals: { cashTipsMinor: 0, paymentCount: 0, salesMinor: 0, tipsMinor: 0 },
    ordersPaid: { amountMinor: 0, count: 0 }, deliveryFees: { amountMinor: 0, orderCount: 0 },
    deliveriesSettled: { cashCollectedMinor: 0, count: 0 }, cancellations: { captures: 0, orders: 0, refundPendingMinor: 0 }, shifts: [],
  };
  const { calls, fetcher } = jsonFetcher(body);
  assert.equal((await client.getDaySummary(fixtureConfig, "token", scopeA, "2026-10-06", fetcher)).shifts.length, 0);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { date: "2026-10-06", schemaVersion: 1, scope: scopeA });
  await assert.rejects(client.getDaySummary(fixtureConfig, "token", scopeB, "2026-10-06", jsonFetcher(body).fetcher), (error: unknown) => error instanceof MobileRequestError && error.status === "protocol");
  await assert.rejects(client.getDaySummary(fixtureConfig, "token", scopeA, "2026-10-07", jsonFetcher(body).fetcher), (error: unknown) => error instanceof MobileRequestError && error.status === "protocol");
  await assert.rejects(client.getDaySummary(fixtureConfig, "token", scopeA, "2026-10-06", (() => Promise.resolve(new Response(null, { status: 403 }))) as typeof fetch), (error: unknown) => error instanceof MobileRequestError && error.status === 403);
});
