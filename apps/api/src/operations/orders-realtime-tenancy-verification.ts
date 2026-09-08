import { randomUUID } from "node:crypto";

import {
  KDS_INITIAL_CURSOR,
  REALTIME_NAMESPACE,
  REALTIME_NOTIFICATION_EVENT,
  REALTIME_SUBSCRIBE_EVENT,
  parseKdsEventPageV1,
  parseKdsTicketListV1,
  parseActiveTableOrderListV2,
  parseOperationalShiftListV1,
  parseRealtimeNotificationV1,
  parseRealtimeSubscriptionAckV1,
  type AddOrderItemCommandV1,
  type BranchScope,
  type CreateOrderCommandV1,
  type CreateOrderCommandV2,
  type KdsTicketListV1,
  type OpenOrderCommandV1,
  type OrderItemForwardStatusV1,
  type OrderMutationSummaryV1,
  type RealtimeNotificationV1,
  type RealtimeSubscriptionV1,
  type TransitionOrderItemCommandV1,
} from "@super-restaurant/shared-types";
import { Pool, type PoolClient } from "pg";
import { io, type Socket } from "socket.io-client";

import type { DatabaseConfig } from "../database.js";
import { createClient } from "@supabase/supabase-js";
import {
  TenancyVerificationError,
  type TenancyVerificationConfig,
} from "./tenancy-verification-config.js";
import type { OrdersRealtimeVerificationCheckpoint } from "./tenancy-verification-progress.js";
import type { KdsTicketVerificationCheckpoint } from "./tenancy-verification-progress.js";
import { tenancyFixtureName } from "./tenancy-fixture-markers.js";
import {
  runTenancyVerification,
  type RunTenancyVerificationOptions,
  type TenancyVerificationLiveFixture,
  type TenancyVerificationLiveFixtureContext,
  type TenancyVerificationSummary,
} from "./tenancy-verification.js";

const STATION_ID = "kitchen";
const HTTP_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 5_000;

export interface RunOrdersRealtimeTenancyVerificationOptions
  extends Omit<RunTenancyVerificationOptions, "liveFixtureHooks" | "verifyKdsTickets" | "verifyMenuCatalog" | "verifyOrdersRealtime"> {
  readonly journeyHooks?: OrderJourneyHooks;
  readonly onOrdersRealtimeCheckpoint?: (checkpoint: OrdersRealtimeVerificationCheckpoint) => void;
  readonly useDiningTable?: true;
  readonly useOperationalShift?: true;
}

export interface OrderJourneyContext {
  readonly currency: string;
  readonly deviceId: string;
  readonly fixture: TenancyVerificationLiveFixture;
  readonly orderId: string;
  readonly orderVersion: number;
  readonly tableId: string | null;
}

export interface OrderJourneyHooks {
  readonly afterDelivery: (context: OrderJourneyContext) => Promise<void>;
  readonly cleanup: (context: OrderJourneyContext) => Promise<void>;
}

export interface KdsBrowserVerificationHooks {
  readonly afterRevocation: (fixture: TenancyVerificationLiveFixture) => Promise<void>;
  readonly ready: (fixture: TenancyVerificationLiveFixture) => Promise<void>;
  readonly sent: (fixture: TenancyVerificationLiveFixture) => Promise<void>;
}

export interface RunKdsTenancyVerificationOptions extends RunOrdersRealtimeTenancyVerificationOptions {
  readonly browserHooks?: KdsBrowserVerificationHooks;
  readonly onKdsTicketCheckpoint?: (checkpoint: KdsTicketVerificationCheckpoint) => void;
}

export interface OrdersRealtimeTenancyVerificationSummary extends TenancyVerificationSummary {
  readonly ordersRealtimeVerified: true;
}

export interface KdsTenancyVerificationSummary extends OrdersRealtimeTenancyVerificationSummary {
  readonly kdsTicketsVerified: true;
}

interface OrdersFixturePlan {
  readonly addItem: AddOrderItemCommandV1;
  readonly create: CreateOrderCommandV1 | CreateOrderCommandV2;
  readonly deviceId: string;
  readonly divergentCreate: CreateOrderCommandV1 | CreateOrderCommandV2;
  readonly open: OpenOrderCommandV1;
  readonly orderId: string;
  readonly orderItemId: string;
  readonly transitions: readonly TransitionOrderItemCommandV1[];
  readonly operational?: Readonly<{
    closedShiftId: string;
    foreignShiftId: string;
    legacyCreate: CreateOrderCommandV1;
    openShiftId: string;
  }>;
}

interface OrdersRuntimeState {
  fixture?: TenancyVerificationLiveFixture;
  journey?: OrderJourneyContext;
  mainSocket?: Socket;
  plan?: OrdersFixturePlan;
  kdsTicketsVerified: boolean;
  verified: boolean;
}

interface KdsVerificationMode {
  readonly browserHooks?: KdsBrowserVerificationHooks;
  readonly checkpoint?: (checkpoint: KdsTicketVerificationCheckpoint) => void;
  readonly enabled: boolean;
}

export async function runOrdersRealtimeTenancyVerification(
  options: RunOrdersRealtimeTenancyVerificationOptions,
): Promise<OrdersRealtimeTenancyVerificationSummary> {
  return runOrdersVerification(options, { enabled: false });
}

export async function runKdsTenancyVerification(
  options: RunKdsTenancyVerificationOptions,
): Promise<KdsTenancyVerificationSummary> {
  const summary = await runOrdersVerification(options, {
    ...(options.browserHooks === undefined ? {} : { browserHooks: options.browserHooks }),
    ...(options.onKdsTicketCheckpoint === undefined
      ? {}
      : { checkpoint: options.onKdsTicketCheckpoint }),
    enabled: true,
  });
  return Object.freeze({ ...summary, kdsTicketsVerified: true });
}

