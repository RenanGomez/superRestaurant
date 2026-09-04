import { randomUUID } from "node:crypto";

import {
  parseCashRegisterOperationalReportV1,
  parseCashRegisterSummaryV1,
  parseCheckoutOrderSummaryV1,
  parsePaymentCollectionSummaryV1,
  type BranchScope,
  type CashRegisterOperationalReportV1,
  type CloseCashRegisterCommandV1,
  type CollectPaymentCommandV1,
  type OpenCashRegisterCommandV1,
} from "@super-restaurant/shared-types";
import { Pool, type PoolClient } from "pg";

import type { DatabaseConfig } from "../database.js";
import {
  runKdsTenancyVerification,
  type KdsTenancyVerificationSummary,
  type OrderJourneyContext,
  type OrderJourneyHooks,
  type RunKdsTenancyVerificationOptions,
} from "./orders-realtime-tenancy-verification.js";
import { tenancyFixtureName } from "./tenancy-fixture-markers.js";
import { TenancyVerificationError } from "./tenancy-verification-config.js";

const HTTP_TIMEOUT_MS = 5_000;
const OPENING_FLOAT_MINOR = 10_000;
const CLOSE_DIFFERENCE_MINOR = 1;

export type FullPosFlowVerificationCheckpoint =
  | "full_flow.register_opened"
  | "full_flow.register_open_replayed"
  | "full_flow.register_resumed"
  | "full_flow.checkout_loaded"
  | "full_flow.overpayment_rejected"
  | "full_flow.scope_rejected"
  | "full_flow.cash_partial_captured"
  | "full_flow.cash_partial_replayed"
  | "full_flow.card_manual_settled"
  | "full_flow.card_manual_replayed"
  | "full_flow.account_and_table_closed"
  | "full_flow.x_report_read_only"
  | "full_flow.z_close_immutable"
  | "full_flow.order_history_verified"
  | "full_flow.payment_history_verified"
  | "full_flow.financial_audit_verified"
  | "full_flow.audit_and_history_verified"
  | "full_flow.cleanup_verified";

export interface RunFullPosFlowTenancyVerificationOptions
  extends Omit<RunKdsTenancyVerificationOptions, "journeyHooks" | "useDiningTable" | "verifyDiningTables"> {
  readonly onFullPosFlowCheckpoint?: (checkpoint: FullPosFlowVerificationCheckpoint) => void;
}

export interface FullPosFlowTenancyVerificationSummary extends KdsTenancyVerificationSummary {
  readonly fullPosFlowVerified: true;
}

interface FinancialPlan {
  readonly cardPaymentId: string;
  readonly cashPaymentId: string;
  readonly cashRegisterSessionId: string;
  readonly closeEventId: string;
  readonly deviceId: string;
  readonly registerId: string;
  readonly shiftId: string;
}

interface FinancialJourneyState {
  context?: OrderJourneyContext;
  plan?: FinancialPlan;
  verified: boolean;
}

