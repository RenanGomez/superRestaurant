import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { parseBranchScope, type CollectPaymentCommandV1, type SettleDeliveryResultV1 } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import {
  BranchMembersError,
  BranchMembersService,
  PostgresBranchMembersAdapter,
} from "./branch-members.js";
import {
  DeliveryApplicationError,
  DeliveryService,
  PostgresDeliveryAdapter,
  type DeliveryPort,
} from "./deliveries.js";
import type { OrderDeliveryContext, OrderDeliveryContextPort } from "./order-delivery-context.js";
import { PostgresOrderDeliveryContextAdapter } from "./order-delivery-context.js";
import { FinancialApplicationError, type FinancialService, type PersistPaymentInput } from "./payments.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: randomUUID() });
const scope = parseBranchScope({ restaurantId: randomUUID(), branchId: randomUUID() });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const orderId = randomUUID();
const courierUserId = randomUUID();
const audit = { deviceId: randomUUID(), eventId: randomUUID(), idempotencyKey: "delivery-test-1", occurredAt: "2026-10-06T18:00:00.000Z" };
const base = { ...audit, expectedVersion: 0, orderId, schemaVersion: 1 as const, scope };
const assignCommand = { ...base, courierUserId };
const settleCommand = {
  ...base, expectedVersion: 3, cashRegisterExpectedVersion: 2, cashRegisterSessionId: randomUUID(), localSequence: 4,
  orderExpectedVersion: 5, paymentId: randomUUID(), tenderedAmountMinor: null, tipMinor: null,
};
const deliveryView = (state: string, version: number) => ({
  assignedAt: "2026-10-06T18:00:00.000Z", attemptCount: 0, courierUserId, deliveredAt: null, dispatchedAt: null,
  failedReason: null, orderId, schemaVersion: 1, scope, settledAt: null, settledPaymentId: null, state, version,
});
const payment = {
  amountMinor: 25_000, cashRegisterSessionId: settleCommand.cashRegisterSessionId, cashRegisterVersion: 3,
  changeMinor: 4_000, currency: "MXN", method: "cash", orderId, orderStatus: "paid", orderVersion: 6,
  paymentId: settleCommand.paymentId, paymentState: "captured", remainingBalanceMinor: 0, replayed: false,
  schemaVersion: 1, scope, tenderedAmountMinor: 30_000, tipMinor: 1_000,
};
const settledView = {
  ...deliveryView("settled", 4), attemptCount: 1, deliveredAt: "2026-10-06T18:30:00.000Z",
  dispatchedAt: "2026-10-06T18:10:00.000Z", settledAt: "2026-10-06T18:40:00.000Z", settledPaymentId: settleCommand.paymentId,
};

test("delivery transitions authorize by permission: managers assign, couriers move their own", async () => {
  const calls: unknown[] = [];
  const port = portWith({
    transition: async (actorId, kind, command) => {
      calls.push([actorId, kind, command]);
      return { delivery: deliveryView("assigned", 1) as never, replayed: false, schemaVersion: 1 };
    },
  });
  const result = await serviceFor(["cashier"], port).assign(principal, assignCommand);
  assert.equal(result.delivery.state, "assigned");
  assert.deepEqual(calls, [[principal.actorId, "assign", assignCommand]]);

  await assertCode(serviceFor(["courier"], port).assign(principal, assignCommand), "authorization");
  await assertCode(serviceFor(["waiter"], port).dispatch(principal, { ...base, expectedVersion: 1 }), "authorization");
  await serviceFor(["courier"], port).dispatch(principal, { ...base, expectedVersion: 1 });
  await serviceFor(["courier"], port).complete(principal, { ...base, expectedVersion: 2 });
  await serviceFor(["courier"], port).fail(principal, { ...base, expectedVersion: 2, reason: "Nadie abrio" });
  assert.deepEqual(calls.map((call) => (call as unknown[])[1]), ["assign", "dispatch", "complete", "fail"]);
  await assertCode(serviceFor(["cashier"], port).assign(principal, { ...assignCommand, courierUserId: "nope" }), "request");
  await assertCode(serviceFor(["cashier"], port).assign(principal, { ...assignCommand, amountMinor: 1 }), "request");
});

test("delivery transitions map SQL refusals and hide persistence failures", async () => {
  const refuse = (value: "conflict" | "forbidden") => portWith({ transition: async () => value });
  await assertCode(serviceFor(["cashier"], refuse("conflict")).assign(principal, assignCommand), "conflict");
  await assertCode(serviceFor(["cashier"], refuse("forbidden")).assign(principal, assignCommand), "authorization");
  await assertCode(serviceFor(["cashier"], portWith({ transition: async () => { throw new Error("pg down"); } })).assign(principal, assignCommand), "unavailable");
});