async function runOrdersVerification(
  options: RunOrdersRealtimeTenancyVerificationOptions,
  kds: KdsVerificationMode,
): Promise<OrdersRealtimeTenancyVerificationSummary> {
  const state: OrdersRuntimeState = { kdsTicketsVerified: false, verified: false };
  const pool = createPool(options.config.adminDatabase);
  try {
    const summary = await runTenancyVerification({
      ...options,
      liveFixtureHooks: {
        afterRevocation: async (fixture) => verifyAfterRevocation(fixture, state, options.onOrdersRealtimeCheckpoint, kds),
        beforeRevocation: async (fixture) => verifyBeforeRevocation(
          fixture,
          state,
          pool,
          options.config,
          options.onOrdersRealtimeCheckpoint,
          kds,
          options.journeyHooks,
          options.useDiningTable === true,
          options.useOperationalShift === true,
        ),
        cleanup: async (fixture) => cleanupOrdersFixture(
          pool,
          fixture,
          state,
          options.onOrdersRealtimeCheckpoint,
          options.journeyHooks,
        ),
      },
      ...(kds.enabled ? { verifyKdsTickets: true as const } : {}),
      ...(options.useOperationalShift === true ? { verifyOperationalOrders: true as const } : {}),
      verifyMenuCatalog: true,
      verifyOrdersRealtime: true,
    });
    if (!state.verified || (kds.enabled && !state.kdsTicketsVerified)) throw ordersError();
    return Object.freeze({ ...summary, ordersRealtimeVerified: true });
  } finally {
    state.mainSocket?.disconnect();
    await pool.end().catch(() => undefined);
  }
}

async function verifyBeforeRevocation(
  fixture: TenancyVerificationLiveFixture,
  state: OrdersRuntimeState,
  pool: Pool,
  config: TenancyVerificationConfig,
  checkpoint: RunOrdersRealtimeTenancyVerificationOptions["onOrdersRealtimeCheckpoint"],
  kds: KdsVerificationMode,
  journeyHooks: OrderJourneyHooks | undefined,
  useDiningTable: boolean,
  useOperationalShift: boolean,
): Promise<void> {
  const context = requireContext(fixture);
  const scope = branchScope(fixture.restaurantId, fixture.branchId);
  const plan = createPlan(fixture, scope, useDiningTable, useOperationalShift);
  state.fixture = fixture;
  state.plan = plan;
  state.journey = Object.freeze({
    currency: plan.create.currency,
    deviceId: plan.deviceId,
    fixture,
    orderId: plan.orderId,
    orderVersion: 7,
    tableId: plan.create.tableId,
  });

  await verifyOrderDataApiDenied(config, context.accessToken, plan.operational !== undefined);

  if (plan.operational !== undefined) {
    await createOperationalShiftFixtures(pool, fixture, context, plan);
    await verifyOperationalOrderPreconditions(fixture, context, plan, checkpoint);
  }

  const subscription = subscriptionFor(scope, STATION_ID);
  if (kds.enabled) {
    await listTickets(fixture.apiBaseUrl, undefined, subscription, 401);
    kds.checkpoint?.("kds_tickets.unauthenticated_list_rejected");
    assertTicketList(
      await listTickets(fixture.apiBaseUrl, context.accessToken, subscription, 200),
      subscription,
      plan,
      fixture.runId,
      undefined,
      undefined,
    );
    kds.checkpoint?.("kds_tickets.empty_list_verified");
  }

  await expectStatus(fixture.apiBaseUrl, "/api/v1/orders", plan.create, undefined, 401);
  checkpoint?.("orders_realtime.unauthenticated_create_rejected");
  await assertPersistenceEmpty(context, pool, plan);
  checkpoint?.("orders_realtime.empty_persistence");

  const created = await mutate(fixture.apiBaseUrl, "/api/v1/orders", plan.create, context.accessToken, 201);
  assertSummary(created, plan.orderId, scope, 1, "draft", false, false);
  checkpoint?.("orders_realtime.manager_create");

  const replayed = await mutate(fixture.apiBaseUrl, "/api/v1/orders", plan.create, context.accessToken, 201);
  assertSummary(replayed, plan.orderId, scope, 1, "draft", true, false);
  checkpoint?.("orders_realtime.create_replay");

  await expectOrderError(fixture.apiBaseUrl, "/api/v1/orders", plan.divergentCreate, context.accessToken, 409, "ORDER_CONFLICT");
  checkpoint?.("orders_realtime.idempotency_conflict");

  await expectOrderError(
    fixture.apiBaseUrl,
    "/api/v1/orders",
    { ...newCreate(plan), scope: branchScope(fixture.restaurantId, context.viewerBranchId) },
    context.accessToken,
    403,
    "ACTION_NOT_AUTHORIZED",
  );
  checkpoint?.("orders_realtime.viewer_write_rejected");
  await expectOrderError(
    fixture.apiBaseUrl,
    "/api/v1/orders",
    { ...newCreate(plan), scope: branchScope(context.secondaryRestaurantId, context.secondaryBranchId) },
    context.accessToken,
    403,
    "ACTION_NOT_AUTHORIZED",
  );
  checkpoint?.("orders_realtime.cross_tenant_write_rejected");
  await expectOrderError(
    fixture.apiBaseUrl,
    "/api/v1/orders",
    { ...newCreate(plan), scope: branchScope(fixture.restaurantId, context.secondaryBranchId) },
    context.accessToken,
    403,
    "ACTION_NOT_AUTHORIZED",
  );
  checkpoint?.("orders_realtime.false_pair_write_rejected");

  const mainSocket = await connectSocket(fixture.apiBaseUrl, context.accessToken);
  state.mainSocket = mainSocket;
  const ack = await subscribe(mainSocket, subscription);
  if (parseRealtimeSubscriptionAckV1(ack) === undefined) throw ordersError();
  checkpoint?.("orders_realtime.socket_subscribed");

  const notificationPromise = waitForNotification(mainSocket);
  const added = await mutate(fixture.apiBaseUrl, "/api/v1/orders/items", plan.addItem, context.accessToken, 201);
  assertSummary(added, plan.orderId, scope, 2, "draft", false, true);
  checkpoint?.("orders_realtime.item_added");
  const notification = await notificationPromise;
  if (notification.scope.restaurantId !== scope.restaurantId || notification.scope.branchId !== scope.branchId || notification.stationId !== STATION_ID) throw ordersError();
  checkpoint?.("orders_realtime.notification_received");
  if (kds.enabled) {
    assertTicketList(
      await listTickets(fixture.apiBaseUrl, context.accessToken, subscription, 200),
      subscription,
      plan,
      fixture.runId,
      undefined,
      undefined,
    );
    kds.checkpoint?.("kds_tickets.pending_item_excluded");
  }

  const opened = await mutate(fixture.apiBaseUrl, "/api/v1/orders/open", plan.open, context.accessToken, 201);
  assertSummary(opened, plan.orderId, scope, 3, "open", false, false);
  checkpoint?.("orders_realtime.order_opened");

  if (plan.operational !== undefined) {
    await verifyActiveOperationalOrders(fixture, context, plan, checkpoint);
  }

  await verifyDuplicateSubscription(fixture.apiBaseUrl, context.accessToken, subscription);
  checkpoint?.("orders_realtime.duplicate_subscription_rejected");

  for (const [index, command] of plan.transitions.entries()) {
    const result = await mutate(fixture.apiBaseUrl, "/api/v1/orders/items/transition", command, context.accessToken, 201);
    assertSummary(result, plan.orderId, scope, 4 + index, "open", false, true);
    checkpoint?.([
      "orders_realtime.item_sent",
      "orders_realtime.item_preparing",
      "orders_realtime.item_ready",
      "orders_realtime.item_delivered",
    ][index] as OrdersRealtimeVerificationCheckpoint);
    if (kds.enabled) {
      const expectedStatus = command.to === "delivered" ? undefined : command.to;
      assertTicketList(
        await listTickets(fixture.apiBaseUrl, context.accessToken, subscription, 200),
        subscription,
        plan,
        fixture.runId,
        expectedStatus,
        expectedStatus === undefined ? undefined : 4 + index,
      );
      kds.checkpoint?.([
        "kds_tickets.sent_ticket_verified",
        "kds_tickets.preparing_ticket_verified",
        "kds_tickets.ready_ticket_verified",
        "kds_tickets.delivered_ticket_removed",
      ][index] as KdsTicketVerificationCheckpoint);
      if (index === 0) {
        await verifyKdsTicketIsolation(fixture, subscription, plan, kds);
        await kds.browserHooks?.sent(fixture);
      }
      if (index === 2) await kds.browserHooks?.ready(fixture);
    }
  }

  await assertPersistence(context, pool, plan);
  checkpoint?.("orders_realtime.persistence_verified");

  const firstPage = await recover(fixture.apiBaseUrl, context.accessToken, subscription, KDS_INITIAL_CURSOR, 1, 200);
  if (firstPage.events.length !== 1 || !firstPage.hasMore || firstPage.events[0]?.status !== "pending") throw ordersError();
  checkpoint?.("orders_realtime.cursor_page_verified");
  const remainder = await recover(fixture.apiBaseUrl, context.accessToken, subscription, firstPage.nextCursor, 50, 200);
  if (remainder.events.length !== 4 || remainder.hasMore || remainder.events.at(-1)?.status !== "delivered") throw ordersError();
  checkpoint?.("orders_realtime.cursor_remainder_verified");

  const wrongStation = await recover(fixture.apiBaseUrl, context.accessToken, subscriptionFor(scope, "bar"), KDS_INITIAL_CURSOR, 50, 200);
  if (wrongStation.events.length !== 0 || wrongStation.hasMore) throw ordersError();
  checkpoint?.("orders_realtime.station_isolation_verified");
  const secondary = await recover(
    fixture.apiBaseUrl,
    context.secondaryAccessToken,
    subscriptionFor(branchScope(context.secondaryRestaurantId, context.secondaryBranchId), STATION_ID),
    KDS_INITIAL_CURSOR,
    50,
    200,
  );
  if (secondary.events.length !== 0 || secondary.hasMore) throw ordersError();
  await recover(fixture.apiBaseUrl, context.accessToken, subscriptionFor(branchScope(context.secondaryRestaurantId, context.secondaryBranchId), STATION_ID), KDS_INITIAL_CURSOR, 50, 403);
  checkpoint?.("orders_realtime.tenant_isolation_verified");
  if (journeyHooks !== undefined) await journeyHooks.afterDelivery(state.journey);
}

