"use server";

import { cookies } from "next/headers";
import {
  PURCHASE_ORDER_STATUSES,
  parseInventoryBalanceV1,
  parseInventoryItemV1,
  parseInventoryMovementV1,
  parseInventoryWarehouseV1,
  parseMenuCatalogStateV1,
  parsePublishRecipeCommandV1,
  parseRecipeVersionV1,
  type InventoryBalanceV1,
  type InventoryItemV1,
  type InventoryMovementKindV1,
  type InventoryMovementV1,
  type InventoryUnitV1,
  type InventoryWarehouseV1,
  type PurchaseOrderStatusV1,
  type RecipeVersionV1,
} from "@super-restaurant/shared-types";

import { getServerEnv } from "../../../env";
import { authorizeBranch } from "../../../lib/branch-selection";
import {
  BRANCH_PREFERENCE_COOKIE,
  findMembership,
  listMemberships,
  parseBranchPreference,
} from "../../../lib/memberships";
import { createServerSupabaseClient } from "../../../lib/supabase-server";

export type InventoryError = "conflict" | "denied" | "invalid" | "missing" | "timeout" | "unauthenticated" | "unavailable";

export type InventoryOperation =
  | "createItem"
  | "createMovement"
  | "createPurchaseOrder"
  | "createSupplier"
  | "createWarehouse"
  | "listBalances"
  | "listItems"
  | "listMovements"
  | "listProductCosts"
  | "listProducts"
  | "listPurchaseOrders"
  | "listRecipes"
  | "listStockAlerts"
  | "listSuppliers"
  | "listWarehouses"
  | "publishRecipe"
  | "readAverageCost"
  | "readProductMargin"
  | "readPurchaseOrder"
  | "readRecipe"
  | "receivePurchaseOrder"
  | "updateItem"
  | "updateSupplier"
  | "updateWarehouse";

export interface RecipeProductV1 {
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly active: boolean;
}

