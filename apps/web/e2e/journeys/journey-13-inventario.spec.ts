import { randomUUID } from "node:crypto";

import {
  formatInventoryMovementQuantity, formatInventoryNumber, formatMinorUnits, formatPercentFromMinor, inventoryUnitLabel,
  stockAlertSummary,
} from "../../src/lib/inventory-ui.ts";
import { buildLineFraction, effectiveHalvesSetup, emptyHalvesDraft, pickHalfFlavor } from "../../src/lib/line-halves.ts";
import type {
  InventoryItem, InventoryModifierGroup, InventoryMovement, InventoryPizzaHalf, InventoryPizzaLine,
  InventoryRecipeVersion, InventoryWarehouse, JourneyApi, MenuCatalog, MenuProduct,
} from "../fixtures/journey-api.ts";
import {
  assertAppPage, beforeJourney, expect, requireActiveShift, test,
} from "../fixtures/journey-test.ts";

const RECIPE_QUANTITY = 120;
const OPENING_QUANTITY = 200;
const UNIT_COST_MINOR = 1;
const MIN_QUANTITY = 1_000;
const ADJUSTMENT_QUANTITY = 10;
const DEFAULT_WAREHOUSE_NAME = "Almacén principal";
const RECIPE_SCAN_LIMIT = 10;

type CatalogGroup = NonNullable<MenuCatalog["modifierGroups"]>[number];

interface SalePlan {
  readonly fraction: NonNullable<ReturnType<typeof buildLineFraction>> | null;
  readonly modifierGroups: readonly InventoryModifierGroup[];
  readonly pizza: InventoryPizzaLine | null;
  readonly product: MenuProduct;
  readonly variantId: string | null;
}

interface MovementWait {
  readonly runId: string;
  readonly warehouseId: string;
}

function groupsFor(product: MenuProduct, catalog: MenuCatalog): readonly CatalogGroup[] {
  const assigned = product.modifierGroupIds;
  return (catalog.modifierGroups ?? []).filter((group) => group.active
    && (assigned === undefined ? group.productId === product.productId : assigned.includes(group.groupId)));
}

/** One option per mandatory slot of a group, or `undefined` when the catalog cannot satisfy it. */
function mandatorySelections(group: CatalogGroup): readonly { readonly optionId: string; readonly quantity: number }[] | undefined {
  const maximum = group.maximumQuantity > 0 ? group.maximumQuantity : group.minimumQuantity;
  const wanted = Math.max(0, Math.min(group.minimumQuantity, maximum));
  const chosen = group.options.filter((option) => option.active).slice(0, wanted)
    .map((option) => ({ optionId: option.optionId, quantity: 1 }));
  return chosen.length === wanted ? chosen : undefined;
}

/**
 * Whole half-and-half line built with the same helpers the capture sheet uses: the first two active
 * flavors of the setup's flavor group, no extras, and the flavor/extra groups left out of the
 * ordinary modifier list. `undefined` means the catalog cannot arm a valid fraction line.
 */