async function verifyAfterRevocation(
  fixture: TenancyVerificationLiveFixture,
  state: OrdersRuntimeState,
  checkpoint: RunOrdersRealtimeTenancyVerificationOptions["onOrdersRealtimeCheckpoint"],
  kds: KdsVerificationMode,
): Promise<void> {
  const context = requireContext(fixture);
  const subscription = subscriptionFor(branchScope(fixture.restaurantId, fixture.branchId), STATION_ID);
  await recover(fixture.apiBaseUrl, context.accessToken, subscription, KDS_INITIAL_CURSOR, 50, 403);
  checkpoint?.("orders_realtime.revoked_recovery_rejected");
  const socket = await connectSocket(fixture.apiBaseUrl, context.accessToken);
  try {
    await expectSubscriptionDisconnect(socket, subscription);
  } finally {
    socket.disconnect();
  }
  checkpoint?.("orders_realtime.revoked_subscription_rejected");
  if (kds.enabled) {
    await listTickets(fixture.apiBaseUrl, context.accessToken, subscription, 403);
    kds.checkpoint?.("kds_tickets.revoked_list_rejected");
    await kds.browserHooks?.afterRevocation(fixture);
    state.kdsTicketsVerified = true;
  }
  state.verified = true;
}

function createPlan(
  fixture: TenancyVerificationLiveFixture,
  scope: BranchScope,
  useDiningTable: boolean,
  useOperationalShift: boolean,
): OrdersFixturePlan {
  const context = requireContext(fixture);
  const orderId = randomUUID();
  const orderItemId = randomUUID();
  const deviceId = randomUUID();
  const occurredAt = new Date().toISOString();
  const openShiftId = randomUUID();
  const createBase: CreateOrderCommandV1 = Object.freeze({
    channel: useDiningTable ? "table" : "counter",
    currency: context.menuCurrency,
    deviceId,
    eventId: randomUUID(),
    idempotencyKey: marker(fixture.runId, "create"),
    occurredAt,
    orderId,
    schemaVersion: 1,
    scope,
    tableId: useDiningTable ? context.diningTableId : null,
    timeZone: useOperationalShift ? "America/Hermosillo" : "America/Mexico_City",
  });
  const create: CreateOrderCommandV1 | CreateOrderCommandV2 = useOperationalShift
    ? Object.freeze({ ...createBase, schemaVersion: 2 as const, shiftId: openShiftId })
    : createBase;
  const addItem: AddOrderItemCommandV1 = Object.freeze({
    deviceId,
    eventId: randomUUID(),
    expectedVersion: 1,
    idempotencyKey: marker(fixture.runId, "add-item"),
    modifierGroups: Object.freeze([Object.freeze({
      groupId: context.menuModifierGroupId,
      selections: Object.freeze([Object.freeze({ optionId: context.menuModifierOptionId, quantity: 1 })]),
    })]),
    occurredAt,
    orderId,
    orderItemId,
    productId: context.menuProductId,
    quantity: 2,
    schemaVersion: 1,
    scope,
  });
  const statuses: readonly OrderItemForwardStatusV1[] = ["sent", "preparing", "ready", "delivered"];
  const transitions = statuses.map((to, index): TransitionOrderItemCommandV1 => Object.freeze({
    deviceId,
    eventId: randomUUID(),
    expectedVersion: 3 + index,
    idempotencyKey: marker(fixture.runId, `item-${to}`),
    occurredAt,
    orderId,
    orderItemId,
    schemaVersion: 1,
    scope,
    to,
  }));
  return Object.freeze({
    addItem,
    create,
    deviceId,
    divergentCreate: Object.freeze({
      ...create,
      channel: create.channel === "table" ? "counter" : "takeout",
      tableId: null,
    }),
    open: Object.freeze({
      deviceId,
      eventId: randomUUID(),
      expectedVersion: 2,
      idempotencyKey: marker(fixture.runId, "open"),
      occurredAt,
      orderId,
      schemaVersion: 1,
      scope,
    }),
    orderId,
    orderItemId,
    ...(useOperationalShift ? {
      operational: Object.freeze({
        closedShiftId: randomUUID(),
        foreignShiftId: randomUUID(),
        legacyCreate: Object.freeze({
          ...createBase,
          eventId: randomUUID(),
          idempotencyKey: marker(fixture.runId, "legacy-create"),
          orderId: randomUUID(),
        }),
        openShiftId,
      }),
    } : {}),
    transitions: Object.freeze(transitions),
  });
}

