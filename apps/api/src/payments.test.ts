import assert from "node:assert/strict";
import test from "node:test";

import {
  Money,
  addOrderItem,
  createOrder,
  expectedCashBalance,
  openCashRegister,
  transitionOrderStatus,
  type CashRegister,
  type Order,
} from "@super-restaurant/domain";
import { parseBranchScope, parseCollectPaymentCommandV1 } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import type { OrderPersistencePort } from "./orders.js";
import {
  FinancialApplicationError,
  FinancialService,
  PostgresFinancialPersistenceAdapter,
  projectPaymentObligation,
  quotePaymentIntent,
  type FinancialPersistencePort,
  type PersistPaymentInput,
  type StoredCashRegister,
} from "./payments.js";
import { encodeCashRegisterRecord } from "./persistence/financial-persistence-codec.js";

const actorId = "8cc7eb84-af2a-4e84-95de-967c39af86ab";
const principal: AuthenticatedPrincipal = Object.freeze({ actorId });
const parsedScope = parseBranchScope({
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
});
if (parsedScope === undefined) throw new Error("TEST_SCOPE_INVALID");
const scope = parsedScope;
const sessionId = "c2da9fc7-013a-4f48-999c-29bd1a7f158f";
const registerId = "3eb31aaa-a466-4b1b-9b37-2f4736106a1d";
const shiftId = "db7bcd0c-61f3-4c65-8280-dd8d78fa39cf";
const orderId = "72371a5f-2056-448d-9ddb-14ab6664a4e8";
const paymentId = "2ee5f057-7971-468d-b197-f946911743eb";
const deviceId = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";

test("payment intent boundary returns an exact non-financial change quote", () => {
  const quote = quotePaymentIntent({
    capturedAmountMinor: 2_500,
    currency: "MXN",
    method: "cash",
    orderTotalMinor: 12_500,
    plannedAmountMinor: 10_000,
    schemaVersion: 1,
    tenderedAmountMinor: 20_000,
    timing: "on_fulfillment",
  });
  assert.equal(quote.remainingBeforePlanMinor, 10_000);
  assert.equal(quote.remainingAfterPlanMinor, 0);
  assert.equal(quote.changeDueMinor, 10_000);
  assert.equal(Object.isFrozen(quote), true);
});

test("payment intent boundary maps invalid financial facts to a request error", () => {
  for (const invalid of [
    {
      capturedAmountMinor: 0, currency: "MXN", method: "cash", orderTotalMinor: 1_000,
      plannedAmountMinor: 1_001, schemaVersion: 1, tenderedAmountMinor: 2_000, timing: "now",
    },
    {
      capturedAmountMinor: 0, currency: "MXN", method: "card_manual", orderTotalMinor: 1_000,
      plannedAmountMinor: 1_000, schemaVersion: 1, tenderedAmountMinor: 1_000, timing: "now",
    },
  ]) {
    assert.throws(
      () => quotePaymentIntent(invalid),
      (error: unknown) => error instanceof FinancialApplicationError && error.code === "request",
    );
  }
});

test("payment obligation boundary projects unresolved exposure without treating it as captured", () => {
  const projection = projectPaymentObligation({
    ambiguousAmountMinor: 1_000,
    capturedAmountMinor: 2_500,
    currency: "MXN",
    orderTotalMinor: 12_500,
    pendingAmountMinor: 4_000,
    schemaVersion: 1,
  });
  assert.equal(projection.paymentStatus, "ambiguous");
  assert.equal(projection.remainingBalanceMinor, 10_000);
  assert.equal(projection.unresolvedExposureMinor, 5_000);
  assert.equal(projection.collectibleAmountMinor, null);
  assert.equal(Object.isFrozen(projection), true);
});

test("payment obligation boundary maps invalid authoritative facts to a request error", () => {
  for (const invalid of [
    {
      ambiguousAmountMinor: 0, capturedAmountMinor: 1_001, currency: "MXN", orderTotalMinor: 1_000,
      pendingAmountMinor: 0, schemaVersion: 1,
    },
    {
      ambiguousAmountMinor: 1, capturedAmountMinor: 0, currency: "MXN", orderTotalMinor: 1_000,
      pendingAmountMinor: Number.MAX_SAFE_INTEGER, schemaVersion: 1,
    },
  ]) {
    assert.throws(
      () => projectPaymentObligation(invalid),
      (error: unknown) => error instanceof FinancialApplicationError && error.code === "request",
    );
  }
});

test("PostgreSQL financial adapter binds private functions and fails closed", async () => {
  const register = openRegister();
  const calls: { readonly parameters: readonly unknown[]; readonly sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      if (sql.includes("replay_financial_command")) return { rows: [{ result: null }] };
      return { rows: [{ result: readRegisterResult(register, 1, 0) }] };
    },
  };
  const adapter = new PostgresFinancialPersistenceAdapter(database);
  const stored = await adapter.read(actorId, scope, sessionId, orderId);
  assert.notEqual(stored, "missing");
  assert.equal(stored === "missing" ? 0 : stored.version, 1);
  assert.match(calls[0]?.sql ?? "", /app_private\.read_cash_register/u);
  assert.deepEqual(calls[0]?.parameters, [actorId, scope.restaurantId, scope.branchId, sessionId, orderId]);
  const replayCommand = parseCollectPaymentCommandV1(collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "cash",
  }));
  if (replayCommand === undefined) throw new Error("TEST_REPLAY_COMMAND_INVALID");
  assert.equal(await adapter.replayCollect(actorId, replayCommand), "missing");
  assert.match(calls[1]?.sql ?? "", /app_private\.replay_financial_command/u);
  assert.deepEqual(calls[1]?.parameters?.slice(0, 2), [actorId, "payment.captured"]);

  for (const rows of [[], [{ result: null }, { result: null }], [{ result: null, extra: true }]]) {
    await assert.rejects(
      new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows }) }).read(actorId, scope, sessionId),
      (error: unknown) => error instanceof FinancialApplicationError && error.code === "unavailable",
    );
  }
  assert.equal(
    await new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: null }] }) }).read(actorId, scope, sessionId),
    "missing",
  );
});

