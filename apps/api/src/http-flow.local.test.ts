import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { cancellationFlow } from "./operations/http-flow-cancellation.js";
import { cardTransferFlow } from "./operations/http-flow-card-transfer.js";
import { daySummaryFlow } from "./operations/http-flow-day-summary.js";
import { deliveryFlow } from "./operations/http-flow-delivery.js";
import { halvesFlow } from "./operations/http-flow-halves.js";
import { bootstrapHttpApp } from "./operations/http-test-app.js";
import { HTTP_TEST_ACTORS, provisionHttpFixtures, type HttpTestActorName } from "./operations/http-test-fixtures.js";
import { assertLocalConfirmation, listMigrationNames, LocalPostgres } from "./operations/local-postgres.js";

// Critical POS flow over real HTTP against a disposable local PostgreSQL 17 (never remote):
// catalog -> shift -> cash register -> order -> kitchen -> cash payment with change and tip -> X cut,
// plus identical/divergent replay and cross-restaurant isolation. Money is asserted in minor units.
// Opt-in only: `pnpm --filter @super-restaurant/api run test:http:local -- --local-disposable-only`.
const marker = "LOCAL_HTTP_FLOW_ONLY";
const argv = process.argv.filter((argument) => argument !== "--");
const unitPriceMinor = 12_500;
const quantity = 2;
const openingFloatMinor = 10_000;
const tenderedMinor = 30_000;
const tipMinor = 1_000;
const billMinor = unitPriceMinor * quantity;
const changeMinor = tenderedMinor - billMinor - tipMinor;
const nowIso = (): string => new Date().toISOString();

type Json = Record<string, unknown>;