export async function runFullPosFlowTenancyVerification(
  options: RunFullPosFlowTenancyVerificationOptions,
): Promise<FullPosFlowTenancyVerificationSummary> {
  const pool = createPool(options.config.adminDatabase);
  const state: FinancialJourneyState = { verified: false };
  const hooks = createFinancialJourneyHooks(pool, state, options.onFullPosFlowCheckpoint);
  try {
    const summary = await runKdsTenancyVerification({
      ...options,
      journeyHooks: hooks,
      useDiningTable: true,
      verifyDiningTables: true,
      verifyFinancials: true,
    });
    if (!state.verified) throw flowError();
    return Object.freeze({ ...summary, fullPosFlowVerified: true });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function createFinancialJourneyHooks(
  pool: Pool,
  state: FinancialJourneyState,
  checkpoint: RunFullPosFlowTenancyVerificationOptions["onFullPosFlowCheckpoint"],
): OrderJourneyHooks {
  return Object.freeze({
    afterDelivery: async (context: OrderJourneyContext) => {
      state.context = context;
      state.plan = createFinancialPlan(context);
      await verifyFinancialJourney(pool, context, state.plan, checkpoint);
      state.verified = true;
    },
    cleanup: async (context: OrderJourneyContext) => {
      await cleanupFinancialJourney(pool, context, state.plan);
      checkpoint?.("full_flow.cleanup_verified");
    },
  });
}

function createFinancialPlan(context: OrderJourneyContext): FinancialPlan {
  return Object.freeze({
    cardPaymentId: randomUUID(),
    cashPaymentId: randomUUID(),
    cashRegisterSessionId: randomUUID(),
    closeEventId: randomUUID(),
    deviceId: context.deviceId,
    registerId: randomUUID(),
    shiftId: randomUUID(),
  });
}

async function verifyFinancialJourney(
  pool: Pool,
  context: OrderJourneyContext,
  plan: FinancialPlan,
  checkpoint: RunFullPosFlowTenancyVerificationOptions["onFullPosFlowCheckpoint"],
): Promise<void> {
  const fixtureContext = requireFixtureContext(context);
  const scope = branchScope(context.fixture.restaurantId, context.fixture.branchId);
  const occurredAt = new Date().toISOString();
  const openCommand: OpenCashRegisterCommandV1 = Object.freeze({
    cashRegisterSessionId: plan.cashRegisterSessionId,
    currency: context.currency,
    deviceId: plan.deviceId,
    eventId: randomUUID(),
    idempotencyKey: marker(context.fixture.runId, "register-open"),
    occurredAt,
    openingFloatMinor: OPENING_FLOAT_MINOR,
    registerId: plan.registerId,
    schemaVersion: 1,
    scope,
    shiftId: plan.shiftId,
  });

  await expectFinancialError(context.fixture.apiBaseUrl, "/api/v1/cash-registers/open", openCommand, undefined, 401, "AUTHENTICATION_REQUIRED");
  const opened = parseCashRegisterSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/cash-registers/open", openCommand, fixtureContext.accessToken, 201));
  if (opened === undefined || opened.replayed || opened.status !== "open" || opened.version !== 1
    || opened.currency !== context.currency || opened.openingFloatMinor !== OPENING_FLOAT_MINOR
    || !sameScope(opened.scope, scope)) throw flowError();
  checkpoint?.("full_flow.register_opened");

  const openReplay = parseCashRegisterSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/cash-registers/open", openCommand, fixtureContext.accessToken, 201));
  if (openReplay === undefined || !openReplay.replayed || openReplay.version !== opened.version) throw flowError();
  checkpoint?.("full_flow.register_open_replayed");

  const resumed = await getReport(context.fixture.apiBaseUrl, fixtureContext.accessToken, scope, plan, null, 200);
  if (resumed === undefined || resumed.register.cashRegisterSessionId !== plan.cashRegisterSessionId
    || resumed.register.version !== 1 || resumed.paymentCount !== 0 || resumed.nextLocalSequence !== 1) throw flowError();
  checkpoint?.("full_flow.register_resumed");

  const checkout = await getCheckout(context.fixture.apiBaseUrl, fixtureContext.accessToken, scope, plan, context.orderId, 200);
  if (checkout === undefined || checkout.orderVersion !== context.orderVersion || checkout.orderStatus !== "open"
    || checkout.currency !== context.currency || checkout.remainingBalanceMinor !== checkout.orderTotalMinor
    || checkout.orderTotalMinor <= 1) throw flowError();
  checkpoint?.("full_flow.checkout_loaded");

  const overpayment = paymentCommand(context, plan, checkout, checkout.remainingBalanceMinor + 1, "cash", randomUUID(), "overpayment");
  await expectFinancialError(context.fixture.apiBaseUrl, "/api/v1/payments/collect", overpayment, fixtureContext.accessToken, 409, "FINANCIAL_CONFLICT");
  checkpoint?.("full_flow.overpayment_rejected");

  const wrongScope = Object.freeze({ ...openCommand, eventId: randomUUID(), idempotencyKey: marker(context.fixture.runId, "wrong-scope"), scope: branchScope(fixtureContext.secondaryRestaurantId, fixtureContext.secondaryBranchId) });
  await expectFinancialError(context.fixture.apiBaseUrl, "/api/v1/cash-registers/open", wrongScope, fixtureContext.accessToken, 403, "ACTION_NOT_AUTHORIZED");
  checkpoint?.("full_flow.scope_rejected");

  const cashAmount = Math.floor(checkout.orderTotalMinor / 2);
  const cashCommand = paymentCommand(context, plan, checkout, cashAmount, "cash", plan.cashPaymentId, "cash-partial");
  const cash = parsePaymentCollectionSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/payments/collect", cashCommand, fixtureContext.accessToken, 201));
  if (cash === undefined || cash.replayed || cash.method !== "cash" || cash.orderStatus !== "partially_paid"
    || cash.amountMinor !== cashAmount || cash.remainingBalanceMinor !== checkout.orderTotalMinor - cashAmount
    || cash.orderVersion !== context.orderVersion + 1 || cash.cashRegisterVersion !== 2) throw flowError();
  checkpoint?.("full_flow.cash_partial_captured");
  const cashReplay = parsePaymentCollectionSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/payments/collect", cashCommand, fixtureContext.accessToken, 201));
  if (cashReplay === undefined || !cashReplay.replayed || cashReplay.paymentId !== plan.cashPaymentId
    || cashReplay.orderVersion !== cash.orderVersion || cashReplay.cashRegisterVersion !== cash.cashRegisterVersion) throw flowError();
  checkpoint?.("full_flow.cash_partial_replayed");

  const partialCheckout = await getCheckout(context.fixture.apiBaseUrl, fixtureContext.accessToken, scope, plan, context.orderId, 200);
  if (partialCheckout === undefined || partialCheckout.orderStatus !== "partially_paid"
    || partialCheckout.capturedAmountMinor !== cashAmount || partialCheckout.remainingBalanceMinor !== cash.remainingBalanceMinor
    || partialCheckout.nextLocalSequence !== 2) throw flowError();
  const cardCommand = paymentCommand(context, plan, partialCheckout, partialCheckout.remainingBalanceMinor, "card_manual", plan.cardPaymentId, "card-settlement");
  const card = parsePaymentCollectionSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/payments/collect", cardCommand, fixtureContext.accessToken, 201));
  if (card === undefined || card.replayed || card.method !== "card_manual" || card.orderStatus !== "paid"
    || card.remainingBalanceMinor !== 0 || card.orderVersion !== context.orderVersion + 2 || card.cashRegisterVersion !== 3) throw flowError();
  checkpoint?.("full_flow.card_manual_settled");
  const cardReplay = parsePaymentCollectionSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/payments/collect", cardCommand, fixtureContext.accessToken, 201));
  if (cardReplay === undefined || !cardReplay.replayed || cardReplay.paymentId !== plan.cardPaymentId
    || cardReplay.orderVersion !== card.orderVersion || cardReplay.cashRegisterVersion !== card.cashRegisterVersion) throw flowError();
  checkpoint?.("full_flow.card_manual_replayed");
  await expectFinancialError(context.fixture.apiBaseUrl, checkoutPath(scope, plan, context.orderId), undefined, fixtureContext.accessToken, 409, "FINANCIAL_CONFLICT", "GET");
  checkpoint?.("full_flow.account_and_table_closed");

  const xBefore = await getReport(context.fixture.apiBaseUrl, fixtureContext.accessToken, scope, plan, plan.cashRegisterSessionId, 200);
  const xAfter = await getReport(context.fixture.apiBaseUrl, fixtureContext.accessToken, scope, plan, plan.cashRegisterSessionId, 200);
  if (xBefore === undefined || xAfter === undefined || JSON.stringify(xBefore) !== JSON.stringify(xAfter)
    || xBefore.paymentCount !== 2 || xBefore.cashCapturedMinor !== cashAmount
    || xBefore.cardManualCapturedMinor !== card.amountMinor || xBefore.totalCapturedMinor !== checkout.orderTotalMinor) throw flowError();
  checkpoint?.("full_flow.x_report_read_only");

  const counted = xBefore.register.expectedCashBalanceMinor + CLOSE_DIFFERENCE_MINOR;
  const closeReason = `tenancy-full-flow-v1:${context.fixture.runId}:cash-close-difference`;
  const closeCommand: CloseCashRegisterCommandV1 = Object.freeze({
    cashRegisterExpectedVersion: xBefore.register.version,
    cashRegisterSessionId: plan.cashRegisterSessionId,
    countedClosingBalanceMinor: counted,
    deviceId: plan.deviceId,
    eventId: plan.closeEventId,
    idempotencyKey: marker(context.fixture.runId, "register-close"),
    occurredAt: new Date().toISOString(),
    reason: closeReason,
    schemaVersion: 1,
    scope,
  });
  const closed = parseCashRegisterSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/cash-registers/close", closeCommand, fixtureContext.accessToken, 201));
  if (closed === undefined || closed.replayed || closed.status !== "closed" || closed.version !== 4
    || closed.expectedCashBalanceMinor !== OPENING_FLOAT_MINOR + cashAmount
    || closed.countedClosingBalanceMinor !== counted || closed.differenceMinor !== CLOSE_DIFFERENCE_MINOR) throw flowError();
  const closeReplay = parseCashRegisterSummaryV1(await postJson(context.fixture.apiBaseUrl, "/api/v1/cash-registers/close", closeCommand, fixtureContext.accessToken, 201));
  if (closeReplay === undefined || !closeReplay.replayed || closeReplay.version !== closed.version) throw flowError();
  const divergentClose = Object.freeze({ ...closeCommand, eventId: randomUUID(), idempotencyKey: marker(context.fixture.runId, "register-close-divergent") });
  await expectFinancialError(context.fixture.apiBaseUrl, "/api/v1/cash-registers/close", divergentClose, fixtureContext.accessToken, 409, "FINANCIAL_CONFLICT");
  const z = await getReport(context.fixture.apiBaseUrl, fixtureContext.accessToken, scope, plan, plan.cashRegisterSessionId, 200);
  if (z === undefined || z.register.status !== "closed" || z.register.closedAt === null
    || z.register.differenceMinor !== CLOSE_DIFFERENCE_MINOR || z.paymentCount !== 2) throw flowError();
  checkpoint?.("full_flow.z_close_immutable");

  await assertFinancialHistory(pool, context, plan, checkout.orderTotalMinor, cashAmount, closeReason, checkpoint);
  checkpoint?.("full_flow.audit_and_history_verified");
}

function paymentCommand(
  context: OrderJourneyContext,
  plan: FinancialPlan,
  checkout: NonNullable<Awaited<ReturnType<typeof getCheckout>>>,
  amountMinor: number,
  method: "cash" | "card_manual",
  paymentId: string,
  operation: string,
): CollectPaymentCommandV1 {
  return Object.freeze({
    amountMinor,
    cardManualEvidence: method === "cash" ? null : Object.freeze({
      externalConfirmed: true as const,
      provider: "E2E external confirmation",
      reference: marker(context.fixture.runId, "external-reference"),
      terminalId: "E2E-terminal",
    }),
    cashRegisterExpectedVersion: checkout.cashRegisterVersion,
    cashRegisterSessionId: plan.cashRegisterSessionId,
    deviceId: plan.deviceId,
    eventId: randomUUID(),
    idempotencyKey: marker(context.fixture.runId, operation),
    localSequence: checkout.nextLocalSequence,
    method,
    occurredAt: new Date().toISOString(),
    orderExpectedVersion: checkout.orderVersion,
    orderId: context.orderId,
    paymentId,
    schemaVersion: 1,
    scope: checkout.scope,
  });
}

async function assertFinancialHistory(
  pool: Pool,
  context: OrderJourneyContext,
  plan: FinancialPlan,
  orderTotalMinor: number,
  cashAmountMinor: number,
  closeReason: string,
  checkpoint: RunFullPosFlowTenancyVerificationOptions["onFullPosFlowCheckpoint"],
): Promise<void> {
  const actorId = requireFixtureContext(context).primaryUserId;
  const result = await pool.query<{
    auditCount: string;
    cardAmount: string;
    cardProvider: string;
    cashAmount: string;
    cashMovementCount: string;
    closeReason: string;
    orderCurrency: string;
    orderStatus: string;
    orderTableId: string | null;
    orderVersion: string;
    paymentCount: string;
    snapshotName: string;
    snapshotOptionName: string;
  }>(
    `select o.status as "orderStatus", o.version::text as "orderVersion",
       o.aggregate->>'currency' as "orderCurrency",
       o.table_id::text as "orderTableId",
       o.aggregate #>> '{items,0,snapshot,name}' as "snapshotName",
       o.aggregate #>> '{items,0,snapshot,modifiers,0,name}' as "snapshotOptionName",
       (select count(*)::text from app.payments p where p.order_id=o.id) as "paymentCount",
       (select amount_minor::text from app.payments p where p.id=$2::uuid) as "cashAmount",
       (select amount_minor::text from app.payments p where p.id=$3::uuid) as "cardAmount",
       (select manual_provider from app.payments p where p.id=$3::uuid) as "cardProvider",
       (select count(*)::text from app.cash_movements m where m.cash_register_session_id=$4::uuid) as "cashMovementCount",
       (select count(*)::text from app.financial_audit_events a where a.cash_register_session_id=$4::uuid
          and a.actor_id=$5::uuid and a.restaurant_id=$6::uuid and a.branch_id=$7::uuid
          and a.device_id=$8::uuid and a.occurred_at is not null and a.received_at is not null) as "auditCount",
       (select command_payload->>'reason' from app.financial_audit_events a where a.event_id=$9::uuid) as "closeReason"
     from app.orders o where o.id=$1::uuid`,
    [context.orderId, plan.cashPaymentId, plan.cardPaymentId, plan.cashRegisterSessionId, actorId,
      context.fixture.restaurantId, context.fixture.branchId, plan.deviceId, plan.closeEventId],
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || row?.orderStatus !== "paid" || row.orderVersion !== String(context.orderVersion + 2)
    || row.orderCurrency !== context.currency || row.orderTableId !== context.tableId
    || row.snapshotName !== tenancyFixtureName(context.fixture.runId, "menu-product")
    || row.snapshotOptionName !== tenancyFixtureName(context.fixture.runId, "menu-option")) throw flowError();
  checkpoint?.("full_flow.order_history_verified");
  if (row.paymentCount !== "2" || row.cashAmount !== String(cashAmountMinor)
    || row.cardAmount !== String(orderTotalMinor - cashAmountMinor)
    || row.cardProvider !== "E2E external confirmation" || row.cashMovementCount !== "1") throw flowError();
  checkpoint?.("full_flow.payment_history_verified");
  if (row.auditCount !== "4" || row.closeReason !== closeReason) throw flowError();
  checkpoint?.("full_flow.financial_audit_verified");
}

async function cleanupFinancialJourney(pool: Pool, context: OrderJourneyContext, plan: FinancialPlan | undefined): Promise<void> {
  const actorId = requireFixtureContext(context).primaryUserId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessions = await client.query<{ actorId: string; branchId: string; id: string; restaurantId: string }>(
      `select id::text, restaurant_id::text as "restaurantId", branch_id::text as "branchId", cashier_id::text as "actorId"
       from app.cash_register_sessions where restaurant_id=$1::uuid and branch_id=$2::uuid for update`,
      [context.fixture.restaurantId, context.fixture.branchId],
    );
    if (sessions.rows.some((row) => row.actorId !== actorId || row.restaurantId !== context.fixture.restaurantId
      || row.branchId !== context.fixture.branchId || plan !== undefined && row.id !== plan.cashRegisterSessionId)) throw cleanupError();
    await client.query("delete from app.financial_audit_events where restaurant_id=$1::uuid and branch_id=$2::uuid and actor_id=$3::uuid", [context.fixture.restaurantId, context.fixture.branchId, actorId]);
    await client.query("delete from app.cash_movements where restaurant_id=$1::uuid and branch_id=$2::uuid and actor_id=$3::uuid", [context.fixture.restaurantId, context.fixture.branchId, actorId]);
    await client.query("delete from app.payments where restaurant_id=$1::uuid and branch_id=$2::uuid and captured_by=$3::uuid", [context.fixture.restaurantId, context.fixture.branchId, actorId]);
    await client.query("delete from app_private.financial_device_sequences where restaurant_id=$1::uuid and branch_id=$2::uuid and device_id=$3::uuid", [context.fixture.restaurantId, context.fixture.branchId, context.deviceId]);
    await client.query("delete from app.cash_register_sessions where restaurant_id=$1::uuid and branch_id=$2::uuid and cashier_id=$3::uuid", [context.fixture.restaurantId, context.fixture.branchId, actorId]);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await rollback(client);
    if (error instanceof TenancyVerificationError) throw error;
    throw cleanupError();
  } finally {
    client.release();
  }
  const remaining = await pool.query<{ count: string }>(
    `select ((select count(*) from app.cash_register_sessions where restaurant_id=$1::uuid)
      +(select count(*) from app.payments where restaurant_id=$1::uuid)
      +(select count(*) from app.cash_movements where restaurant_id=$1::uuid)
      +(select count(*) from app.financial_audit_events where restaurant_id=$1::uuid)
      +(select count(*) from app_private.financial_device_sequences where restaurant_id=$1::uuid))::text as count`,
    [context.fixture.restaurantId],
  );
  if (remaining.rows[0]?.count !== "0") throw cleanupError();
}

async function getReport(
  baseUrl: string,
  accessToken: string,
  scope: BranchScope,
  plan: FinancialPlan,
  sessionId: string | null,
  expectedStatus: number,
): Promise<CashRegisterOperationalReportV1 | undefined> {
  const query = new URLSearchParams({
    branchId: scope.branchId,
    deviceId: plan.deviceId,
    registerId: plan.registerId,
    restaurantId: scope.restaurantId,
  });
  if (sessionId !== null) query.set("cashRegisterSessionId", sessionId);
  const value = await getJson(baseUrl, `/api/v1/cash-registers/report?${query.toString()}`, accessToken, expectedStatus);
  return expectedStatus === 200 ? parseCashRegisterOperationalReportV1(value) : undefined;
}

async function getCheckout(
  baseUrl: string,
  accessToken: string,
  scope: BranchScope,
  plan: FinancialPlan,
  orderId: string,
  expectedStatus: number,
) {
  const value = await getJson(baseUrl, checkoutPath(scope, plan, orderId), accessToken, expectedStatus);
  return expectedStatus === 200 ? parseCheckoutOrderSummaryV1(value) : undefined;
}

function checkoutPath(scope: BranchScope, plan: FinancialPlan, orderId: string): string {
  return `/api/v1/payments/checkout?${new URLSearchParams({
    branchId: scope.branchId,
    cashRegisterSessionId: plan.cashRegisterSessionId,
    deviceId: plan.deviceId,
    orderId,
    registerId: plan.registerId,
    restaurantId: scope.restaurantId,
  }).toString()}`;
}

async function postJson(baseUrl: string, path: string, body: unknown, accessToken: string, expectedStatus: number): Promise<unknown> {
  const response = await timedFetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    method: "POST",
  });
  const value: unknown = await response.json();
  if (response.status !== expectedStatus) throw flowError();
  return value;
}

