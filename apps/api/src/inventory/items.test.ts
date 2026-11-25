import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { BranchScope, MembershipRoleCode } from "@super-restaurant/shared-types";

import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "../auth/authentication.js";
import { MembershipAuthorizationService } from "../auth/membership-authorization.js";
import type { MembershipDirectoryPort } from "../auth/membership-directory.js";
import type { DatabaseClientPort, DatabaseQueryResult, TransactionalDatabaseClientPort } from "../database.js";
import { ItemsController } from "./items.controller.js";
import { InventoryApplicationError, ItemsService } from "./items.service.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const otherRestaurantId = "9f8a5f0a-93ee-4a0b-9f0e-6a2a5f2a1234";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const otherBranchId = "00000000-0000-4000-8000-000000000000";
const itemId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const warehouseId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const scope = { restaurantId, branchId } as unknown as BranchScope;

const itemRow = Object.freeze({
  id: itemId,
  restaurant_id: restaurantId,
  sku: "SKU-MASA",
  name: "Masa",
  unit_code: "g",
  purchase_unit_factor: 1000,
  min_quantity: 5000,
  active: true,
});
const warehouseRow = Object.freeze({
  id: warehouseId,
  restaurant_id: restaurantId,
  branch_id: branchId,
  name: "Almacén central",
  active: true,
});

const expectedItem = Object.freeze({
  id: itemId,
  restaurantId,
  sku: "SKU-MASA",
  name: "Masa",
  unitCode: "g",
  purchaseUnitFactor: 1000,
  minQuantity: 5000,
  active: true,
});
const expectedWarehouse = Object.freeze({
  id: warehouseId,
  restaurantId,
  branchId,
  name: "Almacén central",
  active: true,
});

const validItemInput = {
  restaurantId,
  sku: "SKU-MASA",
  name: "Masa",
  unitCode: "g",
  purchaseUnitFactor: 1000,
  minQuantity: 5000,
  active: true,
};

type Handler = (sql: string, parameters: readonly unknown[]) => readonly unknown[] | Promise<readonly unknown[]>;

class FakeDatabase implements TransactionalDatabaseClientPort {
  public readonly queries: { sql: string; parameters: readonly unknown[] }[] = [];

  public constructor(private readonly handler: Handler) {}

  public async query(sql: string, parameters: readonly unknown[]): Promise<DatabaseQueryResult> {
    this.queries.push({ sql, parameters });
    return { rows: [...await this.handler(sql, parameters)] };
  }

  public async transaction<Result>(operation: (database: DatabaseClientPort) => Promise<Result>): Promise<Result> {
    return operation(this);
  }
}

function defaultHandler(sql: string): readonly unknown[] {
  if (sql.includes("insert into app.inventory_items")) return [itemRow];
  if (sql.includes("insert into app.inventory_warehouses")) return [warehouseRow];
  if (sql.includes("from app.inventory_items")) return [itemRow];
  if (sql.includes("from app.inventory_warehouses")) return [warehouseRow];
  return [];
}

function code(expected: string) {
  return (error: unknown) => error instanceof InventoryApplicationError && error.code === expected;
}

interface Membership {
  readonly roles: readonly MembershipRoleCode[];
  readonly scope: BranchScope;
}

function authorizationFor(memberships: readonly Membership[]): MembershipAuthorizationService {
  return new MembershipAuthorizationService({
    findActiveMembership: async (_principal, requestedScope) => {
      const match = memberships.find((membership) =>
        membership.scope.restaurantId === requestedScope.restaurantId
        && membership.scope.branchId === requestedScope.branchId);
      return match === undefined ? undefined : { roles: match.roles, scope: match.scope };
    },
  });
}

function directoryFor(memberships: readonly Membership[]): MembershipDirectoryPort {
  return {
    listActiveMemberships: async () => ({
      schemaVersion: 1,
      memberships: memberships.map((membership) => ({
        branchName: "Sucursal",
        restaurantName: "Restaurante",
        roles: membership.roles,
        scope: membership.scope,
      })),
    }),
  };
}