test("PostgreSQL financial adapter reads the scoped operational report through one private capability", async () => {
  const register = openRegister();
  const report = operationalReport(register, 3, 5_000, 2_500);
  const calls: { readonly parameters: readonly unknown[]; readonly sql: string }[] = [];
  const adapter = new PostgresFinancialPersistenceAdapter({
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      return { rows: [{ result: report }] };
    },
  });
  const query = reportQuery(sessionId);
  assert.deepEqual(await adapter.readReport(actorId, query), report);
  assert.match(calls[0]?.sql ?? "", /app_private\.read_cash_register_operational_report/u);
  assert.deepEqual(calls[0]?.parameters, [actorId, scope.restaurantId, scope.branchId, registerId, sessionId, deviceId]);

  const forbidden = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { status: "forbidden" } }] }) });
  assert.equal(await forbidden.readReport(actorId, query), "forbidden");
  const hostile = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { ...report, extra: true } }] }) });
  await assertCode(hostile.readReport(actorId, query), "unavailable");
});

test("PostgreSQL financial adapter canonicalizes report timestamps emitted with a database offset", async () => {
  const report = operationalReport(openRegister(), 1, 0, 0);
  const databaseReport = Object.freeze({
    ...report,
    register: Object.freeze({
      ...report.register,
      openedAt: "2026-09-03T12:00:00+00:00",
    }),
  });
  const adapter = new PostgresFinancialPersistenceAdapter({
    query: async () => ({ rows: [{ result: databaseReport }] }),
  });

  const normalized = await adapter.readReport(actorId, reportQuery(sessionId));
  assert.notEqual(normalized, "missing");
  assert.notEqual(normalized, "forbidden");
  assert.notEqual(normalized, "conflict");
  if (normalized === "missing" || normalized === "forbidden" || normalized === "conflict") {
    throw new Error("TEST_OPERATIONAL_REPORT_MISSING");
  }
  assert.equal(normalized.register.openedAt, "2026-09-03T12:00:00.000Z");
});

test("financial service opens a cashier-bound register and persists audit evidence", async () => {
  let opened: CashRegister | undefined;
  const finances = financialPort({
    open: async (_actor, _command, register) => {
      opened = register;
      return registerSummary(register, 1);
    },
  });
  const summary = await serviceFor(["cashier"], finances).open(principal, openCommand());
  assert.equal(summary.cashierId, actorId);
  assert.equal(summary.openingFloatMinor, 2_000);
  assert.equal(opened?.openedDeviceId, deviceId);
});

test("financial service exposes an authorized X view and an exact payable checkout summary", async () => {
  const register = openRegister();
  const order = transitionOrderStatus(payableOrder(), "partially_paid", {
    actorId, deviceId, eventId: "19a8584a-9e47-42b4-a1e1-7bf1ac4c7b6d",
    idempotencyKey: "test-partial-payment-state", occurredAt: "2026-09-03T12:05:00.000Z",
  }).order;
  const report = operationalReport(register, 4, 2_000, 500);
  const finances = financialPort({
    read: async () => storedRegister(register, 3, 2_500),
    readReport: async () => report,
  });
  const service = serviceFor(["cashier"], finances, orderPort(order, 7));
  assert.deepEqual(await service.report(principal, reportQuery(sessionId)), report);
  const checkout = await service.checkout(principal, {
    ...reportQuery(sessionId),
    orderId,
  });
  assert.equal(checkout.cashRegisterVersion, 3);
  assert.equal(checkout.orderVersion, 7);
  assert.equal(checkout.orderTotalMinor, 12_500);
  assert.equal(checkout.capturedAmountMinor, 2_500);
  assert.equal(checkout.remainingBalanceMinor, 10_000);
  assert.equal(checkout.nextLocalSequence, 4);

  await assertCode(serviceFor(["viewer"], finances).report(principal, reportQuery(sessionId)), "authorization");
  await assertCode(serviceFor(["cashier"], financialPort({ readReport: async () => "missing" })).report(
    principal,
    reportQuery(null),
  ), "not_found");
});

test("cash payment captures an exact partial amount and creates one cash movement", async () => {
  let persisted: PersistPaymentInput | undefined;
  const register = openRegister();
  const order = payableOrder();
  const finances = financialPort({
    read: async () => storedRegister(register, 1, 0),
    collect: async (_actor, input) => {
      persisted = input;
      return paymentSummary(input, 2, 2, 7_500);
    },
  });
  const summary = await serviceFor(["cashier"], finances, orderPort(order, 1)).collect(
    principal,
    collectCommand({ amountMinor: 5_000, method: "cash", cardManualEvidence: null }),
  );
  assert.equal(summary.orderStatus, "partially_paid");
  assert.equal(persisted?.payment.amount.amountMinor, 5_000);
  assert.equal(persisted?.payment.state, "captured");
  assert.equal(persisted?.register.movements.length, 1);
  assert.equal(persisted?.register.movements[0]?.type, "cash_sale");
});

