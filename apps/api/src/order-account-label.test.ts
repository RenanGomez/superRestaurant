import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import {
  OrderAccountLabelApplicationError,
  OrderAccountLabelService,
  PostgresOrderAccountLabelAdapter,
  type OrderAccountLabelPort,
} from "./order-account-label.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: randomUUID() });
const scope = parseBranchScope({ restaurantId: randomUUID(), branchId: randomUUID() });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const orderId = randomUUID();
const accountLabel = "Cuenta VIP";
const command = Object.freeze({
  accountLabel,
  deviceId: randomUUID(),
  eventId: randomUUID(),
  expectedVersion: 1,
  idempotencyKey: "account-label-test-1",
  occurredAt: "2026-09-01T18:00:00.000Z",
  orderId,
  schemaVersion: 1 as const,
  scope,
});

test("order account label service authorizes orders.update, sets label, and surfaces conflict/forbidden", async () => {
  const received: unknown[] = [];
  const writer: OrderAccountLabelPort = {
    setAccountLabel: async (actorId, receivedCommand) => {
      received.push(actorId, receivedCommand);
      return { accountLabel, status: "saved", version: 2 };
    },
  };
  const service = serviceFor(["manager"], writer);
  const result = await service.setAccountLabel(principal, command);
  assert.deepEqual(result, {
    accountLabel,
    orderId: command.orderId,
    replayed: false,
    schemaVersion: 1,
    scope,
    version: 2,
  });
  assert.deepEqual(received, [principal.actorId, command]);

  await assertCode(serviceFor(["kitchen"], writer).setAccountLabel(principal, command), "authorization");
  await assertCode(serviceFor(["manager"], { setAccountLabel: async () => ({ status: "conflict" }) }).setAccountLabel(principal, command), "conflict");
  await assertCode(serviceFor(["manager"], { setAccountLabel: async () => ({ status: "forbidden" }) }).setAccountLabel(principal, command), "authorization");
  await assertCode(serviceFor(["manager"], writer).setAccountLabel(principal, { ...command, expectedVersion: 0 }), "request");
  await assertCode(serviceFor(["manager"], writer).setAccountLabel(principal, { ...command, accountLabel: "x".repeat(61) }), "request");
});

test("order account label service clears an account label with accountLabel: null or omitted", async () => {
  const writer: OrderAccountLabelPort = {
    setAccountLabel: async () => ({ accountLabel: null, status: "replayed", version: 3 }),
  };
  const resultNull = await serviceFor(["manager"], writer).setAccountLabel(principal, { ...command, accountLabel: null });
  assert.deepEqual(resultNull, {
    accountLabel: null,
    orderId: command.orderId,
    replayed: true,
    schemaVersion: 1,
    scope,
    version: 3,
  });

  const { accountLabel: _unused, ...omitted } = command;
  void _unused;
  const resultOmitted = await serviceFor(["manager"], writer).setAccountLabel(principal, omitted);
  assert.deepEqual(resultOmitted, {
    accountLabel: null,
    orderId: command.orderId,
    replayed: true,
    schemaVersion: 1,
    scope,
    version: 3,
  });
});

test("PostgreSQL account label adapter sends only payload.to; the audit from is derived in SQL", async () => {
  let audit: Record<string, unknown> | undefined;
  const adapter = new PostgresOrderAccountLabelAdapter({
    query: async (_sql, parameters) => {
      audit = JSON.parse(String(parameters[6])) as Record<string, unknown>;
      return { rows: [{ result: { status: "conflict" } }] };
    },
  });
  assert.deepEqual(await adapter.setAccountLabel(principal.actorId, command), { status: "conflict" });
  assert.deepEqual(audit?.payload, { to: accountLabel });
  assert.equal(audit?.operation, "order.account_label_set");
});

test("PostgreSQL account label adapter unwraps the real { result } row for saved, replayed and malformed outcomes", async () => {
  const order = (version: number, label: string | null) => ({
    accountLabel: label,
    branchId: scope.branchId,
    orderId: command.orderId,
    restaurantId: scope.restaurantId,
    version,
  });
  const adapterFor = (result: unknown, rows?: readonly unknown[]) =>
    new PostgresOrderAccountLabelAdapter({ query: async () => ({ rows: rows ?? [{ result }] }) });

  assert.deepEqual(
    await adapterFor({ order: order(2, accountLabel), status: "saved", version: 2 }).setAccountLabel(principal.actorId, command),
    { accountLabel, status: "saved", version: 2 },
  );
  assert.deepEqual(
    await adapterFor({ order: order(2, accountLabel), status: "replayed", version: "2" }).setAccountLabel(principal.actorId, command),
    { accountLabel, status: "replayed", version: 2 },
  );
  assert.deepEqual(await adapterFor({ status: "forbidden" }).setAccountLabel(principal.actorId, command), { status: "forbidden" });

  await assert.rejects(
    adapterFor({ status: "conflict" }, [{ status: "conflict" }]).setAccountLabel(principal.actorId, command),
    OrderAccountLabelApplicationError,
  );
  await assert.rejects(adapterFor(null, []).setAccountLabel(principal.actorId, command), OrderAccountLabelApplicationError);
});

function serviceFor(roles: readonly ("manager" | "kitchen")[], writer: OrderAccountLabelPort): OrderAccountLabelService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope: validScope }) };
  return new OrderAccountLabelService(new MembershipAuthorizationService(memberships), writer);
}

async function assertCode(promise: Promise<unknown>, code: OrderAccountLabelApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof OrderAccountLabelApplicationError && error.code === code);
}