export interface RecipeSummaryV1 {
  readonly recipeId: string;
  readonly productId: string;
  readonly modifierId: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface SupplierV1 {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly contact: string | null;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface PurchaseOrderSummaryV1 {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly status: PurchaseOrderStatusV1;
  readonly currency: string;
  readonly orderedAt: string;
  readonly receivedAt: string | null;
  readonly receivedBy: string | null;
  readonly totalMinor: number;
}

export interface PurchaseOrderLineDetailV1 {
  readonly itemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unitCode: InventoryUnitV1;
  readonly unitCostMinor: number;
}

export interface PurchaseOrderDetailV1 extends PurchaseOrderSummaryV1 {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly lines: readonly PurchaseOrderLineDetailV1[];
}

export interface PurchaseOrderCreatedV1 {
  readonly orderId: string;
  readonly status: PurchaseOrderStatusV1;
  readonly replayed: boolean;
}

export interface PurchaseOrderReceiptMovementV1 {
  readonly lineId: string;
  readonly movementId: string;
}

export interface StockAlertV1 {
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: InventoryUnitV1;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly quantity: number;
  readonly minQuantity: number;
  readonly deficit: number;
}

export interface AverageCostV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly valueMinor: number;
  readonly unitCostMinor: number;
  readonly currency: string | null;
  readonly roundingRemainder: number;
}

export interface ProductCostV1 {
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: InventoryUnitV1;
  readonly quantity: number;
  readonly purchaseUnitFactor: number;
  readonly unitCostMinor: number;
  readonly lineCostMinor: number;
  readonly currency: string | null;
}

export interface ProductMarginV1 {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly productId: string;
  readonly priceMinor: number;
  readonly costMinor: number;
  readonly marginMinor: number;
  readonly currency: string;
}

export type InventoryActionResult =
  | { readonly ok: true; readonly items: readonly InventoryItemV1[] }
  | { readonly ok: true; readonly warehouses: readonly InventoryWarehouseV1[] }
  | { readonly ok: true; readonly movements: readonly InventoryMovementV1[] }
  | { readonly ok: true; readonly balances: readonly InventoryBalanceV1[] }
  | { readonly ok: true; readonly products: readonly RecipeProductV1[] }
  | { readonly ok: true; readonly recipes: readonly RecipeSummaryV1[] }
  | { readonly ok: true; readonly recipe: RecipeVersionV1 }
  | { readonly ok: true; readonly suppliers: readonly SupplierV1[] }
  | { readonly ok: true; readonly supplier: SupplierV1 }
  | { readonly ok: true; readonly orders: readonly PurchaseOrderSummaryV1[] }
  | { readonly ok: true; readonly order: PurchaseOrderDetailV1 }
  | { readonly ok: true; readonly created: PurchaseOrderCreatedV1 }
  | { readonly ok: true; readonly receipt: readonly PurchaseOrderReceiptMovementV1[] }
  | { readonly ok: true; readonly alerts: readonly StockAlertV1[] }
  | { readonly ok: true; readonly cost: AverageCostV1 }
  | { readonly ok: true; readonly costs: readonly ProductCostV1[] }
  | { readonly ok: true; readonly margin: ProductMarginV1 }
  | { readonly ok: true; readonly item: InventoryItemV1 }
  | { readonly ok: true; readonly warehouse: InventoryWarehouseV1 }
  | { readonly ok: true; readonly recorded: true }
  | { readonly ok: true; readonly published: true }
  | { readonly ok: false; readonly error: InventoryError };

const INVENTORY_UNITS: readonly InventoryUnitV1[] = ["g", "ml", "piece"];
const MANUAL_MOVEMENT_KINDS: ReadonlySet<InventoryMovementKindV1> = new Set([
  "adjustment",
  "count_adjustment",
  "transfer_out",
  "transfer_in",
  "waste",
]);
const MANAGE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "manager"]);
const INVENTORY_OPERATIONS: ReadonlySet<InventoryOperation> = new Set([
  "createItem",
  "createMovement",
  "createPurchaseOrder",
  "createSupplier",
  "createWarehouse",
  "listBalances",
  "listItems",
  "listMovements",
  "listProductCosts",
  "listProducts",
  "listPurchaseOrders",
  "listRecipes",
  "listStockAlerts",
  "listSuppliers",
  "listWarehouses",
  "publishRecipe",
  "readAverageCost",
  "readProductMargin",
  "readPurchaseOrder",
  "readRecipe",
  "receivePurchaseOrder",
  "updateItem",
  "updateSupplier",
  "updateWarehouse",
]);
const READ_OPERATIONS: ReadonlySet<InventoryOperation> = new Set([
  "listBalances",
  "listItems",
  "listMovements",
  "listProductCosts",
  "listProducts",
  "listPurchaseOrders",
  "listRecipes",
  "listStockAlerts",
  "listSuppliers",
  "listWarehouses",
  "readAverageCost",
  "readProductMargin",
  "readPurchaseOrder",
  "readRecipe",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;

export async function inventoryAction(
  operation: InventoryOperation,
  input?: unknown,
): Promise<InventoryActionResult> {
  if (!INVENTORY_OPERATIONS.has(operation)) {
    return invalid();
  }

  const scope = parseBranchPreference((await cookies()).get(BRANCH_PREFERENCE_COOKIE)?.value);
  if (scope === undefined) return denied();
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session === null) return denied();

  const env = getServerEnv();
  const memberships = await listMemberships(session.access_token, env.apiBaseUrl);
  const membership = memberships === undefined ? undefined : findMembership(memberships.memberships, scope);
  if (membership === undefined || await authorizeBranch(session.access_token, env.apiBaseUrl, scope) === undefined) {
    return denied();
  }
  const canManage = membership.roles.some((role) => MANAGE_ROLES.has(role));
  if (!canManage && !READ_OPERATIONS.has(operation)) {
    return denied();
  }

  const base = `${env.apiBaseUrl}/api/v1/inventory`;

  if (operation === "listProducts") {
    const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${env.apiBaseUrl}/api/v1/catalog/menu?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const state = parseMenuCatalogStateV1(reply.body);
    if (state === undefined || state.scope.restaurantId !== scope.restaurantId
      || state.scope.branchId !== scope.branchId) {
      return unavailable();
    }
    const products = (state.catalog?.products ?? []).map((product) => Object.freeze({
      active: product.active,
      name: product.name,
      productId: product.productId,
      sku: product.sku,
    }));
    return { ok: true, products: Object.freeze(products) };
  }

  if (operation === "listRecipes") {
    const productId = readUuidField(input, "productId");
    if (productId === undefined) return invalid();
    const query = new URLSearchParams({ includeInactive: "true", productId, restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${base}/recipes?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const recipes = parseRecipesList(reply.body, scope.restaurantId, productId);
    return recipes === undefined ? unavailable() : { ok: true, recipes };
  }

  if (operation === "readRecipe") {
    const recipeId = readUuidField(input, "recipeId");
    if (recipeId === undefined) return invalid();
    const query = new URLSearchParams({ restaurantId: scope.restaurantId });
    const reply = await send(
      session.access_token,
      `${base}/recipes/${encodeURIComponent(recipeId)}?${query.toString()}`,
      "GET",
    );
    if (!reply.ok) return reply;
    const recipe = parseRecipeVersionV1(reply.body);
    return recipe === undefined || recipe.restaurantId !== scope.restaurantId || recipe.recipeId !== recipeId
      ? unavailable() : { ok: true, recipe };
  }

  if (operation === "publishRecipe") {
    const command = readPublishRecipeCommand(input, scope.restaurantId);
    if (command === undefined) return invalid();
    const reply = await send(session.access_token, `${base}/recipes`, "POST", {
      lines: command.lines,
      modifierId: command.modifierId,
      notes: command.notes,
      productId: command.productId,
      restaurantId: command.restaurantId,
    });
    if (!reply.ok) return reply;
    const recipe = parseRecipeVersionV1(reply.body);
    return recipe === undefined || recipe.restaurantId !== scope.restaurantId
      || recipe.productId !== command.productId ? unavailable() : { ok: true, published: true };
  }

  if (operation === "listSuppliers") {
    const includeInactive = readIncludeInactive(input);
    if (includeInactive === undefined) return invalid();
    const query = new URLSearchParams({ restaurantId: scope.restaurantId });
    if (includeInactive) query.set("includeInactive", "true");
    const reply = await send(session.access_token, `${base}/suppliers?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const suppliers = parseSuppliersList(reply.body, scope.restaurantId, includeInactive);
    return suppliers === undefined ? unavailable() : { ok: true, suppliers };
  }

  if (operation === "createSupplier") {
    const command = readCreateSupplier(input);
    if (command === undefined) return invalid();
    const reply = await send(session.access_token, `${base}/suppliers`, "POST", {
      active: command.active,
      contact: command.contact,
      name: command.name,
      restaurantId: scope.restaurantId,
    });
    if (!reply.ok) return reply;
    const supplier = parseSupplierV1(reply.body, scope.restaurantId);
    return supplier === undefined ? unavailable() : { ok: true, supplier };
  }

  if (operation === "updateSupplier") {
    const command = readSupplierPatch(input);
    if (command === undefined) return invalid();
    const reply = await send(
      session.access_token,
      `${base}/suppliers/${encodeURIComponent(command.id)}`,
      "PATCH",
      command.patch,
    );
    if (!reply.ok) return reply;
    const supplier = parseSupplierV1(reply.body, scope.restaurantId);
    return supplier === undefined || supplier.id !== command.id ? unavailable() : { ok: true, supplier };
  }

  if (operation === "listPurchaseOrders") {
    const filter = readPurchaseOrderFilter(input);
    if (filter === undefined) return invalid();
    const query = new URLSearchParams({
      branchId: scope.branchId,
      limit: "100",
      restaurantId: scope.restaurantId,
    });
    if (filter.status !== undefined) query.set("status", filter.status);
    const reply = await send(session.access_token, `${base}/purchase-orders?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const orders = parseOrdersList(reply.body, scope.restaurantId, scope.branchId);
    return orders === undefined ? unavailable() : { ok: true, orders };
  }

  if (operation === "createPurchaseOrder") {
    const command = readCreatePurchaseOrder(input);
    if (command === undefined) return invalid();
    const payload: Record<string, unknown> = {
      branchId: scope.branchId,
      currency: command.currency,
      idempotencyKey: command.idempotencyKey,
      lines: command.lines,
      restaurantId: scope.restaurantId,
      supplierId: command.supplierId,
    };
    if (command.orderedAt !== undefined) payload["orderedAt"] = command.orderedAt;
    const reply = await send(session.access_token, `${base}/purchase-orders`, "POST", payload);
    if (!reply.ok) return reply;
    const created = parseCreatedOrder(reply.body);
    return created === undefined ? unavailable() : { ok: true, created };
  }

  if (operation === "readPurchaseOrder") {
    const id = readUuidField(input, "id");
    if (id === undefined) return invalid();
    const reply = await send(
      session.access_token,
      `${base}/purchase-orders/${encodeURIComponent(id)}`,
      "GET",
    );
    if (!reply.ok) return reply;
    const order = parseOrderDetail(reply.body, scope.restaurantId, scope.branchId);
    return order === undefined || order.id !== id ? unavailable() : { ok: true, order };
  }

  if (operation === "receivePurchaseOrder") {
    const command = readReceiveCommand(input);
    if (command === undefined) return invalid();
    const payload: Record<string, unknown> = { warehouseId: command.warehouseId };
    if (command.deviceId !== undefined) payload["deviceId"] = command.deviceId;
    const reply = await send(
      session.access_token,
      `${base}/purchase-orders/${encodeURIComponent(command.id)}/receive`,
      "POST",
      payload,
    );
    if (!reply.ok) return reply;
    const receipt = parseReceipt(reply.body);
    return receipt === undefined ? unavailable() : { ok: true, receipt };
  }

  if (operation === "listItems") {
    const query = new URLSearchParams({ restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${base}/items?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const items = parseItemsList(reply.body, scope.restaurantId);
    return items === undefined ? unavailable() : { ok: true, items };
  }

  if (operation === "listWarehouses") {
    const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${base}/warehouses?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const warehouses = parseWarehousesList(reply.body, scope.restaurantId, scope.branchId);
    return warehouses === undefined ? unavailable() : { ok: true, warehouses };
  }

  if (operation === "listMovements") {
    const filter = readMovementFilter(input);
    if (filter === undefined) return invalid();
    const query = new URLSearchParams({
      branchId: scope.branchId,
      limit: "100",
      restaurantId: scope.restaurantId,
    });
    if (filter.warehouseId !== undefined) query.set("warehouseId", filter.warehouseId);
    if (filter.itemId !== undefined) query.set("itemId", filter.itemId);
    const reply = await send(session.access_token, `${base}/movements?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const movements = parseMovementsList(reply.body, scope.restaurantId, scope.branchId);
    return movements === undefined ? unavailable() : { ok: true, movements };
  }

  if (operation === "listBalances") {
    const filter = readBalanceFilter(input);
    if (filter === undefined) return invalid();
    const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
    if (filter.warehouseId !== undefined) query.set("warehouseId", filter.warehouseId);
    const reply = await send(session.access_token, `${base}/balances?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const balances = parseBalancesList(reply.body, scope.restaurantId, scope.branchId);
    return balances === undefined ? unavailable() : { ok: true, balances };
  }

  if (operation === "listStockAlerts") {
    const query = new URLSearchParams({ branchId: scope.branchId, restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${base}/alerts?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const alerts = parseStockAlertsList(reply.body, scope.restaurantId, scope.branchId);
    return alerts === undefined ? unavailable() : { ok: true, alerts };
  }

  if (operation === "readAverageCost") {
    const warehouseId = readUuidField(input, "warehouseId");
    const itemId = readUuidField(input, "itemId");
    if (warehouseId === undefined || itemId === undefined) return invalid();
    const query = new URLSearchParams({
      branchId: scope.branchId,
      itemId,
      restaurantId: scope.restaurantId,
      warehouseId,
    });
    const reply = await send(session.access_token, `${base}/costs?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const cost = parseAverageCost(reply.body, scope.restaurantId, scope.branchId, warehouseId, itemId);
    return cost === undefined ? unavailable() : { ok: true, cost };
  }

  if (operation === "listProductCosts") {
    const productId = readUuidField(input, "productId");
    if (productId === undefined) return invalid();
    const query = new URLSearchParams({ productId, restaurantId: scope.restaurantId });
    const reply = await send(session.access_token, `${base}/product-costs?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const costs = parseProductCostsList(reply.body, scope.restaurantId, productId);
    return costs === undefined ? unavailable() : { ok: true, costs };
  }

  if (operation === "readProductMargin") {
    const productId = readUuidField(input, "productId");
    if (productId === undefined) return invalid();
    const query = new URLSearchParams({
      branchId: scope.branchId,
      productId,
      restaurantId: scope.restaurantId,
    });
    const reply = await send(session.access_token, `${base}/margins?${query.toString()}`, "GET");
    if (!reply.ok) return reply;
    const margin = parseProductMargin(reply.body, scope.restaurantId, scope.branchId, productId);
    return margin === undefined ? unavailable() : { ok: true, margin };
  }

  if (operation === "createMovement") {
    const command = readMovementCommand(input);
    if (command === undefined) return invalid();
    const transfer = command.kind === "transfer_out" || command.kind === "transfer_in";
    const reply = await send(session.access_token, `${base}/movements`, "POST", {
      branchId: scope.branchId,
      compensatesMovementId: null,
      currency: null,
      idempotencyKey: command.idempotencyKey,
      itemId: command.itemId,
      kind: command.kind,
      quantityDelta: command.quantityDelta,
      reason: command.reason,
      restaurantId: scope.restaurantId,
      toWarehouseId: transfer ? command.toWarehouseId : null,
      transferPairId: null,
      unitCode: command.unitCode,
      unitCostMinor: null,
      warehouseId: command.warehouseId,
    });
    if (!reply.ok) return reply;
    return plainRecord(reply.body) === undefined ? unavailable() : { ok: true, recorded: true };
  }

  if (operation === "createItem") {
    const command = readCreateItem(input);
    if (command === undefined) return invalid();
    const reply = await send(session.access_token, `${base}/items`, "POST", {
      ...command,
      restaurantId: scope.restaurantId,
    });
    if (!reply.ok) return reply;
    const item = parseInventoryItemV1(reply.body);
    return item === undefined || item.restaurantId !== scope.restaurantId ? unavailable() : { ok: true, item };
  }

  if (operation === "updateItem") {
    const command = readItemPatch(input);
    if (command === undefined) return invalid();
    const reply = await send(
      session.access_token,
      `${base}/items/${encodeURIComponent(command.id)}`,
      "PATCH",
      command.patch,
    );
    if (!reply.ok) return reply;
    const item = parseInventoryItemV1(reply.body);
    return item === undefined || item.id !== command.id || item.restaurantId !== scope.restaurantId
      ? unavailable() : { ok: true, item };
  }

  if (operation === "createWarehouse") {
    const command = readCreateWarehouse(input);
    if (command === undefined) return invalid();
    const reply = await send(session.access_token, `${base}/warehouses`, "POST", {
      ...command,
      branchId: scope.branchId,
      restaurantId: scope.restaurantId,
    });
    if (!reply.ok) return reply;
    const warehouse = parseInventoryWarehouseV1(reply.body);
    return warehouse === undefined || warehouse.restaurantId !== scope.restaurantId
      || warehouse.branchId !== scope.branchId ? unavailable() : { ok: true, warehouse };
  }

  const command = readWarehousePatch(input);
  if (command === undefined) return invalid();
  const reply = await send(
    session.access_token,
    `${base}/warehouses/${encodeURIComponent(command.id)}`,
    "PATCH",
    command.patch,
  );
  if (!reply.ok) return reply;
  const warehouse = parseInventoryWarehouseV1(reply.body);
  return warehouse === undefined || warehouse.id !== command.id || warehouse.restaurantId !== scope.restaurantId
    || warehouse.branchId !== scope.branchId ? unavailable() : { ok: true, warehouse };
}

type CreateItemCommand = {
  readonly sku: string | null;
  readonly name: string;
  readonly unitCode: InventoryUnitV1;
  readonly purchaseUnitFactor: number;
  readonly minQuantity: number;
  readonly active: boolean;
};

function readCreateItem(input: unknown): CreateItemCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const name = readText(own(record, "name"), 160);
  const sku = readOptionalText(own(record, "sku"), 100);
  const unitCode = own(record, "unitCode");
  const purchaseUnitFactor = readWholeNumber(own(record, "purchaseUnitFactor"), 1);
  const minQuantity = readWholeNumber(own(record, "minQuantity"), 0);
  const active = readBoolean(own(record, "active"), true);
  if (name === undefined || sku === undefined || !isInventoryUnit(unitCode)
    || purchaseUnitFactor === undefined || minQuantity === undefined || active === undefined) {
    return undefined;
  }
  return { active, minQuantity, name, purchaseUnitFactor, sku, unitCode };
}

type WarehouseCommand = {
  readonly name: string;
  readonly active: boolean;
};

function readCreateWarehouse(input: unknown): WarehouseCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const name = readText(own(record, "name"), 160);
  const active = readBoolean(own(record, "active"), true);
  return name === undefined || active === undefined ? undefined : { active, name };
}

function readItemPatch(input: unknown): { readonly id: string; readonly patch: Readonly<Record<string, unknown>> } | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  const patch: Record<string, unknown> = {};
  if (Object.hasOwn(record, "name")) {
    const name = readText(own(record, "name"), 160);
    if (name === undefined) return undefined;
    patch["name"] = name;
  }
  if (Object.hasOwn(record, "sku")) {
    const sku = readOptionalText(own(record, "sku"), 100);
    if (sku === undefined) return undefined;
    patch["sku"] = sku;
  }
  if (Object.hasOwn(record, "minQuantity")) {
    const minQuantity = readWholeNumber(own(record, "minQuantity"), 0);
    if (minQuantity === undefined) return undefined;
    patch["minQuantity"] = minQuantity;
  }
  if (Object.hasOwn(record, "purchaseUnitFactor")) {
    const purchaseUnitFactor = readWholeNumber(own(record, "purchaseUnitFactor"), 1);
    if (purchaseUnitFactor === undefined) return undefined;
    patch["purchaseUnitFactor"] = purchaseUnitFactor;
  }
  if (Object.hasOwn(record, "active")) {
    const active = readBoolean(own(record, "active"));
    if (active === undefined) return undefined;
    patch["active"] = active;
  }
  return Object.keys(patch).length === 0 ? undefined : { id, patch: Object.freeze(patch) };
}

function readWarehousePatch(input: unknown): { readonly id: string; readonly patch: Readonly<Record<string, unknown>> } | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  const patch: Record<string, unknown> = {};
  if (Object.hasOwn(record, "name")) {
    const name = readText(own(record, "name"), 160);
    if (name === undefined) return undefined;
    patch["name"] = name;
  }
  if (Object.hasOwn(record, "active")) {
    const active = readBoolean(own(record, "active"));
    if (active === undefined) return undefined;
    patch["active"] = active;
  }
  return Object.keys(patch).length === 0 ? undefined : { id, patch: Object.freeze(patch) };
}

function parseItemsList(value: unknown, restaurantId: string): readonly InventoryItemV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1 || own(record, "restaurantId") !== restaurantId) {
    return undefined;
  }
  const rawItems = own(record, "items");
  if (!Array.isArray(rawItems)) return undefined;
  const items: InventoryItemV1[] = [];
  for (const rawItem of rawItems) {
    const item = parseInventoryItemV1(rawItem);
    if (item === undefined || item.restaurantId !== restaurantId) return undefined;
    items.push(item);
  }
  return items;
}

function parseWarehousesList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly InventoryWarehouseV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawWarehouses = own(record, "warehouses");
  if (!Array.isArray(rawWarehouses)) return undefined;
  const warehouses: InventoryWarehouseV1[] = [];
  for (const rawWarehouse of rawWarehouses) {
    const warehouse = parseInventoryWarehouseV1(rawWarehouse);
    if (warehouse === undefined || warehouse.restaurantId !== restaurantId || warehouse.branchId !== branchId) {
      return undefined;
    }
    warehouses.push(warehouse);
  }
  return warehouses;
}

function parseMovementsList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly InventoryMovementV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawMovements = own(record, "movements");
  if (!Array.isArray(rawMovements)) return undefined;
  const movements: InventoryMovementV1[] = [];
  for (const rawMovement of rawMovements) {
    const movement = parseInventoryMovementV1(rawMovement);
    if (movement === undefined || movement.restaurantId !== restaurantId || movement.branchId !== branchId) {
      return undefined;
    }
    movements.push(movement);
  }
  return movements;
}

function parseBalancesList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly InventoryBalanceV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawBalances = own(record, "balances");
  if (!Array.isArray(rawBalances)) return undefined;
  const balances: InventoryBalanceV1[] = [];
  for (const rawBalance of rawBalances) {
    const balance = parseInventoryBalanceV1(rawBalance);
    if (balance === undefined || balance.restaurantId !== restaurantId || balance.branchId !== branchId) {
      return undefined;
    }
    balances.push(balance);
  }
  return balances;
}

function parseStockAlertsList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly StockAlertV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawAlerts = own(record, "alerts");
  if (!Array.isArray(rawAlerts)) return undefined;
  const alerts: StockAlertV1[] = [];
  for (const rawAlert of rawAlerts) {
    const alert = parseStockAlert(rawAlert);
    if (alert === undefined) return undefined;
    alerts.push(alert);
  }
  return alerts;
}