test("http flow: cash register, order, kitchen, cash payment with change and tip, X cut, replay and isolation", async () => {
  if (process.env.HTTP_TEST_MODE !== undefined && process.env.HTTP_TEST_MODE !== "local") throw new Error("LOCAL_CONFIRMATION_REQUIRED");
  assertLocalConfirmation(argv);
  const local = new LocalPostgres({ marker, databasePrefix: "superrestaurant_http_flow", authUsersExtraColumns: ", raw_user_meta_data jsonb" });
  let app: Awaited<ReturnType<typeof bootstrapHttpApp>> | undefined;
  const checks: string[] = [];
  const check = (name: string): void => { checks.push(name); };
  try {
    await local.start();
    await local.applyMigrations(listMigrationNames());
    await local.enableAppApiLogin();
    const fixtures = await provisionHttpFixtures(local.admin);
    const principals = new Map<string, string>((Object.keys(HTTP_TEST_ACTORS) as HttpTestActorName[]).map((name) => [fixtures.tokens[name], fixtures.actorIds[name]]));
    app = await bootstrapHttpApp(local.appApiUrl, principals);
    const http = app;
    const scope = { restaurantId: fixtures.restaurantA, branchId: fixtures.branchA };
    const foreignScope = { restaurantId: fixtures.restaurantB, branchId: fixtures.branchB };
    const deviceId = randomUUID();
    const audit = (): { deviceId: string; eventId: string; idempotencyKey: string; occurredAt: string } =>
      ({ deviceId, eventId: randomUUID(), idempotencyKey: randomUUID(), occurredAt: nowIso() });
    const send = async (actor: HttpTestActorName | null, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<{ status: number; body: Json }> => {
      const response = await http.request(actor === null ? null : fixtures.tokens[actor], method, path, body);
      return { status: response.status, body: (response.body ?? {}) as Json };
    };
    const query = (parameters: Record<string, string>): string => `?${new URLSearchParams(parameters).toString()}`;

    // 0. Authentication boundary.
    assert.equal((await send(null, "POST", "/orders/detail", {})).status, 401);
    check("unauthenticated_401");

    // 1. Catalog (manager): one published product, no tax.
    const categoryId = randomUUID();
    const productId = randomUUID();
    const catalog = { ...audit(), schemaVersion: 1, scope, expectedVersion: 0, catalogVersion: randomUUID(), currency: "MXN",
      categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
      products: [{ productId, categoryId, name: "Hamburguesa", sku: "HAM-001", active: true, displayOrder: 0,
        stationId: "kitchen", unit: "piece", unitPriceMinor, tax: null }],
      modifierGroups: [] };
    assert.equal((await send("manager", "PUT", "/catalog/menu", catalog)).status, 200);
    assert.equal((await send("cashier", "PUT", "/catalog/menu", { ...catalog, ...audit() })).status, 403);
    check("catalog_published_manager_only");

    // 2. Shift and cash register (cashier).
    const shiftId = randomUUID();
    const shift = { ...audit(), schemaVersion: 1, scope, shiftId, name: "Turno HTTP" };
    const shiftOpened = await send("cashier", "POST", "/shifts/open", shift);
    assert.equal(shiftOpened.status, 201);
    const registerId = randomUUID();
    const cashRegisterSessionId = randomUUID();
    const open = { ...audit(), schemaVersion: 1, scope, cashRegisterSessionId, registerId, shiftId, openingFloatMinor, currency: "MXN" };
    const opened = await send("cashier", "POST", "/cash-registers/open", open);
    assert.equal(opened.status, 201);
    assert.equal(opened.body.status, "open");
    assert.equal(opened.body.openingFloatMinor, openingFloatMinor);
    assert.equal(opened.body.expectedCashBalanceMinor, openingFloatMinor);
    assert.equal(opened.body.replayed, false);
    const registerVersion = opened.body.version as number;
    const openReplay = await send("cashier", "POST", "/cash-registers/open", open);
    assert.equal(openReplay.status, 201);
    assert.equal(openReplay.body.replayed, true);
    assert.equal(openReplay.body.cashRegisterSessionId, cashRegisterSessionId);
    assert.equal((await send("cashier", "POST", "/cash-registers/open", { ...open, openingFloatMinor: openingFloatMinor + 1 })).status, 409);
    check("register_open_replay_identical_and_divergent_409");

    // 3. Order: create (draft), add two units, send to kitchen.
    const orderId = randomUUID();
    const created = await send("cashier", "POST", "/orders", { ...audit(), schemaVersion: 2, scope, orderId, shiftId,
      channel: "counter", tableId: null, currency: "MXN", timeZone: "America/Hermosillo" });
    assert.equal(created.status, 201);
    assert.equal(created.body.version, 1);
    const orderItemId = randomUUID();
    const added = await send("cashier", "POST", "/orders/items", { ...audit(), schemaVersion: 1, scope, orderId, expectedVersion: 1,
      orderItemId, productId, quantity, modifierGroups: [] });
    assert.equal(added.status, 201);
    assert.equal(added.body.version, 2);
    const sendCommand = { ...audit(), schemaVersion: 1, scope, orderId, orderItemIds: [orderItemId], expectedVersion: 2 };
    const sent = await send("cashier", "POST", "/orders/send-to-kitchen", sendCommand);
    assert.equal(sent.status, 201);
    assert.equal(sent.body.replayed, false);
    const sentVersion = sent.body.version as number;
    const sentReplay = await send("cashier", "POST", "/orders/send-to-kitchen", sendCommand);
    assert.equal(sentReplay.status, 201);
    assert.equal(sentReplay.body.replayed, true);
    assert.equal(sentReplay.body.version, sentVersion);
    assert.equal((await send("cashier", "POST", "/orders/send-to-kitchen", { ...sendCommand, expectedVersion: 99 })).status, 409);
    check("order_create_add_send_replay_and_stale_409");

    // 4. Checkout read, then cash collect with change and tip.
    const checkout = await send("cashier", "GET", `/payments/checkout${query({ ...scope, registerId, cashRegisterSessionId, deviceId, orderId })}`);
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.orderTotalMinor, billMinor);
    assert.equal(checkout.body.remainingBalanceMinor, billMinor);
    assert.equal(checkout.body.nextLocalSequence, 1);
    const collect = { ...audit(), schemaVersion: 1, scope, cashRegisterSessionId, cashRegisterExpectedVersion: registerVersion,
      orderId, orderExpectedVersion: checkout.body.orderVersion as number, paymentId: randomUUID(), amountMinor: billMinor, method: "cash",
      cardManualEvidence: null, localSequence: checkout.body.nextLocalSequence as number, tenderedAmountMinor: tenderedMinor, tipMinor };
    const collected = await send("cashier", "POST", "/payments/collect", collect);
    assert.equal(collected.status, 201);
    assert.equal(collected.body.amountMinor, billMinor);
    assert.equal(collected.body.tenderedAmountMinor, tenderedMinor);
    assert.equal(collected.body.tipMinor, tipMinor);
    assert.equal(collected.body.changeMinor, changeMinor);
    assert.equal(collected.body.remainingBalanceMinor, 0);
    assert.equal(collected.body.orderStatus, "paid");
    assert.equal(collected.body.replayed, false);
    const collectReplay = await send("cashier", "POST", "/payments/collect", collect);
    assert.equal(collectReplay.status, 201);
    assert.equal(collectReplay.body.replayed, true);
    assert.equal(collectReplay.body.paymentId, collect.paymentId);
    assert.equal(collectReplay.body.changeMinor, changeMinor);
    assert.equal((await send("cashier", "POST", "/payments/collect", { ...collect, tipMinor: tipMinor + 100 })).status, 409);
    check("cash_collect_change_tip_replay_identical_and_divergent_409");

    // 5. X cut: expected cash = float + cash sales + cash tip (tip_in), exactly one payment, no double charge.
    const report = await send("cashier", "GET", `/cash-registers/report${query({ ...scope, registerId, cashRegisterSessionId, deviceId })}`);
    assert.equal(report.status, 200);
    assert.equal(report.body.paymentCount, 1);
    assert.equal(report.body.cashCapturedMinor, billMinor);
    assert.equal(report.body.cashTipsMinor, tipMinor);
    assert.equal(report.body.tipsMinor, tipMinor);
    assert.equal(report.body.totalCapturedMinor, billMinor);
    assert.equal((report.body.register as Json).expectedCashBalanceMinor, openingFloatMinor + billMinor + tipMinor);
    const movements = report.body.movements as Json[];
    assert.deepEqual(movements.map((movement) => movement.type).sort(), ["cash_sale", "tip_in"]);
    assert.equal(movements.find((movement) => movement.type === "tip_in")?.amountMinor, tipMinor);
    assert.equal(movements.find((movement) => movement.type === "cash_sale")?.amountMinor, billMinor);
    check("x_cut_expected_float_plus_sales_plus_tip");

    // 6. Isolation and authorization: the other restaurant's manager and a courier get 403 on restaurant A.
    assert.equal((await send("other_restaurant_manager", "POST", "/orders/detail", { schemaVersion: 1, scope, orderId })).status, 403);
    assert.equal((await send("other_restaurant_manager", "GET", `/cash-registers/report${query({ ...scope, registerId, cashRegisterSessionId, deviceId })}`)).status, 403);
    assert.equal((await send("other_restaurant_manager", "POST", "/payments/collect", { ...collect, ...audit(), paymentId: randomUUID() })).status, 403);
    assert.equal((await send("courier", "POST", "/payments/collect", { ...collect, ...audit(), paymentId: randomUUID() })).status, 403);
    // Under its own scope the foreign actor cannot see the order either.
    assert.equal((await send("other_restaurant_manager", "POST", "/orders/detail", { schemaVersion: 1, scope: foreignScope, orderId })).status, 404);
    // The legitimate actor still reads it.
    assert.equal((await send("cashier", "POST", "/orders/detail", { schemaVersion: 1, scope, orderId })).status, 201);
    check("cross_restaurant_403_and_role_403");

    process.stdout.write(`${JSON.stringify({ stage: "http_flow", status: "ok", runId: local.runId, checks, billMinor, changeMinor, tipMinor,
      expectedCashBalanceMinor: openingFloatMinor + billMinor + tipMinor })}\n`);
  } finally {
    try { await app?.close(); } catch { process.exitCode = 1; }
    const cleanup = await local.stop();
    process.stdout.write(`${JSON.stringify({ stage: "local_cleanup", status: cleanup.failed ? "failed" : "ok", stopped: cleanup.stopped, runId: local.runId, marker })}\n`);
    if (cleanup.failed) process.exitCode = 1;
  }
});

test("http flow: phone delivery, courier ownership, cash settle with change and X cut", async () => { await deliveryFlow(); });

test("http flow: half-and-half line quote, selection plan and kitchen ticket", async () => { await halvesFlow(); });

test("http flow: card terminal plus transfer split tender and transfer refused on a delivery in transit", async () => { await cardTransferFlow(); });

test("http flow: whole-order cancellation, refund obligation, active delivery guard and cancelled tray", async () => { await cancellationFlow(); });

test("http flow: branch day summary equals captured payments, role gates and empty day", async () => { await daySummaryFlow(); });