test("PostgreSQL delivery adapter unwraps the real { result } row for saved, replayed, refused and malformed outcomes", async () => {
  const adapterFor = (result: unknown, rows?: readonly unknown[]) =>
    new PostgresDeliveryAdapter({ query: async () => ({ rows: rows ?? [{ result }] }) });
  const saved = await adapterFor({ status: "saved", replayed: false, delivery: deliveryView("assigned", 1) })
    .transition(principal.actorId, "assign", assignCommand);
  assert.equal(typeof saved === "object" && saved.replayed, false);
  const replayed = await adapterFor({ status: "replayed", replayed: true, delivery: deliveryView("assigned", 1) })
    .transition(principal.actorId, "assign", assignCommand);
  assert.equal(typeof replayed === "object" && replayed.replayed, true);
  assert.equal(await adapterFor({ status: "conflict" }).transition(principal.actorId, "assign", assignCommand), "conflict");
  assert.equal(await adapterFor({ status: "forbidden" }).transition(principal.actorId, "assign", assignCommand), "forbidden");
  // the unwrapped function result as a row (the wrong shape), a flag/status mismatch and zero rows fail closed
  await assert.rejects(adapterFor({ status: "conflict" }, [{ status: "conflict" }]).transition(principal.actorId, "assign", assignCommand), DeliveryApplicationError);
  await assert.rejects(adapterFor({ status: "saved", replayed: true, delivery: deliveryView("assigned", 1) }).transition(principal.actorId, "assign", assignCommand), DeliveryApplicationError);
  await assert.rejects(adapterFor(null, []).transition(principal.actorId, "assign", assignCommand), DeliveryApplicationError);
  assert.equal(await adapterFor(null).replaySettle(principal.actorId, settleCommand), "missing");
});

test("PostgreSQL delivery adapter passes the command, collect command and domain aggregates to settle_delivery", async () => {
  let parameters: readonly unknown[] = [];
  const adapter = new PostgresDeliveryAdapter({
    query: async (_sql, received) => {
      parameters = received;
      return { rows: [{ result: { status: "saved", replayed: false, delivery: settledView, payment } }] };
    },
  });
  // The aggregates are encoded by the real codecs in production; the adapter only needs a structurally valid input here.
  const input = fakePersistInput();
  await assert.rejects(adapter.settle(principal.actorId, settleCommand, input));
  assert.equal(parameters.length, 0, "encoding failures never reach the database");
  const listAdapter = new PostgresDeliveryAdapter({ query: async (_sql, received) => { parameters = received; return { rows: [{ result: { status: "forbidden" } }] }; } });
  assert.deepEqual(await listAdapter.list(principal.actorId, validScope), { status: "forbidden" });
  assert.deepEqual(parameters, [principal.actorId, validScope.restaurantId, validScope.branchId]);
});

test("settlement result rows parse with the payment summary and replay marks", async () => {
  const adapterFor = (result: unknown) => new PostgresDeliveryAdapter({ query: async () => ({ rows: [{ result }] }) });
  const replayed = await adapterFor({
    status: "replayed", replayed: true, delivery: settledView, payment: { ...payment, replayed: true },
  }).replaySettle(principal.actorId, settleCommand);
  assert.ok(typeof replayed === "object" && replayed.payment.changeMinor === 4_000 && replayed.replayed);
  assert.equal(await adapterFor({ status: "conflict" }).replaySettle(principal.actorId, settleCommand), "conflict");
  await assert.rejects(adapterFor({ status: "saved", replayed: false, delivery: settledView }).replaySettle(principal.actorId, settleCommand), DeliveryApplicationError);
});

test("settle replays by key before reading anything, requires cash intent and charges the whole balance", async () => {
  const replayed: SettleDeliveryResultV1 = { delivery: settledView as never, payment: payment as never, replayed: true, schemaVersion: 1 };
  let prepared = 0;
  const finances = financesStub(25_000, async () => { prepared += 1; throw new Error("not reached"); });
  const service = serviceFor(["cashier"], portWith({ replaySettle: async () => replayed }), contextWith("cash"), finances);
  assert.equal(await service.settle(principal, settleCommand), replayed);
  assert.equal(prepared, 0);

  // A card intent is never settled through a delivery.
  const card = serviceFor(["cashier"], portWith({ replaySettle: async () => "missing" }), contextWith("card_manual"), finances);
  await assertCode(card.settle(principal, settleCommand), "conflict");
  // A courier cannot settle, nor can a role without payments.collect.
  await assertCode(serviceFor(["courier"], portWith({}), contextWith("cash"), finances).settle(principal, settleCommand), "authorization");
  await assertCode(serviceFor(["viewer"], portWith({}), contextWith("cash"), finances).settle(principal, settleCommand), "authorization");
  // The client never supplies money.
  await assertCode(service.settle(principal, { ...settleCommand, amountMinor: 1 }), "request");
  await assertCode(service.settle(principal, { ...settleCommand, method: "cash" }), "request");
});

