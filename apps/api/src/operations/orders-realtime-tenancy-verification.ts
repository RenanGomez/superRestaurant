import { randomUUID } from "node:crypto";

import {
  KDS_INITIAL_CURSOR,
  REALTIME_NAMESPACE,
  REALTIME_NOTIFICATION_EVENT,
  REALTIME_SUBSCRIBE_EVENT,
  parseKdsEventPageV1,
  parseRealtimeNotificationV1,
  parseRealtimeSubscriptionAckV1,
  type AddOrderItemCommandV1,
  type BranchScope,
  type CreateOrderCommandV1,
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
import {
  runTenancyVerification,
  type RunTenancyVerificationOptions,
  type TenancyVerificationLiveFixture,
  type TenancyVerificationSummary,
} from "./tenancy-verification.js";

const STATION_ID = "kitchen";
const HTTP_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 5_000;

export interface RunOrdersRealtimeTenancyVerificationOptions
  extends Omit<RunTenancyVerificationOptions, "liveFixtureHooks" | "verifyMenuCatalog" | "verifyOrdersRealtime"> {
  readonly onOrdersRealtimeCheckpoint?: (checkpoint: OrdersRealtimeVerificationCheckpoint) => void;
}

export interface OrdersRealtimeTenancyVerificationSummary extends TenancyVerificationSummary {
  readonly ordersRealtimeVerified: true;
}

interface OrdersFixturePlan {
  readonly addItem: AddOrderItemCommandV1;
  readonly create: CreateOrderCommandV1;
  readonly deviceId: string;
  readonly divergentCreate: CreateOrderCommandV1;
  readonly open: OpenOrderCommandV1;
  readonly orderId: string;
  readonly orderItemId: string;
  readonly transitions: readonly TransitionOrderItemCommandV1[];
}

interface OrdersRuntimeState {
  fixture?: TenancyVerificationLiveFixture;
  mainSocket?: Socket;
  plan?: OrdersFixturePlan;
  verified: boolean;
}

export async function runOrdersRealtimeTenancyVerification(
  options: RunOrdersRealtimeTenancyVerificationOptions,
): Promise<OrdersRealtimeTenancyVerificationSummary> {
  const state: OrdersRuntimeState = { verified: false };
  const pool = createPool(options.config.adminDatabase);
  try {
    const summary = await runTenancyVerification({
      ...options,
      liveFixtureHooks: {
        afterRevocation: async (fixture) => verifyAfterRevocation(fixture, state, options.onOrdersRealtimeCheckpoint),
        beforeRevocation: async (fixture) => verifyBeforeRevocation(fixture, state, pool, options.config, options.onOrdersRealtimeCheckpoint),
        cleanup: async (fixture) => cleanupOrdersFixture(pool, fixture, state, options.onOrdersRealtimeCheckpoint),
      },
      verifyMenuCatalog: true,
      verifyOrdersRealtime: true,
    });
    if (!state.verified) throw ordersError();
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
): Promise<void> {
  const context = requireContext(fixture);
  const scope = branchScope(fixture.restaurantId, fixture.branchId);
  const plan = createPlan(fixture, scope);
  state.fixture = fixture;
  state.plan = plan;

  await verifyOrderDataApiDenied(config, context.accessToken);

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
  const subscription = subscriptionFor(scope, STATION_ID);
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

  const opened = await mutate(fixture.apiBaseUrl, "/api/v1/orders/open", plan.open, context.accessToken, 201);
  assertSummary(opened, plan.orderId, scope, 3, "open", false, false);
  checkpoint?.("orders_realtime.order_opened");

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
}

async function verifyAfterRevocation(
  fixture: TenancyVerificationLiveFixture,
  state: OrdersRuntimeState,
  checkpoint: RunOrdersRealtimeTenancyVerificationOptions["onOrdersRealtimeCheckpoint"],
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
  state.verified = true;
}

function createPlan(fixture: TenancyVerificationLiveFixture, scope: BranchScope): OrdersFixturePlan {
  const context = requireContext(fixture);
  const orderId = randomUUID();
  const orderItemId = randomUUID();
  const deviceId = randomUUID();
  const occurredAt = new Date().toISOString();
  const create: CreateOrderCommandV1 = Object.freeze({
    channel: "counter",
    currency: "MXN",
    deviceId,
    eventId: randomUUID(),
    idempotencyKey: marker(fixture.runId, "create"),
    occurredAt,
    orderId,
    schemaVersion: 1,
    scope,
    tableId: null,
    timeZone: "America/Mexico_City",
  });
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
    divergentCreate: Object.freeze({ ...create, channel: "takeout" }),
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
    transitions: Object.freeze(transitions),
  });
}

