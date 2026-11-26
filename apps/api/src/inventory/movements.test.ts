import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { BranchScope, MembershipRoleCode } from "@super-restaurant/shared-types";

import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "../auth/authentication.js";
import { MembershipAuthorizationService } from "../auth/membership-authorization.js";
import type { DatabaseClientPort, DatabaseQueryResult, TransactionalDatabaseClientPort } from "../database.js";
import { MovementsController } from "./movements.controller.js";
import {
  InventoryMovementApplicationError,
  MovementsService,
  type InventoryTransferResultV1,
} from "./movements.service.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const otherRestaurantId = "9f8a5f0a-93ee-4a0b-9f0e-6a2a5f2a1234";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const otherBranchId = "00000000-0000-4000-8000-000000000000";
const itemId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const warehouseId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const otherWarehouseId = "b98b5914-002d-42a0-a26b-2a0f954ddf1e";
const movementId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const transferPairId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const scope = { restaurantId, branchId } as unknown as BranchScope;

const adjustment = {
  restaurantId,
  branchId,
  warehouseId,
  itemId,
  kind: "adjustment",
  quantityDelta: -5,
  unitCode: "g",
  reason: "Ajuste por conteo",
  idempotencyKey: "movement-adjust-1",
  compensatesMovementId: null,
  transferPairId: null,
  toWarehouseId: null,
  unitCostMinor: null,
  currency: null,
};

const transferOut = Object.freeze({
  id: movementId,
  restaurantId,
  branchId,
  warehouseId,
  itemId,
  kind: "transfer_out",
  quantityDelta: -5,
  unitCode: "g",
  occurredAt: "2026-11-26T12:00:00.000Z",
  actorId: principal.actorId,
  reason: "Mover a cocina",
  idempotencyKey: "movement-transfer-1:out",
  compensatesMovementId: null,
  transferPairId,
  unitCostMinor: null,
  currency: null,
  recipeVersionId: null,
  roundingRemainder: 0,
});
const transferIn = Object.freeze({
  ...transferOut,
  id: "e74df54b-30a7-449b-a23f-c4ca6f93bda4",
  warehouseId: otherWarehouseId,
  kind: "transfer_in",
  quantityDelta: 5,
  idempotencyKey: "movement-transfer-1:in",
});

const movementRow = Object.freeze({
  id: movementId,
  restaurant_id: restaurantId,
  branch_id: branchId,
  warehouse_id: warehouseId,
  item_id: itemId,
  kind: "adjustment",
  quantity_delta: -5,
  unit_code: "g",
  occurred_at: new Date("2026-11-26T12:00:00.000Z"),
  actor_id: principal.actorId,
  reason: "Ajuste por conteo",
  idempotency_key: "movement-adjust-1",
  compensates_movement_id: null,
  transfer_pair_id: null,
  unit_cost_minor: "1234",
  currency: "MXN",
  recipe_version_id: null,
  rounding_remainder: 0,
});

const expectedMovement = Object.freeze({
  id: movementId,
  restaurantId,
  branchId,
  warehouseId,
  itemId,
  kind: "adjustment",
  quantityDelta: -5,
  unitCode: "g",
  occurredAt: "2026-11-26T12:00:00.000Z",
  actorId: principal.actorId,
  reason: "Ajuste por conteo",
  idempotencyKey: "movement-adjust-1",
  compensatesMovementId: null,
  transferPairId: null,
  unitCostMinor: 1234,
  currency: "MXN",
  recipeVersionId: null,
  roundingRemainder: 0,
});