function newCreate(plan: OrdersFixturePlan): CreateOrderCommandV1 | CreateOrderCommandV2 {
  return Object.freeze({
    ...plan.create,
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    orderId: randomUUID(),
  });
}

async function createOperationalShiftFixtures(
  pool: Pool,
  fixture: TenancyVerificationLiveFixture,
  context: TenancyVerificationLiveFixtureContext,
  plan: OrdersFixturePlan,
): Promise<void> {
  const operational = plan.operational;
  if (operational === undefined) throw ordersError();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `insert into app.operational_shifts
        (id, restaurant_id, branch_id, name, status, opened_at, opened_by, closed_at, closed_by)
       values
        ($1::uuid, $4::uuid, $5::uuid, $8::text, 'open', clock_timestamp() - interval '5 minutes', $6::uuid, null, null),
        ($2::uuid, $4::uuid, $5::uuid, $9::text, 'closed', clock_timestamp() - interval '10 minutes', $6::uuid, clock_timestamp() - interval '1 minute', $6::uuid),
        ($3::uuid, $10::uuid, $11::uuid, $12::text, 'open', clock_timestamp() - interval '5 minutes', $7::uuid, null, null)`,
      [
        operational.openShiftId,
        operational.closedShiftId,
        operational.foreignShiftId,
        fixture.restaurantId,
        fixture.branchId,
        context.primaryUserId,
        context.secondaryUserId,
        marker(fixture.runId, "shift-open"),
        marker(fixture.runId, "shift-closed"),
        context.secondaryRestaurantId,
        context.secondaryBranchId,
        marker(fixture.runId, "shift-foreign"),
      ],
    );
    await client.query("COMMIT");
  } catch {
    await rollback(client);
    throw ordersError();
  } finally {
    client.release();
  }
}

async function verifyOperationalOrderPreconditions(
  fixture: TenancyVerificationLiveFixture,
  context: TenancyVerificationLiveFixtureContext,
  plan: OrdersFixturePlan,
  checkpoint: RunOrdersRealtimeTenancyVerificationOptions["onOrdersRealtimeCheckpoint"],
): Promise<void> {
  const operational = plan.operational;
  if (operational === undefined || plan.create.tableId === null || !("shiftId" in plan.create)) throw ordersError();
  const shifts = await getOperationalShifts(
    fixture.apiBaseUrl,
    context.accessToken,
    fixture.restaurantId,
    fixture.branchId,
    200,
  );
  const parsedShifts = parseOperationalShiftListV1(shifts);
  if (parsedShifts === undefined || parsedShifts.shifts.length !== 1
    || parsedShifts.shifts[0]?.shiftId !== operational.openShiftId
    || parsedShifts.shifts[0].status !== "open") throw ordersError();
  checkpoint?.("orders_realtime.operational_shift_list_verified");

  const empty = await getActiveOrders(
    fixture.apiBaseUrl,
    context.accessToken,
    fixture.restaurantId,
    fixture.branchId,
    plan.create.tableId,
    200,
  );
  if (empty === undefined || empty.orders.length !== 0) throw ordersError();
  checkpoint?.("orders_realtime.empty_active_orders_verified");

  await expectOrderError(
    fixture.apiBaseUrl,
    "/api/v1/orders",
    { ...newCreate(plan), shiftId: operational.closedShiftId },
    context.accessToken,
    409,
    "ORDER_CONFLICT",
  );
  checkpoint?.("orders_realtime.closed_shift_rejected");
  await expectOrderError(
    fixture.apiBaseUrl,
    "/api/v1/orders",
    { ...newCreate(plan), shiftId: operational.foreignShiftId },
    context.accessToken,
    409,
    "ORDER_CONFLICT",
  );
  checkpoint?.("orders_realtime.foreign_shift_rejected");
  await expectOrderError(
    fixture.apiBaseUrl,
    "/api/v1/orders",
    { ...plan.create, shiftId: operational.closedShiftId },
    context.accessToken,
    409,
    "ORDER_CONFLICT",
  );
  checkpoint?.("orders_realtime.shift_replay_conflict_verified");
}