test("manual card payment requires external evidence and never changes cash balance", async () => {
  let persisted: PersistPaymentInput | undefined;
  const register = openRegister();
  const order = payableOrder();
  const finances = financialPort({
    read: async () => storedRegister(register, 1, 0),
    collect: async (_actor, input) => {
      persisted = input;
      return paymentSummary(input, 2, 2, 0);
    },
  });
  const summary = await serviceFor(["cashier"], finances, orderPort(order, 1)).collect(principal, collectCommand({
    amountMinor: 12_500,
    method: "card_manual",
    cardManualEvidence: { externalConfirmed: true, provider: "terminal externo", reference: "folio-42", terminalId: "caja-1" },
  }));
  assert.equal(summary.orderStatus, "paid");
  assert.equal(persisted?.register.movements.length, 0);
  assert.equal(persisted?.payment.cardManualEvidence?.reference, "folio-42");
  await assertCode(serviceFor(["cashier"], finances, orderPort(order, 1)).collect(principal, {
    ...collectCommand({ amountMinor: 12_500, method: "card_manual", cardManualEvidence: null }),
  }), "request");
});

test("a manual-card event can create a legitimate gap before the next cash-movement sequence", async () => {
  let register = openRegister();
  let order = payableOrder();
  let registerVersion = 1;
  let orderVersion = 1;
  let captured = 0;
  const finances = financialPort({
    read: async () => storedRegister(register, registerVersion, captured),
    collect: async (_actor, input) => {
      register = input.register;
      order = input.order;
      captured += input.payment.amount.amountMinor;
      registerVersion += 1;
      orderVersion += 1;
      return paymentSummary(input, registerVersion, orderVersion, 12_500 - captured);
    },
  });
  const orders = orderPortFrom(() => ({ order, version: orderVersion }));
  const service = serviceFor(["cashier"], finances, orders);
  await service.collect(principal, collectCommand({
    amountMinor: 5_000,
    cardManualEvidence: { externalConfirmed: true, provider: "terminal externo", reference: null, terminalId: "caja-1" },
    method: "card_manual",
  }));
  await service.collect(principal, collectCommand({
    amountMinor: 7_500,
    cardManualEvidence: null,
    cashRegisterExpectedVersion: 2,
    eventId: "eafc3510-6e2e-4fc9-b700-9929788bdbf4",
    idempotencyKey: "payment-attempt-2",
    localSequence: 2,
    method: "cash",
    orderExpectedVersion: 2,
    paymentId: "9bb4bf95-1170-47b0-88ea-72547a3dd2b9",
  }));
  assert.equal(register.movements[0]?.localSequence, 2);
  assert.equal(order.status, "paid");
});

test("financial service rejects overpayment, stale versions, foreign roles, and unexplained closing variance", async () => {
  const register = openRegister();
  const order = payableOrder();
  const finances = financialPort({ read: async () => storedRegister(register, 1, 0) });
  await assertCode(serviceFor(["cashier"], finances, orderPort(order, 1)).collect(
    principal,
    collectCommand({ amountMinor: 12_501, method: "cash", cardManualEvidence: null }),
  ), "conflict");
  await assertCode(serviceFor(["cashier"], finances, orderPort(order, 2)).collect(
    principal,
    collectCommand({ amountMinor: 5_000, method: "cash", cardManualEvidence: null }),
  ), "conflict");
  await assertCode(serviceFor(["viewer"], finances).open(principal, openCommand()), "authorization");
  await assertCode(serviceFor(["cashier"], finances).close(principal, closeCommand(1, 1_999, null)), "request");
});

test("financial service closes with counted balance and required variance reason", async () => {
  const register = openRegister();
  let closed: CashRegister | undefined;
  const finances = financialPort({
    read: async () => storedRegister(register, 1, 0),
    close: async (_actor, _command, value) => {
      closed = value;
      return registerSummary(value, 2);
    },
  });
  const result = await serviceFor(["cashier"], finances).close(principal, closeCommand(1, 1_999, "faltante contado"));
  assert.equal(result.status, "closed");
  assert.equal(closed?.difference?.amountMinor, -1);
});

test("exact payment and close retries return historical results before stale aggregate reads", async () => {
  const order = payableOrder();
  const register = openRegister();
  const paymentInput = await capturedInput(order, register);
  const historicalPayment = paymentSummary(paymentInput, 2, 2, 7_500);
  const closedRegister = await closedValue(register);
  const historicalClose = { ...registerSummary(closedRegister, 2), replayed: true };
  let reads = 0;
  const finances = financialPort({
    read: async () => { reads += 1; return "missing"; },
    replayCollect: async () => historicalPayment,
    replayClose: async () => historicalClose,
  });
  const orders = orderPortFrom(() => { reads += 1; return { order, version: 99 }; });
  const service = serviceFor(["cashier"], finances, orders);
  assert.deepEqual(await service.collect(principal, collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "cash",
  })), historicalPayment);
  assert.deepEqual(await service.close(principal, closeCommand(1, 2_000, null)), historicalClose);
  assert.equal(reads, 0);

  await assertCode(serviceFor(["cashier"], financialPort({ replayCollect: async () => "conflict" }), orders).collect(
    principal,
    collectCommand({ amountMinor: 5_000, cardManualEvidence: null, method: "cash" }),
  ), "conflict");
});

