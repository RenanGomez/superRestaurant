import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { parseBranchScope, parseOperationalShiftListV1 } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import {
  OperationalShiftApplicationError,
  OperationalShiftService,
  PostgresOperationalShiftDirectory,
  type OperationalShiftDirectoryPort,
} from "./operational-shifts.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: randomUUID() });
const scope = parseBranchScope({ branchId: randomUUID(), restaurantId: randomUUID() });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const list = parseOperationalShiftListV1({
  schemaVersion: 1,
  scope,
  shifts: [{
    name: "Servicio de comida",
    openedAt: "2026-09-05T18:00:00.000Z",
    openedBy: principal.actorId,
    schemaVersion: 1,
    scope,
    shiftId: randomUUID(),
    status: "open",
    version: 1,
  }],
});
if (list === undefined) throw new Error("TEST_LIST_INVALID");

test("operational shift service authorizes the exact branch and lists active shifts", async () => {
  const received: unknown[] = [];
  const service = serviceFor(["waiter"], {
    listActive: async (actorId, receivedScope) => {
      received.push(actorId, receivedScope);
      return list;
    },
  });
  assert.deepEqual(await service.listActive(principal, scope), list);
  assert.deepEqual(received, [principal.actorId, scope]);
});

test("operational shift service rejects malformed, unauthorized and forbidden reads", async () => {
  await assertCode(serviceFor(["waiter"], { listActive: async () => list }).listActive(principal, { ...scope, branchId: "bad" }), "request");
  await assertCode(serviceFor([], { listActive: async () => list }).listActive(principal, scope), "authorization");
  await assertCode(serviceFor(["waiter"], { listActive: async () => "forbidden" }).listActive(principal, scope), "authorization");
  await assertCode(serviceFor(["waiter"], { listActive: async () => { throw new Error("secret"); } }).listActive(principal, scope), "unavailable");
});

test("PostgreSQL directory binds actor and scope and fails closed on malformed state", async () => {
  const calls: readonly unknown[][] = [];
  const database: DatabaseClientPort = {
    query: async (_sql, parameters) => {
      (calls as unknown[][]).push([...parameters]);
      return { rows: [{ state: list }] };
    },
  };
  const directory = new PostgresOperationalShiftDirectory(database);
  assert.deepEqual(await directory.listActive(principal.actorId, scope), list);
  assert.deepEqual(calls, [[principal.actorId, scope.restaurantId, scope.branchId]]);

  assert.equal(await new PostgresOperationalShiftDirectory({ query: async () => ({ rows: [{ state: null }] }) }).listActive(principal.actorId, scope), "forbidden");
  for (const rows of [[], [{ state: list }, { state: list }], [{ state: list, extra: true }], [{ state: { ...list, scope: { ...scope, branchId: randomUUID() } } }]]) {
    await assert.rejects(
      new PostgresOperationalShiftDirectory({ query: async () => ({ rows }) }).listActive(principal.actorId, scope),
      OperationalShiftApplicationError,
    );
  }
});

function serviceFor(roles: readonly "waiter"[], port: OperationalShiftDirectoryPort): OperationalShiftService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => roles.length === 0 ? undefined : ({ roles, scope: validScope }) };
  return new OperationalShiftService(new MembershipAuthorizationService(memberships), port);
}

async function assertCode(promise: Promise<unknown>, code: OperationalShiftApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof OperationalShiftApplicationError && error.code === code);
}