async function verifyActiveOperationalOrders(
  fixture: TenancyVerificationLiveFixture,
  context: TenancyVerificationLiveFixtureContext,
  plan: OrdersFixturePlan,
  checkpoint: RunOrdersRealtimeTenancyVerificationOptions["onOrdersRealtimeCheckpoint"],
): Promise<void> {
  const operational = plan.operational;
  if (operational === undefined || plan.create.tableId === null) throw ordersError();
  const active = await getActiveOrders(
    fixture.apiBaseUrl,
    context.accessToken,
    fixture.restaurantId,
    fixture.branchId,
    plan.create.tableId,
    200,
  );
  const main = active?.orders.find((order) => order.orderId === plan.orderId);
  const item = main?.items[0];
  const modifier = item?.modifiers[0];
  if (active === undefined || active.orders.length !== 1 || main === undefined
    || main.shiftId !== operational.openShiftId || main.currency !== context.menuCurrency
    || main.itemCount !== 1 || item?.orderItemId !== plan.orderItemId || item.quantity !== 2
    || item.productId !== context.menuProductId || item.productName !== tenancyFixtureName(fixture.runId, "menu-product")
    || item.unitPrice.currency !== context.menuCurrency || !Number.isSafeInteger(item.unitPrice.amountMinor)
    || modifier?.optionId !== context.menuModifierOptionId
    || modifier.optionName !== tenancyFixtureName(fixture.runId, "menu-option")
    || modifier.unitPrice.currency !== context.menuCurrency
    || !Number.isSafeInteger(modifier.unitPrice.amountMinor)) throw ordersError();
  checkpoint?.("orders_realtime.active_snapshots_verified");

  const legacy = await mutate(
    fixture.apiBaseUrl,
    "/api/v1/orders",
    operational.legacyCreate,
    context.accessToken,
    201,
  );
  assertSummary(legacy, operational.legacyCreate.orderId, plan.create.scope, 1, "draft", false, false);
  const multiple = await getActiveOrders(
    fixture.apiBaseUrl,
    context.accessToken,
    fixture.restaurantId,
    fixture.branchId,
    plan.create.tableId,
    200,
  );
  if (multiple === undefined || multiple.orders.length !== 2) throw ordersError();
  checkpoint?.("orders_realtime.multiple_orders_verified");
  const historical = multiple.orders.find((order) => order.orderId === operational.legacyCreate.orderId);
  if (historical === undefined || historical.shiftId !== null || historical.items.length !== 0) throw ordersError();
  checkpoint?.("orders_realtime.legacy_null_shift_verified");

  await getActiveOrders(
    fixture.apiBaseUrl,
    context.accessToken,
    fixture.restaurantId,
    context.viewerBranchId,
    plan.create.tableId,
    403,
  );
  await getActiveOrders(
    fixture.apiBaseUrl,
    context.secondaryAccessToken,
    context.secondaryRestaurantId,
    context.secondaryBranchId,
    plan.create.tableId,
    403,
  );
  checkpoint?.("orders_realtime.active_scope_isolation_verified");
}

async function getOperationalShifts(
  baseUrl: string,
  accessToken: string,
  restaurantId: string,
  branchId: string,
  expectedStatus: number,
): Promise<unknown> {
  const response = await fetch(
    `${baseUrl}/api/v1/shifts/active?restaurantId=${restaurantId}&branchId=${branchId}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const body: unknown = await response.json();
  if (response.status !== expectedStatus || response.headers.get("cache-control") !== "private, no-store") {
    throw ordersError();
  }
  return body;
}

async function getActiveOrders(
  baseUrl: string,
  accessToken: string,
  restaurantId: string,
  branchId: string,
  tableId: string,
  expectedStatus: number,
): Promise<ReturnType<typeof parseActiveTableOrderListV2>> {
  const response = await fetch(
    `${baseUrl}/api/v1/orders/active?restaurantId=${restaurantId}&branchId=${branchId}&tableId=${tableId}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const body: unknown = await response.json();
  if (response.status !== expectedStatus || response.headers.get("cache-control") !== "private, no-store") {
    throw ordersError();
  }
  if (expectedStatus !== 200) return undefined;
  const parsed = parseActiveTableOrderListV2(body);
  if (parsed === undefined) throw ordersError();
  return parsed;
}

async function cleanupOrdersFixture(
  pool: Pool,
  fixture: TenancyVerificationLiveFixture,
  state: OrdersRuntimeState,
  checkpoint: RunOrdersRealtimeTenancyVerificationOptions["onOrdersRealtimeCheckpoint"],
  journeyHooks: OrderJourneyHooks | undefined,
): Promise<void> {
  state.mainSocket?.disconnect();
  if (state.journey !== undefined) await journeyHooks?.cleanup(state.journey);
  const plan = state.plan;
  if (plan === undefined) return;
  const context = requireContext(fixture);
  const orderIds = [plan.orderId, ...(plan.operational === undefined ? [] : [plan.operational.legacyCreate.orderId])];
  const shiftIds = plan.operational === undefined
    ? []
    : [plan.operational.openShiftId, plan.operational.closedShiftId, plan.operational.foreignShiftId];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateCleanupOwnership(client, fixture, context.primaryUserId, plan);
    await client.query("delete from app.kds_events where order_id = any($1::uuid[])", [orderIds]);
    await client.query("delete from app.order_audit_events where order_id = any($1::uuid[])", [orderIds]);
    if (plan.operational !== undefined) {
      await client.query("delete from app.order_operational_shifts where order_id = any($1::uuid[])", [orderIds]);
    }
    await client.query("delete from app.orders where id = any($1::uuid[])", [orderIds]);
    await client.query("delete from app_private.kds_branch_cursors where restaurant_id = $1::uuid and branch_id = $2::uuid", [fixture.restaurantId, fixture.branchId]);
    if (plan.operational !== undefined) {
      await client.query("delete from app.operational_shifts where id = any($1::uuid[])", [shiftIds]);
    }
    await client.query("COMMIT");
  } catch (error: unknown) {
    await rollback(client);
    if (error instanceof TenancyVerificationError) throw error;
    throw ordersError("cleanup");
  } finally {
    client.release();
  }
  const remaining = plan.operational === undefined
    ? await pool.query<{ count: string }>(
      `select (
        (select count(*) from app.orders where id = any($1::uuid[]))
        + (select count(*) from app.order_audit_events where order_id = any($1::uuid[]))
        + (select count(*) from app.kds_events where order_id = any($1::uuid[]))
        + (select count(*) from app_private.kds_branch_cursors where restaurant_id = $2::uuid and branch_id = $3::uuid)
      )::text as count`,
      [orderIds, fixture.restaurantId, fixture.branchId],
    )
    : await pool.query<{ count: string }>(
      `select (
        (select count(*) from app.orders where id = any($1::uuid[]))
        + (select count(*) from app.order_audit_events where order_id = any($1::uuid[]))
        + (select count(*) from app.kds_events where order_id = any($1::uuid[]))
        + (select count(*) from app_private.kds_branch_cursors where restaurant_id = $2::uuid and branch_id = $3::uuid)
        + (select count(*) from app.order_operational_shifts where order_id = any($1::uuid[]))
        + (select count(*) from app.operational_shifts where id = any($4::uuid[]))
      )::text as count`,
      [orderIds, fixture.restaurantId, fixture.branchId, shiftIds],
    );
  if (remaining.rows[0]?.count !== "0") throw ordersError("cleanup");
  checkpoint?.("orders_realtime.cleanup_verified");
}