function payableOrder(): Order {
  const audit = { actorId, deviceId, eventId: "6676a66a-50cd-44a6-8c43-b95e21487111", idempotencyKey: "order-create", occurredAt: "2026-09-03T12:00:00.000Z" };
  const created = createOrder({
    branchId: scope.branchId, channel: "counter", currency: "MXN", orderId,
    restaurantId: scope.restaurantId, timeZone: "America/Mexico_City",
  }, audit).order;
  const withItem = addOrderItem(created, {
    orderItemId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
    quantity: 1,
    snapshot: {
      catalogVersion: "v1", modifiers: [], name: "Hamburguesa",
      productId: "9544c299-d25b-44ce-98ed-d30116610887", stationId: "kitchen",
      unit: "piece", unitPrice: new Money(12_500, "MXN"),
    },
  }, { ...audit, eventId: "1c63e176-7dc8-4ded-98f5-0b95792ae180", idempotencyKey: "order-item" }).order;
  return transitionOrderStatus(withItem, "open", {
    ...audit, eventId: "4c2044ba-d585-4af5-8f90-b288905c5db4", idempotencyKey: "order-open",
  }).order;
}

function openRegister(): CashRegister {
  return openCashRegister({
    branchId: scope.branchId,
    cashRegisterId: sessionId,
    cashierId: actorId,
    evidence: { actorId, branchId: scope.branchId, deviceId, occurredAt: "2026-09-03T12:00:00.000Z" },
    openingFloat: new Money(2_000, "MXN"),
    registerId,
    restaurantId: scope.restaurantId,
    shiftId,
  }).register;
}

function openCommand(): Readonly<Record<string, unknown>> {
  return {
    cashRegisterSessionId: sessionId,
    currency: "MXN",
    deviceId,
    eventId: "20c39b98-2b8b-4e08-80cf-19d2ab948f68",
    idempotencyKey: "open-register",
    occurredAt: "2026-09-03T12:00:00.000Z",
    openingFloatMinor: 2_000,
    registerId,
    schemaVersion: 1,
    scope,
    shiftId,
  };
}

function collectCommand(overrides: {
  readonly amountMinor: number;
  readonly cardManualEvidence: unknown;
  readonly cashRegisterExpectedVersion?: number;
  readonly eventId?: string;
  readonly idempotencyKey?: string;
  readonly localSequence?: number;
  readonly method: string;
  readonly orderExpectedVersion?: number;
  readonly tenderedAmountMinor?: number | null;
  readonly tipMinor?: number;
  readonly paymentId?: string;
  readonly transferReference?: string | null;
}): Readonly<Record<string, unknown>> {
  return {
    amountMinor: overrides.amountMinor,
    cardManualEvidence: overrides.cardManualEvidence,
    cashRegisterExpectedVersion: overrides.cashRegisterExpectedVersion ?? 1,
    cashRegisterSessionId: sessionId,
    deviceId,
    eventId: overrides.eventId ?? "82598fd2-f419-41e4-862e-9758b1c59f52",
    idempotencyKey: overrides.idempotencyKey ?? "payment-attempt-1",
    localSequence: overrides.localSequence ?? 1,
    method: overrides.method,
    occurredAt: "2026-09-03T12:01:00.000Z",
    orderExpectedVersion: overrides.orderExpectedVersion ?? 1,
    orderId,
    paymentId: overrides.paymentId ?? paymentId,
    schemaVersion: 1,
    scope,
    ...(overrides.tenderedAmountMinor === undefined ? {} : { tenderedAmountMinor: overrides.tenderedAmountMinor }),
    ...(overrides.tipMinor === undefined ? {} : { tipMinor: overrides.tipMinor }),
    ...(overrides.transferReference === undefined ? {} : { transferReference: overrides.transferReference }),
  };
}

function closeCommand(expectedVersion: number, counted: number, reason: string | null): Readonly<Record<string, unknown>> {
  return {
    cashRegisterExpectedVersion: expectedVersion,
    cashRegisterSessionId: sessionId,
    countedClosingBalanceMinor: counted,
    deviceId,
    eventId: "933e49e3-50c8-4636-877e-c885a3cedc04",
    idempotencyKey: "close-register",
    occurredAt: "2026-09-03T13:00:00.000Z",
    reason,
    schemaVersion: 1,
    scope,
  };
}

function serviceFor(
  roles: readonly ("cashier" | "viewer")[],
  finances: FinancialPersistencePort,
  orders: OrderPersistencePort = orderPort(payableOrder(), 1),
): FinancialService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope }) };
  return new FinancialService(new MembershipAuthorizationService(memberships), finances, orders);
}

function orderPort(order: Order, version: number): OrderPersistencePort {
  return orderPortFrom(() => ({ order, version }));
}