function parseStockAlert(value: unknown): StockAlertV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined) return undefined;
  const itemId = own(record, "itemId");
  const warehouseId = own(record, "warehouseId");
  const itemName = own(record, "itemName");
  const warehouseName = own(record, "warehouseName");
  const unitCode = own(record, "unitCode");
  const quantity = readWholeNumber(own(record, "quantity"), 0);
  const minQuantity = readWholeNumber(own(record, "minQuantity"), 0);
  const deficit = readWholeNumber(own(record, "deficit"), 0);
  if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId)) return undefined;
  if (typeof warehouseId !== "string" || !UUID_PATTERN.test(warehouseId)) return undefined;
  if (typeof itemName !== "string" || itemName.trim().length === 0) return undefined;
  if (typeof warehouseName !== "string" || warehouseName.trim().length === 0) return undefined;
  if (!isInventoryUnit(unitCode)) return undefined;
  if (quantity === undefined || minQuantity === undefined || deficit === undefined) return undefined;
  return Object.freeze({ deficit, itemId, itemName, minQuantity, quantity, unitCode, warehouseId, warehouseName });
}

function parseAverageCost(
  value: unknown,
  restaurantId: string,
  branchId: string,
  warehouseId: string,
  itemId: string,
): AverageCostV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  if (own(record, "warehouseId") !== warehouseId || own(record, "itemId") !== itemId) return undefined;
  const quantity = readWholeNumber(own(record, "quantity"), 0);
  const valueMinor = readWholeNumber(own(record, "valueMinor"), 0);
  const unitCostMinor = readWholeNumber(own(record, "unitCostMinor"), 0);
  const roundingRemainder = readWholeNumber(own(record, "roundingRemainder"), 0);
  const currency = readCurrency(own(record, "currency"));
  if (quantity === undefined || valueMinor === undefined || unitCostMinor === undefined
    || roundingRemainder === undefined || currency === undefined) {
    return undefined;
  }
  return Object.freeze({
    branchId,
    currency,
    itemId,
    quantity,
    restaurantId,
    roundingRemainder,
    schemaVersion: 1 as const,
    unitCostMinor,
    valueMinor,
    warehouseId,
  });
}

