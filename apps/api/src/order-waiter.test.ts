import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import { OrderWaiterApplicationError, OrderWaiterService, type OrderWaiterPort } from "./order-waiter.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: randomUUID() });
const scope = parseBranchScope({ restaurantId: randomUUID(), branchId: randomUUID() });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const waiterUserId = randomUUID();
const command = Object.freeze({
  schemaVersion: 1 as const, scope, orderId: randomUUID(), expectedVersion: 1, waiterUserId,
  eventId: randomUUID(), idempotencyKey: "assign-waiter-test-1", deviceId: randomUUID(),
  occurredAt: "2026-09-01T18:00:00.000Z",
});

test("order waiter service authorizes orders.update, assigns, and surfaces conflict/forbidden", async () => {
  const received: unknown[] = [];
  const writer: OrderWaiterPort = {
    assign: async (actorId, receivedCommand) => { received.push(actorId, receivedCommand); return { status: "saved", version: 2, waiterUserId }; },
  };
  const service = serviceFor(["manager"], writer);
  const result = await service.assign(principal, command);
  assert.deepEqual(result, { orderId: command.orderId, replayed: false, schemaVersion: 1, scope, version: 2, waiterUserId });
  assert.deepEqual(received, [principal.actorId, command]);

  await assertCode(serviceFor(["kitchen"], writer).assign(principal, command), "authorization");
  await assertCode(serviceFor(["manager"], { assign: async () => ({ status: "conflict" }) }).assign(principal, command), "conflict");
  await assertCode(serviceFor(["manager"], { assign: async () => ({ status: "forbidden" }) }).assign(principal, command), "authorization");
  await assertCode(serviceFor(["manager"], writer).assign(principal, { ...command, expectedVersion: 0 }), "request");
});

test("order waiter service clears a waiter with waiterUserId: null", async () => {
  const writer: OrderWaiterPort = { assign: async () => ({ status: "replayed", version: 3, waiterUserId: null }) };
  const result = await serviceFor(["manager"], writer).assign(principal, { ...command, waiterUserId: null });
  assert.deepEqual(result, { orderId: command.orderId, replayed: true, schemaVersion: 1, scope, version: 3, waiterUserId: null });
});

function serviceFor(roles: readonly ("manager" | "kitchen")[], writer: OrderWaiterPort): OrderWaiterService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope: validScope }) };
  return new OrderWaiterService(new MembershipAuthorizationService(memberships), writer);
}

async function assertCode(promise: Promise<unknown>, code: OrderWaiterApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof OrderWaiterApplicationError && error.code === code);
}
