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
  type OperationalShiftWriterPort,
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

test("PostgreSQL directory open unwraps the real { result } row and fails closed on the unwrapped shape", async () => {
  const directoryFor = (rows: readonly unknown[]) => new PostgresOperationalShiftDirectory({ query: async () => ({ rows }) });
  assert.deepEqual(
    await directoryFor([{ result: { status: "saved", shiftId: openCommand.shiftId } }]).open(principal.actorId, openCommand),
    { shiftId: openCommand.shiftId, status: "saved" },
  );
  assert.deepEqual(
    await directoryFor([{ result: { status: "replayed", shiftId: openCommand.shiftId } }]).open(principal.actorId, openCommand),
    { shiftId: openCommand.shiftId, status: "replayed" },
  );
  assert.deepEqual(await directoryFor([{ result: { status: "conflict" } }]).open(principal.actorId, openCommand), { status: "conflict" });
  assert.deepEqual(await directoryFor([{ result: { status: "forbidden" } }]).open(principal.actorId, openCommand), { status: "forbidden" });
  await assert.rejects(directoryFor([{ status: "saved", shiftId: openCommand.shiftId }]).open(principal.actorId, openCommand), OperationalShiftApplicationError);
  await assert.rejects(directoryFor([]).open(principal.actorId, openCommand), OperationalShiftApplicationError);
});

const openCommand = {
  schemaVersion: 1 as const, scope, shiftId: randomUUID(), name: "Turno de comida",
  eventId: randomUUID(), idempotencyKey: "operational-shift-open-test-1", deviceId: randomUUID(),
  occurredAt: "2026-09-05T18:00:00.000Z",
};

test("operational shift service open authorizes cash-register.manage, rejects a waiter, surfaces conflict", async () => {
  const received: unknown[] = [];
  const writer: OperationalShiftWriterPort = {
    open: async (actorId, command) => { received.push(actorId, command); return { shiftId: command.shiftId, status: "saved" }; },
  };
  const service = serviceFor(["cashier"], { listActive: async () => list }, writer);
  const result = await service.open(principal, openCommand);
  assert.deepEqual(result, { replayed: false, schemaVersion: 1, scope, shiftId: openCommand.shiftId });
  assert.deepEqual(received, [principal.actorId, openCommand]);

  await assertCode(serviceFor(["waiter"], { listActive: async () => list }).open(principal, openCommand), "authorization");
  await assertCode(
    serviceFor(["cashier"], { listActive: async () => list }, { open: async () => ({ status: "conflict" }) }).open(principal, openCommand),
    "conflict",
  );
  await assertCode(serviceFor(["cashier"], { listActive: async () => list }).open(principal, { ...openCommand, shiftId: "bad" }), "request");
});

function serviceFor(
  roles: readonly ("waiter" | "cashier" | "manager")[],
  port: OperationalShiftDirectoryPort,
  writer: OperationalShiftWriterPort = { open: async () => ({ status: "conflict" }) },
): OperationalShiftService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => roles.length === 0 ? undefined : ({ roles, scope: validScope }) };
  return new OperationalShiftService(new MembershipAuthorizationService(memberships), port, writer);
}

async function assertCode(promise: Promise<unknown>, code: OperationalShiftApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof OperationalShiftApplicationError && error.code === code);
}