function parseProductCostsList(
  value: unknown,
  restaurantId: string,
  productId: string,
): readonly ProductCostV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "productId") !== productId) {
    return undefined;
  }
  const rawCosts = own(record, "costs");
  if (!Array.isArray(rawCosts)) return undefined;
  const costs: ProductCostV1[] = [];
  for (const rawCost of rawCosts) {
    const cost = parseProductCost(rawCost);
    if (cost === undefined) return undefined;
    costs.push(cost);
  }
  return costs;
}

function parseProductCost(value: unknown): ProductCostV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined) return undefined;
  const itemId = own(record, "itemId");
  const itemName = own(record, "itemName");
  const unitCode = own(record, "unitCode");
  const quantity = readWholeNumber(own(record, "quantity"), 1);
  const purchaseUnitFactor = readWholeNumber(own(record, "purchaseUnitFactor"), 1);
  const unitCostMinor = readWholeNumber(own(record, "unitCostMinor"), 0);
  const lineCostMinor = readWholeNumber(own(record, "lineCostMinor"), 0);
  const currency = readCurrency(own(record, "currency"));
  if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId)) return undefined;
  if (typeof itemName !== "string" || itemName.trim().length === 0) return undefined;
  if (!isInventoryUnit(unitCode)) return undefined;
  if (quantity === undefined || purchaseUnitFactor === undefined || unitCostMinor === undefined
    || lineCostMinor === undefined || currency === undefined) {
    return undefined;
  }
  return Object.freeze({
    currency,
    itemId,
    itemName,
    lineCostMinor,
    purchaseUnitFactor,
    quantity,
    unitCode,
    unitCostMinor,
  });
}

