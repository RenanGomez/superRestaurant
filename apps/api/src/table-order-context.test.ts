import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { parseActiveTableOrderListV2, parseBranchScope } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import {
  PostgresTableOrderContextDirectory,
  TableOrderContextError,
  TableOrderContextService,
  type TableOrderContextDirectoryPort,
} from "./table-order-context.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: randomUUID() });
const parsedScope = parseBranchScope({ branchId: randomUUID(), restaurantId: randomUUID() });
if (parsedScope === undefined) throw new Error("TEST_SCOPE_INVALID");
const scope = parsedScope;
const tableId = randomUUID();
const orderItemId = randomUUID();
const productId = randomUUID();
const optionId = randomUUID();
const list = parseActiveTableOrderListV2({
  orders: [{
    currency: "MXN",
    itemCount: 1,
    items: [{
      modifiers: [{
        groupId: null,
        groupName: null,
        optionId,
        optionName: "Bien cocido",
        quantity: 1,
        unitPrice: { amountMinor: 0, currency: "MXN" },
      }],
      orderItemId,
      productId,
      productName: "Arrachera al carbón",
      quantity: 2,
      status: "pending",
      unit: "pieza",
      unitPrice: { amountMinor: 12_500, currency: "MXN" },
    }],
    orderId: randomUUID(),
    shiftId: randomUUID(),
    status: "open",
    tableId,
    updatedAt: "2026-09-05T20:00:00.000Z",
    version: 3,
  }],
  schemaVersion: 2,
  scope,
  tableId,
});
if (list === undefined) throw new Error("TEST_LIST_INVALID");

test("table order context authorizes orders.read and preserves the exact table scope", async () => {
  const received: unknown[] = [];
  const service = serviceFor(["waiter"], {
    listActive: async (actorId, receivedScope, receivedTableId) => {
      received.push(actorId, receivedScope, receivedTableId);
      return list;
    },
  });
  assert.deepEqual(await service.listActive(principal, {
    branchId: scope.branchId.toUpperCase(),
    restaurantId: scope.restaurantId.toUpperCase(),
    tableId: tableId.toUpperCase(),
  }), list);
  assert.deepEqual(received, [principal.actorId, scope, tableId]);
});

test("table order context rejects malformed, unauthorized and forbidden reads", async () => {
  await assertCode(serviceFor(["waiter"], { listActive: async () => list }).listActive(principal, { ...scope, tableId: "bad" }), "request");
  await assertCode(serviceFor([], { listActive: async () => list }).listActive(principal, { ...scope, tableId }), "authorization");
  await assertCode(serviceFor(["waiter"], { listActive: async () => "forbidden" }).listActive(principal, { ...scope, tableId }), "authorization");
  await assertCode(serviceFor(["waiter"], { listActive: async () => { throw new Error("private detail"); } }).listActive(principal, { ...scope, tableId }), "unavailable");
});

test("PostgreSQL table context binds actor and exact identifiers and fails closed", async () => {
  const calls: unknown[][] = [];
  const database: DatabaseClientPort = {
    query: async (_sql, parameters) => {
      calls.push([...parameters]);
      return { rows: [{ state: list }] };
    },
  };
  const directory = new PostgresTableOrderContextDirectory(database);
  assert.deepEqual(await directory.listActive(principal.actorId, scope, tableId), list);
  assert.deepEqual(calls, [[principal.actorId, scope.restaurantId, scope.branchId, tableId]]);
  assert.equal(await new PostgresTableOrderContextDirectory({ query: async () => ({ rows: [{ state: null }] }) }).listActive(principal.actorId, scope, tableId), "forbidden");

  for (const rows of [
    [],
    [{ state: list }, { state: list }],
    [{ state: list, extra: true }],
    [{ state: { ...list, tableId: randomUUID() } }],
  ]) {
    await assert.rejects(
      new PostgresTableOrderContextDirectory({ query: async () => ({ rows }) }).listActive(principal.actorId, scope, tableId),
      TableOrderContextError,
    );
  }
});

function serviceFor(roles: readonly "waiter"[], port: TableOrderContextDirectoryPort): TableOrderContextService {
  const memberships: MembershipLookupPort = {
    findActiveMembership: async () => roles.length === 0 ? undefined : ({ roles, scope }),
  };
  return new TableOrderContextService(new MembershipAuthorizationService(memberships), port);
}

async function assertCode(promise: Promise<unknown>, code: TableOrderContextError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof TableOrderContextError && error.code === code);
}
