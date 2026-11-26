import { randomUUID } from "node:crypto";

import {
  formatInventoryMovementQuantity, formatInventoryNumber, formatMinorUnits, formatPercentFromMinor,
  stockAlertSummary,
} from "../../src/lib/inventory-ui.ts";
import type {
  InventoryItem, InventoryModifierGroup, InventoryMovement, InventoryPizzaHalf, InventoryPizzaLine, JourneyApi,
  MenuCatalog, MenuProduct,
} from "../fixtures/journey-api.ts";
import {
  assertAppPage, beforeJourney, expect, requireActiveShift, test,
} from "../fixtures/journey-test.ts";

const RECIPE_QUANTITY = 120;
const OPENING_QUANTITY = 200;
const UNIT_COST_MINOR = 1;
const MIN_QUANTITY = 1_000;
const ADJUSTMENT_QUANTITY = 10;
const NO_DEFAULT_WAREHOUSE = "La sucursal no tiene almacén predeterminado activo: la venta no descuenta inventario";

type CatalogGroup = NonNullable<MenuCatalog["modifierGroups"]>[number];

interface SalePlan {
  readonly modifierGroups: readonly InventoryModifierGroup[];
  readonly pizza: InventoryPizzaLine | null;
  readonly product: MenuProduct;
  readonly variantId: string | null;
}

function groupsFor(product: MenuProduct, catalog: MenuCatalog): readonly CatalogGroup[] {
  const assigned = product.modifierGroupIds;
  return (catalog.modifierGroups ?? []).filter((group) => group.active
    && (assigned === undefined ? group.productId === product.productId : assigned.includes(group.groupId)));
}

function baseGroupIds(product: MenuProduct): readonly string[] {
  return product.baseGroupIds ?? (product.baseGroupId == null ? [] : [product.baseGroupId]);
}

function extraGroupIds(product: MenuProduct, groups: readonly CatalogGroup[]): readonly string[] {
  if (product.extraOptionIds === undefined) return product.extraGroupIds ?? [];
  const ids: string[] = [];
  for (const optionId of product.extraOptionIds) {
    const group = groups.find((candidate) => candidate.options.some((option) => option.optionId === optionId));
    if (group !== undefined && !ids.includes(group.groupId)) ids.push(group.groupId);
  }
  return ids;
}

/**
 * Whole pizza for a Pizza V2 product: both halves carry the same product, size and minimal picks.
 * `null` means a legacy product (sold as a simple V1 line); `undefined` means its catalog is incomplete.
 */
function pizzaPlan(
  product: MenuProduct,
  groups: readonly CatalogGroup[],
): InventoryPizzaLine | null | undefined {
  if (product.pizzaMode === undefined) return null;
  const ingredientOptionIds: string[] = [];
  for (const groupId of baseGroupIds(product)) {
    const group = groups.find((candidate) => candidate.groupId === groupId);
    if (group === undefined) return undefined;
    if (product.pizzaMode !== "custom") continue;
    const maximum = group.maximumQuantity > 0 ? group.maximumQuantity : group.minimumQuantity;
    const wanted = Math.max(0, Math.min(group.minimumQuantity, maximum));
    const chosen = group.options.filter((option) => option.active).slice(0, wanted).map((option) => option.optionId);
    if (chosen.length < wanted) return undefined;
    ingredientOptionIds.push(...chosen);
  }
  const extraOptionIds: string[] = [];
  const canAddExtras = product.pizzaMode === "custom" || product.customizeAtOrder === true;
  if (canAddExtras) {
    for (const groupId of extraGroupIds(product, groups)) {
      const group = groups.find((candidate) => candidate.groupId === groupId);
      if (group === undefined || group.minimumQuantity < 1) continue;
      const wanted = Math.min(group.minimumQuantity, group.maximumQuantity > 0 ? group.maximumQuantity : group.minimumQuantity);
      const chosen = group.options
        .filter((option) => option.active && !ingredientOptionIds.includes(option.optionId))
        .slice(0, wanted)
        .map((option) => option.optionId);
      if (chosen.length < wanted) return undefined;
      extraOptionIds.push(...chosen);
    }
  }
  const ingredients = [...new Set(ingredientOptionIds)];
  const extras = [...new Set(extraOptionIds)];
  if (extras.some((id) => ingredients.includes(id))) return undefined;
  const variantId = (product.variants ?? []).find((variant) => variant.active)?.variantId ?? null;
  const half = (fraction: InventoryPizzaHalf["fraction"]): InventoryPizzaHalf => ({
    extraOptionIds: extras, fraction, ingredientOptionIds: ingredients, productId: product.productId,
    removedIngredientOptionIds: [], variantId,
  });
  return { halves: [half("half-a"), half("half-b")], ruleVersion: "pizza-halves-v2" };
}