async function getJson(baseUrl: string, path: string, accessToken: string, expectedStatus: number): Promise<unknown> {
  const response = await timedFetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  const value: unknown = await response.json();
  if (response.status !== expectedStatus) throw flowError();
  return value;
}

async function expectFinancialError(
  baseUrl: string,
  path: string,
  body: unknown,
  accessToken: string | undefined,
  expectedStatus: number,
  expectedCode: string,
  method: "GET" | "POST" = "POST",
): Promise<void> {
  const response = await timedFetch(`${baseUrl}${path}`, {
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    headers: {
      ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    method,
  });
  const value: unknown = await response.json();
  if (response.status !== expectedStatus || !isExactCode(value, expectedCode)) throw flowError();
}

async function timedFetch(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function requireFixtureContext(context: OrderJourneyContext): NonNullable<OrderJourneyContext["fixture"]["verificationContext"]> {
  if (context.fixture.verificationContext === undefined) throw flowError();
  return context.fixture.verificationContext;
}

function branchScope(restaurantId: string, branchId: string): BranchScope {
  return Object.freeze({ branchId, restaurantId }) as BranchScope;
}

function marker(runId: string, operation: string): string {
  return `tenancy-full-flow-v1:${runId}:${operation}`;
}

function sameScope(left: BranchScope, right: BranchScope): boolean {
  return left.restaurantId === right.restaurantId && left.branchId === right.branchId;
}

function isExactCode(value: unknown, code: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  const descriptor = Object.getOwnPropertyDescriptor(value, "code");
  return keys.length === 1 && descriptor !== undefined && "value" in descriptor && descriptor.value === code;
}

function createPool(config: DatabaseConfig): Pool {
  return new Pool({
    application_name: "super-restaurant-full-pos-flow-e2e",
    connectionString: config.connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    max: 2,
    query_timeout: 10_000,
    ssl: { ca: config.caCertificate, rejectUnauthorized: true },
    statement_timeout: 10_000,
  });
}

function flowError(): TenancyVerificationError {
  return new TenancyVerificationError("http", "TENANCY_VERIFICATION_HTTP_FAILED");
}

function cleanupError(): TenancyVerificationError {
  return new TenancyVerificationError("cleanup", "TENANCY_VERIFICATION_CLEANUP_FAILED");
}

async function rollback(client: PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); } catch { /* caller emits stable cleanup failure */ }
}
