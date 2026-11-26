import assert from "node:assert/strict";
import test from "node:test";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { BranchScope, MembershipRoleCode } from "@super-restaurant/shared-types";

import { AUTH_PRINCIPAL_VERIFIER, SupabaseAuthGuard } from "../auth/authentication.js";
import { MembershipAuthorizationService } from "../auth/membership-authorization.js";
import type { MembershipDirectoryPort } from "../auth/membership-directory.js";
import type { DatabaseClientPort, DatabaseQueryResult, TransactionalDatabaseClientPort } from "../database.js";
import { PurchasingController } from "./purchasing.controller.js";
import {
  PurchasingApplicationError,
  PurchasingService,
  type PurchaseOrderV1,
} from "./purchasing.service.js";

const principal = { actorId: "8cc7eb84-af2a-4e84-95de-967c39af86ab" };
const restaurantId = "1e37ae13-8507-484c-969f-2176f77b7000";
const otherRestaurantId = "9f8a5f0a-93ee-4a0b-9f0e-6a2a5f2a1234";
const branchId = "23723e10-c0bf-49fd-9363-4f0e2c60e955";
const otherBranchId = "00000000-0000-4000-8000-000000000000";
const supplierId = "c483b6e7-e102-4cc5-a887-d30712c85e52";
const otherSupplierId = "d6f3073e-4d2d-4b9f-90ea-926e5a86ff02";
const orderId = "a409ec59-9f5e-496d-a45d-b83a46b49674";
const itemId = "ee50f0f6-746f-47cb-8383-ad7834ef3ef0";
const warehouseId = "e74df54b-30a7-449b-a23f-c4ca6f93bda4";
const movementId = "0a5dfef7-e2dd-4b66-845a-7e28d24a46ce";
const lineId = "b98b5914-002d-42a0-a26b-2a0f954ddf1e";
const deviceId = "88d34b74-6afe-4a3c-acb9-9fc8ed902c91";
const scope = { restaurantId, branchId } as unknown as BranchScope;

const supplierRow = Object.freeze({
  id: supplierId,
  restaurant_id: restaurantId,
  name: "Distribuidora Norte",
  contact: "+52 555 0000",
  active: true,
  created_at: new Date("2026-11-26T12:00:00.000Z"),
});

const expectedSupplier = Object.freeze({
  id: supplierId,
  restaurantId,
  name: "Distribuidora Norte",
  contact: "+52 555 0000",
  active: true,
  createdAt: "2026-11-26T12:00:00.000Z",
});

const orderSummaryRow = Object.freeze({
  id: orderId,
  supplier_id: supplierId,
  supplier_name: "Distribuidora Norte",
  status: "draft",
  currency: "MXN",
  ordered_at: new Date("2026-11-26T12:00:00.000Z"),
  received_at: null,
  received_by: null,
  total_minor: "75000",
});

const orderDetailRow = Object.freeze({
  ...orderSummaryRow,
  restaurant_id: restaurantId,
  branch_id: branchId,
  lines: [
    {
      item_id: itemId,
      item_name: "Harina",
      quantity: 100,
      unit_code: "g",
      unit_cost_minor: "250",
    },
  ],
});

const expectedOrderSummary = Object.freeze({
  id: orderId,
  supplierId,
  supplierName: "Distribuidora Norte",
  status: "draft",
  currency: "MXN",
  orderedAt: "2026-11-26T12:00:00.000Z",
  receivedAt: null,
  receivedBy: null,
  totalMinor: 75000,
});

const orderCommand = {
  restaurantId,
  branchId,
  supplierId,
  currency: "MXN",
  idempotencyKey: "purchase-order-1",
  lines: [
    { itemId, quantity: 100, unitCode: "g", unitCostMinor: 250 },
  ],
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
  if (sql.includes("app_private.create_inventory_supplier")) return [supplierRow];
  if (sql.includes("app_private.update_inventory_supplier")) return [supplierRow];
  if (sql.includes("app_private.read_inventory_supplier_for_manage")) return [supplierRow];
  if (sql.includes("app_private.list_inventory_suppliers")) return [supplierRow];
  if (sql.includes("app_private.list_inventory_purchase_orders")) return [orderSummaryRow];
  if (sql.includes("app_private.read_inventory_purchase_order")) return [orderDetailRow];
  if (sql.includes("app_private.inventory_create_purchase_order")) {
    return [{ result: { orderId, status: "draft" } }];
  }
  if (sql.includes("app_private.inventory_receive_purchase_order")) {
    return [{ result: { status: "received", movements: [{ lineId, movementId }] } }];
  }
  return [];
}