const balanceRow = Object.freeze({
  warehouse_id: warehouseId,
  item_id: itemId,
  quantity: 45,
  updated_at: new Date("2026-11-26T12:00:00.000Z"),
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
  if (sql.includes("app_private.inventory_transfer")) {
    return [{ result: { status: "recorded", transferPairId, movements: [transferOut, transferIn] } }];
  }
  if (sql.includes("app_private.inventory_record_manual_movement")) {
    return [{ result: { status: "recorded", movementId, balance: 45 } }];
  }
  if (sql.includes("app_private.list_inventory_movements")) return [movementRow];
  if (sql.includes("app_private.list_inventory_balances")) return [balanceRow];
  return [];
}

function code(expected: string) {
  return (error: unknown) => error instanceof InventoryMovementApplicationError && error.code === expected;
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

function serviceFor(options: {
  roles?: readonly MembershipRoleCode[];
  memberships?: readonly Membership[];
  handler?: Handler;
} = {}): { service: MovementsService; database: FakeDatabase } {
  const roles = options.roles ?? (["manager"] as const);
  const memberships = options.memberships ?? [{ roles, scope }];
  const database = new FakeDatabase(options.handler ?? defaultHandler);
  const service = new MovementsService(authorizationFor(memberships), database);
  return { service, database };
}

test("recordMovement: an adjustment calls the manual wrapper with the server actor", async () => {
  const { service, database } = serviceFor();
  const result = await service.recordMovement(principal, adjustment, undefined);
  assert.deepEqual(result, { status: "recorded", movementId, balance: 45 });
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.sql.includes("app_private.inventory_record_manual_movement"), true);
  assert.equal(database.queries[0]?.sql.includes("app_private.inventory_record_movement"), false);
  assert.deepEqual(database.queries[0]?.parameters, [
    principal.actorId, restaurantId, branchId, warehouseId, itemId, "adjustment", -5,
    "Ajuste por conteo", "movement-adjust-1", null,
  ]);
});

test("recordMovement: a replayed manual key reports duplicate without inventing a balance", async () => {
  const handler: Handler = (sql) => (sql.includes("app_private.inventory_record_manual_movement")
    ? [{ result: { status: "duplicate", movementId } }]
    : []);
  const { service } = serviceFor({ handler });
  const result = await service.recordMovement(principal, adjustment, undefined);
  assert.deepEqual(result, { status: "duplicate", movementId, balance: null });
});

test("recordMovement: waste without a reason is rejected before the database", async () => {
  const { service, database } = serviceFor();
  const payload = { ...adjustment, kind: "waste", quantityDelta: -1, reason: null, idempotencyKey: "waste-1" };
  await assert.rejects(service.recordMovement(principal, payload, undefined), code("request"));
  assert.equal(database.queries.length, 0);
});

test("recordMovement: a client-supplied actorId is ignored, not trusted", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.recordMovement(principal, { ...adjustment, actorId: otherRestaurantId }, undefined),
    code("request"),
  );
  assert.equal(database.queries.length, 0);
});

test("recordMovement: unsupported ledger kinds are request errors", async () => {
  const { service, database } = serviceFor();
  for (const kind of ["receipt", "sale_consumption", "sale_reversal"]) {
    const quantityDelta = kind === "sale_consumption" ? -1 : 1;
    await assert.rejects(
      service.recordMovement(principal, { ...adjustment, kind, quantityDelta, idempotencyKey: `${kind}-1` }, undefined),
      code("request"),
    );
  }
  assert.equal(database.queries.length, 0);
});

test("recordMovement: transfer_out moves from the requested warehouse to toWarehouseId with one call", async () => {
  const { service, database } = serviceFor();
  const result = await service.recordMovement(principal, {
    ...adjustment,
    kind: "transfer_out",
    quantityDelta: -5,
    toWarehouseId: otherWarehouseId,
    idempotencyKey: "movement-transfer-1",
  }, "0a5dfef7-e2dd-4b66-845a-7e28d24a46ce");
  assert.equal(result.status, "recorded");
  assert.equal((result as InventoryTransferResultV1).transferPairId, transferPairId);
  assert.equal((result as InventoryTransferResultV1).movements.length, 2);
  assert.equal(database.queries.length, 1);
  assert.equal(database.queries[0]?.sql.includes("app_private.inventory_transfer"), true);
  assert.deepEqual(database.queries[0]?.parameters, [
    principal.actorId, restaurantId, branchId, warehouseId, otherWarehouseId, itemId, 5, "g",
    "Ajuste por conteo", "movement-transfer-1", "0a5dfef7-e2dd-4b66-845a-7e28d24a46ce",
  ]);
});

test("recordMovement: transfer_in normalizes toWarehouseId as the source warehouse", async () => {
  const { service, database } = serviceFor();
  await service.recordMovement(principal, {
    ...adjustment,
    warehouseId: otherWarehouseId,
    kind: "transfer_in",
    quantityDelta: 5,
    toWarehouseId: warehouseId,
    idempotencyKey: "movement-transfer-2",
  }, undefined);
  assert.deepEqual(database.queries[0]?.parameters, [
    principal.actorId, restaurantId, branchId, warehouseId, otherWarehouseId, itemId, 5, "g",
    "Ajuste por conteo", "movement-transfer-2", null,
  ]);
});

test("recordMovement: a transfer without a reason is rejected before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.recordMovement(principal, {
    ...adjustment,
    kind: "transfer_out",
    quantityDelta: -5,
    reason: null,
    toWarehouseId: otherWarehouseId,
    idempotencyKey: "movement-transfer-3",
  }, undefined), code("request"));
  assert.equal(database.queries.length, 0);
});

test("recordMovement: a transfer without toWarehouseId is rejected before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.recordMovement(principal, {
    ...adjustment,
    kind: "transfer_out",
    quantityDelta: -5,
    toWarehouseId: null,
    idempotencyKey: "movement-transfer-4",
  }, undefined), code("request"));
  assert.equal(database.queries.length, 0);
});