function orderPortFrom(read: () => { readonly order: Order; readonly version: number }): OrderPersistencePort {
  return {
    cancelWholeOrder: () => Promise.resolve({ status: "conflict" as const }),
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => read(),
    recoverKds: async () => "forbidden",
    readAssignedToCourier: async () => "missing" as const,
    readReceiptData: async () => "missing" as const,
    sendOrderToKitchen: async () => { throw new Error("sendOrderToKitchen not implemented by this fake"); },
  };
}

function financialPort(overrides: Partial<FinancialPersistencePort> = {}): FinancialPersistencePort {
  return {
    close: async () => "conflict",
    collect: async () => "conflict",
    open: async () => "conflict",
    read: async () => "missing",
    readReport: async () => "missing",
    replayClose: async () => "missing",
    replayCollect: async () => "missing",
    replayOpen: async () => "missing",
    ...overrides,
  };
}

function reportQuery(cashRegisterSessionId: string | null) {
  return Object.freeze({ cashRegisterSessionId, deviceId, registerId, schemaVersion: 1 as const, scope });
}

function operationalReport(register: CashRegister, nextLocalSequence: number, cashCapturedMinor: number, cardManualCapturedMinor: number) {
  return Object.freeze({
    cardManualCapturedMinor,
    cashCapturedMinor,
    cashTipsMinor: 0,
    movementCount: 0,
    movements: Object.freeze([]),
    nextLocalSequence,
    tipsMinor: 0,
    paymentCount: Number(cashCapturedMinor > 0) + Number(cardManualCapturedMinor > 0),
    register: registerSummary(register, 3),
    schemaVersion: 1 as const,
    scope,
    totalCapturedMinor: cashCapturedMinor + cardManualCapturedMinor,
    transferCapturedMinor: 0,
  });
}

async function capturedInput(order: Order, register: CashRegister): Promise<PersistPaymentInput> {
  let captured: PersistPaymentInput | undefined;
  const finances = financialPort({
    read: async () => storedRegister(register, 1, 0),
    collect: async (_actor, input) => {
      captured = input;
      return paymentSummary(input, 2, 2, 7_500);
    },
  });
  await serviceFor(["cashier"], finances, orderPort(order, 1)).collect(
    principal,
    collectCommand({ amountMinor: 5_000, cardManualEvidence: null, method: "cash" }),
  );
  if (captured === undefined) throw new Error("TEST_PAYMENT_INPUT_MISSING");
  return captured;
}

async function closedValue(register: CashRegister): Promise<CashRegister> {
  let closed: CashRegister | undefined;
  const finances = financialPort({
    read: async () => storedRegister(register, 1, 0),
    close: async (_actor, _command, value) => {
      closed = value;
      return registerSummary(value, 2);
    },
  });
  await serviceFor(["cashier"], finances).close(principal, closeCommand(1, 2_000, null));
  if (closed === undefined) throw new Error("TEST_CLOSED_REGISTER_MISSING");
  return closed;
}

function storedRegister(register: CashRegister, version: number, capturedAmountMinor: number): StoredCashRegister {
  return Object.freeze({ capturedAmountMinor, register, version });
}

function registerSummary(register: CashRegister, version: number) {
  const expected = expectedCashBalance(register).amountMinor;
  return Object.freeze({
    cashRegisterSessionId: register.cashRegisterId,
    cashierId: register.cashierId,
    closedAt: register.closedAt ?? null,
    countedClosingBalanceMinor: register.countedClosingBalance?.amountMinor ?? null,
    currency: register.currency,
    differenceMinor: register.difference?.amountMinor ?? null,
    expectedCashBalanceMinor: expected,
    openedAt: register.openedAt,
    openingFloatMinor: register.openingFloat.amountMinor,
    registerId: register.registerId,
    replayed: false,
    schemaVersion: 1 as const,
    scope,
    shiftId: register.shiftId,
    status: register.status,
    version,
  });
}

function paymentSummary(input: PersistPaymentInput, cashRegisterVersion: number, orderVersion: number, remainingBalanceMinor: number) {
  return Object.freeze({
    amountMinor: input.payment.amount.amountMinor,
    cashRegisterSessionId: input.register.cashRegisterId,
    cashRegisterVersion,
    changeMinor: input.payment.change?.amountMinor ?? null,
    currency: input.payment.amount.currency,
    method: input.command.method,
    tenderedAmountMinor: input.payment.tenderedAmount?.amountMinor ?? null,
    tipMinor: input.payment.tip?.amountMinor ?? 0,
    orderId: input.order.orderId,
    orderStatus: input.order.status as "partially_paid" | "paid",
    orderVersion,
    paymentId: input.payment.paymentId,
    paymentState: "captured" as const,
    remainingBalanceMinor,
    replayed: false,
    schemaVersion: 1 as const,
    scope,
    transferReference: null,
  });
}

function readRegisterResult(register: CashRegister, version: number, capturedAmountMinor: number) {
  return {
    capturedAmountMinor,
    register: encodeCashRegisterRecord(register),
    schemaVersion: 1,
    scope,
    version,
  };
}

async function assertCode(promise: Promise<unknown>, code: FinancialApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof FinancialApplicationError && error.code === code);
}