function parseProductMargin(
  value: unknown,
  restaurantId: string,
  branchId: string,
  productId: string,
): ProductMarginV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId
    || own(record, "productId") !== productId) {
    return undefined;
  }
  const priceMinor = readWholeNumber(own(record, "priceMinor"), 0);
  const costMinor = readWholeNumber(own(record, "costMinor"), 0);
  const marginMinor = readInteger(own(record, "marginMinor"));
  const currency = readCurrency(own(record, "currency"));
  if (priceMinor === undefined || costMinor === undefined || marginMinor === undefined
    || typeof currency !== "string") {
    return undefined;
  }
  return Object.freeze({
    branchId,
    costMinor,
    currency,
    marginMinor,
    priceMinor,
    productId,
    restaurantId,
    schemaVersion: 1 as const,
  });
}

function parseRecipesList(
  value: unknown,
  restaurantId: string,
  productId: string,
): readonly RecipeSummaryV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "productId") !== productId) {
    return undefined;
  }
  const rawRecipes = own(record, "recipes");
  if (!Array.isArray(rawRecipes)) return undefined;
  const recipes: RecipeSummaryV1[] = [];
  for (const rawRecipe of rawRecipes) {
    const summary = parseRecipeSummary(rawRecipe, restaurantId, productId);
    if (summary === undefined) return undefined;
    recipes.push(summary);
  }
  return recipes;
}