/**
 * First product the capture can sell with a minimal, catalog-derived plan: its active size (when it
 * has sizes), one option per mandatory non-pizza group and, for a Pizza V2 product, the two-halves
 * payload the API requires instead.
 */
function sellablePlan(catalog: MenuCatalog): SalePlan | undefined {
  const candidates = catalog.products.filter((product) => product.active
    && ((product.variants ?? []).length === 0 || (product.variants ?? []).some((variant) => variant.active)));
  const allGroups = catalog.modifierGroups ?? [];
  for (const product of [...candidates.filter((candidate) => candidate.pizzaMode === undefined), ...candidates]) {
    const groups = groupsFor(product, catalog);
    const pizza = pizzaPlan(product, allGroups);
    if (pizza === undefined) continue;
    const pizzaGroups = pizza === null
      ? new Set<string>()
      : new Set([...baseGroupIds(product), ...extraGroupIds(product, allGroups)]);
    const modifierGroups: InventoryModifierGroup[] = [];
    let complete = true;
    for (const group of groups) {
      if (group.minimumQuantity < 1 || pizzaGroups.has(group.groupId)) continue;
      const option = group.options.find((candidate) => candidate.active);
      if (option === undefined) { complete = false; break; }
      const maximum = group.maximumQuantity > 0 ? group.maximumQuantity : group.minimumQuantity;
      modifierGroups.push({
        groupId: group.groupId,
        selections: [{ optionId: option.optionId, quantity: Math.max(1, Math.min(group.minimumQuantity, maximum)) }],
      });
    }
    if (complete) return { modifierGroups, pizza, product, variantId: (product.variants ?? []).find((v) => v.active)?.variantId ?? null };
  }
  return undefined;
}