test("cash payment with tender records server-derived change and a separate tip_in movement", async () => {
  let persisted: PersistPaymentInput | undefined;
  const finances = financialPort({
    read: async () => storedRegister(openRegister(), 1, 0),
    collect: async (_actor, input) => {
      persisted = input;
      return paymentSummary(input, 2, 2, 7_500);
    },
  });
  const summary = await serviceFor(["cashier"], finances, orderPort(payableOrder(), 1)).collect(
    principal,
    collectCommand({ amountMinor: 5_000, cardManualEvidence: null, method: "cash", tenderedAmountMinor: 10_000, tipMinor: 300 }),
  );
  assert.equal(summary.changeMinor, 4_700);
  assert.equal(summary.tenderedAmountMinor, 10_000);
  assert.equal(summary.tipMinor, 300);
  assert.equal(persisted?.payment.amount.amountMinor, 5_000);
  assert.equal(persisted?.payment.change?.amountMinor, 4_700);
  assert.equal(persisted?.orderTotalMinor, 12_500);
  const [sale, tip] = persisted?.register.movements ?? [];
  assert.equal(sale?.type, "cash_sale");
  assert.equal(sale?.amount.amountMinor, 5_000);
  assert.equal(tip?.type, "tip_in");
  assert.equal(tip?.amount.amountMinor, 300);
  assert.equal(tip?.localSequence, 2);
  assert.equal(tip?.source?.type, "payment");
  assert.notEqual(tip?.movementId, sale?.movementId);
  assert.equal(expectedCashBalance(persisted?.register ?? openRegister()).amountMinor, 2_000 + 5_000 + 300);
});

test("tender below the amount, tender with a card, and a stale tender are rejected as request errors", async () => {
  const finances = financialPort({ read: async () => storedRegister(openRegister(), 1, 0) });
  const service = serviceFor(["cashier"], finances, orderPort(payableOrder(), 1));
  await assertCode(service.collect(principal, collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "cash", tenderedAmountMinor: 4_999,
  })), "request");
  await assertCode(service.collect(principal, collectCommand({
    amountMinor: 5_000, method: "card_manual", tenderedAmountMinor: 6_000,
    cardManualEvidence: { externalConfirmed: true, provider: "terminal externo", reference: null, terminalId: "caja-1" },
  })), "request");
  await assertCode(service.collect(principal, collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "cash", tipMinor: -1,
  })), "request");
});

test("card payment records a tip on the payment only, with no cash movement", async () => {
  let persisted: PersistPaymentInput | undefined;
  const finances = financialPort({
    read: async () => storedRegister(openRegister(), 1, 0),
    collect: async (_actor, input) => {
      persisted = input;
      return paymentSummary(input, 2, 2, 0);
    },
  });
  const summary = await serviceFor(["cashier"], finances, orderPort(payableOrder(), 1)).collect(principal, collectCommand({
    amountMinor: 12_500, method: "card_manual", tipMinor: 1_000,
    cardManualEvidence: { externalConfirmed: true, provider: "terminal externo", reference: null, terminalId: "caja-1" },
  }));
  assert.equal(summary.tipMinor, 1_000);
  assert.equal(summary.changeMinor, null);
  assert.equal(persisted?.payment.tip?.amountMinor, 1_000);
  assert.equal(persisted?.payment.amount.amountMinor, 12_500);
  assert.equal(persisted?.register.movements.length, 0);
});

test("transfer collects the exact amount with an optional reference, a tip, and no cash movement", async () => {
  const persisted: PersistPaymentInput[] = [];
  const finances = financialPort({
    read: async () => storedRegister(openRegister(), 1, 0),
    collect: async (_actor, input) => {
      persisted.push(input);
      return paymentSummary(input, 2, 2, 0);
    },
  });
  const service = serviceFor(["cashier"], finances, orderPort(payableOrder(), 1));
  const summary = await service.collect(principal, collectCommand({
    amountMinor: 12_500, cardManualEvidence: null, method: "transfer", tipMinor: 500, transferReference: "SPEI-0001",
  }));
  assert.equal(summary.method, "transfer");
  assert.equal(summary.tipMinor, 500);
  assert.equal(summary.changeMinor, null);
  assert.equal(summary.tenderedAmountMinor, null);
  assert.equal(summary.transferReference, "SPEI-0001");
  assert.equal(persisted[0]?.register.movements.length, 0);
  assert.equal(persisted[0]?.payment.method, "transfer");
  assert.equal(persisted[0]?.payment.cardManualEvidence, undefined);
  assert.equal((persisted[0]?.command as { transferReference?: string }).transferReference, "SPEI-0001");
  // No reference is valid too.
  await service.collect(principal, collectCommand({ amountMinor: 12_500, cardManualEvidence: null, method: "transfer" }));
  // Invalid shapes are request errors: tender, terminal evidence, reference on another method, over-long reference.
  await assertCode(service.collect(principal, collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "transfer", tenderedAmountMinor: 6_000,
  })), "request");
  await assertCode(service.collect(principal, collectCommand({
    amountMinor: 5_000, method: "transfer",
    cardManualEvidence: { externalConfirmed: true, provider: "terminal externo", reference: null, terminalId: "caja-1" },
  })), "request");
  await assertCode(service.collect(principal, collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "cash", transferReference: "SPEI-1",
  })), "request");
  await assertCode(service.collect(principal, collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "transfer", transferReference: "x".repeat(65),
  })), "request");
});

