import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { captureAndConfirm, ok, openShiftAndRegister, publishCatalog, record } from "./http-flow-support.js";
import { runHttpFlow, type HttpFlowContext, type Json } from "./http-test-harness.js";

const marker = "LOCAL_HTTP_FLOW_ONLY";
const unitPriceMinor = 12_500;
const recipeQuantityPerUnit = 120;
const lineQuantity = 2;
const openingStock = 5_000;
const reason = "Cliente cambio de opinion";

async function rows(context: HttpFlowContext, text: string, values: readonly unknown[] = []): Promise<Json[]> {
  const result = await context.admin.query<Record<string, unknown>>(text, [...values]);
  return result.rows;
}

async function single(context: HttpFlowContext, text: string, values: readonly unknown[] = []): Promise<Json> {
  const result = await rows(context, text, values);
  assert.equal(result.length, 1, `expected one row from: ${text}`);
  const [row] = result;
  assert.notEqual(row, undefined);
  return row as Json;
}

async function count(context: HttpFlowContext, text: string, values: readonly unknown[] = []): Promise<number> {
  const row = await single(context, text, values);
  return Number(Object.values(row)[0]);
}

async function stockOf(context: HttpFlowContext, warehouseId: string, itemId: string): Promise<number> {
  const row = await single(context,
    "select quantity from app.inventory_balances where warehouse_id = $1 and item_id = $2",
    [warehouseId, itemId]);
  return Number(row.quantity);
}

async function orderItemIdOf(context: HttpFlowContext, orderId: string): Promise<string> {
  const detail = record(ok(await context.send("cashier", "POST", "/orders/detail", { schemaVersion: 1, scope: context.scope, orderId }), "order_detail"));
  const items = detail.items as Json[];
  assert.equal(items.length, 1, "the flow uses single-line orders");
  return String(items[0]?.orderItemId);
}

/**
 * A confirmed sale consumes the active recipe of its product from the branch default warehouse; cancelling
 * the line writes the compensating reversal and restores the balance; re-sending the same confirm body is a
 * replay that neither duplicates movements nor changes stock; a product without a recipe is inert.
 * Inventory is read back as postgres because nothing else may read `app.inventory_consumptions`.
 */
