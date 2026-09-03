import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBranchScope,
  parseMenuCatalogStateV1,
  parseSaveMenuCatalogCommandV1,
  type MenuCatalogStateV1,
  type SaveMenuCatalogCommandV1,
} from "@super-restaurant/shared-types";

import type { AuthenticatedPrincipal } from "./auth/authentication.js";
import { MembershipAuthorizationService, type MembershipLookupPort } from "./auth/membership-authorization.js";
import type { DatabaseClientPort } from "./database.js";
import {
  MenuCatalogApplicationError,
  MenuCatalogService,
  PostgresMenuCatalogAdapter,
  type MenuCatalogPort,
} from "./menu-catalog.js";

const principal: AuthenticatedPrincipal = Object.freeze({ actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" });
const scope = parseBranchScope({
  restaurantId: "1e37ae13-8507-484c-969f-2176f77b7000",
  branchId: "23723e10-c0bf-49fd-9363-4f0e2c60e955",
});
if (scope === undefined) throw new Error("TEST_SCOPE_INVALID");
const validScope = scope;

const command = parseSaveMenuCatalogCommandV1({
  schemaVersion: 1,
  scope,
  eventId: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  idempotencyKey: "8cc7eb84-af2a-4e84-95de-967c39af86ab",
  deviceId: "a72573ec-6224-4857-bc4a-f3d1d07b6d83",
  occurredAt: "2026-09-02T22:00:00.000Z",
  expectedVersion: 0,
  catalogVersion: "ee50f0f6-746f-47cb-8383-ad7834ef3ef0",
  currency: "MXN",
  categories: [{ categoryId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02", name: "Alimentos", active: true, displayOrder: 0 }],
  products: [{
    productId: "9544c299-d25b-44ce-98ed-d30116610887",
    categoryId: "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02",
    name: "Hamburguesa",
    sku: "HAM-001",
    active: true,
    displayOrder: 0,
    stationId: "kitchen",
    unit: "piece",
    unitPriceMinor: 12_500,
    tax: null,
  }],
  modifierGroups: [{
    groupId: "a409ec59-9f5e-496d-a45d-b83a46b49674",
    productId: "9544c299-d25b-44ce-98ed-d30116610887",
    name: "Extras",
    active: true,
    displayOrder: 0,
    minimumQuantity: 0,
    maximumQuantity: 2,
    options: [{
      optionId: "c483b6e7-e102-4cc5-a887-d30712c85e52",
      name: "Queso",
      unitPriceMinor: 1_500,
      active: true,
      maximumQuantity: 2,
    }],
  }],
});
if (command === undefined) throw new Error("TEST_COMMAND_INVALID");

const populatedState = stateFor(command, false);
const emptyState = parseMenuCatalogStateV1({ schemaVersion: 1, scope, catalog: null });
if (emptyState === undefined) throw new Error("TEST_EMPTY_STATE_INVALID");

test("menu catalog authorizes reads and atomic saves with distinct permissions", async () => {
  const calls: string[] = [];
  const port: MenuCatalogPort = {
    read: async () => { calls.push("read"); return populatedState; },
    save: async () => { calls.push("save"); return { state: populatedState, status: "saved" }; },
  };
  const manager = serviceFor(["manager"], port);
  assert.deepEqual(await manager.read(principal, validScope), populatedState);
  assert.deepEqual(await manager.save(principal, command), populatedState);
  const viewer = serviceFor(["viewer"], port);
  assert.deepEqual(await viewer.read(principal, validScope), populatedState);
  await assertCode(viewer.save(principal, command), "authorization");
  assert.deepEqual(calls, ["read", "save", "read"]);
});

test("menu catalog rejects malformed requests and maps conflict, forbidden, and failures", async () => {
  const conflict = serviceFor(["manager"], {
    read: async () => "forbidden",
    save: async () => ({ status: "conflict" }),
  });
  await assertCode(conflict.read(principal, validScope), "authorization");
  await assertCode(conflict.save(principal, { ...command, expectedVersion: -1 }), "request");
  await assertCode(conflict.save(principal, command), "conflict");
  const unavailable = serviceFor(["manager"], {
    read: async () => { throw new Error("native secret"); },
    save: async () => { throw new Error("native secret"); },
  });
  await assertCode(unavailable.read(principal, validScope), "unavailable");
  await assertCode(unavailable.save(principal, command), "unavailable");
});

test("menu PostgreSQL adapter binds scope and canonical catalog payload", async () => {
  const calls: { readonly parameters: readonly unknown[]; readonly sql: string }[] = [];
  const database: DatabaseClientPort = {
    query: async (sql, parameters) => {
      calls.push({ parameters, sql });
      return sql.includes("get_menu_catalog")
        ? { rows: [{ state: populatedState }] }
        : { rows: [{ status: "saved", state: populatedState }] };
    },
  };
  const adapter = new PostgresMenuCatalogAdapter(database);
  assert.deepEqual(await adapter.read(principal.actorId, validScope), populatedState);
  assert.deepEqual(await adapter.save(principal.actorId, command), { status: "saved", state: populatedState });
  assert.equal(calls[0]?.sql, "select app_private.get_menu_catalog($1::uuid, $2::uuid, $3::uuid) as state");
  assert.deepEqual(calls[0]?.parameters, [principal.actorId, validScope.restaurantId, validScope.branchId]);
  assert.equal(calls[1]?.parameters.length, 11);
  assert.deepEqual(JSON.parse(String(calls[1]?.parameters[10])), {
    categories: command.categories,
    modifierGroups: command.modifierGroups,
    products: command.products,
  });
});

test("menu PostgreSQL adapter fails closed for ambiguous or mismatched rows", async () => {
  for (const rows of [
    [],
    [{ state: populatedState }, { state: populatedState }],
    [{ state: populatedState, extra: true }],
    [{ state: { ...populatedState, scope: { ...validScope, branchId: "72371a5f-2056-448d-9ddb-14ab6664a4e8" } } }],
  ]) {
    await assert.rejects(
      new PostgresMenuCatalogAdapter({ query: async () => ({ rows }) }).read(principal.actorId, validScope),
      MenuCatalogApplicationError,
    );
  }
  assert.equal(
    await new PostgresMenuCatalogAdapter({ query: async () => ({ rows: [{ state: null }] }) }).read(principal.actorId, validScope),
    "forbidden",
  );

  const wrongCatalog = stateFor({ ...command, catalogVersion: "72371a5f-2056-448d-9ddb-14ab6664a4e8" }, false);
  await assert.rejects(
    new PostgresMenuCatalogAdapter({ query: async () => ({ rows: [{ status: "saved", state: wrongCatalog }] }) }).save(principal.actorId, command),
    MenuCatalogApplicationError,
  );
});

test("menu service accepts an empty first catalog and preserves exact branch scope", async () => {
  const service = serviceFor(["manager"], {
    read: async (_actorId, receivedScope) => {
      assert.deepEqual(receivedScope, validScope);
      return emptyState;
    },
    save: async () => ({ state: populatedState, status: "saved" }),
  });
  assert.deepEqual(await service.read(principal, validScope), emptyState);
});

function stateFor(input: SaveMenuCatalogCommandV1, replayed: boolean): MenuCatalogStateV1 {
  const state = parseMenuCatalogStateV1({
    schemaVersion: 1,
    scope: input.scope,
    catalog: {
      catalogVersion: input.catalogVersion,
      currency: input.currency,
      categories: input.categories,
      products: input.products,
      modifierGroups: input.modifierGroups,
      version: input.expectedVersion + 1,
      updatedAt: "2026-09-02T22:00:01.000Z",
      updatedBy: principal.actorId,
      replayed,
    },
  });
  if (state === undefined) throw new Error("TEST_STATE_INVALID");
  return state;
}

function serviceFor(roles: readonly ("manager" | "viewer")[], port: MenuCatalogPort): MenuCatalogService {
  const memberships: MembershipLookupPort = {
    findActiveMembership: async () => ({ roles, scope: validScope }),
  };
  return new MenuCatalogService(new MembershipAuthorizationService(memberships), port);
}

async function assertCode(promise: Promise<unknown>, code: MenuCatalogApplicationError["code"]): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof MenuCatalogApplicationError && error.code === code,
  );
}
