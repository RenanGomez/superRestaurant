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
  readonly paymentId?: string;
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
    listKdsTickets: async () => "forbidden",
    persist: async () => ({ status: "conflict" }),
    read: async () => read(),
    recoverKds: async () => "forbidden",
  };
}

function financialPort(overrides: Partial<FinancialPersistencePort> = {}): FinancialPersistencePort {
  return {
    close: async () => "conflict",
    collect: async () => "conflict",
    open: async () => "conflict",
    read: async () => "missing",
    replayClose: async () => "missing",
    replayCollect: async () => "missing",
    replayOpen: async () => "missing",
    ...overrides,
  };
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
    currency: input.payment.amount.currency,
    method: input.command.method,
    orderId: input.order.orderId,
    orderStatus: input.order.status as "partially_paid" | "paid",
    orderVersion,
    paymentId: input.payment.paymentId,
    paymentState: "captured" as const,
    remainingBalanceMinor,
    replayed: false,
    schemaVersion: 1 as const,
    scope,
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