function serviceFor(options: {
  roles?: readonly MembershipRoleCode[];
  memberships?: readonly Membership[];
  handler?: Handler;
} = {}): { service: ItemsService; database: FakeDatabase } {
  const roles = options.roles ?? (["manager"] as const);
  const memberships = options.memberships ?? [{ roles, scope }];
  const database = new FakeDatabase(options.handler ?? defaultHandler);
  const service = new ItemsService(authorizationFor(memberships), directoryFor(memberships), database);
  return { service, database };
}

test("listItems: projects explicit columns and filters by the authorized restaurant", async () => {
  const { service, database } = serviceFor();
  const result = await service.listItems(principal, { restaurantId });
  assert.equal(result.restaurantId, restaurantId);
  assert.deepEqual(result.items, [expectedItem]);
  assert.deepEqual(database.queries[0]?.parameters, [restaurantId]);
  assert.equal(database.queries[0]?.sql.toLowerCase().includes("select *"), false);
});

test("listItems: a restaurant outside the actor's memberships is rejected before touching the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.listItems(principal, { restaurantId: otherRestaurantId }), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("listWarehouses: filters by the authorized branch and returns explicit columns", async () => {
  const { service, database } = serviceFor();
  const result = await service.listWarehouses(principal, { restaurantId, branchId });
  assert.equal(result.branchId, branchId);
  assert.deepEqual(result.warehouses, [expectedWarehouse]);
  assert.deepEqual(database.queries[0]?.parameters, [restaurantId, branchId]);
});

test("listWarehouses: a foreign branch scope is denied before any query", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.listWarehouses(principal, { restaurantId, branchId: otherBranchId }),
    code("authorization"),
  );
  assert.equal(database.queries.length, 0);
});

test("createItem: validates with the shared parser, omits the id and returns the stored resource", async () => {
  const { service, database } = serviceFor();
  const item = await service.createItem(principal, validItemInput);
  assert.deepEqual(item, expectedItem);
  assert.deepEqual(database.queries[0]?.parameters, [
    restaurantId, "SKU-MASA", "Masa", "g", 1000, 5000, true,
  ]);
  assert.equal(database.queries[0]?.sql.includes("returning id::text as id"), true);
});

test("createItem: invalid payloads are request errors and never reach the database", async () => {
  const { service, database } = serviceFor();
  const invalidPayloads: unknown[] = [
    {},
    { ...validItemInput, unitCode: "kg" },
    { ...validItemInput, id: itemId },
    { ...validItemInput, minQuantity: -1 },
    { ...validItemInput, restaurantId: "not-a-uuid" },
  ];
  for (const payload of invalidPayloads) {
    await assert.rejects(service.createItem(principal, payload), code("request"));
  }
  assert.equal(database.queries.length, 0);
});

