import assert from "node:assert/strict";
import test from "node:test";

import type { ActiveTableOrderListV2, BranchScope, OrderMutationSummaryV1 } from "@super-restaurant/shared-types";
import type { EnqueueInput } from "@super-restaurant/sync-engine";

import { MobileRequestError, addOrderItem, createOrder, listActiveTableOrders, openOrder } from "./mobile-client.js";
import type { OrderDraftLine } from "./order-draft.js";
import { buildOrderDeliveryPlan, type OrderDeliveryPlanV1 } from "./order-plan.js";
import {
  buildOfflineCashInput,
  buildOfflineOrderInputs,
  createOrderDeliveryPort,
  enqueueCashCollectOffline,
  enqueueOrderPlanOffline,
  stableOfflineCashIdentity,
  submitOrderPlan,
  toOrderSubmissionFailure,
  type MobileOfflineEnqueuePort,
  type OfflineCashCollectInput,
  type OrderMutationTransport,
} from "./order-submission.js";
import {
  FIXTURE_GROUP_DONENESS,
  FIXTURE_ORDER,
  FIXTURE_OPTION_WELL_DONE,
  FIXTURE_PRODUCT_MAIN,
  FIXTURE_SHIFT,
  FIXTURE_TABLE,
  FIXTURE_TIME_ZONE,
  activeTableOrderItemBody,
  activeTableOrderListBody,
  fixtureConfig,
  orderEntryCatalog,
  orderMutationSummaryBody,
  scopeA,
  scopeB,
} from "./test-fixtures.js";

const unhandled: unknown[] = [];
process.on("unhandledRejection", (reason) => { unhandled.push(reason); });

const DEVICE_ID = "d0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-06T18:30:45.123Z");

function line(overrides: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return Object.freeze({
    draftLineId: "draft-line-1",
    modifierGroups: Object.freeze([Object.freeze({
      groupId: FIXTURE_GROUP_DONENESS,
      selections: Object.freeze([Object.freeze({ optionId: FIXTURE_OPTION_WELL_DONE, quantity: 1 })]),
    })]),
    productId: FIXTURE_PRODUCT_MAIN,
    quantity: 1,
    ...overrides,
  });
}

let uuidSerial = 0;
function planUuid(): string {
  uuidSerial += 1;
  return `e0000000-0000-4000-8000-${uuidSerial.toString(16).padStart(12, "0")}`;
}

function plan(lines: readonly OrderDraftLine[] = [line()]): OrderDeliveryPlanV1 {
  const built = buildOrderDeliveryPlan({
    catalog: orderEntryCatalog(scopeA),
    deviceId: DEVICE_ID,
    lines,
    now: NOW,
    randomUuid: planUuid,
    scope: scopeA,
    shiftId: FIXTURE_SHIFT,
    tableId: FIXTURE_TABLE,
    timeZone: FIXTURE_TIME_ZONE,
  });
  assert.ok(built !== undefined);
  return built;
}

const twoLines = [line(), line({ draftLineId: "draft-line-2", productId: FIXTURE_PRODUCT_MAIN, quantity: 2 })];

/** One step of a scripted server: what it answers, or what it throws. */
type Step =
  | { readonly answer: unknown; readonly status?: number }
  | { readonly throws: unknown };

/**
 * A `fetch` double that records every call and answers a scripted sequence. It
 * is deliberately strict: an unscripted call fails the test rather than being
 * quietly absorbed, which is how "no request after the first failure" is proved.
 */