test("transfer quote has zero change and refuses a tender; adapter reads the real { result } rows", async () => {
  const finances = financialPort({ read: async () => storedRegister(openRegister(), 1, 2_500) });
  const service = serviceFor(["cashier"], finances, orderPort(payableOrder(), 1));
  const base = {
    amountMinor: 5_000, cashRegisterSessionId: sessionId, method: "transfer", orderId, schemaVersion: 1,
    scope, tenderedAmountMinor: null, tipMinor: 200,
  };
  const quote = await service.quote(principal, base);
  assert.equal(quote.changeMinor, null);
  assert.equal(quote.remainingAfterMinor, 5_000);
  await assertCode(service.quote(principal, { ...base, tenderedAmountMinor: 6_000 }), "request");

  const register = openRegister();
  const input = await capturedInput(payableOrder(), register);
  const wire = {
    amountMinor: 5_000, cashRegisterSessionId: sessionId, cashRegisterVersion: 2, currency: "MXN", method: "transfer",
    orderId, orderStatus: "partially_paid", orderVersion: 2, paymentId, paymentState: "captured",
    remainingBalanceMinor: 7_500, replayed: false, schemaVersion: 1, scope, tenderedAmountMinor: null, changeMinor: null, tipMinor: 200,
  };
  const adapter = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: wire }] }) });
  const collected = await adapter.collect(actorId, input);
  assert.equal(typeof collected === "string" ? "" : collected.method, "transfer");
  assert.equal(typeof collected === "string" ? "" : collected.transferReference, null, "the stored row carries no reference");
  // Real { result } rows through the service: first call and replay both project the command's reference.
  const rowFinances = financialPort({
    read: async () => storedRegister(openRegister(), 1, 0),
    collect: async () => adapter.collect(actorId, input),
  });
  const rowService = serviceFor(["cashier"], rowFinances, orderPort(payableOrder(), 1));
  const withRef = collectCommand({ amountMinor: 5_000, cardManualEvidence: null, method: "transfer", tipMinor: 200, transferReference: "SPEI-0001" });
  assert.equal((await rowService.collect(principal, withRef)).transferReference, "SPEI-0001");
  const noRef = collectCommand({ amountMinor: 5_000, cardManualEvidence: null, method: "transfer", tipMinor: 200 });
  assert.equal((await rowService.collect(principal, noRef)).transferReference, null);
  const replayFinances = financialPort({ replayCollect: async () => new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { ...wire, replayed: true } }] }) }).replayCollect(actorId, input.command) });
  const replayService = serviceFor(["cashier"], replayFinances, orderPort(payableOrder(), 1));
  const replayedRef = await replayService.collect(principal, withRef);
  assert.equal(replayedRef.transferReference, "SPEI-0001");
  // A replay (idempotent) returns the stored row flagged as replayed.
  const replayAdapter = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { ...wire, replayed: true } }] }) });
  const replayed = await replayAdapter.collect(actorId, input);
  assert.equal(typeof replayed === "string" ? false : replayed.replayed, true);
  // A SQL conflict (invalid shape) maps to 409.
  const conflict = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { status: "conflict" } }] }) });
  assert.equal(await conflict.collect(actorId, input), "conflict");
  // A transfer row carrying change is corrupt.
  const corrupt = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { ...wire, tenderedAmountMinor: 6_000, changeMinor: 800 } }] }) });
  await assertCode(corrupt.collect(actorId, input), "unavailable");

  const report = { ...operationalReport(register, 3, 0, 0), transferCapturedMinor: 5_000, totalCapturedMinor: 5_000, paymentCount: 1 };
  const reportAdapter = new PostgresFinancialPersistenceAdapter({
    query: async () => ({ rows: [{ result: { ...report, register: { ...report.register, openedAt: "2026-09-03T12:00:00+00:00" } } }] }),
  });
  const read = await reportAdapter.readReport(actorId, reportQuery(sessionId));
  assert.equal(typeof read === "string" ? -1 : read.transferCapturedMinor, 5_000);
  // A report from before transfers (no key) still reads as zero.
  const cashOnly = operationalReport(register, 3, 5_000, 0);
  const legacy: Record<string, unknown> = { ...cashOnly, register: { ...cashOnly.register, openedAt: "2026-09-03T12:00:00+00:00" } };
  delete legacy.transferCapturedMinor;
  const legacyAdapter = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: legacy }] }) });
  const legacyRead = await legacyAdapter.readReport(actorId, reportQuery(sessionId));
  assert.equal(typeof legacyRead === "string" ? -1 : legacyRead.transferCapturedMinor, 0);
});

test("payment quote derives change and remaining balance from the live order and rejects bad tender", async () => {
  const finances = financialPort({ read: async () => storedRegister(openRegister(), 1, 2_500) });
  const service = serviceFor(["cashier"], finances, orderPort(payableOrder(), 1));
  const base = {
    amountMinor: 5_000, cashRegisterSessionId: sessionId, method: "cash", orderId, schemaVersion: 1,
    scope, tenderedAmountMinor: 10_000, tipMinor: 200,
  };
  const quote = await service.quote(principal, base);
  assert.equal(quote.changeMinor, 4_800);
  assert.equal(quote.remainingBeforeMinor, 10_000);
  assert.equal(quote.remainingAfterMinor, 5_000);
  assert.equal(quote.currency, "MXN");
  assert.equal((await service.quote(principal, { ...base, tenderedAmountMinor: null })).changeMinor, null);
  await assertCode(service.quote(principal, { ...base, tenderedAmountMinor: 4_999 }), "request");
  await assertCode(service.quote(principal, { ...base, tenderedAmountMinor: 5_199 }), "request");
  await assertCode(service.quote(principal, { ...base, amountMinor: 10_001, tenderedAmountMinor: 20_000 }), "request");
  await assertCode(serviceFor(["viewer"], finances).quote(principal, base), "authorization");
});

