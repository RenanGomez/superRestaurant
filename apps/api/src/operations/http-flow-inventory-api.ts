import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { publishCatalog } from "./http-flow-support.js";
import { runHttpFlow, type HttpFlowContext, type Json } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const currency = "MXN";
const supplierName = "Proveedor Inventario";

interface HttpResponse {
  readonly body: Json;
  readonly status: number;
}

interface PurchaseLineInput {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitCode: string;
  readonly unitCostMinor: number;
}

function expectStatus(response: HttpResponse, status: number, label: string): Json {
  assert.equal(response.status, status, `${label}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function rows(context: HttpFlowContext, text: string, values: readonly unknown[] = []): Promise<Json[]> {
  const result = await context.admin.query<Record<string, unknown>>(text, [...values]);
  return result.rows;
}

async function count(context: HttpFlowContext, text: string, values: readonly unknown[] = []): Promise<number> {
  const result = await rows(context, text, values);
  const row = result[0];
  assert.ok(row !== undefined, `expected a count row from: ${text}`);
  return Number(Object.values(row)[0]);
}

async function createItem(
  context: HttpFlowContext,
  name: string,
  unitCode: string,
  minQuantity: number,
): Promise<string> {
  const response = await context.send("manager", "POST", "/inventory/items", {
    restaurantId: context.scope.restaurantId,
    name,
    unitCode,
    minQuantity,
    active: true,
  });
  const body = expectStatus(response, 201, `item_create:${name}`);
  assert.equal(typeof body.id, "string");
  assert.equal(body.unitCode, unitCode);
  return String(body.id);
}

async function createWarehouse(context: HttpFlowContext, name: string): Promise<string> {
  const response = await context.send("manager", "POST", "/inventory/warehouses", {
    restaurantId: context.scope.restaurantId,
    branchId: context.scope.branchId,
    name,
    active: true,
  });
  const body = expectStatus(response, 201, `warehouse_create:${name}`);
  assert.equal(body.restaurantId, context.scope.restaurantId);
  assert.equal(body.branchId, context.scope.branchId);
  return String(body.id);
}

async function createPurchaseOrder(
  context: HttpFlowContext,
  supplierId: string,
  lines: readonly PurchaseLineInput[],
  idempotencyKey: string,
): Promise<Json> {
  const response = await context.send("manager", "POST", "/inventory/purchase-orders", {
    restaurantId: context.scope.restaurantId,
    branchId: context.scope.branchId,
    supplierId,
    currency,
    idempotencyKey,
    lines,
  });
  return expectStatus(response, 201, `purchase_order_create:${idempotencyKey}`);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Contract of the inventory HTTP surface against a real disposable PostgreSQL: authentication, role
 * gates, validation, 404, purchase-order idempotency, server-computed totals, cross-restaurant
 * isolation, reception into balances/alerts/costs, and the item/warehouse/recipe regression path.
 */
export async function inventoryApiFlow(): Promise<void> {
  await runHttpFlow(
    { databasePrefix: "superrestaurant_http_inventory_api", marker, stage: "http_flow_inventory_api" },
    async (context) => {
      const { restaurantId, branchId } = context.scope;
      // Inventory writes validate the device against `app.sync_devices`; the real browser registers
      // its per-actor id before writing, so the flow does the same for the manager.
      await context.admin.query(
        "select app_private.sync_register_device($1::uuid,$2::uuid,$3::uuid,$4::text)",
        [context.fixtures.actorIds.manager, restaurantId, branchId, context.deviceId],
      );
      const categoryId = randomUUID();
      const recipeProductId = randomUUID();
      const plainProductId = randomUUID();
      await publishCatalog(context, {
        categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
        products: [
          { productId: recipeProductId, categoryId, name: "Platillo con receta", sku: "INVAPI-001", active: true,
            displayOrder: 0, stationId: "kitchen", unit: "piece", unitPriceMinor: 500_000, tax: null },
          { productId: plainProductId, categoryId, name: "Platillo simple", sku: "INVAPI-002", active: true,
            displayOrder: 1, stationId: "kitchen", unit: "piece", unitPriceMinor: 120_000, tax: null },
        ],
        modifierGroups: [],
      });

      const defaultWarehouseId = randomUUID();
      await context.admin.query(
        "insert into app.inventory_warehouses(id, restaurant_id, branch_id, name, active, is_default) values ($1, $2, $3, $4, true, true)",
        [defaultWarehouseId, restaurantId, branchId, "Almacen Central"],
      );
      const supplier = expectStatus(await context.send("manager", "POST", "/inventory/suppliers", {
        restaurantId, name: supplierName, contact: "555-0100", active: true,
      }), 201, "supplier_create");
      assert.equal(supplier.name, supplierName);
      const supplierId = String(supplier.id);

      // 1. Every documented read plus the item write rejects a request with no session.
      const unauthenticated: readonly { readonly body?: unknown; readonly method: "GET" | "POST"; readonly path: string }[] = [
        { method: "GET", path: `/inventory/items${context.query({ restaurantId })}` },
        { method: "GET", path: `/inventory/warehouses${context.query({ restaurantId, branchId })}` },
        { method: "GET", path: `/inventory/suppliers${context.query({ restaurantId })}` },
        { method: "GET", path: `/inventory/purchase-orders${context.query({ restaurantId, branchId })}` },
        { method: "GET", path: `/inventory/movements${context.query({ restaurantId, branchId })}` },
        { method: "GET", path: `/inventory/balances${context.query({ restaurantId, branchId })}` },
        { method: "GET", path: `/inventory/alerts${context.query({ restaurantId, branchId })}` },
        { method: "GET", path: `/inventory/costs${context.query({ restaurantId, branchId, warehouseId: randomUUID(), itemId: randomUUID() })}` },
        { method: "GET", path: `/inventory/product-costs${context.query({ restaurantId, productId: recipeProductId })}` },
        { method: "GET", path: `/inventory/margins${context.query({ restaurantId, branchId, productId: recipeProductId })}` },
        { method: "POST", path: "/inventory/items", body: { restaurantId, name: "Insumo sin sesion", unitCode: "g" } },
      ];
      for (const request of unauthenticated) {
        const response = await context.send(null, request.method, request.path, request.body);
        assert.equal(response.status, 401, `${request.method} ${request.path}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
      }
      context.check("unauthenticated_401");

      // 2. A read-only membership cannot manage inventory but still reads the item list.
      const viewerItems = await context.send("viewer", "POST", "/inventory/items", {
        restaurantId, name: "Insumo viewer", unitCode: "g",
      });
      expectStatus(viewerItems, 403, "viewer_create_item");
      assert.equal(viewerItems.body.code, "ACTION_NOT_AUTHORIZED");
      const viewerSupplier = await context.send("viewer", "POST", "/inventory/suppliers", { restaurantId, name: "Proveedor viewer" });
      expectStatus(viewerSupplier, 403, "viewer_create_supplier");
      assert.equal(viewerSupplier.body.code, "ACTION_NOT_AUTHORIZED");
      const viewerOrder = await context.send("viewer", "POST", "/inventory/purchase-orders", {
        restaurantId, branchId, supplierId, currency, idempotencyKey: `viewer-${randomUUID()}`,
        lines: [{ itemId: randomUUID(), quantity: 1, unitCode: "g", unitCostMinor: 100 }],
      });
      expectStatus(viewerOrder, 403, "viewer_create_order");
      assert.equal(viewerOrder.body.code, "ACTION_NOT_AUTHORIZED");
      const viewerMovement = await context.send("viewer", "POST", "/inventory/movements", {
        restaurantId, branchId, warehouseId: randomUUID(), itemId: randomUUID(), kind: "adjustment",
        quantityDelta: 5, unitCode: "g", reason: "Ajuste de prueba", idempotencyKey: `viewer-movement-${randomUUID()}`,
        compensatesMovementId: null, transferPairId: null, toWarehouseId: null, unitCostMinor: null, currency: null,
      });
      expectStatus(viewerMovement, 403, "viewer_record_movement");
      assert.equal(viewerMovement.body.code, "ACTION_NOT_AUTHORIZED");
      const viewerRead = await context.send("viewer", "GET", `/inventory/items${context.query({ restaurantId })}`);
      expectStatus(viewerRead, 200, "viewer_list_items");
      assert.ok(Array.isArray(viewerRead.body.items));
      const viewerSupplierList = await context.send("viewer", "GET", `/inventory/suppliers${context.query({ restaurantId })}`);
      expectStatus(viewerSupplierList, 200, "viewer_list_suppliers");
      const viewerSupplierRows = viewerSupplierList.body.suppliers as Json[];
      assert.ok(viewerSupplierRows.some((row) => row.id === supplierId));
      const viewerSeedItemId = await createItem(context, "Insumo viewer seed", "g", 0);
      const viewerSeedOrder = await createPurchaseOrder(context, supplierId, [
        { itemId: viewerSeedItemId, quantity: 1, unitCode: "g", unitCostMinor: 100 },
      ], `viewer-seed-${randomUUID()}`);
      const viewerSeedOrderId = String(viewerSeedOrder.orderId);
      const viewerOrderList = await context.send("viewer", "GET", `/inventory/purchase-orders${context.query({ restaurantId, branchId })}`);
      expectStatus(viewerOrderList, 200, "viewer_list_orders");
      const viewerOrderRows = viewerOrderList.body.orders as Json[];
      assert.ok(viewerOrderRows.some((order) => order.id === viewerSeedOrderId));
      const viewerOrderDetail = expectStatus(
        await context.send("viewer", "GET", `/inventory/purchase-orders/${viewerSeedOrderId}`),
        200,
        "viewer_order_detail",
      );
      assert.equal(viewerOrderDetail.id, viewerSeedOrderId);
      context.check("role_403_viewer");

      // 3. Malformed payloads never reach the database: each is a request error.
      const withoutName = await context.send("manager", "POST", "/inventory/items", { restaurantId, unitCode: "g" });
      expectStatus(withoutName, 400, "item_without_name");
      assert.equal(withoutName.body.code, "INVENTORY_REQUEST_INVALID");
      const injectedTotal = await context.send("manager", "POST", "/inventory/purchase-orders", {
        restaurantId, branchId, supplierId, currency, idempotencyKey: `injected-${randomUUID()}`,
        lines: [{ itemId: randomUUID(), quantity: 1, unitCode: "g", unitCostMinor: 100 }], totalMinor: 99,
      });
      expectStatus(injectedTotal, 400, "order_with_total");
      assert.equal(injectedTotal.body.code, "INVENTORY_REQUEST_INVALID");
      const emptyPatch = await context.send("manager", "PATCH", `/inventory/suppliers/${supplierId}`, {});
      expectStatus(emptyPatch, 400, "supplier_empty_patch");
      assert.equal(emptyPatch.body.code, "INVENTORY_REQUEST_INVALID");
      const receiveWithoutWarehouse = await context.send("manager", "POST", `/inventory/purchase-orders/${randomUUID()}/receive`, {});
      expectStatus(receiveWithoutWarehouse, 400, "receive_without_warehouse");
      assert.equal(receiveWithoutWarehouse.body.code, "INVENTORY_REQUEST_INVALID");
      context.check("validation_400");

      // 4. An unknown id is a not-found, not an empty success.
      const unknownOrder = await context.send("manager", "GET", `/inventory/purchase-orders/${randomUUID()}`);
      expectStatus(unknownOrder, 404, "unknown_purchase_order");
      assert.equal(unknownOrder.body.code, "INVENTORY_NOT_FOUND");
      context.check("missing_404");

      // 5. Purchase-order creation is idempotent per key; reusing the key with other lines conflicts.
      const idempotencyItemId = await createItem(context, "Insumo Idempotencia", "g", 0);
      const idempotencyKey = `idem-${randomUUID()}`;
      const firstLines: readonly PurchaseLineInput[] = [{ itemId: idempotencyItemId, quantity: 4, unitCode: "g", unitCostMinor: 1_500 }];
      const firstOrder = await createPurchaseOrder(context, supplierId, firstLines, idempotencyKey);
      assert.equal(firstOrder.status, "draft");
      assert.equal(firstOrder.replayed, false);
      const firstOrderId = String(firstOrder.orderId);
      const replayOrder = await createPurchaseOrder(context, supplierId, firstLines, idempotencyKey);
      assert.equal(replayOrder.orderId, firstOrderId);
      assert.equal(replayOrder.replayed, true);
      assert.equal(await count(context,
        "select count(*) from app.inventory_purchase_orders where restaurant_id = $1 and idempotency_key = $2",
        [restaurantId, idempotencyKey]), 1);
      const divergentOrder = await context.send("manager", "POST", "/inventory/purchase-orders", {
        restaurantId, branchId, supplierId, currency, idempotencyKey,
        lines: [{ itemId: idempotencyItemId, quantity: 5, unitCode: "g", unitCostMinor: 1_500 }],
      });
      expectStatus(divergentOrder, 409, "idempotency_conflict");
      assert.equal(divergentOrder.body.code, "INVENTORY_PURCHASE_IDEMPOTENCY_CONFLICT");
      context.check("idempotency_409");

      // 6. Totals and line detail are computed by the server in integer minor units.
      const itemAId = await createItem(context, "Insumo A", "g", 0);
      const itemBId = await createItem(context, "Insumo B", "g", 0);
      const lineA: PurchaseLineInput = { itemId: itemAId, quantity: 3, unitCode: "g", unitCostMinor: 2_500 };
      const lineB: PurchaseLineInput = { itemId: itemBId, quantity: 2, unitCode: "g", unitCostMinor: 1_750 };
      const expectedTotal = lineA.quantity * lineA.unitCostMinor + lineB.quantity * lineB.unitCostMinor;
      const totalsOrder = await createPurchaseOrder(context, supplierId, [lineA, lineB], `totals-${randomUUID()}`);
      assert.equal(totalsOrder.totalMinor, undefined);
      const totalsOrderId = String(totalsOrder.orderId);
      const detail = expectStatus(await context.send("manager", "GET", `/inventory/purchase-orders/${totalsOrderId}`), 200, "order_detail");
      assert.equal(detail.id, totalsOrderId);
      assert.equal(detail.totalMinor, expectedTotal);
      const detailLines = detail.lines as Json[];
      assert.equal(detailLines.length, 2);
      const detailLineA = detailLines.find((line) => line.itemId === itemAId);
      assert.ok(detailLineA !== undefined);
      assert.equal(detailLineA.itemName, "Insumo A");
      assert.equal(detailLineA.quantity, lineA.quantity);
      assert.equal(detailLineA.unitCode, "g");
      assert.equal(detailLineA.unitCostMinor, lineA.unitCostMinor);
      const orderList = expectStatus(await context.send("manager", "GET",
        `/inventory/purchase-orders${context.query({ restaurantId, branchId })}`), 200, "order_list");
      const summaries = orderList.orders as Json[];
      const totalsSummary = summaries.find((order) => order.id === totalsOrderId);
      assert.ok(totalsSummary !== undefined);
      assert.equal(totalsSummary.totalMinor, expectedTotal);
      context.check("server_computed_totals");

      // 7. A manager of another restaurant sees nothing of restaurant A, not even purchase details.
      const foreignItems = await context.send("other_restaurant_manager", "GET", `/inventory/items${context.query({ restaurantId })}`);
      expectStatus(foreignItems, 403, "foreign_items");
      assert.equal(foreignItems.body.code, "ACTION_NOT_AUTHORIZED");
      const foreignSuppliers = await context.send("other_restaurant_manager", "GET", `/inventory/suppliers${context.query({ restaurantId })}`);
      expectStatus(foreignSuppliers, 403, "foreign_suppliers");
      assert.equal(foreignSuppliers.body.code, "ACTION_NOT_AUTHORIZED");
      const foreignOrders = await context.send("other_restaurant_manager", "GET",
        `/inventory/purchase-orders${context.query({ restaurantId, branchId })}`);
      expectStatus(foreignOrders, 403, "foreign_orders");
      assert.equal(foreignOrders.body.code, "ACTION_NOT_AUTHORIZED");
      const foreignDetail = await context.send("other_restaurant_manager", "GET", `/inventory/purchase-orders/${totalsOrderId}`);
      expectStatus(foreignDetail, 404, "foreign_order_detail");
      assert.equal(foreignDetail.body.code, "INVENTORY_NOT_FOUND");
      assert.ok(!JSON.stringify(foreignDetail.body).includes(supplierName));
      context.check("cross_restaurant_isolation");

      // 8. Reception writes one movement per line, feeds balances/alerts and the integer costing reads.
      const flourId = await createItem(context, "Harina HTTP", "g", 100_000);
      const cheeseId = await createItem(context, "Queso HTTP", "g", 50_000);
      const receptionOrder = await createPurchaseOrder(context, supplierId, [
        { itemId: flourId, quantity: 3, unitCode: "g", unitCostMinor: 2_500 },
        { itemId: cheeseId, quantity: 2, unitCode: "g", unitCostMinor: 1_750 },
      ], `reception-${randomUUID()}`);
      const receptionOrderId = String(receptionOrder.orderId);
      // 8.0 A device that is not registered for this actor cannot write: the receipt is rejected
      // before touching balances, and the order stays receivable.
      const foreignDeviceCheck = await context.send("manager", "POST", `/inventory/purchase-orders/${receptionOrderId}/receive`, {
        warehouseId: defaultWarehouseId, deviceId: randomUUID(), occurredAt: nowIso(), receivedAt: nowIso(),
      });
      expectStatus(foreignDeviceCheck, 403, "receive_foreign_device");
      assert.equal(foreignDeviceCheck.body.code, "INVENTORY_DEVICE_REJECTED");
      const foreignMovement = await context.send("manager", "POST", "/inventory/movements", {
        branchId,
        compensatesMovementId: null,
        currency: null,
        idempotencyKey: randomUUID(),
        itemId: flourId,
        kind: "adjustment",
        quantityDelta: 1,
        reason: "Dispositivo ajeno",
        restaurantId,
        toWarehouseId: null,
        transferPairId: null,
        unitCode: "g",
        unitCostMinor: null,
        warehouseId: defaultWarehouseId,
      }, { "x-device-id": randomUUID() });
      expectStatus(foreignMovement, 403, "movement_foreign_device");
      assert.equal(foreignMovement.body.code, "INVENTORY_DEVICE_REJECTED");
      assert.equal(await count(context, "select count(*)::int as total from app.inventory_movements where restaurant_id = $1 and item_id = $2", [restaurantId, flourId]), 0);
      context.check("device_registry_isolation");
      const received = await context.send("manager", "POST", `/inventory/purchase-orders/${receptionOrderId}/receive`, {
        warehouseId: defaultWarehouseId, deviceId: context.deviceId, occurredAt: nowIso(), receivedAt: nowIso(),
      });
      expectStatus(received, 201, "receive_purchase_order");
      assert.equal(received.body.status, "received");
      const receiptMovements = received.body.movements as Json[];
      assert.equal(receiptMovements.length, 2);
      const balances = expectStatus(await context.send("manager", "GET",
        `/inventory/balances${context.query({ restaurantId, branchId })}`), 200, "balances");
      const balanceRows = balances.balances as Json[];
      const flourBalance = balanceRows.find((row) => row.itemId === flourId && row.warehouseId === defaultWarehouseId);
      assert.ok(flourBalance !== undefined);
      assert.equal(flourBalance.quantity, 3);
      const alerts = expectStatus(await context.send("manager", "GET",
        `/inventory/alerts${context.query({ restaurantId, branchId })}`), 200, "alerts");
      const alertRows = alerts.alerts as Json[];
      const flourAlert = alertRows.find((row) => row.itemId === flourId && row.warehouseId === defaultWarehouseId);
      assert.ok(flourAlert !== undefined);
      assert.equal(flourAlert.quantity, 3);
      assert.equal(flourAlert.minQuantity, 100_000);
      assert.equal(flourAlert.deficit, 100_000 - 3);
      const cost = expectStatus(await context.send("manager", "GET",
        `/inventory/costs${context.query({ restaurantId, branchId, warehouseId: defaultWarehouseId, itemId: flourId })}`), 200, "cost");
      assert.equal(cost.quantity, 3);
      assert.equal(cost.valueMinor, 7_500);
      assert.equal(cost.unitCostMinor, 2_500);
      assert.equal(cost.currency, currency);
      assert.ok(Number.isInteger(cost.unitCostMinor));
      const recipe = expectStatus(await context.send("manager", "POST", "/inventory/recipes", {
        restaurantId, productId: recipeProductId,
        lines: [{ itemId: flourId, quantity: 120, unitCode: "g" }],
      }), 201, "recipe_publish");
      assert.equal(recipe.productId, recipeProductId);
      assert.equal(recipe.version, 1);
      const productCosts = expectStatus(await context.send("manager", "GET",
        `/inventory/product-costs${context.query({ restaurantId, productId: recipeProductId })}`), 200, "product_costs");
      const productCostRows = productCosts.costs as Json[];
      const flourCost = productCostRows.find((row) => row.itemId === flourId);
      assert.ok(flourCost !== undefined);
      assert.equal(flourCost.unitCostMinor, 2_500);
      assert.equal(flourCost.lineCostMinor, 120 * 2_500);
      assert.equal(flourCost.currency, currency);
      const margin = expectStatus(await context.send("manager", "GET",
        `/inventory/margins${context.query({ restaurantId, branchId, productId: recipeProductId })}`), 200, "margin");
      assert.equal(margin.priceMinor, 500_000);
      assert.equal(margin.costMinor, 120 * 2_500);
      assert.equal(margin.marginMinor, 500_000 - 120 * 2_500);
      assert.equal(margin.currency, currency);
      context.check("reception_balances_alerts_costs");

      // 9. Items, warehouses and recipes keep their own create/read path with the right scope.
      const boxItemId = await createItem(context, "Caja HTTP", "piece", 0);
      const secondWarehouseId = await createWarehouse(context, "Almacen Secundario");
      const items = expectStatus(await context.send("manager", "GET", `/inventory/items${context.query({ restaurantId })}`), 200, "items_list");
      const itemRows = items.items as Json[];
      assert.ok(itemRows.some((row) => row.id === boxItemId));
      const warehouses = expectStatus(await context.send("manager", "GET",
        `/inventory/warehouses${context.query({ restaurantId, branchId })}`), 200, "warehouses_list");
      const warehouseRows = warehouses.warehouses as Json[];
      assert.ok(warehouseRows.some((row) => row.id === secondWarehouseId));
      const plainRecipe = expectStatus(await context.send("manager", "POST", "/inventory/recipes", {
        restaurantId, productId: plainProductId,
        lines: [{ itemId: boxItemId, quantity: 1, unitCode: "piece" }],
      }), 201, "plain_recipe_publish");
      assert.equal(plainRecipe.productId, plainProductId);
      const plainRecipeId = String(plainRecipe.recipeId);
      const readRecipe = expectStatus(await context.send("manager", "GET",
        `/inventory/recipes/${plainRecipeId}${context.query({ restaurantId })}`), 200, "recipe_read");
      assert.equal(readRecipe.recipeId, plainRecipeId);
      assert.equal(readRecipe.productId, plainProductId);
      const recipeLines = readRecipe.lines as Json[];
      assert.equal(recipeLines.length, 1);
      const recipeLine = recipeLines[0];
      assert.ok(recipeLine !== undefined);
      assert.equal(recipeLine.itemId, boxItemId);
      assert.equal(recipeLine.quantity, 1);
      assert.equal(recipeLine.unitCode, "piece");
      context.check("items_warehouses_recipes_regression");

      return {
        restaurantId, branchId, supplierId, defaultWarehouseId, secondWarehouseId, flourId, cheeseId,
        idempotencyOrderId: firstOrderId, totalsOrderId, receptionOrderId, plainRecipeId,
        expectedTotal, flourUnitCostMinor: 2_500,
      };
    },
  );
}