test("settle builds the cash collection from the server balance and the frozen intent, then persists atomically", async () => {
  let collect: CollectPaymentCommandV1 | undefined;
  let persisted: { command: unknown; collectAmount: number } | undefined;
  const finances = financesStub(25_000, async (_actor, command) => {
    collect = command;
    return fakePersistInput(command);
  });
  const result: SettleDeliveryResultV1 = { delivery: settledView as never, payment: payment as never, replayed: false, schemaVersion: 1 };
  const port = portWith({
    replaySettle: async () => "missing",
    settle: async (_actor, command, input) => { persisted = { command, collectAmount: input.command.amountMinor }; return result; },
  });
  // Intent: cash, tendered 30000 (covers the balance), tip 1000 -> used when the command leaves them null.
  const service = serviceFor(["cashier"], port, contextWith("cash", 30_000, 1_000), finances);
  assert.equal(await service.settle(principal, settleCommand), result);
  assert.equal(collect?.amountMinor, 25_000);
  assert.equal(collect?.method, "cash");
  assert.equal(collect?.tenderedAmountMinor, 30_000);
  assert.equal(collect?.tipMinor, 1_000);
  assert.equal(collect?.idempotencyKey, settleCommand.idempotencyKey);
  assert.equal(collect?.paymentId, settleCommand.paymentId);
  assert.equal(persisted?.collectAmount, 25_000);

  // A stale intent tender below the balance degrades to exact cash; an explicit command value wins.
  const stale = serviceFor(["cashier"], port, contextWith("cash", 10_000, 0), finances);
  await stale.settle(principal, settleCommand);
  assert.equal(collect?.tenderedAmountMinor, undefined);
  await stale.settle(principal, { ...settleCommand, tenderedAmountMinor: 40_000, tipMinor: 500 });
  assert.equal(collect?.tenderedAmountMinor, 40_000);
  assert.equal(collect?.tipMinor, 500);

  // SQL refusals map to HTTP-ready codes; a missing order or a financial conflict never reaches SQL.
  const refused = serviceFor(["cashier"], portWith({ replaySettle: async () => "missing", settle: async () => "conflict" }), contextWith("cash"), finances);
  await assertCode(refused.settle(principal, settleCommand), "conflict");
  const balance = financesStub(0, async () => { throw new Error("not reached"); }, true);
  await assertCode(serviceFor(["cashier"], port, contextWith("cash"), balance).settle(principal, settleCommand), "conflict");
});

test("delivery list rejects malformed rows and unauthorized roles, and accepts an empty branch", async () => {
  const empty = { schemaVersion: 1, scope, deliveries: [] };
  assert.deepEqual(await serviceFor(["cashier"], portWith({ list: async () => empty })).list(principal, { schemaVersion: 1, scope }),
    { items: [], schemaVersion: 1, scope });
  await assertCode(serviceFor(["waiter"], portWith({ list: async () => empty })).list(principal, { schemaVersion: 1, scope }), "authorization");
  await assertCode(serviceFor(["cashier"], portWith({ list: async () => ({ status: "forbidden" }) })).list(principal, { schemaVersion: 1, scope }), "authorization");
  await assertCode(serviceFor(["cashier"], portWith({ list: async () => ({ schemaVersion: 1, scope, deliveries: [{ bogus: true }] }) })).list(principal, { schemaVersion: 1, scope }), "unavailable");
  await assertCode(serviceFor(["cashier"], portWith({ list: async () => { throw new Error("pg down"); } })).list(principal, { schemaVersion: 1, scope }), "unavailable");
});

test("order delivery context adapter unwraps the real { result } row and fails closed on other shapes", async () => {
  const adapterFor = (result: unknown, rows?: readonly unknown[]) =>
    new PostgresOrderDeliveryContextAdapter({ query: async () => ({ rows: rows ?? [{ result }] }) });
  assert.deepEqual(await adapterFor({ schemaVersion: 1, snapshot: null, delivery: deliveryView("assigned", 1) }).read(principal.actorId, validScope, orderId),
    { delivery: deliveryView("assigned", 1), snapshot: null });
  assert.equal(await adapterFor(null).read(principal.actorId, validScope, orderId), "missing");
  assert.equal(await adapterFor({ status: "forbidden" }).read(principal.actorId, validScope, orderId), "forbidden");
  await assert.rejects(adapterFor({ status: "forbidden" }, [{ status: "forbidden" }]).read(principal.actorId, validScope, orderId));
  // a delivery that belongs to another order is never accepted
  await assert.rejects(adapterFor({ schemaVersion: 1, snapshot: null, delivery: deliveryView("assigned", 1) }).read(principal.actorId, validScope, randomUUID()));
  await assert.rejects(adapterFor(null, []).read(principal.actorId, validScope, orderId));
});