test("PostgreSQL adapter parses the real { result } rows for tender, change, tip and report movements", async () => {
  const register = openRegister();
  const input = await capturedInput(payableOrder(), register);
  const wire = {
    amountMinor: 5_000, cashRegisterSessionId: sessionId, cashRegisterVersion: 2, changeMinor: 4_700,
    currency: "MXN", method: "cash", orderId, orderStatus: "partially_paid", orderVersion: 2, paymentId,
    paymentState: "captured", remainingBalanceMinor: 7_500, replayed: false, schemaVersion: 1, scope,
    tenderedAmountMinor: 10_000, tipMinor: 300,
  };
  const adapter = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: wire }] }) });
  const collected = await adapter.collect(actorId, input);
  assert.equal(typeof collected === "string" ? 0 : collected.changeMinor, 4_700);
  const replay = await adapter.replayCollect(actorId, parseCollectPaymentCommandV1(collectCommand({
    amountMinor: 5_000, cardManualEvidence: null, method: "cash", tenderedAmountMinor: 10_000, tipMinor: 300,
  })) ?? input.command);
  assert.equal(typeof replay === "string" ? 0 : replay.tenderedAmountMinor, 10_000);
  const legacy: Record<string, unknown> = { ...wire };
  for (const key of ["changeMinor", "tenderedAmountMinor", "tipMinor"]) delete legacy[key];
  const legacyAdapter = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: legacy }] }) });
  const legacyResult = await legacyAdapter.collect(actorId, input);
  assert.equal(typeof legacyResult === "string" ? 0 : legacyResult.tipMinor, 0);
  // A change that does not equal tender minus amount is a corrupt row, never a result.
  const corrupt = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { ...wire, changeMinor: 1 } }] }) });
  await assertCode(corrupt.collect(actorId, input), "unavailable");

  const movement = {
    amountMinor: 300, direction: "in", movementId: "b1c4a3a0-5a6a-4a58-9a3f-3d5a6f0a1111", note: null,
    occurredAt: "2026-09-03T12:01:00.000Z", sourcePaymentId: paymentId, sourceRefundId: null, type: "tip_in",
  };
  const report = { ...operationalReport(register, 3, 5_000, 0), cashTipsMinor: 300, movementCount: 1, movements: [movement], tipsMinor: 300 };
  const reportAdapter = new PostgresFinancialPersistenceAdapter({
    query: async () => ({ rows: [{ result: { ...report, register: { ...report.register, openedAt: "2026-09-03T12:00:00+00:00" } } }] }),
  });
  const read = await reportAdapter.readReport(actorId, reportQuery(sessionId));
  assert.notEqual(typeof read, "string");
  if (typeof read !== "string") {
    assert.equal(read.tipsMinor, 300);
    assert.equal(read.movements[0]?.type, "tip_in");
    assert.equal(read.register.openedAt, "2026-09-03T12:00:00.000Z");
  }
  const missing: Record<string, unknown> = { ...report };
  delete missing.movements;
  const missingAdapter = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: missing }] }) });
  await assertCode(missingAdapter.readReport(actorId, reportQuery(sessionId)), "unavailable");
});

test("collect on an Order with an active delivery maps the SQL conflict code to delivery_settle_required", async () => {
  const register = openRegister();
  const database: DatabaseClientPort = {
    query: async () => ({ rows: [{ result: { status: "conflict", code: "DELIVERY_SETTLE_REQUIRED" } }] }),
  };
  const adapter = new PostgresFinancialPersistenceAdapter(database);
  const finances = financialPort({
    read: async () => storedRegister(register, 1, 0),
    collect: (actor, input) => adapter.collect(actor, input),
  });
  await assertCode(
    serviceFor(["cashier"], finances, orderPort(payableOrder(), 1)).collect(
      principal, collectCommand({ amountMinor: 5_000, method: "cash", cardManualEvidence: null }),
    ),
    "delivery_settle_required",
  );
  const notDelivered = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { status: "conflict", code: "DELIVERY_NOT_DELIVERED" } }] }) });
  await assertCode(
    serviceFor(["cashier"], financialPort({ read: async () => storedRegister(register, 1, 0), collect: (actor, input) => notDelivered.collect(actor, input) }), orderPort(payableOrder(), 1)).collect(
      principal, collectCommand({ amountMinor: 5_000, method: "cash", cardManualEvidence: null }),
    ),
    "delivery_not_delivered",
  );
  // Any other extra-key shape from SQL fails closed instead of being read as a plain conflict.
  const odd = new PostgresFinancialPersistenceAdapter({ query: async () => ({ rows: [{ result: { status: "conflict", code: "OTHER" } }] }) });
  await assert.rejects(odd.collect(actorId, {
    command: collectCommand({ amountMinor: 5_000, method: "cash", cardManualEvidence: null }) as never,
    order: payableOrder(), orderTotalMinor: 10_000, payment: undefined as never, priorCapturedAmountMinor: 0, register,
  }));
});