test("recordMovement: a cashier without catalog.manage is denied before the database", async () => {
  const { service, database } = serviceFor({ roles: ["cashier"] });
  await assert.rejects(service.recordMovement(principal, adjustment, undefined), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("recordMovement: SQLSTATEs map to request, conflict, authorization and outage", async () => {
  const cases: readonly (readonly [string, string])[] = [
    ["23514", "request"],
    ["22000", "request"],
    ["23503", "conflict"],
    ["42501", "authorization"],
    ["42P01", "unavailable"],
  ];
  for (const [state, expected] of cases) {
    const handler: Handler = () => {
      throw Object.assign(new Error("database failure"), { code: state });
    };
    const { service } = serviceFor({ handler });
    await assert.rejects(service.recordMovement(principal, adjustment, undefined), code(expected));
  }
});

test("listMovements: calls the branch-scoped read with filters and maps the rows", async () => {
  const { service, database } = serviceFor();
  const result = await service.listMovements(principal, {
    restaurantId,
    branchId,
    warehouseId,
    itemId,
    limit: "25",
  });
  assert.deepEqual(result.movements, [expectedMovement]);
  assert.equal(database.queries[0]?.sql.includes("app_private.list_inventory_movements"), true);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, branchId, warehouseId, itemId, 25]);
});

test("listMovements: a foreign restaurant or branch is denied before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.listMovements(principal, { restaurantId: otherRestaurantId, branchId }), code("authorization"));
  await assert.rejects(service.listMovements(principal, { restaurantId, branchId: otherBranchId }), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("listMovements: a limit outside 1..200 is a request error", async () => {
  const { service, database } = serviceFor();
  for (const limit of [0, 201, "abc", ""]) {
    await assert.rejects(service.listMovements(principal, { restaurantId, branchId, limit }), code("request"));
  }
  assert.equal(database.queries.length, 0);
});

test("listBalances: calls the branch-scoped balance read and adds the request scope", async () => {
  const { service, database } = serviceFor();
  const result = await service.listBalances(principal, { restaurantId, branchId, warehouseId });
  assert.deepEqual(result.balances, [{
    restaurantId,
    branchId,
    warehouseId,
    itemId,
    quantity: 45,
    updatedAt: "2026-11-26T12:00:00.000Z",
  }]);
  assert.equal(database.queries[0]?.sql.includes("app_private.list_inventory_balances"), true);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, branchId, warehouseId]);
});

test("listBalances: a foreign branch is denied before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.listBalances(principal, { restaurantId, branchId: otherBranchId }), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("HTTP contract: 401, 400, 201, 200 and 403 for the movement endpoints", async () => {
  const { service } = serviceFor();
  const module = await Test.createTestingModule({
    controllers: [MovementsController],
    providers: [
      { provide: MovementsService, useValue: service },
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const movementsUrl = `${await app.getUrl()}/api/v1/inventory/movements`;
  const balancesUrl = `${await app.getUrl()}/api/v1/inventory/balances`;
  const authorization = { authorization: "Bearer inventory-fixture-token" };
  try {
    const unauthenticated = await fetch(movementsUrl, { method: "POST", body: JSON.stringify(adjustment) });
    assert.equal(unauthenticated.status, 401);

    const invalid = await fetch(movementsUrl, {
      method: "POST",
      body: "{}",
      headers: { ...authorization, "content-type": "application/json" },
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { code: "INVENTORY_REQUEST_INVALID" });

    const invalidDevice = await fetch(movementsUrl, {
      method: "POST",
      body: JSON.stringify(adjustment),
      headers: { ...authorization, "content-type": "application/json", "x-device-id": "not-a-uuid" },
    });
    assert.equal(invalidDevice.status, 400);
    assert.deepEqual(await invalidDevice.json(), { code: "INVENTORY_REQUEST_INVALID" });

    const created = await fetch(movementsUrl, {
      method: "POST",
      body: JSON.stringify(adjustment),
      headers: { ...authorization, "content-type": "application/json" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await created.json(), { status: "recorded", movementId, balance: 45 });

    const listed = await fetch(`${movementsUrl}?restaurantId=${restaurantId}&branchId=${branchId}`, { headers: authorization });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json() as { movements: readonly unknown[] }).movements, [expectedMovement]);

    const balances = await fetch(`${balancesUrl}?restaurantId=${restaurantId}&branchId=${branchId}`, { headers: authorization });
    assert.equal(balances.status, 200);
    assert.equal((await balances.json() as { balances: readonly unknown[] }).balances.length, 1);

    const foreign = await fetch(`${movementsUrl}?restaurantId=${otherRestaurantId}&branchId=${branchId}`, { headers: authorization });
    assert.equal(foreign.status, 403);
    assert.deepEqual(await foreign.json(), { code: "ACTION_NOT_AUTHORIZED" });
  } finally {
    await app.close();
  }
});