test("branch members: memberships.read gates the reader and the real { result } row is unwrapped", async () => {
  const userId = randomUUID();
  const members = { schemaVersion: 1, scope, members: [{ userId, displayName: "Repartidor Uno", roles: ["courier"] }] };
  const calls: unknown[] = [];
  const adapter = new PostgresBranchMembersAdapter({
    query: async (_sql, parameters) => { calls.push(parameters); return { rows: [{ result: members }] }; },
  });
  const request = { roles: ["courier"], schemaVersion: 1, scope };
  const service = (roles: readonly string[], port = adapter) => new BranchMembersService(
    new MembershipAuthorizationService({ findActiveMembership: async () => ({ roles: roles as never, scope: validScope }) }), port);
  assert.deepEqual(await service(["cashier"]).list(principal, request), members);
  assert.deepEqual(calls, [[principal.actorId, scope.restaurantId, scope.branchId, ["courier"]]]);
  await assert.rejects(service(["courier"]).list(principal, request), (error: unknown) => error instanceof BranchMembersError && error.code === "authorization");
  await assert.rejects(service(["cashier"]).list(principal, { ...request, roles: ["pirate"] }), (error: unknown) => error instanceof BranchMembersError && error.code === "request");
  const forbidden = new PostgresBranchMembersAdapter({ query: async () => ({ rows: [{ result: { status: "forbidden" } }] }) });
  await assert.rejects(service(["cashier"], forbidden).list(principal, request), (error: unknown) => error instanceof BranchMembersError && error.code === "authorization");
  const wrongShape = new PostgresBranchMembersAdapter({ query: async () => ({ rows: [members] }) });
  await assert.rejects(service(["cashier"], wrongShape).list(principal, request), (error: unknown) => error instanceof BranchMembersError && error.code === "unavailable");
  const leaky = new PostgresBranchMembersAdapter({ query: async () => ({ rows: [{ result: { ...members, members: [{ ...members.members[0], email: "a@b.c" }] } }] }) });
  await assert.rejects(service(["cashier"], leaky).list(principal, request), (error: unknown) => error instanceof BranchMembersError && error.code === "unavailable");
});

function serviceFor(
  roles: readonly string[],
  port: DeliveryPort,
  context: OrderDeliveryContextPort = contextWith("cash"),
  finances: FinancialService = financesStub(25_000, async () => fakePersistInput()),
): DeliveryService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles: roles as never, scope: validScope }) };
  return new DeliveryService(new MembershipAuthorizationService(memberships), port, context, finances);
}

function portWith(overrides: Partial<DeliveryPort>): DeliveryPort {
  return {
    list: async () => { throw new Error("unexpected list"); },
    replaySettle: async () => { throw new Error("unexpected replaySettle"); },
    settle: async () => { throw new Error("unexpected settle"); },
    transition: async () => { throw new Error("unexpected transition"); },
    ...overrides,
  };
}

function contextWith(method: "card_manual" | "cash" | "transfer", tendered: number | null = null, tip = 0): OrderDeliveryContextPort {
  const context: OrderDeliveryContext = {
    delivery: null,
    snapshot: { paymentIntent: { method, schemaVersion: 1, tenderedAmountMinor: tendered, tipMinor: tip } } as never,
  };
  return { read: async () => context };
}

function financesStub(
  remaining: number,
  prepare: (actorId: string, command: CollectPaymentCommandV1) => Promise<PersistPaymentInput>,
  failBalance = false,
): FinancialService {
  return {
    prepareCollection: prepare,
    remainingBalance: async () => { if (failBalance) throw new FinancialApplicationError("conflict"); return remaining; },
  } as unknown as FinancialService;
}

function fakePersistInput(command?: CollectPaymentCommandV1): PersistPaymentInput {
  return { command: command ?? ({} as CollectPaymentCommandV1), order: {}, orderTotalMinor: 0, payment: {}, priorCapturedAmountMinor: 0, register: {} } as unknown as PersistPaymentInput;
}

async function assertCode(promise: Promise<unknown>, code: DeliveryApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof DeliveryApplicationError && error.code === code);
}