function parseRecipeSummary(
  value: unknown,
  restaurantId: string,
  productId: string,
): RecipeSummaryV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined) return undefined;
  const recipeId = own(record, "recipeId");
  const modifierId = own(record, "modifierId");
  const version = own(record, "version");
  const active = own(record, "active");
  const notes = own(record, "notes");
  const createdAt = own(record, "createdAt");
  if (typeof recipeId !== "string" || !UUID_PATTERN.test(recipeId)) return undefined;
  if (own(record, "restaurantId") !== restaurantId || own(record, "productId") !== productId) return undefined;
  if (!(modifierId === null || (typeof modifierId === "string" && UUID_PATTERN.test(modifierId)))) return undefined;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) return undefined;
  if (typeof active !== "boolean") return undefined;
  if (!(notes === null || typeof notes === "string")) return undefined;
  if (typeof createdAt !== "string" || createdAt.length === 0) return undefined;
  return Object.freeze({ active, createdAt, modifierId, notes, productId, recipeId, restaurantId, version });
}

function readUuidField(input: unknown, key: string): string | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const value = own(record, key);
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function readPublishRecipeCommand(input: unknown, restaurantId: string) {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  return parsePublishRecipeCommandV1({
    lines: own(record, "lines"),
    modifierId: null,
    notes: null,
    productId: own(record, "productId"),
    restaurantId,
  });
}

const ORDER_STATUSES: ReadonlySet<string> = new Set(PURCHASE_ORDER_STATUSES);
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

interface SupplierCommand {
  readonly name: string;
  readonly contact: string | null;
  readonly active: boolean;
}

function readCreateSupplier(input: unknown): SupplierCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const name = readText(own(record, "name"), 160);
  const contact = readOptionalText(own(record, "contact"), 200);
  const active = readBoolean(own(record, "active"), true);
  if (name === undefined || contact === undefined || active === undefined) return undefined;
  return { active, contact, name };
}

function readSupplierPatch(
  input: unknown,
): { readonly id: string; readonly patch: Readonly<Record<string, unknown>> } | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  const patch: Record<string, unknown> = {};
  if (Object.hasOwn(record, "name")) {
    const name = readText(own(record, "name"), 160);
    if (name === undefined) return undefined;
    patch["name"] = name;
  }
  if (Object.hasOwn(record, "contact")) {
    const contact = readOptionalText(own(record, "contact"), 200);
    if (contact === undefined) return undefined;
    patch["contact"] = contact;
  }
  if (Object.hasOwn(record, "active")) {
    const active = readBoolean(own(record, "active"));
    if (active === undefined) return undefined;
    patch["active"] = active;
  }
  return Object.keys(patch).length === 0 ? undefined : { id, patch: Object.freeze(patch) };
}

function readIncludeInactive(input: unknown): boolean | undefined {
  if (input === undefined) return false;
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  return readBoolean(own(record, "includeInactive"), false);
}

function readPurchaseOrderFilter(
  input: unknown,
): { readonly status?: PurchaseOrderStatusV1 } | undefined {
  if (input === undefined) return {};
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const raw = own(record, "status");
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string" || !ORDER_STATUSES.has(raw)) return undefined;
  return { status: raw as PurchaseOrderStatusV1 };
}

interface CreatePurchaseOrderCommand {
  readonly supplierId: string;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly orderedAt?: string;
  readonly lines: readonly {
    readonly itemId: string;
    readonly quantity: number;
    readonly unitCode: InventoryUnitV1;
    readonly unitCostMinor: number;
  }[];
}

function readCreatePurchaseOrder(input: unknown): CreatePurchaseOrderCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const supplierId = own(record, "supplierId");
  const currency = own(record, "currency");
  const idempotencyKey = own(record, "idempotencyKey");
  if (typeof supplierId !== "string" || !UUID_PATTERN.test(supplierId)) return undefined;
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency.trim().toUpperCase())) return undefined;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 200
    || CONTROL_CHARACTER_PATTERN.test(idempotencyKey)) {
    return undefined;
  }
  let orderedAt: string | undefined;
  if (Object.hasOwn(record, "orderedAt")) {
    const raw = own(record, "orderedAt");
    if (typeof raw !== "string" || raw === "" || Number.isNaN(Date.parse(raw))) return undefined;
    orderedAt = raw;
  }
  const rawLines = own(record, "lines");
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 200) return undefined;
  const lines: CreatePurchaseOrderCommand["lines"][number][] = [];
  const seen = new Set<string>();
  for (const rawLine of rawLines) {
    const line = readPurchaseOrderLine(rawLine);
    if (line === undefined || seen.has(line.itemId)) return undefined;
    seen.add(line.itemId);
    lines.push(line);
  }
  return {
    currency: currency.trim().toUpperCase(),
    idempotencyKey,
    lines: Object.freeze(lines),
    supplierId,
    ...(orderedAt === undefined ? {} : { orderedAt }),
  };
}

function readPurchaseOrderLine(
  input: unknown,
): { readonly itemId: string; readonly quantity: number; readonly unitCode: InventoryUnitV1; readonly unitCostMinor: number } | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const itemId = own(record, "itemId");
  const quantity = own(record, "quantity");
  const unitCode = own(record, "unitCode");
  const unitCostMinor = own(record, "unitCostMinor");
  if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId)) return undefined;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return undefined;
  if (!isInventoryUnit(unitCode)) return undefined;
  if (typeof unitCostMinor !== "number" || !Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) {
    return undefined;
  }
  return Object.freeze({ itemId, quantity, unitCode, unitCostMinor });
}