function code(expected: string) {
  return (error: unknown) => error instanceof PurchasingApplicationError && error.code === expected;
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
} = {}): { service: PurchasingService; database: FakeDatabase } {
  const roles = options.roles ?? (["manager"] as const);
  const memberships = options.memberships ?? [{ roles, scope }];
  const database = new FakeDatabase(options.handler ?? defaultHandler);
  const service = new PurchasingService(authorizationFor(memberships), directoryFor(memberships), database);
  return { service, database };
}

test("listSuppliers: calls the restaurant-scoped function and maps the rows", async () => {
  const { service, database } = serviceFor();
  const result = await service.listSuppliers(principal, { restaurantId });
  assert.equal(result.includeInactive, false);
  assert.deepEqual(result.suppliers, [expectedSupplier]);
  assert.equal(database.queries[0]?.sql.includes("app_private.list_inventory_suppliers"), true);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, false]);
});

test("listSuppliers: a kitchen role without catalog.read is denied before the database", async () => {
  const { service, database } = serviceFor({ roles: ["kitchen"] });
  await assert.rejects(service.listSuppliers(principal, { restaurantId }), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("listSuppliers: a foreign restaurant is denied before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.listSuppliers(principal, { restaurantId: otherRestaurantId }), code("authorization"));
  assert.equal(database.queries.length, 0);
});

test("createSupplier: calls the writer with the server actor and optional contact", async () => {
  const { service, database } = serviceFor();
  const result = await service.createSupplier(principal, {
    restaurantId,
    name: "Distribuidora Norte",
    contact: "+52 555 0000",
  });
  assert.deepEqual(result, expectedSupplier);
  assert.equal(database.queries[0]?.sql.includes("app_private.create_inventory_supplier"), true);
  assert.deepEqual(database.queries[0]?.parameters, [
    principal.actorId,
    restaurantId,
    "Distribuidora Norte",
    "+52 555 0000",
    true,
  ]);
});

test("createSupplier: a blank name is a request error before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.createSupplier(principal, { restaurantId, name: "   " }), code("request"));
  assert.equal(database.queries.length, 0);
});

test("updateSupplier: reads the existing row, authorizes and merges the patch", async () => {
  const { service, database } = serviceFor();
  const result = await service.updateSupplier(principal, supplierId, { name: "Distribuidora Sur", active: false });
  assert.deepEqual(result, expectedSupplier);
  assert.equal(database.queries[0]?.sql.includes("app_private.read_inventory_supplier_for_manage"), true);
  assert.equal(database.queries[1]?.sql.includes("app_private.update_inventory_supplier"), true);
  assert.deepEqual(database.queries[1]?.parameters, [
    principal.actorId,
    supplierId,
    "Distribuidora Sur",
    "+52 555 0000",
    false,
  ]);
});

test("updateSupplier: an unknown supplier is missing and an empty patch is rejected", async () => {
  const missing = serviceFor({ handler: () => [] });
  await assert.rejects(missing.service.updateSupplier(principal, supplierId, { name: "Otro" }), code("missing"));
  assert.equal(missing.database.queries.length, 1);

  const { service, database } = serviceFor();
  await assert.rejects(service.updateSupplier(principal, supplierId, {}), code("request"));
  assert.equal(database.queries.length, 0);
});

test("updateSupplier: a cashier cannot update an existing supplier", async () => {
  const { service, database } = serviceFor({ roles: ["cashier"] });
  await assert.rejects(service.updateSupplier(principal, supplierId, { name: "Otro" }), code("authorization"));
  assert.equal(database.queries.length, 1);
});

test("listPurchaseOrders: calls the branch read with the status filter and limit", async () => {
  const { service, database } = serviceFor();
  const result = await service.listPurchaseOrders(principal, {
    restaurantId,
    branchId,
    status: "draft",
    limit: "25",
  });
  assert.deepEqual(result.orders, [expectedOrderSummary]);
  assert.equal(database.queries[0]?.sql.includes("app_private.list_inventory_purchase_orders"), true);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, restaurantId, branchId, "draft", 25]);
});

