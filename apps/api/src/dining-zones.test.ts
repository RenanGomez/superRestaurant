import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import {
  DiningZoneApplicationError,
  DiningZoneService,
  PostgresDiningZoneCreator,
  type DiningZoneCreationPort,
} from "./dining-zones.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scope = parseBranchScope({
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
});
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const command = Object.freeze({
  schemaVersion: 1,
  scope: validScope,
  zoneId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  eventId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
  idempotencyKey: "c483b6e7-e102-4cc5-a887-d30712c85e52",
  deviceId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  occurredAt: "2026-08-31T17:00:00.000Z",
  name: "Terraza",
});
const zone = Object.freeze({
  schemaVersion: 1,
  scope: validScope,
  zoneId: command.zoneId,
  name: command.name,
  version: 1,
  createdAt: "2026-08-31T17:00:01.000Z",
  createdBy: principal.actorId,
  replayed: false,
});

test("authorizes tables.manage before invoking the creator and returns its exact zone", async () => {
  const calls: unknown[] = [];
  const creator: DiningZoneCreationPort = {
    createZone: async (actorId, received) => {
      calls.push({ actorId, received });
      return { status: "created", zone };
    },
  };
  const service = serviceFor(["manager"], creator);
  assert.deepEqual(await service.createZone(principal, command), zone);
  assert.deepEqual(calls, [{ actorId: principal.actorId, received: command }]);
});

test("rejects malformed requests and insufficient roles before persistence", async () => {
  let calls = 0;
  const creator: DiningZoneCreationPort = {
    createZone: async () => {
      calls += 1;
      return { status: "created", zone };
    },
  };
  await assertCode(serviceFor(["manager"], creator).createZone(principal, { ...command, name: " Terraza" }), "request");
  await assertCode(serviceFor(["viewer"], creator).createZone(principal, command), "authorization");
  assert.equal(calls, 0);
});

test("maps database revalidation, idempotency conflicts and failures to stable application errors", async () => {
  await assertCode(serviceFor(["manager"], { createZone: async () => ({ status: "forbidden" }) }).createZone(principal, command), "authorization");
  await assertCode(serviceFor(["manager"], { createZone: async () => ({ status: "conflict" }) }).createZone(principal, command), "conflict");
  await assertCode(serviceFor(["manager"], { createZone: async () => { throw new Error("native secret"); } }).createZone(principal, command), "unavailable");
});

test("PostgreSQL adapter binds verified actor and command facts and parses created/replayed rows", async () => {
  const calls: { parameters: readonly unknown[]; sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      return { rows: [row("created")] };
    },
  };
  const adapter = new PostgresDiningZoneCreator(database);
  assert.deepEqual(await adapter.createZone(principal.actorId, command), { status: "created", zone });
  assert.equal(calls[0]?.sql.includes("app_private.create_dining_zone"), true);
  assert.deepEqual(calls[0]?.parameters, [
    principal.actorId,
    validScope.restaurantId,
    validScope.branchId,
    command.zoneId,
    command.eventId,
    command.idempotencyKey,
    command.deviceId,
    command.occurredAt,
    command.name,
  ]);

  const replayAdapter = new PostgresDiningZoneCreator({ query: async () => ({ rows: [row("replayed")] }) });
  assert.deepEqual(await replayAdapter.createZone(principal.actorId, command), {
    status: "replayed",
    zone: { ...zone, replayed: true },
  });
});

test("PostgreSQL adapter rejects ambiguous, partial and hostile rows fail-closed", async () => {
  for (const rows of [[], [row("created"), row("created")], [{ ...row("created"), extra: true }], [{ ...row("created"), zone_version: "0" }]]) {
    const adapter = new PostgresDiningZoneCreator({ query: async () => ({ rows }) });
    await assert.rejects(adapter.createZone(principal.actorId, command), DiningZoneApplicationError);
  }
  const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
  const adapter = new PostgresDiningZoneCreator({ query: async () => ({ rows: [hostile] }) });
  await assert.rejects(adapter.createZone(principal.actorId, command), DiningZoneApplicationError);
});

function serviceFor(roles: readonly ("manager" | "viewer")[], creator: DiningZoneCreationPort): DiningZoneService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope: validScope }) };
  return new DiningZoneService(new MembershipAuthorizationService(memberships), creator);
}

function row(status: "created" | "replayed"): Record<string, unknown> {
  return {
    status,
    schema_version: 1,
    restaurant_id: validScope.restaurantId,
    branch_id: validScope.branchId,
    zone_id: zone.zoneId,
    zone_name: zone.name,
    zone_version: "1",
    created_at: new Date(zone.createdAt),
    created_by: zone.createdBy,
  };
}

async function assertCode(promise: Promise<unknown>, code: DiningZoneApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DiningZoneApplicationError);
    assert.equal(error.code, code);
    return true;
  });
}