async function createRunItem(api: JourneyApi, name: string): Promise<InventoryItem> {
  try {
    return await api.createInventoryItem({
      active: true, minQuantity: MIN_QUANTITY, name, purchaseUnitFactor: 1, sku: null, unitCode: "g",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("HTTP 403")) {
      test.skip(true, "La cuenta guardada no puede administrar inventario (rol de solo lectura)");
    }
    throw error;
  }
}

async function balanceOf(api: JourneyApi, warehouseId: string, itemId: string): Promise<number> {
  const reply = await api.listInventoryBalances();
  return reply.balances.find((balance) => balance.warehouseId === warehouseId && balance.itemId === itemId)?.quantity ?? 0;
}

/** Polls the ledger until a movement of `kind` for this run's item appears; undefined on timeout. */
async function waitForMovement(
  api: JourneyApi,
  itemId: string,
  kind: InventoryMovement["kind"],
): Promise<InventoryMovement | undefined> {
  let found: InventoryMovement | undefined;
  await expect.poll(async () => {
    const reply = await api.listInventoryMovements({ itemId });
    found = reply.movements.find((movement) => movement.kind === kind);
    return found !== undefined;
  }, { intervals: [500, 1_000], message: `No apareció el movimiento ${kind}`, timeout: 20_000 })
    .toBe(true)
    .catch(() => undefined);
  return found;
}

test("journey 13: la venta descuenta inventario, la alerta muestra el déficit y cancelar repone el saldo", async ({
  page, api, cleanup, runId,
}, testInfo) => {
  beforeJourney(testInfo);
  test.setTimeout(120_000);

  const catalog = (await api.menuCatalog()).catalog;
  if (catalog === null) {
    test.skip(true, "La sucursal no tiene catálogo publicado; siembra uno de pruebas antes de correr journeys");
    throw new Error("Sin catálogo");
  }
  const plan = sellablePlan(catalog);
  if (plan === undefined) {
    test.skip(true, "El catálogo no tiene un producto vendible con su configuración obligatoria completa");
    throw new Error("Sin producto vendible");
  }
  const shiftId = await requireActiveShift(api);
  const warehouses = (await api.listInventoryWarehouses()).warehouses.filter((warehouse) => warehouse.active);
  if (warehouses.length === 0) {
    test.skip(true, "La sucursal no tiene almacenes de inventario activos; crea uno antes de correr el journey");
    throw new Error("Sin almacenes");
  }

  const itemName = `Insumo ${runId}`;
  const saleOrderId = randomUUID();
  let createdSupplierId: string | undefined;

  // Cleanup is registered before the first write: cancel the sale (which reverses its stock) and
  // deactivate only this run's item/supplier, since the inventory API has no physical delete.
  cleanup.add("desactivar el insumo del journey 13", async () => {
    const items = await api.listInventoryItems();
    for (const item of items.items) {
      if (item.name === itemName) await api.updateInventoryItem(item.id, { active: false });
    }
  });
  cleanup.add("desactivar el proveedor del journey 13", async () => {
    if (createdSupplierId !== undefined) await api.updateInventorySupplier(createdSupplierId, { active: false });
  });
  cleanup.add("cancelar la venta del journey 13 si quedó sin cobrar", async () => {
    await api.cancelIfUnpaid(saleOrderId);
  });

  const item = await createRunItem(api, itemName);
  const suppliers = (await api.listInventorySuppliers()).suppliers;
  const activeSupplier = suppliers.find((supplier) => supplier.active);
  let supplierId: string;
  if (activeSupplier === undefined) {
    const created = await api.createInventorySupplier({ contact: null, name: `Proveedor ${runId}` });
    createdSupplierId = created.id;
    supplierId = created.id;
  } else {
    supplierId = activeSupplier.id;
  }

  // Seed a received purchase order per active warehouse: the default warehouse may be any of them,
  // so stock and integer cost exist wherever the sale consumes. No second `is_default` is created.
  for (const warehouse of warehouses) {
    const order = await api.createInventoryPurchaseOrder({
      currency: catalog.currency,
      idempotencyKey: `e2e-inventory-${runId}-${warehouse.id}`,
      lines: [{ itemId: item.id, quantity: OPENING_QUANTITY, unitCode: "g", unitCostMinor: UNIT_COST_MINOR }],
      supplierId,
    });
    const receipt = await api.receiveInventoryPurchaseOrder(order.orderId, warehouse.id);
    expect(receipt.status).toBe("received");
    expect(receipt.movements).toHaveLength(1);
  }

  const beforeBalances = new Map(
    (await api.listInventoryBalances()).balances
      .filter((balance) => balance.itemId === item.id)
      .map((balance) => [balance.warehouseId, balance.quantity] as const),
  );
  for (const warehouse of warehouses) {
    expect(beforeBalances.get(warehouse.id), `saldo inicial en ${warehouse.name}`).toBe(OPENING_QUANTITY);
  }

  const recipe = await api.publishInventoryRecipe(plan.product.productId, [
    { itemId: item.id, quantity: RECIPE_QUANTITY, unitCode: "g" },
  ]);
  expect(recipe.productId).toBe(plan.product.productId);
  expect(recipe.version).toBeGreaterThanOrEqual(1);
  expect(recipe.lines[0]?.itemId).toBe(item.id);

  let inventoryStatus: string | undefined;
  try {
    const sale = await api.confirmCounterSale({
      catalogVersion: catalog.catalogVersion,
      currency: catalog.currency,
      modifierGroups: plan.modifierGroups,
      orderId: saleOrderId,
      pizza: plan.pizza,
      productId: plan.product.productId,
      shiftId,
      variantId: plan.variantId,
    });
    inventoryStatus = sale.inventory?.status;
  } catch (error: unknown) {
    if (error instanceof Error && /captures\/(selection-plan|confirm).*HTTP (400|409)/u.test(error.message)) {
      test.skip(true, "El catálogo no admite el plan de venta generado; configura un producto vendible para el journey");
    }
    throw error;
  }
  if (inventoryStatus === "skipped") {
    test.skip(true, NO_DEFAULT_WAREHOUSE);
    throw new Error(NO_DEFAULT_WAREHOUSE);
  }

  // 1. Confirming the sale consumes recipe × quantity from the branch default warehouse.
  const saleMovement = await waitForMovement(api, item.id, "sale_consumption");
  if (saleMovement === undefined) {
    test.skip(true, NO_DEFAULT_WAREHOUSE);
    throw new Error(NO_DEFAULT_WAREHOUSE);
  }
  expect(saleMovement.quantityDelta).toBe(-RECIPE_QUANTITY);
  expect(saleMovement.unitCode).toBe("g");
  expect(saleMovement.recipeVersionId).not.toBeNull();
  const consumedWarehouse = saleMovement.warehouseId;
  const consumedWarehouseRecord = warehouses.find((warehouse) => warehouse.id === consumedWarehouse);
  expect(consumedWarehouseRecord, "el almacén que consumió pertenece a la sucursal").toBeDefined();
  const consumedWarehouseName = consumedWarehouseRecord?.name ?? consumedWarehouse;
  const afterSale = await balanceOf(api, consumedWarehouse, item.id);
  expect(afterSale).toBe((beforeBalances.get(consumedWarehouse) ?? 0) + saleMovement.quantityDelta);

  const alertsAfterSale = (await api.listInventoryAlerts()).alerts
    .find((alert) => alert.itemId === item.id && alert.warehouseId === consumedWarehouse);
  expect(alertsAfterSale, "alerta de saldo bajo mínimo tras la venta").toBeDefined();
  if (alertsAfterSale !== undefined) {
    expect(alertsAfterSale.quantity).toBe(afterSale);
    expect(alertsAfterSale.minQuantity).toBe(MIN_QUANTITY);
    expect(alertsAfterSale.deficit).toBe(Math.max(0, alertsAfterSale.minQuantity - alertsAfterSale.quantity));
    expect(alertsAfterSale.deficit).toBeGreaterThan(0);
  }

  // 2. The purchases tab opens with its own heading before the operator records anything by hand.
  await page.goto("/app/inventario?tab=compras");
  await assertAppPage(page, "/app/inventario");
  await page.getByRole("tab", { name: "Compras", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Compras", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Compras", exact: true })).toBeVisible();

  // 3. Movements: the sale consumption and the discounted balance are visible in the UI.
  await page.goto("/app/inventario?tab=movimientos");
  await assertAppPage(page, "/app/inventario");
  await page.getByRole("tab", { name: "Movimientos", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Movimientos", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Movimientos y saldos", exact: true })).toBeVisible();
  await page.getByLabel("Insumo", { exact: true }).selectOption(item.id);
  await expect(page.getByText("Consumo por venta", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(formatInventoryMovementQuantity(saleMovement.quantityDelta, saleMovement.unitCode),
    { exact: true }).first()).toBeVisible();
  const balanceAfterSale = page.locator("tr")
    .filter({ has: page.getByRole("cell", { name: item.name, exact: true }) })
    .filter({ has: page.getByRole("cell", { name: consumedWarehouseName, exact: true }) });
  await expect(balanceAfterSale).toContainText(formatInventoryNumber(afterSale));

  // 4. The operator records a real adjustment from the movements tab.
  await page.getByRole("button", { name: "Ajustar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Ajustar inventario", exact: true })).toBeVisible();
  await dialog.getByLabel("Almacén de origen", { exact: true }).selectOption(consumedWarehouse);
  await dialog.getByLabel("Insumo", { exact: true }).selectOption(item.id);
  await dialog.getByLabel("Cantidad", { exact: true }).fill(String(ADJUSTMENT_QUANTITY));
  await dialog.getByLabel("Motivo", { exact: true }).fill(`Ajuste E2E ${runId}`);
  await dialog.getByRole("button", { name: "Guardar ajuste", exact: true }).click();
  await expect(page.getByText("Movimiento registrado.", { exact: true })).toBeVisible({ timeout: 20_000 });
  const afterAdjustment = afterSale + ADJUSTMENT_QUANTITY;
  await expect.poll(() => balanceOf(api, consumedWarehouse, item.id), { timeout: 15_000 }).toBe(afterAdjustment);

  // 5. Alerts and the product margin are checked against the API and shown in the UI.
  const alertsNow = (await api.listInventoryAlerts()).alerts
    .find((alert) => alert.itemId === item.id && alert.warehouseId === consumedWarehouse);
  expect(alertsNow, "la alerta del insumo sigue vigente").toBeDefined();
  const margin = await api.readInventoryMargin(plan.product.productId);
  expect(margin.costMinor).toBe(RECIPE_QUANTITY * UNIT_COST_MINOR);
  expect(margin.marginMinor).toBe(margin.priceMinor - margin.costMinor);
  expect(margin.currency).toBe(catalog.currency);

  await page.goto("/app/inventario?tab=alertas");
  await assertAppPage(page, "/app/inventario");
  await page.getByRole("tab", { name: "Alertas", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Alertas", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Alertas y costos", exact: true })).toBeVisible();
  if (alertsNow !== undefined) {
    expect(alertsNow.quantity).toBe(afterAdjustment);
    const alertCard = page.locator("li")
      .filter({ has: page.getByText(item.name, { exact: true }) })
      .filter({ has: page.getByText(consumedWarehouseName, { exact: true }) })
      .first();
    await expect(alertCard).toContainText(stockAlertSummary(alertsNow));
  }
  await page.getByLabel("Producto", { exact: true }).selectOption(plan.product.productId);
  await expect(page.getByText("Margen estimado", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`Precio: ${formatMinorUnits(margin.priceMinor, margin.currency)}`, { exact: true }))
    .toBeVisible();
  await expect(page.getByText(`Costo: ${formatMinorUnits(margin.costMinor, margin.currency)}`, { exact: true }))
    .toBeVisible();
  await expect(page.getByText(`Margen: ${formatMinorUnits(margin.marginMinor, margin.currency)}`, { exact: true }))
    .toBeVisible();
  await expect(page.getByText(formatPercentFromMinor(margin.marginMinor, margin.priceMinor), { exact: true }))
    .toBeVisible();

  // 6. Cancelling the line writes the compensating reversal and restores the balance.
  const order = await api.readOrder(saleOrderId);
  const line = order.items?.find((candidate) => candidate.status !== "cancelled");
  expect(line, "la orden confirmada conserva su línea").toBeDefined();
  if (line === undefined) throw new Error("La orden no conserva su línea");
  const cancelled = await api.cancelOrderItem(saleOrderId, line.orderItemId, order.version, `Cancelación E2E ${runId}`);
  expect(cancelled.replayed).toBe(false);
  const reversal = await waitForMovement(api, item.id, "sale_reversal");
  expect(reversal, "la cancelación escribe la reversa").toBeDefined();
  if (reversal !== undefined) {
    expect(reversal.quantityDelta).toBe(RECIPE_QUANTITY);
    expect(reversal.compensatesMovementId).toBe(saleMovement.id);
    expect(reversal.warehouseId).toBe(consumedWarehouse);
  }
  const restored = await balanceOf(api, consumedWarehouse, item.id);
  expect(restored).toBe(afterAdjustment + RECIPE_QUANTITY);

  await page.goto("/app/inventario?tab=movimientos");
  await assertAppPage(page, "/app/inventario");
  await page.getByRole("tab", { name: "Movimientos", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Movimientos", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Insumo", { exact: true }).selectOption(item.id);
  await expect(page.getByText("Reversa de venta", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(formatInventoryMovementQuantity(RECIPE_QUANTITY, "g"), { exact: true }).first())
    .toBeVisible();
  const balanceAfterCancel = page.locator("tr")
    .filter({ has: page.getByRole("cell", { name: item.name, exact: true }) })
    .filter({ has: page.getByRole("cell", { name: consumedWarehouseName, exact: true }) });
  await expect(balanceAfterCancel).toContainText(formatInventoryNumber(restored));
});