test("listPurchaseOrders: an invalid status or limit is a request error", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.listPurchaseOrders(principal, { restaurantId, branchId, status: "archived" }),
    code("request"),
  );
  await assert.rejects(
    service.listPurchaseOrders(principal, { restaurantId, branchId, limit: 201 }),
    code("request"),
  );
  assert.equal(database.queries.length, 0);
});

test("listPurchaseOrders: a foreign branch is denied before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.listPurchaseOrders(principal, { restaurantId, branchId: otherBranchId }),
    code("authorization"),
  );
  assert.equal(database.queries.length, 0);
});

test("createPurchaseOrder: sends the exact payload with the propagated idempotency key", async () => {
  const { service, database } = serviceFor();
  const result = await service.createPurchaseOrder(principal, orderCommand);
  assert.deepEqual(result, { orderId, status: "draft", replayed: false });
  assert.equal(database.queries[0]?.sql.includes("app_private.inventory_create_purchase_order"), true);
  assert.deepEqual(database.queries[0]?.parameters.slice(0, 3), [principal.actorId, restaurantId, branchId]);
  assert.deepEqual(JSON.parse(String(database.queries[0]?.parameters[3])), {
    supplierId,
    currency: "MXN",
    idempotencyKey: "purchase-order-1",
    lines: [{ itemId, quantity: 100, unitCode: "g", unitCostMinor: 250 }],
  });
});

test("createPurchaseOrder: a replayed result is reported without inventing data", async () => {
  const handler: Handler = (sql) => (sql.includes("app_private.inventory_create_purchase_order")
    ? [{ result: { orderId, status: "draft", replayed: true } }]
    : []);
  const { service } = serviceFor({ handler });
  assert.deepEqual(await service.createPurchaseOrder(principal, orderCommand), {
    orderId,
    status: "draft",
    replayed: true,
  });
});

test("createPurchaseOrder: a client actorId, fractional cost or foreign unit is rejected", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(
    service.createPurchaseOrder(principal, { ...orderCommand, actorId: otherSupplierId }),
    code("request"),
  );
  await assert.rejects(
    service.createPurchaseOrder(principal, {
      ...orderCommand,
      lines: [{ itemId, quantity: 1, unitCode: "g", unitCostMinor: 1.5 }],
    }),
    code("request"),
  );
  await assert.rejects(
    service.createPurchaseOrder(principal, {
      ...orderCommand,
      lines: [{ itemId, quantity: 1, unitCode: "kg", unitCostMinor: 100 }],
    }),
    code("request"),
  );
  assert.equal(database.queries.length, 0);
});

test("readPurchaseOrder: reads the detail and parses integer minor costs and lines", async () => {
  const { service, database } = serviceFor();
  const order = await service.readPurchaseOrder(principal, orderId);
  assert.deepEqual(order, {
    ...expectedOrderSummary,
    restaurantId,
    branchId,
    lines: [{ itemId, itemName: "Harina", quantity: 100, unitCode: "g", unitCostMinor: 250 }],
  });
  assert.equal(database.queries[0]?.sql.includes("app_private.read_inventory_purchase_order"), true);
  assert.deepEqual(database.queries[0]?.parameters, [principal.actorId, orderId]);
});

test("readPurchaseOrder: an unknown id is missing", async () => {
  const { service } = serviceFor({ handler: () => [] });
  await assert.rejects(service.readPurchaseOrder(principal, orderId), code("missing"));
});

test("read isolation: a viewer with only catalog.read lists suppliers, orders and a detail", async () => {
  const { service } = serviceFor({ roles: ["viewer"] });
  assert.deepEqual((await service.listSuppliers(principal, { restaurantId })).suppliers, [expectedSupplier]);
  assert.deepEqual(
    (await service.listPurchaseOrders(principal, { restaurantId, branchId })).orders,
    [expectedOrderSummary],
  );
  assert.deepEqual(await service.readPurchaseOrder(principal, orderId), {
    ...expectedOrderSummary,
    restaurantId,
    branchId,
    lines: [{ itemId, itemName: "Harina", quantity: 100, unitCode: "g", unitCostMinor: 250 }],
  });
});