async function validateCleanupOwnership(
  client: PoolClient,
  fixture: TenancyVerificationLiveFixture,
  actorId: string,
  plan: OrdersFixturePlan,
): Promise<void> {
  await validateOperationalCleanupOwnership(client, fixture, actorId, plan);
  const orders = await client.query<{ actorId: string; branchId: string; id: string; restaurantId: string; status: string; version: number }>(
    `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
            created_by::text as "actorId", status, version::integer
     from app.orders where id = $1::uuid for update`,
    [plan.orderId],
  );
  const audits = await client.query<{ actorId: string; eventId: string; idempotencyKey: string; resultVersion: number }>(
    `select event_id::text as "eventId", actor_id::text as "actorId",
            idempotency_key as "idempotencyKey", result_order_version::integer as "resultVersion"
     from app.order_audit_events where order_id = $1::uuid order by result_order_version for update`,
    [plan.orderId],
  );
  const kds = await client.query<{ eventId: string }>(
    `select event_id::text as "eventId" from app.kds_events where order_id = $1::uuid order by cursor for update`,
    [plan.orderId],
  );
  if (orders.rows.length === 0) {
    if (audits.rows.length !== 0 || kds.rows.length !== 0) throw ordersError("cleanup");
    return;
  }
  const order = orders.rows[0];
  const expectedCommands = [plan.create, plan.addItem, plan.open, ...plan.transitions];
  if (orders.rows.length !== 1 || order?.restaurantId !== fixture.restaurantId || order.branchId !== fixture.branchId
    || order.actorId !== actorId || order.version < 1 || order.version > expectedCommands.length + 2
    || order.status !== (order.version < 3 ? "draft" : order.version < 8 ? "open" : order.version === 8 ? "partially_paid" : "paid")
    || audits.rows.length !== Math.min(order.version, expectedCommands.length)) throw ordersError("cleanup");
  for (const [index, audit] of audits.rows.entries()) {
    const command = expectedCommands[index];
    if (command === undefined || audit.resultVersion !== index + 1 || audit.actorId !== actorId
      || audit.eventId !== command.eventId || audit.idempotencyKey !== command.idempotencyKey) throw ordersError("cleanup");
  }
  const expectedKdsEventIds = [plan.addItem.eventId, ...plan.transitions.map((command) => command.eventId)]
    .filter((eventId) => audits.rows.some((audit) => audit.eventId === eventId));
  if (kds.rows.length !== expectedKdsEventIds.length
    || kds.rows.some((row, index) => row.eventId !== expectedKdsEventIds[index])) throw ordersError("cleanup");

  if (plan.operational !== undefined) {
    const legacy = await client.query<{ actorId: string; auditCount: string; eventId: string; idempotencyKey: string; status: string; version: number }>(
      `select o.created_by::text as "actorId", o.status, o.version::integer,
         count(a.event_id)::text as "auditCount", min(a.event_id)::text as "eventId",
         min(a.idempotency_key)::text as "idempotencyKey"
       from app.orders o left join app.order_audit_events a on a.order_id=o.id
       where o.id=$1::uuid group by o.id`,
      [plan.operational.legacyCreate.orderId],
    );
    const row = legacy.rows[0];
    if (legacy.rows.length > 1 || (row !== undefined && (
      row.actorId !== actorId || row.status !== "draft" || row.version !== 1 || row.auditCount !== "1"
      || row.eventId !== plan.operational.legacyCreate.eventId
      || row.idempotencyKey !== plan.operational.legacyCreate.idempotencyKey
    ))) throw ordersError("cleanup");
  }
}

async function validateOperationalCleanupOwnership(
  client: PoolClient,
  fixture: TenancyVerificationLiveFixture,
  actorId: string,
  plan: OrdersFixturePlan,
): Promise<void> {
  const operational = plan.operational;
  if (operational === undefined) return;
  const shifts = await client.query<{ branchId: string; closedBy: string | null; id: string; name: string; openedBy: string; restaurantId: string; status: string }>(
    `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId", name, status,
       opened_by::text as "openedBy", closed_by::text as "closedBy"
     from app.operational_shifts where id=any($1::uuid[]) for update`,
    [[operational.openShiftId, operational.closedShiftId, operational.foreignShiftId]],
  );
  const context = requireContext(fixture);
  const expected = new Map<string, readonly [string, string, string, string, string, string | null]>([
    [operational.openShiftId, [fixture.restaurantId, fixture.branchId, marker(fixture.runId, "shift-open"), "open", actorId, null]],
    [operational.closedShiftId, [fixture.restaurantId, fixture.branchId, marker(fixture.runId, "shift-closed"), "closed", actorId, actorId]],
    [operational.foreignShiftId, [context.secondaryRestaurantId, context.secondaryBranchId, marker(fixture.runId, "shift-foreign"), "open", context.secondaryUserId, null]],
  ]);
  if (shifts.rows.length !== expected.size) throw ordersError("cleanup");
  for (const row of shifts.rows) {
    const value = expected.get(row.id);
    if (value === undefined || JSON.stringify([
      row.restaurantId, row.branchId, row.name, row.status, row.openedBy, row.closedBy,
    ]) !== JSON.stringify(value)) throw ordersError("cleanup");
  }
  const links = await client.query<{ actorId: string; orderId: string; shiftId: string }>(
    `select order_id::text as "orderId", shift_id::text as "shiftId", linked_by::text as "actorId"
     from app.order_operational_shifts where order_id=any($1::uuid[]) for update`,
    [[plan.orderId, operational.legacyCreate.orderId]],
  );
  if (links.rows.length > 1 || (links.rows[0] !== undefined && (
    links.rows[0].orderId !== plan.orderId || links.rows[0].shiftId !== operational.openShiftId
    || links.rows[0].actorId !== actorId
  ))) throw ordersError("cleanup");
}