function halvesPlan(
  product: MenuProduct,
  groups: readonly CatalogGroup[],
  variant: unknown,
): { readonly excludedGroupIds: readonly string[]; readonly fraction: NonNullable<ReturnType<typeof buildLineFraction>> } | undefined {
  const setup = effectiveHalvesSetup(product as never, variant as never);
  if (setup === undefined || setup.flavorGroupId === null) return undefined;
  const flavorGroupId = setup.flavorGroupId;
  const flavorGroup = groups.find((group) => group.groupId === flavorGroupId);
  const flavors = (flavorGroup?.options ?? []).filter((option) => option.active);
  const first = flavors[0];
  const second = flavors[1];
  if (first === undefined || second === undefined) return undefined;
  const draft = pickHalfFlavor(pickHalfFlavor(emptyHalvesDraft(), "half-a", first.optionId), "half-b", second.optionId);
  const fraction = buildLineFraction(draft);
  if (fraction === null) return undefined;
  return {
    excludedGroupIds: [flavorGroupId, ...(setup.extraGroupId === null ? [] : [setup.extraGroupId])],
    fraction,
  };
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
 * Every product the capture can sell with a minimal, catalog-derived plan, in preference order:
 * legacy products first, then Pizza V2, with its active size (when it has sizes), one option per
 * mandatory non-pizza group and, for a Pizza V2 product, the two-halves payload the API requires.
 */
function sellablePlans(catalog: MenuCatalog): readonly SalePlan[] {
  const candidates = catalog.products.filter((product) => product.active
    && ((product.variants ?? []).length === 0 || (product.variants ?? []).some((variant) => variant.active)));
  const allGroups = catalog.modifierGroups ?? [];
  const ordered = [...candidates.filter((candidate) => candidate.pizzaMode === undefined), ...candidates];
  const seen = new Set<string>();
  const plans: SalePlan[] = [];
  for (const product of ordered) {
    if (seen.has(product.productId)) continue;
    seen.add(product.productId);
    const groups = groupsFor(product, catalog);
    const pizza = pizzaPlan(product, allGroups);
    if (pizza === undefined) continue;
    const halves = halvesPlan(product, groups, (product.variants ?? []).find((candidate) => candidate.active));
    const excludedGroupIds = new Set<string>([
      ...(pizza === null ? [] : [...baseGroupIds(product), ...extraGroupIds(product, allGroups)]),
      ...(halves?.excludedGroupIds ?? []),
    ]);
    const modifierGroups: InventoryModifierGroup[] = [];
    let complete = true;
    for (const group of groups) {
      if (excludedGroupIds.has(group.groupId)) continue;
      const selections = mandatorySelections(group);
      if (selections === undefined) { complete = false; break; }
      if (selections.length > 0) modifierGroups.push({ groupId: group.groupId, selections });
    }
    if (complete) {
      plans.push({
        fraction: halves?.fraction ?? null, modifierGroups, pizza, product,
        variantId: (product.variants ?? []).find((variant) => variant.active)?.variantId ?? null,
      });
    }
  }
  return plans;
}

function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof Error && error.message.includes(`HTTP ${status}`);
}

/** A 403 in inventory management is the only account-level skip: the run never got to write. */
function skipIfReadOnlyInventory(error: unknown): void {
  if (isHttpStatus(error, 403)) {
    test.skip(true, "La cuenta guardada no puede administrar inventario (rol de solo lectura)");
  }
}

async function createRunItem(api: JourneyApi, name: string): Promise<InventoryItem> {
  try {
    return await api.createInventoryItem({
      active: true, minQuantity: MIN_QUANTITY, name, purchaseUnitFactor: 1, sku: null, unitCode: "g",
    });
  } catch (error: unknown) {
    skipIfReadOnlyInventory(error);
    throw error;
  }
}

async function activeWarehouses(api: JourneyApi): Promise<readonly InventoryWarehouse[]> {
  return (await api.listInventoryWarehouses()).warehouses.filter((warehouse) => warehouse.active);
}

/**
 * The branch's active default warehouse is a shared fixture: reuse it untouched, otherwise create
 * (or promote) the stable `Almacén principal`. It carries no `runId` on purpose and stays.
 */
async function ensureDefaultWarehouse(api: JourneyApi): Promise<InventoryWarehouse> {
  const existing = (await activeWarehouses(api)).find((warehouse) => warehouse.isDefault);
  if (existing !== undefined) return existing;

  const named = (await api.listInventoryWarehouses()).warehouses.find((warehouse) => warehouse.active
    && warehouse.name.trim().toLocaleLowerCase("es") === DEFAULT_WAREHOUSE_NAME.toLocaleLowerCase("es"));
  if (named !== undefined) {
    try {
      return await api.updateInventoryWarehouse(named.id, { isDefault: true });
    } catch (error: unknown) {
      skipIfReadOnlyInventory(error);
      if (isHttpStatus(error, 409)) {
        const raced = (await activeWarehouses(api)).find((warehouse) => warehouse.isDefault);
        if (raced !== undefined) return raced;
      }
      throw error;
    }
  }

  try {
    return await api.createInventoryWarehouse({
      active: true, isDefault: true, name: DEFAULT_WAREHOUSE_NAME,
    });
  } catch (error: unknown) {
    skipIfReadOnlyInventory(error);
    if (isHttpStatus(error, 409)) {
      const raced = (await activeWarehouses(api)).find((warehouse) => warehouse.isDefault);
      if (raced !== undefined) return raced;
    }
    throw error;
  }
}