interface ReceivePurchaseOrderCommand {
  readonly id: string;
  readonly warehouseId: string;
  readonly deviceId?: string;
}

function readReceiveCommand(input: unknown): ReceivePurchaseOrderCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  const warehouseId = own(record, "warehouseId");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  if (typeof warehouseId !== "string" || !UUID_PATTERN.test(warehouseId)) return undefined;
  let deviceId: string | undefined;
  if (Object.hasOwn(record, "deviceId")) {
    const raw = own(record, "deviceId");
    if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) return undefined;
    deviceId = raw;
  }
  return { id, warehouseId, ...(deviceId === undefined ? {} : { deviceId }) };
}

function parseSupplierV1(value: unknown, restaurantId: string): SupplierV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  const name = own(record, "name");
  const contact = own(record, "contact");
  const active = own(record, "active");
  const createdAt = own(record, "createdAt");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  if (own(record, "restaurantId") !== restaurantId) return undefined;
  if (typeof name !== "string" || name.trim().length < 1) return undefined;
  if (!(contact === null || typeof contact === "string")) return undefined;
  if (typeof active !== "boolean") return undefined;
  if (typeof createdAt !== "string" || createdAt.length === 0) return undefined;
  return Object.freeze({ active, contact, createdAt, id, name, restaurantId });
}

function parseSuppliersList(
  value: unknown,
  restaurantId: string,
  includeInactive: boolean,
): readonly SupplierV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "includeInactive") !== includeInactive) {
    return undefined;
  }
  const rawSuppliers = own(record, "suppliers");
  if (!Array.isArray(rawSuppliers)) return undefined;
  const suppliers: SupplierV1[] = [];
  for (const rawSupplier of rawSuppliers) {
    const supplier = parseSupplierV1(rawSupplier, restaurantId);
    if (supplier === undefined) return undefined;
    suppliers.push(supplier);
  }
  return suppliers;
}

function parseOrderSummary(value: unknown): PurchaseOrderSummaryV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined) return undefined;
  const id = own(record, "id");
  const supplierId = own(record, "supplierId");
  const supplierName = own(record, "supplierName");
  const status = own(record, "status");
  const currency = own(record, "currency");
  const orderedAt = own(record, "orderedAt");
  const receivedAt = own(record, "receivedAt");
  const receivedBy = own(record, "receivedBy");
  const totalMinor = own(record, "totalMinor");
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return undefined;
  if (typeof supplierId !== "string" || !UUID_PATTERN.test(supplierId)) return undefined;
  if (typeof supplierName !== "string" || supplierName.trim().length < 1) return undefined;
  if (typeof status !== "string" || !ORDER_STATUSES.has(status)) return undefined;
  if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) return undefined;
  if (typeof orderedAt !== "string" || orderedAt.length === 0) return undefined;
  if (!(receivedAt === null || (typeof receivedAt === "string" && receivedAt.length > 0))) return undefined;
  if (!(receivedBy === null || (typeof receivedBy === "string" && receivedBy.length > 0))) return undefined;
  if (typeof totalMinor !== "number" || !Number.isSafeInteger(totalMinor) || totalMinor < 0) return undefined;
  return Object.freeze({
    currency,
    id,
    orderedAt,
    receivedAt,
    receivedBy,
    status: status as PurchaseOrderStatusV1,
    supplierId,
    supplierName,
    totalMinor,
  });
}

function parseOrdersList(
  value: unknown,
  restaurantId: string,
  branchId: string,
): readonly PurchaseOrderSummaryV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "schemaVersion") !== 1
    || own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) {
    return undefined;
  }
  const rawOrders = own(record, "orders");
  if (!Array.isArray(rawOrders)) return undefined;
  const orders: PurchaseOrderSummaryV1[] = [];
  for (const rawOrder of rawOrders) {
    const order = parseOrderSummary(rawOrder);
    if (order === undefined) return undefined;
    orders.push(order);
  }
  return orders;
}

function parseOrderDetail(
  value: unknown,
  restaurantId: string,
  branchId: string,
): PurchaseOrderDetailV1 | undefined {
  const record = plainRecord(value);
  const summary = parseOrderSummary(value);
  if (record === undefined || summary === undefined) return undefined;
  if (own(record, "restaurantId") !== restaurantId || own(record, "branchId") !== branchId) return undefined;
  const rawLines = own(record, "lines");
  if (!Array.isArray(rawLines) || rawLines.length === 0) return undefined;
  const lines: PurchaseOrderLineDetailV1[] = [];
  for (const rawLine of rawLines) {
    const line = plainRecord(rawLine);
    if (line === undefined) return undefined;
    const itemId = own(line, "itemId");
    const itemName = own(line, "itemName");
    const quantity = own(line, "quantity");
    const unitCode = own(line, "unitCode");
    const unitCostMinor = own(line, "unitCostMinor");
    if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId)) return undefined;
    if (typeof itemName !== "string" || itemName.trim().length < 1) return undefined;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1) return undefined;
    if (!isInventoryUnit(unitCode)) return undefined;
    if (typeof unitCostMinor !== "number" || !Number.isSafeInteger(unitCostMinor) || unitCostMinor < 0) {
      return undefined;
    }
    lines.push(Object.freeze({ itemId, itemName, quantity, unitCode, unitCostMinor }));
  }
  return Object.freeze({ ...summary, branchId, lines: Object.freeze(lines), restaurantId });
}

function parseCreatedOrder(value: unknown): PurchaseOrderCreatedV1 | undefined {
  const record = plainRecord(value);
  if (record === undefined) return undefined;
  const orderId = own(record, "orderId");
  const status = own(record, "status");
  const replayed = own(record, "replayed");
  if (typeof orderId !== "string" || !UUID_PATTERN.test(orderId)) return undefined;
  if (typeof status !== "string" || !ORDER_STATUSES.has(status)) return undefined;
  if (typeof replayed !== "boolean") return undefined;
  return Object.freeze({ orderId, replayed, status: status as PurchaseOrderStatusV1 });
}