test("read isolation: an auditor with only catalog.read reads suppliers, orders and a detail", async () => {
  const { service } = serviceFor({ roles: ["auditor"] });
  assert.equal((await service.listSuppliers(principal, { restaurantId })).suppliers.length, 1);
  assert.equal((await service.listPurchaseOrders(principal, { restaurantId, branchId })).orders.length, 1);
  assert.equal((await service.readPurchaseOrder(principal, orderId)).id, orderId);
});

test("write isolation: a viewer with only catalog.read cannot create or edit suppliers or orders", async () => {
  const createSupplier = serviceFor({ roles: ["viewer"] });
  await assert.rejects(
    createSupplier.service.createSupplier(principal, { restaurantId, name: "Distribuidora Sur" }),
    code("authorization"),
  );
  assert.equal(createSupplier.database.queries.length, 0);

  const updateSupplier = serviceFor({ roles: ["viewer"] });
  await assert.rejects(
    updateSupplier.service.updateSupplier(principal, supplierId, { name: "Distribuidora Sur" }),
    code("authorization"),
  );
  assert.equal(updateSupplier.database.queries.length, 1);

  const createOrder = serviceFor({ roles: ["viewer"] });
  await assert.rejects(createOrder.service.createPurchaseOrder(principal, orderCommand), code("authorization"));
  assert.equal(createOrder.database.queries.length, 0);

  const receiveOrder = serviceFor({ roles: ["viewer"] });
  await assert.rejects(
    receiveOrder.service.receivePurchaseOrder(principal, orderId, { warehouseId }),
    code("authorization"),
  );
  assert.equal(receiveOrder.database.queries.length, 1);
});

test("read isolation: a foreign principal is denied and never receives a foreign order", async () => {
  const foreignOrderDetailRow = Object.freeze({
    ...orderDetailRow,
    restaurant_id: otherRestaurantId,
    branch_id: otherBranchId,
  });
  const { service } = serviceFor({
    roles: ["viewer"],
    handler: (sql) => (sql.includes("app_private.read_inventory_purchase_order") ? [foreignOrderDetailRow] : []),
  });
  await assert.rejects(service.listSuppliers(principal, { restaurantId: otherRestaurantId }), code("authorization"));
  await assert.rejects(
    service.listPurchaseOrders(principal, { restaurantId: otherRestaurantId, branchId: otherBranchId }),
    code("authorization"),
  );
  await assert.rejects(service.readPurchaseOrder(principal, orderId), code("authorization"));
});

test("receivePurchaseOrder: reads the scope, authorizes and sends the receipt payload", async () => {
  const { service, database } = serviceFor();
  const result = await service.receivePurchaseOrder(principal, orderId, {
    warehouseId,
    deviceId,
    occurredAt: "2026-11-26T12:00:00.000Z",
  });
  assert.deepEqual(result, { status: "received", movements: [{ lineId, movementId }] });
  assert.equal(database.queries[0]?.sql.includes("app_private.read_inventory_purchase_order"), true);
  assert.equal(database.queries[1]?.sql.includes("app_private.inventory_receive_purchase_order"), true);
  assert.deepEqual(database.queries[1]?.parameters.slice(0, 2), [principal.actorId, orderId]);
  assert.deepEqual(JSON.parse(String(database.queries[1]?.parameters[2])), {
    warehouseId,
    deviceId,
    occurredAt: "2026-11-26T12:00:00.000Z",
  });
});

test("receivePurchaseOrder: a missing warehouseId is rejected before the database", async () => {
  const { service, database } = serviceFor();
  await assert.rejects(service.receivePurchaseOrder(principal, orderId, {}), code("request"));
  assert.equal(database.queries.length, 0);
});

test("SQLSTATEs map to request, conflict, authorization and outage", async () => {
  const cases: readonly (readonly [string, string])[] = [
    ["22000", "request"],
    ["23514", "request"],
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
    await assert.rejects(service.listSuppliers(principal, { restaurantId }), code(expected));
  }
});

test("the idempotency conflict message maps to its own 409 code", async () => {
  const handler: Handler = () => {
    throw Object.assign(new Error("INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT"), { code: "22000" });
  };
  const { service } = serviceFor({ handler });
  await assert.rejects(service.createPurchaseOrder(principal, orderCommand), code("idempotency-conflict"));
});

