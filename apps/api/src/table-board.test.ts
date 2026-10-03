import assert from "node:assert/strict";
import test from "node:test";

import { parseBranchScope } from "@super-restaurant/shared-types";
import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DiningTablePort } from "./dining-tables.js";
import { TableBoardApplicationError, TableBoardService, type TableBoardPort } from "./table-board.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scope = parseBranchScope({ restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000", branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955" });
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;
const freeTableId = "9544c299-d25b-44ce-98ed-d30116610887";
const occupiedTableId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const orderId = "a72573ec-6224-4857-bc4a-f3d1d07b6d83";
const table = (tableId: string) => Object.freeze({
  schemaVersion: 1 as const, scope, tableId, zoneId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  name: "Mesa", capacity: 4, shape: "round" as const, layout: { x: 0, y: 0, width: 2, height: 2 }, version: 1,
  updatedAt: "2026-09-01T18:00:01.000Z", updatedBy: principal.actorId, replayed: false,
});
const layout = Object.freeze({
  schemaVersion: 1 as const, scope,
  zones: Object.freeze([Object.freeze({
    zoneId: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0", name: "Terraza", version: 1,
    tables: Object.freeze([table(freeTableId), table(occupiedTableId)]),
  })]),
});

test("table board derives occupied/free per table from the bounded active-order list", async () => {
  const tables: DiningTablePort = { list: async () => layout, create: async () => ({ status: "conflict" }), updateLayout: async () => ({ status: "conflict" }) };
  const board: TableBoardPort = {
    listActiveOrders: async () => [Object.freeze({
      openedAt: "2026-09-01T19:00:00.000Z", orderId, status: "open", tableId: occupiedTableId,
      version: 2, waiterUserId: null,
    })],
  };
  const service = serviceFor(["manager"], tables, board);
  const result = await service.read(principal, scope);
  const byId = new Map(result.tables.map((entry) => [entry.tableId, entry]));
  assert.deepEqual(byId.get(freeTableId)?.status, "free");
  assert.deepEqual(byId.get(freeTableId)?.activeOrders, []);
  assert.deepEqual(byId.get(occupiedTableId)?.status, "occupied");
  assert.deepEqual(byId.get(occupiedTableId)?.activeOrders[0]?.orderId, orderId);
});

test("table board rejects a non-member and a malformed scope", async () => {
  const tables: DiningTablePort = { list: async () => layout, create: async () => ({ status: "conflict" }), updateLayout: async () => ({ status: "conflict" }) };
  const board: TableBoardPort = { listActiveOrders: async () => [] };
  await assertCode(serviceFor([], tables, board).read(principal, scope), "authorization");
  await assertCode(serviceFor(["manager"], tables, board).read(principal, { ...scope, branchId: "bad" }), "request");
  await assertCode(serviceFor(["manager"], { ...tables, list: async () => "forbidden" }, board).read(principal, scope), "authorization");
});

function serviceFor(roles: readonly "manager"[], tables: DiningTablePort, board: TableBoardPort): TableBoardService {
  const memberships: MembershipLookupPort = { findActiveMembership: async () => roles.length === 0 ? undefined : ({ roles, scope: validScope }) };
  return new TableBoardService(new MembershipAuthorizationService(memberships), tables, board);
}

async function assertCode(promise: Promise<unknown>, code: TableBoardApplicationError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof TableBoardApplicationError && error.code === code);
}
