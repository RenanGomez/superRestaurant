import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { BranchScope, MembershipRoleCode } from "@super-restaurant/shared-types";

import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "../auth/authentication.js";
import { MembershipAuthorizationService } from "../auth/membership-authorization.js";
import type { MembershipDirectoryPort } from "../auth/membership-directory.js";
import type { DatabaseClientPort, DatabaseQueryResult, TransactionalDatabaseClientPort } from "../database.js";
import { CostingController } from "./costing.controller.js";
import {
  CostingApplicationError,
  CostingService,
  type InventoryAverageCostV1,
  type InventoryProductMarginV1,
  type InventoryStockAlertV1,
} from "./costing.service.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const otherRestaurantId = "9f8a5f0a-93ee-4a0b-9f0e-6a2a5f2a1234";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const otherBranchId = "00000000-0000-4000-8000-000000000000";
const warehouseId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const itemId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const sugarId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const productId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const scope = { restaurantId, branchId } as unknown as BranchScope;

const alertRow = Object.freeze({
  item_id: itemId,
  item_name: "Harina",
  unit_code: "g",
  warehouse_id: warehouseId,
  warehouse_name: "Principal",
  quantity: 3,
  min_quantity: 5,
  deficit: 2,
});
const expectedAlert: InventoryStockAlertV1 = Object.freeze({
  itemId,
  itemName: "Harina",
  unitCode: "g",
  warehouseId,
  warehouseName: "Principal",
  quantity: 3,
  minQuantity: 5,
  deficit: 2,
});

const costRow = Object.freeze({
  quantity: 3,
  value_minor: "302",
  unit_cost_minor: "101",
  currency: "MXN",
  rounding_remainder: 2,
});
const expectedCost: InventoryAverageCostV1 = Object.freeze({
  schemaVersion: 1,
  restaurantId,
  branchId,
  warehouseId,
  itemId,
  quantity: 3,
  valueMinor: 302,
  unitCostMinor: 101,
  currency: "MXN",
  roundingRemainder: 2,
});

const flourCostRow = Object.freeze({
  item_id: itemId,
  item_name: "Harina",
  unit_code: "g",
  quantity: 150,
  purchase_unit_factor: 1,
  unit_cost_minor: "101",
  line_cost_minor: "15150",
  currency: "MXN",
});
const sugarCostRow = Object.freeze({
  item_id: sugarId,
  item_name: "Azucar",
  unit_code: "ml",
  quantity: 20,
  purchase_unit_factor: 1,
  unit_cost_minor: "200",
  line_cost_minor: "4000",
  currency: "MXN",
});

const marginRow = Object.freeze({
  product_id: productId,
  price_minor: "20000",
  cost_minor: "19150",
  margin_minor: "850",
  currency: "MXN",
});
const expectedMargin: InventoryProductMarginV1 = Object.freeze({
  schemaVersion: 1,
  restaurantId,
  branchId,
  productId,
  priceMinor: 20000,
  costMinor: 19150,
  marginMinor: 850,
  currency: "MXN",
});

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
  if (sql.includes("app_private.list_inventory_alerts")) return [alertRow];
  if (sql.includes("app_private.inventory_average_cost")) return [costRow];
  if (sql.includes("app_private.list_inventory_product_costs")) return [flourCostRow, sugarCostRow];
  if (sql.includes("app_private.read_inventory_product_margin")) return [marginRow];
  return [];
}

function code(expected: string) {
  return (error: unknown) => error instanceof CostingApplicationError && error.code === expected;
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
} = {}): { service: CostingService; database: FakeDatabase } {
  const roles = options.roles ?? (["manager"] as const);
  const memberships = options.memberships ?? [{ roles, scope }];
  const database = new FakeDatabase(options.handler ?? defaultHandler);
  const service = new CostingService(authorizationFor(memberships), directoryFor(memberships), database);
  return { service, database };
}

test("listAlerts: one branch-scoped call with the server actor", async () => {
  const { service, database } = serviceFor();
  const result = await service.listAlerts(principal, { restaurantId, branchId });
  assert.deepEqual(result.alerts, [expectedAlert]);
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.sql.includes("app_private.list_inventory_alerts"), true);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, branchId]);
});

test("listAlerts: invalid query keys are request errors before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.listAlerts(principal, { restaurantId, branchId, extra: "x" }),
    code("request"),
  );
  assert.equal(database.queries.length, 0);
});

test("listAlerts: a foreign branch is denied before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.listAlerts(principal, { restaurantId, branchId: otherBranchId }),
    code("authorization"),
  );
  assert.equal(database.queries.length, 0);
});

test("readCost: one call maps valid int8 strings and the currency", async () => {
  const { service, database } = serviceFor();
  const result = await service.readCost(principal, { restaurantId, branchId, warehouseId, itemId });
  assert.deepEqual(result, expectedCost);
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.sql.includes("app_private.inventory_average_cost"), true);
  assert.deepEqual(database.queries[0]?.parameters, [
    principal.actorId,
    restaurantId,
    branchId,
    warehouseId,
    itemId,
  ]);
});