function server(...steps: readonly Step[]): {
  readonly calls: readonly { body: unknown; headers: unknown; method: string; url: string }[];
  readonly fetcher: typeof fetch;
} {
  const calls: { body: unknown; headers: unknown; method: string; url: string }[] = [];
  let index = 0;
  const fetcher = ((url: string, init?: RequestInit): Promise<Response> => {
    const step = steps[index];
    index += 1;
    calls.push({
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: init?.headers,
      method: init?.method ?? "GET",
      url,
    });
    assert.ok(step !== undefined, `unscripted request ${index}: ${init?.method ?? "GET"} ${url}`);
    if ("throws" in step) return Promise.reject(step.throws);
    return Promise.resolve(new Response(JSON.stringify(step.answer), {
      headers: { "content-type": "application/json" },
      status: step.status ?? 200,
    }));
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

/** The productive transport, over a scripted server. */
function transportOver(fetcher: typeof fetch): OrderMutationTransport {
  const transport: OrderMutationTransport = {
    addItem: (command): Promise<OrderMutationSummaryV1> => addOrderItem(fixtureConfig, "token-1", command, fetcher),
    createOrder: (command): Promise<OrderMutationSummaryV1> => createOrder(fixtureConfig, "token-1", command, fetcher),
    listActiveOrders: (table): Promise<ActiveTableOrderListV2> =>
      listActiveTableOrders(fixtureConfig, "token-1", scopeA, table, fetcher),
    openOrder: (command): Promise<OrderMutationSummaryV1> => openOrder(fixtureConfig, "token-1", command, fetcher),
  };
  return Object.freeze(transport);
}

const summary = (version: number, orderId: string, orderStatus = "draft", replayed = false): unknown =>
  orderMutationSummaryBody({ orderId, orderStatus, replayed, scope: scopeA, version });

/** A transport whose every call the test settles by hand. */
function controlled(): OrderMutationTransport & {
  readonly calls: () => readonly string[];
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: unknown) => void;
} {
  const calls: string[] = [];
  let settle: ((value: never) => void) | undefined;
  let fail: ((error: unknown) => void) | undefined;
  const pending = <T>(name: string): Promise<T> => {
    calls.push(name);
    return new Promise<T>((resolvePromise, rejectPromise) => {
      settle = resolvePromise as (value: never) => void;
      fail = rejectPromise;
    });
  };
  return Object.freeze({
    addItem: (): Promise<OrderMutationSummaryV1> => pending<OrderMutationSummaryV1>("addItem"),
    calls: (): readonly string[] => [...calls],
    createOrder: (): Promise<OrderMutationSummaryV1> => pending<OrderMutationSummaryV1>("createOrder"),
    listActiveOrders: (): Promise<ActiveTableOrderListV2> => pending<ActiveTableOrderListV2>("listActiveOrders"),
    openOrder: (): Promise<OrderMutationSummaryV1> => pending<OrderMutationSummaryV1>("openOrder"),
    reject: (error: unknown): void => { fail?.(error); },
    resolve: (value: unknown): void => { settle?.(value as never); },
  });
}

test("a delivery is exactly create, one add per line, then open", async () => {
  const delivery = plan(twoLines);
  const { calls, fetcher } = server(
    { answer: summary(1, delivery.orderId) },
    { answer: summary(2, delivery.orderId) },
    { answer: summary(3, delivery.orderId) },
    { answer: summary(4, delivery.orderId, "open") },
  );

  const outcome = await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) });
  assert.deepEqual(outcome, { kind: "sent", orderId: delivery.orderId, version: 4 });

  // The routes, the methods and the credential.
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.replace(fixtureConfig.apiBaseUrl, "")}`), [
    "POST /api/v1/orders",
    "POST /api/v1/orders/items",
    "POST /api/v1/orders/items",
    "POST /api/v1/orders/open",
  ]);
  for (const call of calls) {
    assert.deepEqual(call.headers, { authorization: "Bearer token-1", "content-type": "application/json" });
  }

  // The exact bodies, including the version chained from each answer.
  assert.deepEqual(calls[0]?.body, {
    channel: "table",
    currency: orderEntryCatalog(scopeA).currency,
    deviceId: DEVICE_ID,
    eventId: delivery.createOrder.eventId,
    idempotencyKey: delivery.createOrder.idempotencyKey,
    occurredAt: delivery.occurredAt,
    orderId: delivery.orderId,
    schemaVersion: 2,
    scope: { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId },
    shiftId: FIXTURE_SHIFT,
    tableId: FIXTURE_TABLE,
    timeZone: FIXTURE_TIME_ZONE,
  });
  assert.deepEqual(
    calls.slice(1, 3).map((call) => (call.body as { expectedVersion: number }).expectedVersion),
    [1, 2],
    "expectedVersion comes from the previous authoritative answer",
  );
  assert.equal((calls[3]?.body as { expectedVersion: number }).expectedVersion, 3);
  assert.deepEqual(
    calls.slice(1, 3).map((call) => (call.body as { orderItemId: string }).orderItemId),
    delivery.addItems.map((item) => item.orderItemId),
  );

  const notedPlan = plan([line({ note: "Término medio" })]);
  const notedServer = server(
    { answer: summary(1, notedPlan.orderId) },
    { answer: summary(2, notedPlan.orderId) },
    { answer: summary(3, notedPlan.orderId, "open") },
  );
  const notedOutcome = await submitOrderPlan({ plan: notedPlan, transport: transportOver(notedServer.fetcher) });
  assert.equal(notedOutcome.kind, "sent");
  assert.equal((notedServer.calls[1]?.body as { note?: string }).note, "Término medio");
});

test("an exact retry replays and resumes: only the missing lines are sent again", async () => {
  const delivery = plan(twoLines);
  // First attempt: create and the first line land, then the network drops.
  const first = server(
    { answer: summary(1, delivery.orderId) },
    { answer: summary(2, delivery.orderId) },
    { throws: new TypeError("NETWORK") },
  );
  const failed = await submitOrderPlan({ plan: delivery, transport: transportOver(first.fetcher) });
  assert.deepEqual(failed, { failure: "network", kind: "failed", step: "addItem" });
  assert.equal(first.calls.length, 3, "nothing is sent after the first failure");

  // Second attempt with the very same plan. `create` replays, the active list
  // says the first line is already there, and only the second one is sent.
  const applied = activeTableOrderListBody({
    orders: [{
      items: [activeTableOrderItemBody({ orderItemId: delivery.addItems[0]?.orderItemId })],
      orderId: delivery.orderId,
      status: "draft",
      version: 2,
    }],
    scope: scopeA,
  });
  const second = server(
    { answer: summary(2, delivery.orderId, "draft", true) },
    { answer: applied },
    { answer: summary(3, delivery.orderId) },
    { answer: summary(4, delivery.orderId, "open") },
  );
  const outcome = await submitOrderPlan({ plan: delivery, transport: transportOver(second.fetcher) });
  assert.deepEqual(outcome, { kind: "sent", orderId: delivery.orderId, version: 4 });

  assert.deepEqual(second.calls.map((call) => `${call.method} ${call.url.replace(fixtureConfig.apiBaseUrl, "")}`), [
    "POST /api/v1/orders",
    `GET /api/v1/orders/active?branchId=${scopeA.branchId}&restaurantId=${scopeA.restaurantId}&tableId=${FIXTURE_TABLE}`,
    "POST /api/v1/orders/items",
    "POST /api/v1/orders/open",
  ]);
  // Byte for byte: the retried create is identical to the first one.
  assert.deepEqual(second.calls[0]?.body, first.calls[0]?.body);
  // And the line that is sent again is the *second* one, at the version the
  // server reported, not the one the client remembered.
  assert.equal((second.calls[2]?.body as { orderItemId: string }).orderItemId, delivery.addItems[1]?.orderItemId);
  assert.equal((second.calls[2]?.body as { expectedVersion: number }).expectedVersion, 2);
});

test("a retry of a delivery that already completed sends no mutation at all", async () => {
  const delivery = plan();
  const opened = activeTableOrderListBody({
    orders: [{
      items: [activeTableOrderItemBody({ orderItemId: delivery.addItems[0]?.orderItemId })],
      orderId: delivery.orderId,
      status: "open",
      version: 3,
    }],
    scope: scopeA,
  });
  const { calls, fetcher } = server(
    { answer: summary(3, delivery.orderId, "open", true) },
    { answer: opened },
  );

  const outcome = await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) });
  assert.deepEqual(outcome, { kind: "sent", orderId: delivery.orderId, version: 3 });
  assert.equal(calls.length, 2, "an order already open is not added to or opened again");
});

test("an ambiguous failure at each step stops there, with the plan intact", async () => {
  for (const [after, step] of [[0, "create"], [1, "addItem"], [2, "open"]] as const) {
    const delivery = plan();
    const answers: Step[] = [
      { answer: summary(1, delivery.orderId) },
      { answer: summary(2, delivery.orderId) },
      { answer: summary(3, delivery.orderId, "open") },
    ];
    const scripted = [...answers.slice(0, after), { throws: new TypeError("NETWORK") }];
    const { calls, fetcher } = server(...scripted);
    const outcome = await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) });

    assert.deepEqual(outcome, { failure: "network", kind: "failed", step });
    assert.equal(calls.length, after + 1, `${step}: a request was made after the failure`);
    // The identities are untouched, so the retry is the same delivery.
    assert.equal(calls[0]?.body !== undefined, true);
    if (after > 0) {
      assert.equal((calls[0]?.body as { orderId: string }).orderId, delivery.orderId);
    }
  }
});

test("a line that was not confirmed never lets the order be opened", async () => {
  const delivery = plan(twoLines);
  const { calls, fetcher } = server(
    { answer: summary(1, delivery.orderId) },
    { answer: summary(2, delivery.orderId) },
    { answer: { code: "ORDER_CONFLICT" }, status: 409 },
  );

  const outcome = await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) });
  assert.deepEqual(outcome, { failure: "conflict", kind: "failed", step: "addItem" });
  assert.equal(
    calls.some((call) => call.url.endsWith("/orders/open")),
    false,
    "open was reached with an unconfirmed line",
  );
});

test("each transport failure keeps its own operational meaning", () => {
  assert.equal(toOrderSubmissionFailure(new MobileRequestError(409)), "conflict");
  assert.equal(toOrderSubmissionFailure(new MobileRequestError(401)), "authorization");
  assert.equal(toOrderSubmissionFailure(new MobileRequestError(403)), "authorization");
  assert.equal(toOrderSubmissionFailure(new MobileRequestError("network")), "network");
  assert.equal(toOrderSubmissionFailure(new MobileRequestError("protocol")), "protocol");
  assert.equal(toOrderSubmissionFailure(new MobileRequestError(503)), "unavailable");
  assert.equal(toOrderSubmissionFailure(new Error("boom")), "unavailable");
});

test("an answer about another order or another branch is refused, not applied", async () => {
  const delivery = plan();
  const other = server({ answer: orderMutationSummaryBody({ orderId: delivery.addItems[0]?.orderItemId ?? "", scope: scopeA, version: 1 }) });
  assert.deepEqual(
    await submitOrderPlan({ plan: delivery, transport: transportOver(other.fetcher) }),
    { failure: "protocol", kind: "failed", step: "create" },
  );

  const crossed = server({ answer: orderMutationSummaryBody({ orderId: delivery.orderId, scope: scopeB, version: 1 }) });
  assert.deepEqual(
    await submitOrderPlan({ plan: delivery, transport: transportOver(crossed.fetcher) }),
    { failure: "protocol", kind: "failed", step: "create" },
  );
});

test("a replay whose order is no longer active is a conflict, never a silent success", async () => {
  const delivery = plan();
  const { fetcher } = server(
    // Replayed, still a draft, and absent from the active list: the screen
    // cannot tell what happened to it, so it says so.
    { answer: summary(2, delivery.orderId, "draft", true) },
    { answer: activeTableOrderListBody({ orders: [], scope: scopeA }) },
  );
  assert.deepEqual(
    await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) }),
    { failure: "conflict", kind: "failed", step: "read" },
  );
});

test("a resume that cannot read the active list fails recoverably, sending nothing", async () => {
  const delivery = plan();
  const { calls, fetcher } = server(
    { answer: summary(2, delivery.orderId, "draft", true) },
    { throws: new TypeError("NETWORK") },
  );
  assert.deepEqual(
    await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) }),
    { failure: "network", kind: "failed", step: "read" },
  );
  assert.equal(calls.length, 2);
});

test("a cancelled line counts as applied: a retry never revives it", async () => {
  const delivery = plan(twoLines);
  const cancelled = activeTableOrderListBody({
    orders: [{
      items: [
        activeTableOrderItemBody({ orderItemId: delivery.addItems[0]?.orderItemId, status: "cancelled" }),
        activeTableOrderItemBody({ orderItemId: delivery.addItems[1]?.orderItemId }),
      ],
      orderId: delivery.orderId,
      status: "draft",
      version: 4,
    }],
    scope: scopeA,
  });
  const { calls, fetcher } = server(
    { answer: summary(4, delivery.orderId, "draft", true) },
    { answer: cancelled },
    { answer: summary(5, delivery.orderId, "open") },
  );

  const outcome = await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) });
  assert.deepEqual(outcome, { kind: "sent", orderId: delivery.orderId, version: 5 });
  assert.equal(
    calls.some((call) => call.url.endsWith("/orders/items")),
    false,
    "a line already present, cancelled or not, must not be sent again",
  );
});

test("a table with several active orders leaves the other ones alone", async () => {
  const delivery = plan();
  const list = activeTableOrderListBody({
    orders: [
      { orderId: "b0000000-0000-4000-8000-0000000000aa", shiftId: null, status: "partially_paid", version: 7 },
      {
        items: [activeTableOrderItemBody({ orderItemId: delivery.addItems[0]?.orderItemId })],
        orderId: delivery.orderId,
        status: "draft",
        version: 2,
      },
    ],
    scope: scopeA,
  });
  const { calls, fetcher } = server(
    { answer: summary(2, delivery.orderId, "draft", true) },
    { answer: list },
    { answer: summary(3, delivery.orderId, "open") },
  );

  assert.deepEqual(
    await submitOrderPlan({ plan: delivery, transport: transportOver(fetcher) }),
    { kind: "sent", orderId: delivery.orderId, version: 3 },
  );
  // Only this plan's own order is opened, at its own version.
  assert.equal((calls[2]?.body as { orderId: string }).orderId, delivery.orderId);
  assert.equal((calls[2]?.body as { expectedVersion: number }).expectedVersion, 2);
});

test("the delivery port reports one failure and nothing else", async () => {
  const delivery = plan();
  const accepted = server(
    { answer: summary(1, delivery.orderId) },
    { answer: summary(2, delivery.orderId) },
    { answer: summary(3, delivery.orderId, "open") },
  );
  assert.equal(await createOrderDeliveryPort(transportOver(accepted.fetcher)).deliver(delivery), undefined);

  const refused = server({ answer: { code: "ACTION_NOT_AUTHORIZED" }, status: 403 });
  assert.equal(await createOrderDeliveryPort(transportOver(refused.fetcher)).deliver(delivery), "authorization");
});

test("a transport that throws synchronously is contained, and reaches no later step", async () => {
  const delivery = plan();
  const transport: OrderMutationTransport = Object.freeze({
    addItem: (): Promise<OrderMutationSummaryV1> => { throw new Error("UNREACHABLE"); },
    createOrder: (): Promise<OrderMutationSummaryV1> => { throw new Error("SYNCHRONOUS"); },
    listActiveOrders: (): Promise<ActiveTableOrderListV2> => { throw new Error("UNREACHABLE"); },
    openOrder: (): Promise<OrderMutationSummaryV1> => { throw new Error("UNREACHABLE"); },
  });
  assert.deepEqual(
    await submitOrderPlan({ plan: delivery, transport }),
    { failure: "unavailable", kind: "failed", step: "create" },
  );
});

test("a request that never settles leaves the delivery pending, not duplicated", async () => {
  const delivery = plan();
  const transport = controlled();
  const outcome = submitOrderPlan({ plan: delivery, transport });

  // Nothing else is attempted while `create` is in flight, and nothing is
  // rejected: the delivery is simply not finished.
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(transport.calls(), ["createOrder"]);

  transport.resolve(orderMutationSummaryBody({ orderId: delivery.orderId, scope: scopeA, version: 1 }));
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(transport.calls(), ["createOrder", "addItem"]);

  transport.resolve(orderMutationSummaryBody({
    orderId: delivery.orderId,
    orderStatus: "open",
    scope: scopeA,
    version: 2,
  }));
  assert.deepEqual(await outcome, { kind: "sent", orderId: delivery.orderId, version: 2 });
});

test("no rejection was left unhandled", async () => {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(unhandled, []);
});


test("adds to a selected open order using its authoritative version and resumes without duplicates", async () => {
  const base = plan(twoLines);
  const delivery: OrderDeliveryPlanV1 = { ...base, orderId: "b0000000-0000-4000-8000-000000000001", existingOrderId: "b0000000-0000-4000-8000-000000000001" };
  const existing = activeTableOrderListBody({ scope: scopeA, orders: [{ orderId: delivery.orderId, status: "open", version: 8, items: [activeTableOrderItemBody({ orderItemId: delivery.addItems[0]!.orderItemId })] }] });
  const service = server({ answer: existing }, { answer: summary(9, delivery.orderId, "open") });
  assert.deepEqual(await submitOrderPlan({ plan: delivery, transport: transportOver(service.fetcher) }), { kind: "sent", orderId: delivery.orderId, version: 9 });
  assert.equal(service.calls.length, 2);
  assert.equal((service.calls[1]!.body as { expectedVersion: number }).expectedVersion, 8);
  assert.equal((service.calls[1]!.body as { orderItemId: string }).orderItemId, delivery.addItems[1]!.orderItemId);
  const stale = server({ answer: activeTableOrderListBody({ scope: scopeA, orders: [{ orderId: delivery.orderId, status: "partially_paid" }] }) });
  assert.deepEqual(await submitOrderPlan({ plan: delivery, transport: transportOver(stale.fetcher) }), { failure: "conflict", kind: "failed", step: "read" });
  assert.equal(stale.calls.length, 1);
});

// ---- Offline capture through the sync engine ----------------------------------------------

const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

/** A controllable engine double: capability decisions are scripted, enqueue is idempotent. */
function offlineEngine(options: {
  readonly allow?: boolean;
  readonly enqueueError?: unknown;
  readonly reasonCode?: string | null;
} = {}): MobileOfflineEnqueuePort & {
  readonly canChecks: readonly unknown[];
  readonly enqueued: readonly { idempotencyKey: string; payload: unknown; scope: unknown }[];
} {
  const seen = new Map<string, string>();
  let serial = 0;
  const enqueued: { idempotencyKey: string; payload: unknown; scope: unknown }[] = [];
  const canChecks: unknown[] = [];
  const port = {
    canChecks,
    canEnqueue: async () => {
      canChecks.push(true);
      return Object.freeze({
        allowed: options.allow ?? true,
        reasonCode: options.allow === false ? (options.reasonCode ?? "SNAPSHOTS_REQUIRED") : null,
      });
    },
    enqueued,
    enqueue: async (input: EnqueueInput) => {
      if (options.enqueueError !== undefined) throw options.enqueueError;
      enqueued.push({ idempotencyKey: input.idempotencyKey, payload: input.payload, scope: input.scope });
      const existing = seen.get(input.idempotencyKey);
      if (existing !== undefined) return { eventId: existing };
      serial += 1;
      const eventId = `offline-${serial}`;
      seen.set(input.idempotencyKey, eventId);
      return { eventId };
    },
  };
  return port;
}

test("an offline delivery queues the order first, then each line, with stable identities", () => {
  const delivery = plan(twoLines);
  const events = buildOfflineOrderInputs({ actorId: ACTOR, plan: delivery });

  assert.equal(events.length, 3, "one order create plus one event per line");
  const order = events[0];
  assert.ok(order !== undefined);
  assert.equal(order.entityType, "Order");
  assert.equal(order.operation, "create");
  assert.equal(order.baseVersion, null);
  assert.equal(order.entityId, delivery.orderId);
  assert.equal(order.idempotencyKey, delivery.createOrder.idempotencyKey, "the plan owns the idempotency key");
  assert.deepEqual(order.payload, {
    channel: delivery.channel,
    currency: delivery.currency,
    timeZone: delivery.timeZone,
  }, "no lines are smuggled into the order create");
  assert.deepEqual(order.preconditions, { hasCatalogSnapshots: true, originatedOnThisDevice: true });

  assert.deepEqual(
    events.slice(1).map((event) => event.entityId),
    delivery.addItems.map((line) => line.orderItemId),
  );
  for (const [index, event] of events.slice(1).entries()) {
    assert.equal(event.entityType, "OrderItem");
    assert.equal(event.operation, "create");
    assert.equal(event.idempotencyKey, delivery.addItems[index]?.idempotencyKey);
    const payload = event.payload as { readonly orderId?: string; readonly productId?: string };
    assert.equal(payload.orderId, delivery.orderId);
    assert.equal(payload.productId, delivery.addItems[index]?.productId);
  }
  // Nothing cross-tenant: every event carries the plan's own pair.
  for (const event of events) {
    assert.deepEqual(event.scope, { branchId: scopeA.branchId, restaurantId: scopeA.restaurantId });
  }
});

test("an offline delivery is queued once and a retry reuses the same identities", async () => {
  const delivery = plan(twoLines);
  const engine = offlineEngine();

  const first = await enqueueOrderPlanOffline({ actorId: ACTOR, plan: delivery, port: engine });
  assert.equal(first.queued, true);
  assert.equal(first.eventIds.length, 3);
  assert.equal(engine.enqueued.length, 3);

  const retry = await enqueueOrderPlanOffline({ actorId: ACTOR, plan: delivery, port: engine });
  assert.equal(retry.queued, true);
  assert.deepEqual(retry.eventIds, first.eventIds, "the engine dedupes by idempotency key");
  assert.equal(engine.enqueued.length, 6, "all three events were offered again");
  const keys = engine.enqueued.map((entry) => entry.idempotencyKey);
  assert.equal(new Set(keys).size, 3, "the same three keys, never new ones");
});

test("a capability refusal blocks the offline queue before anything is written", async () => {
  const delivery = plan();
  const blocked = offlineEngine({ allow: false, reasonCode: "SNAPSHOTS_REQUIRED" });
  const outcome = await enqueueOrderPlanOffline({ actorId: ACTOR, plan: delivery, port: blocked });
  assert.deepEqual(outcome, { eventIds: [], queued: false, reasonCode: "SNAPSHOTS_REQUIRED" });
  assert.equal(blocked.enqueued.length, 0);
  assert.equal(blocked.canChecks.length, 1);
});

test("an engine capability error surfaces its matrix code, and other failures are not called queued", async () => {
  const delivery = plan();
  const refused = offlineEngine({ enqueueError: new Error("CAPABILITY_BLOCKED: REMOTE_ORIGIN_OFFLINE_BLOCKED") });
  const blocked = await enqueueOrderPlanOffline({ actorId: ACTOR, plan: delivery, port: refused });
  assert.equal(blocked.queued, false);
  assert.equal(blocked.reasonCode, "REMOTE_ORIGIN_OFFLINE_BLOCKED");

  const broken = offlineEngine({ enqueueError: new Error("STORAGE_COMMIT_FAILED") });
  const failed = await enqueueOrderPlanOffline({ actorId: ACTOR, plan: delivery, port: broken });
  assert.equal(failed.queued, false);
  assert.equal(failed.reasonCode, null, "a storage failure is not a matrix refusal");
});

function cashInput(overrides: Partial<OfflineCashCollectInput> = {}): OfflineCashCollectInput {
  return Object.freeze({
    amountMinor: 12_500,
    cashRegisterSessionId: "c0000000-0000-4000-8000-0000000000cc",
    currency: "MXN",
    idempotencyKey: "cash-idem-1",
    occurredAt: "2026-11-23T18:00:00.000Z",
    orderId: FIXTURE_ORDER,
    orderVersion: 4,
    paymentId: "c0000000-0000-4000-8000-0000000000dd",
    ...overrides,
  });
}

test("offline cash is built with its matrix preconditions and enqueued only when allowed", async () => {
  const cash = cashInput();
  const scope = scopeA as unknown as BranchScope;
  const event = buildOfflineCashInput({
    actorId: ACTOR,
    cash,
    preconditions: { cashRegisterOpen: true, cashierShiftOpen: true, withinOfflineCashLimit: true },
    scope,
  });
  assert.equal(event.entityType, "Payment");
  assert.equal(event.operation, "create");
  assert.equal(event.entityId, cash.paymentId);
  assert.equal(event.idempotencyKey, cash.idempotencyKey);
  assert.equal(event.baseVersion, cash.orderVersion, "the version the server reported is expected");
  assert.deepEqual(event.payload, {
    amountMinor: 12_500,
    cashRegisterSessionId: cash.cashRegisterSessionId,
    currency: "MXN",
    method: "cash",
    orderId: FIXTURE_ORDER,
    orderVersion: 4,
    paymentId: cash.paymentId,
  });
  assert.deepEqual(event.preconditions, {
    cashRegisterOpen: true,
    cashierShiftOpen: true,
    paymentMethod: "cash",
    withinOfflineCashLimit: true,
  });

  const engine = offlineEngine();
  const queued = await enqueueCashCollectOffline({
    actorId: ACTOR,
    cash,
    port: engine,
    preconditions: { cashRegisterOpen: true, cashierShiftOpen: true, withinOfflineCashLimit: true },
    scope,
  });
  assert.equal(queued.queued, true);
  assert.equal(engine.enqueued.length, 1);
  assert.deepEqual(engine.enqueued[0]?.scope, scope);

  const refused = offlineEngine({ allow: false, reasonCode: "CASH_REGISTER_REQUIRED" });
  const blocked = await enqueueCashCollectOffline({
    actorId: ACTOR,
    cash,
    port: refused,
    preconditions: { cashRegisterOpen: false, cashierShiftOpen: false, withinOfflineCashLimit: true },
    scope,
  });
  assert.deepEqual(blocked, { eventIds: [], queued: false, reasonCode: "CASH_REGISTER_REQUIRED" });
  assert.equal(refused.enqueued.length, 0);
});

test("offline cash identity is stable per order and version, so a second tap replays it", async () => {
  let serial = 0;
  const uuid = (): string => `uuid-${(serial += 1)}`;
  const first = stableOfflineCashIdentity(undefined, {
    key: "order-1|4",
    now: new Date("2026-11-23T18:00:00.000Z"),
    uuid,
  });
  const second = stableOfflineCashIdentity(first, {
    key: "order-1|4",
    now: new Date("2026-11-23T18:05:00.000Z"),
    uuid,
  });
  assert.equal(second, first, "the same order and version keep the same identity");
  assert.equal(second.paymentId, first.paymentId);
  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.equal(serial, 2, "no new identifiers were minted on the second tap");

  const otherVersion = stableOfflineCashIdentity(first, { key: "order-1|5", now: new Date(), uuid });
  assert.notEqual(otherVersion.paymentId, first.paymentId, "a new order version is a new collection");
  assert.notEqual(otherVersion.idempotencyKey, first.idempotencyKey);

  // Two taps through the engine with that identity enqueue the same event.
  const engine = offlineEngine();
  const scope = scopeA as unknown as BranchScope;
  const cash = cashInput({
    idempotencyKey: first.idempotencyKey,
    occurredAt: first.occurredAt,
    paymentId: first.paymentId,
  });
  const preconditions = { cashRegisterOpen: true, cashierShiftOpen: true, withinOfflineCashLimit: true };
  const once = await enqueueCashCollectOffline({ actorId: ACTOR, cash, port: engine, preconditions, scope });
  const twice = await enqueueCashCollectOffline({ actorId: ACTOR, cash, port: engine, preconditions, scope });
  assert.equal(once.queued, true);
  assert.deepEqual(twice.eventIds, once.eventIds, "the replay answers the original event");
  assert.equal(engine.enqueued.length, 2);
  assert.equal(new Set(engine.enqueued.map((entry) => entry.idempotencyKey)).size, 1, "one collection, not two");
});