test("createItem: a manager without catalog.manage is denied", async () => {
  const { service, database } = serviceFor({ roles: ["cashier"] });
  await assert.rejects(service.createItem(principal, validItemInput), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("createWarehouse: stores a branch-scoped warehouse without a client-supplied id", async () => {
  const { service, database } = serviceFor();
  const warehouse = await service.createWarehouse(principal, { restaurantId, branchId, name: "Almacén central" });
  assert.deepEqual(warehouse, expectedWarehouse);
  assert.deepEqual(database.queries[0]?.parameters, [restaurantId, branchId, "Almacén central", true]);
});

test("updateItem: merges the patch with the stored row and scopes the update to its restaurant", async () => {
  const handler: Handler = (sql) => {
    if (sql.includes("from app.inventory_items")) return [itemRow];
    if (sql.includes("update app.inventory_items")) return [{ ...itemRow, name: "Masa premium", active: false }];
    return [];
  };
  const { service, database } = serviceFor({ handler });
  const updated = await service.updateItem(principal, itemId, { name: "Masa premium", active: false });
  assert.equal(updated.name, "Masa premium");
  assert.equal(updated.active, false);
  const update = database.queries.find((query) => query.sql.includes("update app.inventory_items"));
  assert.deepEqual(update?.parameters, [itemId, restaurantId, "SKU-MASA", "Masa premium", "g", 1000, 5000, false]);
});

test("updateItem: unknown ids are missing, never a silent no-op", async () => {
  const handler: Handler = (sql) => (sql.includes("from app.inventory_items") ? [] : [itemRow]);
  const { service, database } = serviceFor({ handler });
  await assert.rejects(service.updateItem(principal, itemId, { active: false }), code("missing"));
  assert.equal(database.queries.length, 1);
});

test("updateItem: an item from another restaurant is not writable by the actor", async () => {
  const foreignRow = { ...itemRow, restaurant_id: otherRestaurantId };
  const handler: Handler = (sql) => (sql.includes("from app.inventory_items") ? [foreignRow] : [itemRow]);
  const { service, database } = serviceFor({ handler });
  await assert.rejects(service.updateItem(principal, itemId, { active: false }), code("authorization"));
  assert.equal(database.queries.length, 1);
});

test("updateItem: unknown patch keys are request errors", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.updateItem(principal, itemId, { brand: "x" }), code("request"));
  assert.equal(database.queries.length, 0);
});

test("updateWarehouse: updates name and active within the stored branch scope", async () => {
  const handler: Handler = (sql) => {
    if (sql.includes("from app.inventory_warehouses")) return [warehouseRow];
    if (sql.includes("update app.inventory_warehouses")) return [{ ...warehouseRow, name: "Almacén 2" }];
    return [];
  };
  const { service, database } = serviceFor({ handler });
  const updated = await service.updateWarehouse(principal, warehouseId, { name: "Almacén 2" });
  assert.equal(updated.name, "Almacén 2");
  const update = database.queries.find((query) => query.sql.includes("update app.inventory_warehouses"));
  assert.deepEqual(update?.parameters, [warehouseId, restaurantId, branchId, "Almacén 2", true]);
});

test("HTTP contract: 401, 400 INVENTORY_REQUEST_INVALID, 201 no-store, 403 ACTION_NOT_AUTHORIZED", async () => {
  const { service } = serviceFor();
  const module = await Test.createTestingModule({
    controllers: [ItemsController],
    providers: [
      { provide: ItemsService, useValue: service },
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const itemsUrl = `${await app.getUrl()}/api/v1/inventory/items`;
  const send = (body: unknown, authenticated = true) => fetch(itemsUrl, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer inventory-fixture-token" } : {}),
    },
  });
  const authorization = { authorization: "Bearer inventory-fixture-token" };
  try {
    assert.equal((await send({ restaurantId, name: "Masa", unitCode: "g" }, false)).status, 401);

    const invalid = await send({});
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { code: "INVENTORY_REQUEST_INVALID" });

    const created = await send({ restaurantId, name: "Masa", unitCode: "g" });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "private, no-store");
    const createdBody = await created.json() as { id: string; restaurantId: string };
    assert.equal(createdBody.id, itemId);
    assert.equal(createdBody.restaurantId, restaurantId);

    const listed = await fetch(`${itemsUrl}?restaurantId=${restaurantId}`, { headers: authorization });
    assert.equal(listed.status, 200);
    const listedBody = await listed.json() as { items: readonly { id: string }[] };
    assert.deepEqual(listedBody.items.map((item) => item.id), [itemId]);

    const foreign = await fetch(`${itemsUrl}?restaurantId=${otherRestaurantId}`, { headers: authorization });
    assert.equal(foreign.status, 403);
    assert.deepEqual(await foreign.json(), { code: "ACTION_NOT_AUTHORIZED" });
  } finally {
    await app.close();
  }
});