test("readCost: missing ids or unknown query keys are request errors", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.readCost(principal, { restaurantId, branchId, warehouseId }), code("request"));
  await assert.rejects(
    service.readCost(principal, { restaurantId, branchId, warehouseId, itemId, limit: 1 }),
    code("request"),
  );
  assert.equal(database.queries.length, 0);
});

test("listProductCosts: restaurant-scoped call returns every recipe line", async () => {
  const { service, database } = serviceFor();
  const result = await service.listProductCosts(principal, { restaurantId, productId });
  assert.deepEqual(result.costs.map((cost) => cost.lineCostMinor), [15150, 4000]);
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.sql.includes("app_private.list_inventory_product_costs"), true);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, productId]);
});

test("listProductCosts: a restaurant outside the actor's memberships is denied", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.listProductCosts(principal, { restaurantId: otherRestaurantId, productId }),
    code("authorization"),
  );
  assert.equal(database.queries.length, 0);
});

test("readMargin: one call returns the estimated integer margin", async () => {
  const { service, database } = serviceFor();
  const result = await service.readMargin(principal, { restaurantId, branchId, productId });
  assert.deepEqual(result, expectedMargin);
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.sql.includes("app_private.read_inventory_product_margin"), true);
  assert.deepEqual(database.queries[0]?.parameters, [
    principal.actorId,
    restaurantId,
    branchId,
    productId,
  ]);
});

test("readMargin: zero rows mean a missing product or recipe, never a zero margin", async () => {
  const handler: Handler = (sql) => (sql.includes("read_inventory_product_margin") ? [] : [marginRow]);
  const { service } = serviceFor({ handler });
  await assert.rejects(
    service.readMargin(principal, { restaurantId, branchId, productId }),
    code("missing"),
  );
});

test("all endpoints: SQLSTATEs map to request, conflict, authorization and outage", async () => {
  const cases: readonly (readonly [string, string])[] = [
    ["22000", "request"],
    ["23514", "request"],
    ["22003", "request"],
    ["23503", "conflict"],
    ["23505", "conflict"],
    ["42501", "authorization"],
    ["42P01", "unavailable"],
  ];
  for (const [state, expected] of cases) {
    const handler: Handler = () => {
      throw Object.assign(new Error("database failure"), { code: state });
    };
    const { service } = serviceFor({ handler });
    await assert.rejects(
      service.readCost(principal, { restaurantId, branchId, warehouseId, itemId }),
      code(expected),
    );
  }
});

test("HTTP contract: 401, 400, 200, 403 and 200 for the costing endpoints", async () => {
  const { service } = serviceFor();
  const module = await Test.createTestingModule({
    controllers: [CostingController],
    providers: [
      { provide: CostingService, useValue: service },
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const base = `${await app.getUrl()}/api/v1/inventory`;
  const authorization = { authorization: "Bearer inventory-fixture-token" };
  try {
    const unauthenticated = await fetch(`${base}/alerts?restaurantId=${restaurantId}&branchId=${branchId}`);
    assert.equal(unauthenticated.status, 401);

    const invalid = await fetch(`${base}/costs?restaurantId=${restaurantId}&branchId=${branchId}`, {
      headers: authorization,
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { code: "INVENTORY_REQUEST_INVALID" });

    const alerts = await fetch(`${base}/alerts?restaurantId=${restaurantId}&branchId=${branchId}`, {
      headers: authorization,
    });
    assert.equal(alerts.status, 200);
    assert.equal(alerts.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await alerts.json() as { alerts: readonly InventoryStockAlertV1[] }).alerts, [expectedAlert]);

    const costs = await fetch(
      `${base}/costs?restaurantId=${restaurantId}&branchId=${branchId}&warehouseId=${warehouseId}&itemId=${itemId}`,
      { headers: authorization },
    );
    assert.equal(costs.status, 200);
    assert.deepEqual(await costs.json(), expectedCost);

    const productCosts = await fetch(`${base}/product-costs?restaurantId=${restaurantId}&productId=${productId}`, {
      headers: authorization,
    });
    assert.equal(productCosts.status, 200);
    assert.equal((await productCosts.json() as { costs: readonly unknown[] }).costs.length, 2);

    const margins = await fetch(
      `${base}/margins?restaurantId=${restaurantId}&branchId=${branchId}&productId=${productId}`,
      { headers: authorization },
    );
    assert.equal(margins.status, 200);
    assert.deepEqual(await margins.json(), expectedMargin);

    const foreign = await fetch(`${base}/alerts?restaurantId=${otherRestaurantId}&branchId=${branchId}`, {
      headers: authorization,
    });
    assert.equal(foreign.status, 403);
    assert.deepEqual(await foreign.json(), { code: "ACTION_NOT_AUTHORIZED" });
  } finally {
    await app.close();
  }
});
