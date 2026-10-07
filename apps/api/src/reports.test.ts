import assert from "node:assert/strict";
import test from "node:test";

import { Test } from "@nestjs/testing";
import { parseBranchScope } from "@super-restaurant/shared-types";

import { AppModule } from "./app.module.js";
import { AUTH_PRINCIPAL_VERIFIER, type AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService } from "./auth/membership-authorization.js";
import { DATABASE_CLIENT } from "./database.js";
import { PostgresBranchDaySummary, ReportsError, ReportsService } from "./reports.js";

const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const actorId = "aa9a25b7-3c6a-4c0e-8f2e-9e4c5a6b7c8d";
const scope = parseBranchScope({ restaurantId, branchId });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const principal: AuthenticatedPrincipal = Object.freeze({ actorId });
const request = { date: "2026-10-05", schemaVersion: 1 as const, scope };

const zero = { amountMinor: 0, paymentCount: 0, tipMinor: 0 };
function summary(overrides: Record<string, unknown> = {}) {
  return {
    cancellations: { captures: 0, orders: 0 }, currency: "MXN", date: "2026-10-05",
    deliveriesSettled: { cashCollectedMinor: 0, count: 0 }, deliveryFees: { amountMinor: 0, orderCount: 0 },
    ordersPaid: { amountMinor: 0, count: 0 },
    salesByChannel: ["table", "counter", "takeout", "delivery"].map((channel) => ({ channel, ...zero })),
    salesByMethod: ["cash", "card_manual", "transfer"].map((method) => ({ method, ...zero })),
    schemaVersion: 1, scope, shifts: [], timeZone: "America/Hermosillo",
    totals: { cashTipsMinor: 0, paymentCount: 0, salesMinor: 0, tipsMinor: 0 },
    ...overrides,
  };
}

function serviceOver(result: unknown, roles: readonly string[] = ["manager"]): ReportsService {
  const authorization = { authorizeBranch: async () => ({ principal: { actorId }, roles }) } as never;
  const adapter = new PostgresBranchDaySummary({ query: async () => ({ rows: [{ result }] }) });
  return new ReportsService(authorization, adapter);
}

test("adapter binds the actor, sends the exact request jsonb and reads the real { result } row", async () => {
  const calls: unknown[][] = [];
  const adapter = new PostgresBranchDaySummary({ query: async (_sql, parameters) => {
    calls.push([...parameters]);
    return { rows: [{ result: summary() }] };
  } });
  assert.deepEqual(await adapter.daySummary(actorId, request), summary());
  assert.equal(calls[0]?.[0], actorId);
  assert.deepEqual(JSON.parse(calls[0]?.[1] as string), { date: "2026-10-05", schemaVersion: 1, scope });
});

test("service returns the parsed summary over a real row", async () => {
  const result = await serviceOver(summary()).daySummary(principal, request);
  assert.equal(result.totals.salesMinor, 0);
  assert.equal(result.salesByChannel.length, 4);
});

test("service projects refundPendingMinor from a real { result } row, and reads it as 0 from an older reader", async () => {
  const withRefund = await serviceOver(summary({ cancellations: { captures: 0, orders: 2, refundPendingMinor: 5500 } }))
    .daySummary(principal, request);
  assert.equal(withRefund.cancellations.refundPendingMinor, 5500);
  const older = await serviceOver(summary()).daySummary(principal, request);
  assert.equal(older.cancellations.refundPendingMinor, 0);
});

test("service maps SQL statuses and malformed answers to closed errors", async () => {
  const codeOf = async (raw: unknown, input: unknown = request): Promise<string> => {
    try { await serviceOver(raw).daySummary(principal, input); return "ok"; } catch (error) {
      return error instanceof ReportsError ? error.code : "other";
    }
  };
  assert.equal(await codeOf({ status: "denied" }), "authorization");
  assert.equal(await codeOf({ status: "rejected" }), "request");
  assert.equal(await codeOf({ status: "conflict" }), "unavailable");
  assert.equal(await codeOf(null), "unavailable");
  assert.equal(await codeOf(summary({ date: "2026-10-04" })), "unavailable");
  assert.equal(await codeOf(summary({ scope: { restaurantId, branchId: actorId } })), "unavailable");
  assert.equal(await codeOf(summary({ totals: { cashTipsMinor: 0, paymentCount: 0, salesMinor: 5, tipsMinor: 0 } })), "unavailable");
  assert.equal(await codeOf(summary(), { ...request, date: "nope" }), "request");
});

test("authorization failure and adapter failure never leak details", async () => {
  const denied = new ReportsService({ authorizeBranch: async () => { throw new Error("secret"); } } as never,
    { daySummary: async () => summary() });
  await assert.rejects(denied.daySummary(principal, request), (e: unknown) => e instanceof ReportsError && e.code === "authorization");
  const broken = new ReportsService({ authorizeBranch: async () => ({ principal: { actorId }, roles: ["manager"] }) } as never,
    { daySummary: async () => { throw new Error("secret connection string"); } });
  await assert.rejects(broken.daySummary(principal, request), (e: unknown) => e instanceof ReportsError && e.code === "unavailable");
});

test("POST /reports/day-summary: 401, 400, 201 no-store, 403 by role and 503 without leaking", async () => {
  let roles: readonly string[] = ["manager"];
  let broken = false;
  const memberships = { findActiveMembership: async () => ({ roles: roles as never, scope }) };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE_CLIENT).useValue({ query: async () => {
      if (broken) throw new Error("secret connection string");
      return { rows: [{ result: summary() }] };
    } })
    .overrideProvider(MembershipAuthorizationService).useValue(new MembershipAuthorizationService(memberships))
    .overrideProvider(AUTH_PRINCIPAL_VERIFIER).useValue({ verifyAccessToken: async () => principal })
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/api/v1/reports/day-summary`;
  const send = (body: unknown, authenticated = true) => fetch(url, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer reports-fixture-token" } : {}) },
  });
  try {
    assert.equal((await send(request, false)).status, 401);
    assert.equal((await send({})).status, 400);
    const ok = await send(request);
    assert.equal(ok.status, 201, await ok.clone().text());
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    assert.equal(((await ok.json()) as { date: string }).date, "2026-10-05");
    roles = ["cashier"];
    const denied = await send(request);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { code: "ACTION_NOT_AUTHORIZED" });
    roles = ["viewer"];
    assert.equal((await send(request)).status, 201);
    broken = true;
    const down = await send(request);
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { code: "REPORTS_UNAVAILABLE" });
  } finally {
    await app.close();
  }
});