async function verifyOrderDataApiDenied(
  config: TenancyVerificationConfig,
  accessToken: string,
  verifyOperationalOrders: boolean,
): Promise<void> {
  const clients = [
    createClient(config.supabaseUrl, config.publishableKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }),
    createClient(config.supabaseUrl, config.publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    createClient(config.supabaseUrl, config.secretKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }),
  ];
  for (const client of clients) {
    for (const table of [
      "orders",
      "order_audit_events",
      "kds_events",
      ...(verifyOperationalOrders ? ["operational_shifts", "order_operational_shifts"] as const : []),
    ] as const) {
      const result = await client.schema("app").from(table).select("*").limit(1);
      if (result.data !== null || result.error?.code !== "42501") throw ordersError();
    }
  }
}

async function assertPersistenceEmpty(context: NonNullable<TenancyVerificationLiveFixture["verificationContext"]>, pool: Pool, plan: OrdersFixturePlan): Promise<void> {
  const result = await pool.query<{ count: string }>(
    `select ((select count(*) from app.orders where id = $1::uuid) + (select count(*) from app.order_audit_events where event_id = $2::uuid))::text as count`,
    [plan.orderId, plan.create.eventId],
  );
  if (context.primaryUserId.length === 0 || result.rows[0]?.count !== "0") throw ordersError();
}

async function assertPersistence(context: NonNullable<TenancyVerificationLiveFixture["verificationContext"]>, pool: Pool, plan: OrdersFixturePlan): Promise<void> {
  const result = await pool.query<{ actorId: string; auditCount: string; itemStatus: string; kdsCount: string; status: string; version: string }>(
    `select o.created_by::text as "actorId", o.status, o.version::text,
      o.aggregate #>> '{items,0,status}' as "itemStatus",
      (select count(*)::text from app.order_audit_events a where a.order_id = o.id) as "auditCount",
      (select count(*)::text from app.kds_events k where k.order_id = o.id) as "kdsCount"
     from app.orders o where o.id = $1::uuid`,
    [plan.orderId],
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row?.actorId !== context.primaryUserId || row.status !== "open" || row.version !== "7" || row.itemStatus !== "delivered" || row.auditCount !== "7" || row.kdsCount !== "5") throw ordersError();
}

async function mutate(baseUrl: string, path: string, body: unknown, accessToken: string, expectedStatus: number): Promise<unknown> {
  const response = await timedFetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    method: "POST",
  });
  const result: unknown = await response.json();
  if (response.status !== expectedStatus) throw ordersError();
  return result;
}

async function expectStatus(baseUrl: string, path: string, body: unknown, accessToken: string | undefined, expectedStatus: number): Promise<void> {
  const response = await timedFetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }), "content-type": "application/json" },
    method: "POST",
  });
  await response.arrayBuffer();
  if (response.status !== expectedStatus) throw ordersError();
}

async function expectOrderError(baseUrl: string, path: string, body: unknown, accessToken: string, status: number, code: string): Promise<void> {
  const response = await timedFetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    method: "POST",
  });
  const result: unknown = await response.json();
  if (response.status !== status || !isExactCode(result, code)) throw ordersError();
}

async function recover(baseUrl: string, accessToken: string, subscription: RealtimeSubscriptionV1, after: string, limit: number, expectedStatus: number) {
  const query = new URLSearchParams({
    after,
    branchId: subscription.scope.branchId,
    limit: String(limit),
    restaurantId: subscription.scope.restaurantId,
    stationId: subscription.stationId,
  });
  const response = await timedFetch(`${baseUrl}/api/v1/kds/events?${query.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const result: unknown = await response.json();
  if (response.status !== expectedStatus) throw ordersError();
  if (expectedStatus !== 200) {
    if (!isExactCode(result, "ACTION_NOT_AUTHORIZED")) throw ordersError();
    return { events: [], hasMore: false, nextCursor: KDS_INITIAL_CURSOR } as const;
  }
  const parsed = parseKdsEventPageV1(result);
  if (parsed === undefined) throw ordersError();
  return parsed;
}

async function listTickets(
  baseUrl: string,
  accessToken: string | undefined,
  subscription: RealtimeSubscriptionV1,
  expectedStatus: 200 | 401 | 403,
): Promise<KdsTicketListV1 | undefined> {
  const query = new URLSearchParams({
    branchId: subscription.scope.branchId,
    restaurantId: subscription.scope.restaurantId,
    stationId: subscription.stationId,
  });
  const response = await timedFetch(`${baseUrl}/api/v1/kds/tickets?${query.toString()}`, {
    headers: accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` },
  });
  const result: unknown = await response.json();
  if (response.status !== expectedStatus) throw ordersError();
  if (expectedStatus !== 200) {
    const expectedCode = expectedStatus === 401 ? "AUTHENTICATION_REQUIRED" : "ACTION_NOT_AUTHORIZED";
    if (!isExactCode(result, expectedCode)) throw ordersError();
    return undefined;
  }
  if (response.headers.get("cache-control") !== "private, no-store") throw ordersError();
  const parsed = parseKdsTicketListV1(result);
  if (parsed === undefined) throw ordersError();
  return parsed;
}

function assertTicketList(
  list: KdsTicketListV1 | undefined,
  subscription: RealtimeSubscriptionV1,
  plan: OrdersFixturePlan,
  runId: string,
  expectedStatus: "sent" | "preparing" | "ready" | undefined,
  expectedVersion: number | undefined,
): void {
  if (list === undefined
    || !sameScope(list.scope, subscription.scope)
    || list.stationId !== subscription.stationId
    || list.truncated) throw ordersError();
  if (expectedStatus === undefined) {
    if (list.tickets.length !== 0) throw ordersError();
    return;
  }
  const ticket = list.tickets[0];
  const modifier = ticket?.modifiers[0];
  if (list.tickets.length !== 1
    || ticket === undefined
    || ticket.orderId !== plan.orderId
    || ticket.orderItemId !== plan.orderItemId
    || ticket.orderVersion !== expectedVersion
    || ticket.channel !== plan.create.channel
    || ticket.tableId !== plan.create.tableId
    || ticket.quantity !== 2
    || ticket.productName !== tenancyFixtureName(runId, "menu-product")
    || ticket.modifiers.length !== 1
    || modifier?.name !== tenancyFixtureName(runId, "menu-option")
    || modifier.quantity !== 1
    || ticket.status !== expectedStatus
    || ticket.stationId !== subscription.stationId
    || !sameScope(ticket.scope, subscription.scope)) throw ordersError();
}