function parseReceipt(value: unknown): readonly PurchaseOrderReceiptMovementV1[] | undefined {
  const record = plainRecord(value);
  if (record === undefined || own(record, "status") !== "received") return undefined;
  const rawMovements = own(record, "movements");
  if (!Array.isArray(rawMovements) || rawMovements.length === 0) return undefined;
  const movements: PurchaseOrderReceiptMovementV1[] = [];
  for (const rawMovement of rawMovements) {
    const movement = plainRecord(rawMovement);
    if (movement === undefined) return undefined;
    const lineId = own(movement, "lineId");
    const movementId = own(movement, "movementId");
    if (typeof lineId !== "string" || !UUID_PATTERN.test(lineId)) return undefined;
    if (typeof movementId !== "string" || !UUID_PATTERN.test(movementId)) return undefined;
    movements.push(Object.freeze({ lineId, movementId }));
  }
  return Object.freeze(movements);
}

interface MovementFilter {
  readonly warehouseId?: string;
  readonly itemId?: string;
}

function readMovementFilter(input: unknown): MovementFilter | undefined {
  if (input === undefined) return {};
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const warehouseId = readFilterUuid(own(record, "warehouseId"));
  const itemId = readFilterUuid(own(record, "itemId"));
  if (warehouseId === null || itemId === null) return undefined;
  return {
    ...(warehouseId === undefined ? {} : { warehouseId }),
    ...(itemId === undefined ? {} : { itemId }),
  };
}

function readBalanceFilter(input: unknown): { readonly warehouseId?: string } | undefined {
  if (input === undefined) return {};
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const warehouseId = readFilterUuid(own(record, "warehouseId"));
  if (warehouseId === null) return undefined;
  return warehouseId === undefined ? {} : { warehouseId };
}

/** Blank or absent means «all»; anything that is not a UUID is invalid (`null`). */
function readFilterUuid(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

interface ManualMovementCommand {
  readonly warehouseId: string;
  readonly itemId: string;
  readonly kind: InventoryMovementKindV1;
  readonly quantityDelta: number;
  readonly unitCode: InventoryUnitV1;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly toWarehouseId: string | null;
}

function readMovementCommand(input: unknown): ManualMovementCommand | undefined {
  const record = plainRecord(input);
  if (record === undefined) return undefined;
  const warehouseId = readFilterUuid(own(record, "warehouseId"));
  const itemId = readFilterUuid(own(record, "itemId"));
  const kindValue = own(record, "kind");
  const kind = typeof kindValue === "string" && MANUAL_MOVEMENT_KINDS.has(kindValue as InventoryMovementKindV1)
    ? kindValue as InventoryMovementKindV1 : undefined;
  const quantityDelta = own(record, "quantityDelta");
  const unitCode = own(record, "unitCode");
  const reason = readText(own(record, "reason"), 500);
  const idempotencyKey = own(record, "idempotencyKey");
  const rawTarget = own(record, "toWarehouseId");
  if (rawTarget !== undefined && rawTarget !== null
    && (typeof rawTarget !== "string" || !UUID_PATTERN.test(rawTarget))) {
    return undefined;
  }
  const toWarehouseId = typeof rawTarget === "string" ? rawTarget : null;

  if (warehouseId === undefined || warehouseId === null
    || itemId === undefined || itemId === null
    || kind === undefined
    || typeof quantityDelta !== "number" || !Number.isSafeInteger(quantityDelta) || quantityDelta === 0
    || !isInventoryUnit(unitCode)
    || reason === undefined || reason.length < 3
    || typeof idempotencyKey !== "string" || !UUID_PATTERN.test(idempotencyKey)) {
    return undefined;
  }
  if ((kind === "waste" || kind === "transfer_out") && quantityDelta > 0) return undefined;
  if (kind === "transfer_in" && quantityDelta < 0) return undefined;
  if (kind === "transfer_out" || kind === "transfer_in") {
    if (toWarehouseId === null || toWarehouseId === warehouseId) return undefined;
  } else if (toWarehouseId !== null) {
    return undefined;
  }

  return Object.freeze({
    idempotencyKey,
    itemId,
    kind,
    quantityDelta,
    reason,
    toWarehouseId,
    unitCode,
    warehouseId,
  });
}

async function send(
  accessToken: string,
  url: string,
  method: "GET" | "PATCH" | "POST",
  body?: unknown,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly error: InventoryError }> {
  let response: Response;
  try {
    const init: RequestInit = {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
      signal: AbortSignal.timeout(10_000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(url, init);
  } catch (error) {
    return requestTimedOut(error) ? timedOut() : unavailable();
  }
  if (response.status === 400) return invalid();
  if (response.status === 401) return unauthenticated();
  if (response.status === 403) return denied();
  if (response.status === 404) return { ok: false, error: "missing" };
  if (response.status === 409) return { ok: false, error: "conflict" };
  if (!response.ok) return unavailable();
  try {
    return { body: await response.json(), ok: true };
  } catch {
    return unavailable();
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function own(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function readText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maximumLength && !CONTROL_CHARACTER_PATTERN.test(trimmed)
    ? trimmed
    : undefined;
}

function readOptionalText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() === "" ? null : readText(value, maximumLength);
}

function readWholeNumber(value: unknown, minimum: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** A three-letter ISO code, or `null` when the server has no cost yet. */
function readCurrency(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return CURRENCY_PATTERN.test(normalized) ? normalized : undefined;
}

function readBoolean(value: unknown, fallback?: boolean): boolean | undefined {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : undefined;
}

function isInventoryUnit(value: unknown): value is InventoryUnitV1 {
  return typeof value === "string" && (INVENTORY_UNITS as readonly string[]).includes(value);
}

function requestTimedOut(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error
    && (error.name === "TimeoutError" || error.name === "AbortError");
}

function invalid(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "invalid", ok: false };
}

function denied(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "denied", ok: false };
}

function unauthenticated(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "unauthenticated", ok: false };
}

function timedOut(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "timeout", ok: false };
}

function unavailable(): { readonly ok: false; readonly error: InventoryError } {
  return { error: "unavailable", ok: false };
}