/** Active product-level recipe (no modifier scope) with no notes, as a restorable snapshot. */
async function activeProductRecipe(
  api: JourneyApi,
  productId: string,
): Promise<InventoryRecipeVersion | undefined> {
  const list = await api.listInventoryRecipes(productId, false);
  // Publishing cannot carry `notes`, so a recipe with notes is not restorable faithfully.
  const active = list.recipes.find((recipe) => recipe.active && recipe.modifierId === null && recipe.notes === null);
  return active === undefined ? undefined : api.readInventoryRecipe(active.recipeId);
}

async function balanceOf(api: JourneyApi, warehouseId: string, itemId: string): Promise<number> {
  const reply = await api.listInventoryBalances();
  return reply.balances.find((balance) => balance.warehouseId === warehouseId && balance.itemId === itemId)?.quantity ?? 0;
}

/**
 * Waits for the ledger movement this run's sale must write. A timeout is a real inventory
 * regression, so it throws with the runId and the balance observed in the default warehouse; it is
 * never converted into a skip.
 */
async function waitForMovement(
  api: JourneyApi,
  itemId: string,
  kind: InventoryMovement["kind"],
  wait: MovementWait,
): Promise<InventoryMovement> {
  let found: InventoryMovement | undefined;
  let observedBalance = Number.NaN;
  try {
    await expect.poll(async () => {
      const [movements, balances] = await Promise.all([
        api.listInventoryMovements({ itemId }),
        api.listInventoryBalances(),
      ]);
      found = movements.movements.find((movement) => movement.kind === kind);
      observedBalance = balances.balances
        .find((balance) => balance.warehouseId === wait.warehouseId && balance.itemId === itemId)?.quantity ?? 0;
      return found !== undefined;
    }, {
      intervals: [500, 1_000],
      message: `No apareció el movimiento ${kind} del run ${wait.runId} en el almacén ${wait.warehouseId}`,
      timeout: 20_000,
    }).toBe(true);
  } catch (error: unknown) {
    throw new Error(
      `El movimiento ${kind} del run ${wait.runId} no apareció en el almacén predeterminado `
      + `${wait.warehouseId}; saldo observado del insumo ${itemId}: ${observedBalance}. `
      + "Es una regresión de inventario (venta/cancelación), no una precondición del entorno.",
      { cause: error },
    );
  }
  if (found === undefined) {
    throw new Error(`El movimiento ${kind} del run ${wait.runId} no apareció y el poll no devolvió el hallazgo`);
  }
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
  const plans = sellablePlans(catalog);
  const [firstPlan] = plans;
  if (firstPlan === undefined) {
    test.skip(true, "El catálogo no tiene un producto vendible con su configuración obligatoria completa");
    throw new Error("Sin producto vendible");
  }

  // Prefer a product that already has an active recipe, so the run restores the real composition
  // instead of leaving a test recipe behind. Without any previous recipe the API cannot unpublish.
  let plan = firstPlan;
  let previousRecipe: InventoryRecipeVersion | undefined;
  const scanLimit = Math.min(plans.length, RECIPE_SCAN_LIMIT);
  for (let index = 0; index < scanLimit; index += 1) {
    const candidate = plans[index];
    if (candidate === undefined) continue;
    const previous = await activeProductRecipe(api, candidate.product.productId);
    if (previous !== undefined) {
      plan = candidate;
      previousRecipe = previous;
      break;
    }
  }
  const salePlan = plan;

  const shiftId = await requireActiveShift(api);

  const itemName = `Insumo ${runId}`;
  const supplierName = `Proveedor ${runId}`;
  const saleOrderId = randomUUID();

  // Cleanup is registered before the first write. The sweeps match this run's names, so a lost
  // create response is still cleaned up; the shared warehouse fixture is intentionally kept.
  cleanup.add("desactivar el insumo del journey 13", async () => {
    const items = await api.listInventoryItems();
    for (const item of items.items) {
      if (item.name === itemName && item.active) await api.updateInventoryItem(item.id, { active: false });
    }
  });
  cleanup.add("desactivar el proveedor del journey 13", async () => {
    const suppliers = await api.listInventorySuppliers();
    for (const supplier of suppliers.suppliers) {
      if (supplier.name === supplierName && supplier.active) {
        await api.updateInventorySupplier(supplier.id, { active: false });
      }
    }
  });
  cleanup.add("cancelar la venta del journey 13 si quedó sin cobrar", async () => {
    await api.cancelIfUnpaid(saleOrderId);
  });

  const defaultWarehouse = await ensureDefaultWarehouse(api);
  expect(defaultWarehouse.isDefault, "el almacén usado es el predeterminado de la sucursal").toBe(true);
  const defaultWarehouseId = defaultWarehouse.id;
  const defaultWarehouseName = defaultWarehouse.name;

  const item = await createRunItem(api, itemName);
  const suppliers = (await api.listInventorySuppliers()).suppliers;
  const activeSupplier = suppliers.find((supplier) => supplier.active);
  let supplierId: string;
  if (activeSupplier === undefined) {
    const created = await api.createInventorySupplier({ contact: null, name: supplierName });
    supplierId = created.id;
  } else {
    supplierId = activeSupplier.id;
  }

  // Seed one received purchase order in the default warehouse: that is where sale consumption
  // must land, so the before/after balance is checked exactly there.
  const purchaseOrder = await api.createInventoryPurchaseOrder({
    currency: catalog.currency,
    idempotencyKey: `e2e-inventory-${runId}-${defaultWarehouseId}`,
    lines: [{ itemId: item.id, quantity: OPENING_QUANTITY, unitCode: "g", unitCostMinor: UNIT_COST_MINOR }],
    supplierId,
  });
  const receipt = await api.receiveInventoryPurchaseOrder(purchaseOrder.orderId, defaultWarehouseId);
  expect(receipt.status).toBe("received");
  expect(receipt.movements).toHaveLength(1);

  const beforeSale = await balanceOf(api, defaultWarehouseId, item.id);
  expect(beforeSale, `saldo inicial en ${defaultWarehouseName}`).toBe(OPENING_QUANTITY);

  // Snapshot and register the restore BEFORE publishing our recipe, so even a failure mid-publish
  // re-publishes the previous composition. A first-ever recipe cannot be unpublished by the API.
  const recipeToRestore = previousRecipe;
  cleanup.add("restaurar la receta previa del producto del journey 13", async () => {
    if (recipeToRestore === undefined) {
      console.warn(`[journey 13 ${runId}] El producto ${salePlan.product.productId} no tenía receta activa `
        + "previa; la API no permite despublicar la receta que publicó este run.");
      return;
    }
    await api.publishInventoryRecipe(recipeToRestore.productId, recipeToRestore.lines);
  });

  const recipe = await api.publishInventoryRecipe(salePlan.product.productId, [
    { itemId: item.id, quantity: RECIPE_QUANTITY, unitCode: "g" },
  ]);
  expect(recipe.productId).toBe(salePlan.product.productId);
  expect(recipe.lines.map((line) => line.itemId)).toEqual([item.id]);
  expect(recipe.version).toBeGreaterThanOrEqual(1);

  // A 400/409 from the plan/confirmation is a real failure with the API body, never a catalog skip.
  await api.confirmCounterSale({
    catalogVersion: catalog.catalogVersion,
    currency: catalog.currency,
    fraction: salePlan.fraction,
    modifierGroups: salePlan.modifierGroups,
    orderId: saleOrderId,
    pizza: salePlan.pizza,
    productId: salePlan.product.productId,
    shiftId,
    variantId: salePlan.variantId,
  });

  // 1. Confirming the sale consumes recipe × quantity from the branch default warehouse.
  const saleMovement = await waitForMovement(api, item.id, "sale_consumption", {
    runId, warehouseId: defaultWarehouseId,
  });
  expect(saleMovement.warehouseId, "el consumo se escribe en el almacén predeterminado").toBe(defaultWarehouseId);
  expect(saleMovement.quantityDelta).toBe(-RECIPE_QUANTITY);
  expect(saleMovement.unitCode).toBe("g");
  // The movement projection always returns recipeVersionId=null (00800 hardcodes null::uuid), so the
  // balance and the movement kind are the authority for sale-driven consumption here.
  const afterSale = await balanceOf(api, defaultWarehouseId, item.id);
  expect(afterSale).toBe(beforeSale + saleMovement.quantityDelta);

  const alertsAfterSale = (await api.listInventoryAlerts()).alerts
    .find((alert) => alert.itemId === item.id && alert.warehouseId === defaultWarehouseId);
  expect(alertsAfterSale, "alerta de saldo bajo mínimo tras la venta").toBeDefined();
  if (alertsAfterSale === undefined) throw new Error(`Sin alerta de saldo bajo para ${item.id}`);
  expect(alertsAfterSale.quantity).toBe(afterSale);
  expect(alertsAfterSale.minQuantity).toBe(MIN_QUANTITY);
  expect(alertsAfterSale.deficit).toBe(Math.max(0, alertsAfterSale.minQuantity - alertsAfterSale.quantity));
  expect(alertsAfterSale.deficit).toBeGreaterThan(0);

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
    .filter({ has: page.getByRole("cell", { name: defaultWarehouseName, exact: true }) });
  await expect(balanceAfterSale.getByRole("cell", { name: new RegExp(`^${formatInventoryNumber(afterSale)} ${inventoryUnitLabel(saleMovement.unitCode)}$`, "u") })).toBeVisible();

  // 4. The operator records a real adjustment from the movements tab.
  await page.getByRole("button", { name: "Ajustar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Ajustar inventario", exact: true })).toBeVisible();
  await dialog.getByLabel("Almacén de origen", { exact: true }).selectOption(defaultWarehouseId);
  await dialog.getByLabel("Insumo", { exact: true }).selectOption(item.id);
  await dialog.getByLabel("Cantidad", { exact: true }).fill(String(ADJUSTMENT_QUANTITY));
  await dialog.getByLabel("Motivo", { exact: true }).fill(`Ajuste E2E ${runId}`);
  await dialog.getByRole("button", { name: "Guardar ajuste", exact: true }).click();
  await expect(page.getByText("Movimiento registrado.", { exact: true })).toBeVisible({ timeout: 20_000 });
  const afterAdjustment = afterSale + ADJUSTMENT_QUANTITY;
  await expect.poll(() => balanceOf(api, defaultWarehouseId, item.id), { timeout: 15_000 }).toBe(afterAdjustment);

  // 5. Alerts and the product margin are checked against the API and shown in the UI.
  const alertsNow = (await api.listInventoryAlerts()).alerts
    .find((alert) => alert.itemId === item.id && alert.warehouseId === defaultWarehouseId);
  expect(alertsNow, "la alerta del insumo sigue vigente").toBeDefined();
  if (alertsNow === undefined) throw new Error(`Sin alerta vigente para ${item.id}`);
  expect(alertsNow.quantity).toBe(afterAdjustment);
  const margin = await api.readInventoryMargin(salePlan.product.productId);
  expect(margin.costMinor).toBe(RECIPE_QUANTITY * UNIT_COST_MINOR);
  expect(margin.marginMinor).toBe(margin.priceMinor - margin.costMinor);
  expect(margin.currency).toBe(catalog.currency);

  await page.goto("/app/inventario?tab=alertas");
  await assertAppPage(page, "/app/inventario");
  await page.getByRole("tab", { name: "Alertas", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Alertas", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Alertas y costos", exact: true })).toBeVisible();
  const alertCard = page.locator("li")
    .filter({ has: page.getByText(item.name, { exact: true }) })
    .filter({ has: page.getByText(defaultWarehouseName, { exact: true }) })
    .first();
  await expect(alertCard).toContainText(stockAlertSummary(alertsNow));
  await page.getByLabel("Producto", { exact: true }).selectOption(salePlan.product.productId);
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
  const reversal = await waitForMovement(api, item.id, "sale_reversal", {
    runId, warehouseId: defaultWarehouseId,
  });
  expect(reversal.quantityDelta).toBe(RECIPE_QUANTITY);
  expect(reversal.compensatesMovementId).toBe(saleMovement.id);
  expect(reversal.warehouseId).toBe(defaultWarehouseId);
  const restored = await balanceOf(api, defaultWarehouseId, item.id);
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
    .filter({ has: page.getByRole("cell", { name: defaultWarehouseName, exact: true }) });
  await expect(balanceAfterCancel.getByRole("cell", { name: new RegExp(`^${formatInventoryNumber(restored)} ${inventoryUnitLabel(saleMovement.unitCode)}$`, "u") })).toBeVisible();
});