async function verifyKdsTicketIsolation(
  fixture: TenancyVerificationLiveFixture,
  subscription: RealtimeSubscriptionV1,
  plan: OrdersFixturePlan,
  kds: KdsVerificationMode,
): Promise<void> {
  const context = requireContext(fixture);
  const wrongStation = subscriptionFor(subscription.scope, "bar");
  assertTicketList(
    await listTickets(fixture.apiBaseUrl, context.accessToken, wrongStation, 200),
    wrongStation,
    plan,
    fixture.runId,
    undefined,
    undefined,
  );
  kds.checkpoint?.("kds_tickets.station_isolation_verified");

  const viewerBranch = subscriptionFor(
    branchScope(fixture.restaurantId, context.viewerBranchId),
    STATION_ID,
  );
  assertTicketList(
    await listTickets(fixture.apiBaseUrl, context.accessToken, viewerBranch, 200),
    viewerBranch,
    plan,
    fixture.runId,
    undefined,
    undefined,
  );
  kds.checkpoint?.("kds_tickets.branch_isolation_verified");

  const secondary = subscriptionFor(
    branchScope(context.secondaryRestaurantId, context.secondaryBranchId),
    STATION_ID,
  );
  assertTicketList(
    await listTickets(fixture.apiBaseUrl, context.secondaryAccessToken, secondary, 200),
    secondary,
    plan,
    fixture.runId,
    undefined,
    undefined,
  );
  await listTickets(fixture.apiBaseUrl, context.accessToken, secondary, 403);
  await listTickets(
    fixture.apiBaseUrl,
    context.accessToken,
    subscriptionFor(branchScope(fixture.restaurantId, context.secondaryBranchId), STATION_ID),
    403,
  );
  kds.checkpoint?.("kds_tickets.tenant_isolation_verified");
}

function assertSummary(value: unknown, orderId: string, scope: BranchScope, version: number, orderStatus: string, replayed: boolean, hasKdsEvent: boolean): asserts value is OrderMutationSummaryV1 {
  if (!isRecord(value)) throw ordersError();
  const keys = Object.keys(value).sort();
  const expectedKeys = ["kdsEvent", "orderId", "orderStatus", "replayed", "schemaVersion", "scope", "version"].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    || value.schemaVersion !== 1 || value.orderId !== orderId || value.orderStatus !== orderStatus
    || value.replayed !== replayed || value.version !== version || !sameScope(value.scope, scope)
    || (hasKdsEvent ? value.kdsEvent === null : value.kdsEvent !== null)) throw ordersError();
}

async function connectSocket(baseUrl: string, accessToken: string): Promise<Socket> {
  const socket = io(`${baseUrl}${REALTIME_NAMESPACE}`, {
    auth: { accessToken },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(ordersError()), SOCKET_TIMEOUT_MS);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", () => { clearTimeout(timer); reject(ordersError()); });
  }).catch((error: unknown) => { socket.disconnect(); throw error; });
  return socket;
}

async function subscribe(socket: Socket, subscription: RealtimeSubscriptionV1): Promise<unknown> {
  return socket.timeout(SOCKET_TIMEOUT_MS).emitWithAck(REALTIME_SUBSCRIBE_EVENT, subscription);
}

async function waitForNotification(socket: Socket): Promise<RealtimeNotificationV1> {
  return new Promise<RealtimeNotificationV1>((resolve, reject) => {
    const timer = setTimeout(() => reject(ordersError()), SOCKET_TIMEOUT_MS);
    socket.once(REALTIME_NOTIFICATION_EVENT, (value: unknown) => {
      clearTimeout(timer);
      const parsed = parseRealtimeNotificationV1(value);
      if (parsed === undefined) reject(ordersError());
      else resolve(parsed);
    });
  });
}

async function verifyDuplicateSubscription(baseUrl: string, accessToken: string, subscription: RealtimeSubscriptionV1): Promise<void> {
  const socket = await connectSocket(baseUrl, accessToken);
  try {
    if (parseRealtimeSubscriptionAckV1(await subscribe(socket, subscription)) === undefined) throw ordersError();
    await expectSubscriptionDisconnect(socket, subscription);
  } finally {
    socket.disconnect();
  }
}

async function expectSubscriptionDisconnect(socket: Socket, subscription: RealtimeSubscriptionV1): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(ordersError()), SOCKET_TIMEOUT_MS);
    socket.once("disconnect", () => { clearTimeout(timer); resolve(); });
    socket.emit(REALTIME_SUBSCRIBE_EVENT, subscription, () => {
      clearTimeout(timer);
      reject(ordersError());
    });
  });
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch { throw ordersError(); }
  finally { clearTimeout(timer); }
}

function createPool(config: DatabaseConfig): Pool {
  return new Pool({
    application_name: "super-restaurant-orders-e2e",
    connectionString: config.connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    max: 2,
    query_timeout: 10_000,
    ssl: { ca: config.caCertificate, rejectUnauthorized: true },
    statement_timeout: 10_000,
  });
}

function requireContext(fixture: TenancyVerificationLiveFixture): NonNullable<TenancyVerificationLiveFixture["verificationContext"]> {
  if (fixture.verificationContext === undefined) throw ordersError();
  return fixture.verificationContext;
}

function branchScope(restaurantId: string, branchId: string): BranchScope {
  return Object.freeze({ branchId, restaurantId }) as BranchScope;
}

function subscriptionFor(scope: BranchScope, stationId: string): RealtimeSubscriptionV1 {
  return Object.freeze({ schemaVersion: 1, scope, stationId });
}

function marker(runId: string, operation: string): string {
  return `tenancy-orders-v1:${runId}:${operation}`;
}

function sameScope(value: unknown, expected: BranchScope): boolean {
  return isRecord(value) && value.restaurantId === expected.restaurantId && value.branchId === expected.branchId && Object.keys(value).length === 2;
}

function isExactCode(value: unknown, code: string): boolean {
  return isRecord(value) && Object.keys(value).length === 1 && value.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ordersError(stage: "orders_realtime" | "cleanup" = "orders_realtime"): TenancyVerificationError {
  return new TenancyVerificationError(stage, stage === "cleanup" ? "TENANCY_VERIFICATION_CLEANUP_FAILED" : "TENANCY_VERIFICATION_ORDERS_REALTIME_FAILED");
}

async function rollback(client: PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); } catch { /* stable cleanup failure is emitted by the caller */ }
}
