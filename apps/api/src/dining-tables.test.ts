import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope, parseCreateDiningTableCommandV1, parseUpdateDiningTableDetailsCommandV1 } from "@super-restaurant/shared-types";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import { DiningTableApplicationError, DiningTableService, PostgresDiningTableAdapter, type DiningTablePort } from "./dining-tables.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const command = parseCreateDiningTableCommandV1({
  schemaVersion: 1, scope, tableId: "9544c299-d25b-44ce-98ed-d30116610887", zoneId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
  eventId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83", idempotencyKey: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  deviceId: "88d34b74-6afe-4a3c-acb9-9fc8ed902c91", occurredAt: "2026-09-01T18:00:00.000Z",
  name: "Mesa 1", capacity: 4, shape: "round", layout: { x: 2, y: 3, width: 4, height: 4 },
});
if (command === undefined) throw new Error("TEST_COMMAND_INVALID");
const table = Object.freeze({ schemaVersion: 1 as const, scope: validScope, tableId: command.tableId, zoneId: command.zoneId,
  name: command.name, capacity: command.capacity, shape: command.shape, layout: command.layout, version: 1,
  updatedAt: "2026-09-01T18:00:01.000Z", updatedBy: principal.actorId, replayed: false });
const layout = Object.freeze({ schemaVersion: 1 as const, scope: validScope, zones: Object.freeze([Object.freeze({ zoneId: command.zoneId, name: "Terraza", version: 1, tables: Object.freeze([table]) })]) });

test("dining tables authorize reads and writes with distinct permissions", async () => {
  const calls: string[] = [];
  const port: DiningTablePort = { list: async () => { calls.push("list"); return layout; }, create: async () => { calls.push("create"); return { status: "created", table }; }, updateLayout: async () => ({ status: "updated", table }), updateDetails: async () => ({ status: "updated", table }) };
  const service = serviceFor(["manager"], port);
  assert.deepEqual(await service.list(principal, validScope), layout);
  assert.deepEqual(await service.create(principal, command), table);
  const viewer = serviceFor(["viewer"], port);
  assert.deepEqual(await viewer.list(principal, validScope), layout);
  await assertCode(viewer.create(principal, command), "authorization");
  assert.deepEqual(calls, ["list", "create", "list"]);
});

test("dining tables reject malformed requests and map conflicts or failures", async () => {
  let calls = 0;
  const port: DiningTablePort = { list: async () => layout, create: async () => { calls += 1; return { status: "conflict" }; }, updateLayout: async () => { throw new Error("native secret"); }, updateDetails: async () => { throw new Error("native secret"); } };
  const service = serviceFor(["manager"], port);
  await assertCode(service.create(principal, { ...command, capacity: 0 }), "request");
  await assertCode(service.create(principal, command), "conflict");
  await assertCode(service.updateLayout(principal, { schemaVersion: 1, scope, tableId: command.tableId,
    eventId: "5ed22a92-a93d-4034-9661-4df2b523517b", idempotencyKey: "72371a5f-2056-448d-9ddb-14ab6664a4e8",
    deviceId: command.deviceId, occurredAt: "2026-09-01T18:05:00.000Z", expectedVersion: 1, layout: command.layout }), "unavailable");
  assert.equal(calls, 1);
});

test("dining table PostgreSQL adapter binds facts and rejects ambiguous rows", async () => {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const database: DatabaseClientPort = { query: async (sql, parameters) => { calls.push({ sql, parameters }); return sql.includes("list_dining_layout") ? { rows: [{ layout }] } : { rows: [mutationRow("created")] }; } };
  const adapter = new PostgresDiningTableAdapter(database);
  assert.deepEqual(await adapter.list(principal.actorId, validScope), layout);
  assert.deepEqual(await adapter.create(principal.actorId, command), { status: "created", table });
  assert.equal(calls[0]?.sql, "select app_private.list_dining_layout($1::uuid, $2::uuid, $3::uuid) as layout");
  assert.deepEqual(calls[0]?.parameters, [principal.actorId, validScope.restaurantId, validScope.branchId]);
  assert.equal(calls[1]?.parameters.length, 16);
  for (const rows of [[], [mutationRow("created"), mutationRow("created")], [{ ...mutationRow("created"), extra: true }]]) {
    await assert.rejects(new PostgresDiningTableAdapter({ query: async () => ({ rows }) }).create(principal.actorId, command), DiningTableApplicationError);
  }
});

const detailsInput = Object.freeze({
  schemaVersion: 1, scope: validScope, tableId: command.tableId,
  eventId: "5ed22a92-a93d-4034-9661-4df2b523517b", idempotencyKey: "72371a5f-2056-448d-9ddb-14ab6664a4e8",
  deviceId: command.deviceId, occurredAt: "2026-09-01T18:05:00.000Z", expectedVersion: 1,
  name: "Terraza 1", capacity: 6, shape: "rectangle",
});
const detailsCommand = parseUpdateDiningTableDetailsCommandV1(detailsInput);
if (detailsCommand === undefined) throw new Error("TEST_DETAILS_COMMAND_INVALID");
const detailsTable = Object.freeze({ ...table, name: "Terraza 1", capacity: 6, shape: "rectangle" as const, version: 2 });