export async function inventoryFlow(): Promise<void> {
  await runHttpFlow({ databasePrefix: "superrestaurant_http_inventory", marker, stage: "http_flow_inventory" }, async (context) => {
    const { scope } = context;
    const managerActorId = context.fixtures.actorIds.manager;
    const categoryId = randomUUID();
    const recipeProductId = randomUUID();
    const plainProductId = randomUUID();
    const { catalogVersion } = await publishCatalog(context, {
      categories: [{ categoryId, name: "Platos", active: true, displayOrder: 0 }],
      products: [
        { productId: recipeProductId, categoryId, name: "Hamburguesa", sku: "INV-001", active: true, displayOrder: 0, stationId: "kitchen", unit: "piece", unitPriceMinor, tax: null },
        { productId: plainProductId, categoryId, name: "Refresco", sku: "INV-002", active: true, displayOrder: 1, stationId: "kitchen", unit: "piece", unitPriceMinor, tax: null },
      ],
      modifierGroups: [],
    });
    const register = await openShiftAndRegister(context, 0);

    // 1. Seed a restaurant item, the single default warehouse of the branch, opening stock and a recipe.
    const flourId = randomUUID();
    const warehouseId = randomUUID();
    await context.admin.query(
      "insert into app.inventory_items(id, restaurant_id, name, unit_code) values ($1, $2, 'Harina', 'g')",
      [flourId, scope.restaurantId],
    );
    await context.admin.query(
      "insert into app.inventory_warehouses(id, restaurant_id, branch_id, name, active, is_default) values ($1, $2, $3, 'Almacen principal', true, true)",
      [warehouseId, scope.restaurantId, scope.branchId],
    );
    const receipt = record((await single(context,
      "select app_private.inventory_record_movement($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'receipt', $6::integer, null, $7::text, null, null, null, pg_catalog.clock_timestamp(), null) as result",
      [managerActorId, scope.restaurantId, scope.branchId, warehouseId, flourId, openingStock, "seed:inventory-flow:flour"],
    )).result);
    assert.equal(receipt.status, "recorded");
    assert.equal(receipt.balance, openingStock);
    const recipe = record((await single(context,
      "select app_private.publish_inventory_recipe($1::uuid, $2::uuid, $3::jsonb) as result",
      [managerActorId, scope.restaurantId, JSON.stringify({ productId: recipeProductId,
        lines: [{ itemId: flourId, quantity: recipeQuantityPerUnit, unitCode: "g" }] })],
    )).result);
    assert.equal(recipe.version, 1);
    assert.equal(await stockOf(context, warehouseId, flourId), openingStock);
    context.check("seed_item_default_warehouse_receipt_and_recipe");

    // 2. Confirm a real capture: the applied path of the wrapper consumes recipe x line quantity.
    const sale = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId,
      lines: [{ lineId: randomUUID(), productId: recipeProductId, variantId: null, quantity: lineQuantity }] });
    const saleItemId = await orderItemIdOf(context, sale.orderId);
    const saleConsumption = await rows(context,
      "select cause, warehouse_id, order_item_id from app.inventory_consumptions where restaurant_id = $1 and order_id = $2",
      [scope.restaurantId, sale.orderId]);
    assert.equal(saleConsumption.length, 1);
    assert.equal(saleConsumption[0]?.cause, "sale");
    assert.equal(saleConsumption[0]?.warehouse_id, warehouseId);
    assert.equal(saleConsumption[0]?.order_item_id, saleItemId);
    const saleMovements = await rows(context,
      "select id, item_id, quantity_delta, warehouse_id, compensates_movement_id from app.inventory_movements where restaurant_id = $1 and source_type = 'order_item' and source_id = $2 and kind = 'sale_consumption'",
      [scope.restaurantId, saleItemId]);
    assert.equal(saleMovements.length, 1);
    assert.equal(saleMovements[0]?.item_id, flourId);
    assert.equal(saleMovements[0]?.warehouse_id, warehouseId);
    assert.equal(saleMovements[0]?.compensates_movement_id, null);
    assert.equal(Number(saleMovements[0]?.quantity_delta), -(recipeQuantityPerUnit * lineQuantity));
    const saleMovementId = String(saleMovements[0]?.id);
    assert.equal(await stockOf(context, warehouseId, flourId), openingStock - recipeQuantityPerUnit * lineQuantity);
    context.check("confirm_applied_consumes_recipe_times_quantity");

    // 3. Re-sending the identical confirmation body is a replay: no duplicate movement, no extra stock.
    const replay = ok(await context.send("cashier", "POST", "/captures/confirm", sale.confirm), "capture_confirm_replay");
    assert.equal(replay.replayed, true);
    assert.equal(record(replay.detail).confirmedOrderId, sale.orderId);
    assert.equal(await count(context,
      "select count(*) from app.inventory_movements where restaurant_id = $1 and source_type = 'order_item' and source_id = $2 and kind = 'sale_consumption'",
      [scope.restaurantId, saleItemId]), 1);
    assert.equal(await stockOf(context, warehouseId, flourId), openingStock - recipeQuantityPerUnit * lineQuantity);
    context.check("confirm_replay_does_not_duplicate_movements");

    // 4. Cancelling the line over HTTP writes one compensating reversal and restores the exact balance.
    const detailVersion = record(ok(await context.send("cashier", "POST", "/orders/detail", { schemaVersion: 1, scope, orderId: sale.orderId }), "order_detail")).version;
    assert.equal(typeof detailVersion, "number");
    const cancelled = ok(await context.send("cashier", "POST", "/orders/items/cancel", { ...context.audit(), schemaVersion: 1, scope,
      orderId: sale.orderId, orderItemId: saleItemId, expectedVersion: detailVersion, reason }), "cancel_line");
    assert.equal(cancelled.replayed, false);
    const cancelConsumption = await rows(context,
      "select cause, warehouse_id from app.inventory_consumptions where restaurant_id = $1 and order_id = $2 and order_item_id = $3 and cause = 'cancel'",
      [scope.restaurantId, sale.orderId, saleItemId]);
    assert.equal(cancelConsumption.length, 1);
    assert.equal(cancelConsumption[0]?.warehouse_id, warehouseId);
    const reversals = await rows(context,
      "select item_id, quantity_delta, compensates_movement_id from app.inventory_movements where restaurant_id = $1 and source_type = 'order_item' and source_id = $2 and kind = 'sale_reversal'",
      [scope.restaurantId, saleItemId]);
    assert.equal(reversals.length, 1);
    assert.equal(reversals[0]?.item_id, flourId);
    assert.equal(reversals[0]?.compensates_movement_id, saleMovementId);
    assert.equal(Number(reversals[0]?.quantity_delta), recipeQuantityPerUnit * lineQuantity);
    assert.equal(await stockOf(context, warehouseId, flourId), openingStock);
    context.check("cancel_line_reverses_and_restores_balance");

    // 5. A product without an active recipe produces no movement, no consumption row and no stock change.
    const plain = await captureAndConfirm(context, { catalogVersion, shiftId: register.shiftId,
      lines: [{ lineId: randomUUID(), productId: plainProductId, variantId: null, quantity: 1 }] });
    const plainItemId = await orderItemIdOf(context, plain.orderId);
    assert.equal(await count(context,
      "select count(*) from app.inventory_consumptions where restaurant_id = $1 and order_id = $2",
      [scope.restaurantId, plain.orderId]), 0);
    assert.equal(await count(context,
      "select count(*) from app.inventory_movements where restaurant_id = $1 and source_type = 'order_item' and source_id = $2",
      [scope.restaurantId, plainItemId]), 0);
    assert.equal(await stockOf(context, warehouseId, flourId), openingStock);
    context.check("line_without_recipe_is_inert");

    return { recipeProductId, plainProductId, warehouseId, flourId, saleOrderId: sale.orderId, saleItemId,
      saleMovementId, consumedQuantity: recipeQuantityPerUnit * lineQuantity };
  });
}