test("HTTP contract: 401, 400, 201, 200, 403 and 409 for the purchasing endpoints", async () => {
  const { service } = serviceFor();
  const module = await Test.createTestingModule({
    controllers: [PurchasingController],
    providers: [
      { provide: PurchasingService, useValue: service },
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const suppliersUrl = `${base}/api/v1/inventory/suppliers`;
  const ordersUrl = `${base}/api/v1/inventory/purchase-orders`;
  const authorization = { authorization: "Bearer inventory-fixture-token" };
  try {
    const unauthenticated = await fetch(`${suppliersUrl}?restaurantId=${restaurantId}`);
    assert.equal(unauthenticated.status, 401);

    const invalid = await fetch(suppliersUrl, {
      method: "POST",
      body: "{}",
      headers: { ...authorization, "content-type": "application/json" },
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { code: "INVENTORY_REQUEST_INVALID" });

    const createdSupplier = await fetch(suppliersUrl, {
      method: "POST",
      body: JSON.stringify({ restaurantId, name: "Distribuidora Norte", contact: "+52 555 0000" }),
      headers: { ...authorization, "content-type": "application/json" },
    });
    assert.equal(createdSupplier.status, 201);
    assert.equal(createdSupplier.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await createdSupplier.json(), expectedSupplier);

    const listedSuppliers = await fetch(`${suppliersUrl}?restaurantId=${restaurantId}`, { headers: authorization });
    assert.equal(listedSuppliers.status, 200);
    assert.equal((await listedSuppliers.json() as { suppliers: readonly unknown[] }).suppliers.length, 1);

    const createdOrder = await fetch(ordersUrl, {
      method: "POST",
      body: JSON.stringify(orderCommand),
      headers: { ...authorization, "content-type": "application/json" },
    });
    assert.equal(createdOrder.status, 201);
    assert.deepEqual(await createdOrder.json(), { orderId, status: "draft", replayed: false });

    const listedOrders = await fetch(`${ordersUrl}?restaurantId=${restaurantId}&branchId=${branchId}`, {
      headers: authorization,
    });
    assert.equal(listedOrders.status, 200);
    assert.deepEqual((await listedOrders.json() as { orders: readonly unknown[] }).orders, [expectedOrderSummary]);

    const detail = await fetch(`${ordersUrl}/${orderId}`, { headers: authorization });
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json() as PurchaseOrderV1).lines[0]?.unitCostMinor, 250);

    const received = await fetch(`${ordersUrl}/${orderId}/receive`, {
      method: "POST",
      body: JSON.stringify({ warehouseId }),
      headers: { ...authorization, "content-type": "application/json" },
    });
    assert.equal(received.status, 201);
    assert.deepEqual(await received.json(), { status: "received", movements: [{ lineId, movementId }] });

    const foreign = await fetch(`${ordersUrl}?restaurantId=${otherRestaurantId}&branchId=${branchId}`, {
      headers: authorization,
    });
    assert.equal(foreign.status, 403);
    assert.deepEqual(await foreign.json(), { code: "ACTION_NOT_AUTHORIZED" });
  } finally {
    await app.close();
  }
});

test("HTTP contract: an idempotency conflict is a readable 409", async () => {
  const handler: Handler = (sql) => {
    if (sql.includes("app_private.inventory_create_purchase_order")) {
      throw Object.assign(new Error("INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT"), { code: "22000" });
    }
    return defaultHandler(sql);
  };
  const { service } = serviceFor({ handler });
  const module = await Test.createTestingModule({
    controllers: [PurchasingController],
    providers: [
      { provide: PurchasingService, useValue: service },
      { provide: AUTH_PRINCIPAL_VERIFIER, useValue: { verifyAccessToken: async () => principal } },
      { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  try {
    const response = await fetch(`${await app.getUrl()}/api/v1/inventory/purchase-orders`, {
      method: "POST",
      body: JSON.stringify(orderCommand),
      headers: { authorization: "Bearer inventory-fixture-token", "content-type": "application/json" },
    });
    assert.equal(response.status, 409);
    const body = await response.json() as { code: string; message: string };
    assert.equal(body.code, "INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT");
    assert.equal(typeof body.message, "string");
    assert.equal(body.message.length > 0, true);
  } finally {
    await app.close();
  }
});