test("dining table details require tables.manage, validate the request and bind the command", async () => {
  const seen: { actorId: string; name: string; capacity: number; shape: string; expectedVersion: number }[] = [];
  const port: DiningTablePort = {
    list: async () => layout, create: async () => ({ status: "conflict" }), updateLayout: async () => ({ status: "conflict" }),
    updateDetails: async (actorId, received) => {
      seen.push({ actorId, name: received.name, capacity: received.capacity, shape: received.shape, expectedVersion: received.expectedVersion });
      return { status: "updated", table: detailsTable };
    },
  };
  assert.deepEqual(await serviceFor(["manager"], port).updateDetails(principal, detailsInput), detailsTable);
  assert.deepEqual(seen, [{ actorId: principal.actorId, name: "Terraza 1", capacity: 6, shape: "rectangle", expectedVersion: 1 }]);
  await assertCode(serviceFor(["viewer"], port).updateDetails(principal, detailsInput), "authorization");
  for (const invalid of [{ ...detailsInput, capacity: 0 }, { ...detailsInput, name: " " }, { ...detailsInput, shape: "oval" }, { ...detailsInput, expectedVersion: 0 }, { ...detailsInput, extra: 1 }, null]) {
    await assertCode(serviceFor(["manager"], port).updateDetails(principal, invalid), "request");
  }
  assert.equal(seen.length, 1);
});

test("dining table details map conflicts, forbidden results, replays and failures", async () => {
  const resultPort = (result: Awaited<ReturnType<DiningTablePort["updateDetails"]>> | "throw"): DiningTablePort => ({
    list: async () => layout, create: async () => ({ status: "conflict" }), updateLayout: async () => ({ status: "conflict" }),
    updateDetails: async () => { if (result === "throw") throw new Error("native secret"); return result; },
  });
  await assertCode(serviceFor(["manager"], resultPort({ status: "conflict" })).updateDetails(principal, detailsInput), "conflict");
  await assertCode(serviceFor(["manager"], resultPort({ status: "forbidden" })).updateDetails(principal, detailsInput), "authorization");
  await assertCode(serviceFor(["manager"], resultPort("throw")).updateDetails(principal, detailsInput), "unavailable");
  const replayed = Object.freeze({ ...detailsTable, replayed: true });
  assert.deepEqual(await serviceFor(["manager"], resultPort({ status: "replayed", table: replayed })).updateDetails(principal, detailsInput), replayed);
});

test("dining table PostgreSQL adapter binds the details command in SQL order", async () => {
  const calls: { sql: string; parameters: readonly unknown[] }[] = [];
  const adapter = new PostgresDiningTableAdapter({ query: async (sql, parameters) => { calls.push({ sql, parameters }); return { rows: [{ ...mutationRow("updated"), table_name: "Terraza 1", capacity: 6, shape: "rectangle", table_version: "2" }] }; } });
  assert.deepEqual(await adapter.updateDetails(principal.actorId, detailsCommand), { status: "updated", table: detailsTable });
  assert.match(calls[0]?.sql ?? "", /app_private\.update_dining_table_details\(/u);
  assert.deepEqual(calls[0]?.parameters, [
    principal.actorId, validScope.restaurantId, validScope.branchId, detailsCommand.tableId, detailsCommand.eventId,
    detailsCommand.idempotencyKey, detailsCommand.deviceId, detailsCommand.occurredAt, 1, "Terraza 1", 6, "rectangle",
  ]);
  for (const rows of [[], [mutationRow("updated"), mutationRow("updated")], [{ ...mutationRow("updated"), extra: true }]]) {
    await assert.rejects(new PostgresDiningTableAdapter({ query: async () => ({ rows }) }).updateDetails(principal.actorId, detailsCommand), DiningTableApplicationError);
  }
  const replay = await new PostgresDiningTableAdapter({ query: async () => ({ rows: [{ ...mutationRow("replayed"), table_name: "Terraza 1", capacity: 6, shape: "rectangle", table_version: "2" }] }) }).updateDetails(principal.actorId, detailsCommand);
  assert.deepEqual(replay, { status: "replayed", table: { ...detailsTable, replayed: true } });
  assert.deepEqual(await new PostgresDiningTableAdapter({ query: async () => ({ rows: [{ status: "conflict", schema_version: null, restaurant_id: null, branch_id: null, table_id: null, zone_id: null, table_name: null, capacity: null, shape: null, layout_x: null, layout_y: null, layout_width: null, layout_height: null, table_version: null, updated_at: null, updated_by: null }] }) }).updateDetails(principal.actorId, detailsCommand), { status: "conflict" });
});

function serviceFor(roles: readonly ("manager" | "viewer")[], port: DiningTablePort): DiningTableService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => ({ roles, scope: validScope }) };
  return new DiningTableService(new MembershipAuthorizationService(memberships), port);
}
function mutationRow(status: "created" | "updated" | "replayed"): Record<string, unknown> {
  return { status, schema_version: 1, restaurant_id: validScope.restaurantId, branch_id: validScope.branchId, table_id: table.tableId,
    zone_id: table.zoneId, table_name: table.name, capacity: table.capacity, shape: table.shape, layout_x: table.layout.x,
    layout_y: table.layout.y, layout_width: table.layout.width, layout_height: table.layout.height, table_version: "1",
    updated_at: new Date(table.updatedAt), updated_by: table.updatedBy };
}
async function assertCode(promise: Promise<unknown>, code: DiningTableApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof DiningTableApplicationError && error.code === code);
}