function newCreate(plan: OrdersFixturePlan): CreateOrderCommandV1 {
  return Object.freeze({
    ...plan.create,
    eventId: randomUUID(),
    idempotencyKey: randomUUID(),
    orderId: randomUUID(),
  });
}

async function cleanupOrdersFixture(
  pool: Pool,
  fixture: TenancyVerificationLiveFixture,
  state: OrdersRuntimeState,
  checkpoint: RunOrdersRealtimeTenancyVerificationOptions["onOrdersRealtimeCheckpoint"],
): Promise<void> {
  state.mainSocket?.disconnect();
  const plan = state.plan;
  if (plan === undefined) return;
  const context = requireContext(fixture);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateCleanupOwnership(client, fixture, context.primaryUserId, plan);
    await client.query("delete from app.kds_events where order_id = $1::uuid and restaurant_id = $2::uuid and branch_id = $3::uuid", [plan.orderId, fixture.restaurantId, fixture.branchId]);
    await client.query("delete from app.order_audit_events where order_id = $1::uuid and restaurant_id = $2::uuid and branch_id = $3::uuid", [plan.orderId, fixture.restaurantId, fixture.branchId]);
    await client.query("delete from app.orders where id = $1::uuid and restaurant_id = $2::uuid and branch_id = $3::uuid", [plan.orderId, fixture.restaurantId, fixture.branchId]);
    await client.query("delete from app_private.kds_branch_cursors where restaurant_id = $1::uuid and branch_id = $2::uuid", [fixture.restaurantId, fixture.branchId]);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await rollback(client);
    if (error instanceof TenancyVerificationError) throw error;
    throw ordersError("cleanup");
  } finally {
    client.release();
  }
  const remaining = await pool.query<{ count: string }>(
    `select (
      (select count(*) from app.orders where id = $1::uuid)
      + (select count(*) from app.order_audit_events where order_id = $1::uuid)
      + (select count(*) from app.kds_events where order_id = $1::uuid)
      + (select count(*) from app_private.kds_branch_cursors where restaurant_id = $2::uuid and branch_id = $3::uuid)
    )::text as count`,
    [plan.orderId, fixture.restaurantId, fixture.branchId],
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
  const orders = await client.query<{ actorId: string; branchId: string; id: string; restaurantId: string; version: number }>(
    `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId",
            created_by::text as "actorId", version::integer
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
    || order.actorId !== actorId || order.version < 1 || order.version > expectedCommands.length
    || audits.rows.length !== order.version) throw ordersError("cleanup");
  for (const [index, audit] of audits.rows.entries()) {
    const command = expectedCommands[index];
    if (command === undefined || audit.resultVersion !== index + 1 || audit.actorId !== actorId
      || audit.eventId !== command.eventId || audit.idempotencyKey !== command.idempotencyKey) throw ordersError("cleanup");
  }
  const expectedKdsEventIds = [plan.addItem.eventId, ...plan.transitions.map((command) => command.eventId)]
    .filter((eventId) => audits.rows.some((audit) => audit.eventId === eventId));
  if (kds.rows.length !== expectedKdsEventIds.length
    || kds.rows.some((row, index) => row.eventId !== expectedKdsEventIds[index])) throw ordersError("cleanup");
}

async function verifyOrderDataApiDenied(config: TenancyVerificationConfig, accessToken: string): Promise<void> {
  const clients = [
    createClient(config.supabaseUrl, config.publishableKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }),
    createClient(config.supabaseUrl, config.publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
    createClient(config.supabaseUrl, config.secretKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } }),
  ];
  for (const client of clients) {
    for (const table of ["orders", "order_audit_events", "kds_events"] as const) {
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
