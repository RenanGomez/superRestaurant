import { randomUUID } from "node:crypto";

import {
  accessTokenFrom, readAuthState, scopeFrom, type BranchScope,
} from "./journey-env.ts";

const DEFAULT_API_URL = "http://127.0.0.1:3000/api/v1";

export interface JourneyAudit {
  readonly deviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface MenuProduct {
  readonly productId: string;
  readonly name: string;
  readonly active: boolean;
  readonly unitPriceMinor: number;
  readonly stationId: string;
  readonly variants?: readonly { readonly variantId: string; readonly name: string; readonly active: boolean; readonly unitPriceMinor: number }[];
  readonly modifierGroupIds?: readonly string[];
  readonly pizzaMode?: string;
  readonly baseGroupId?: string | null;
  readonly baseGroupIds?: readonly string[];
  readonly customizeAtOrder?: boolean;
  readonly defaultIngredientOptionIds?: readonly string[];
  readonly extraGroupIds?: readonly string[];
  readonly extraOptionIds?: readonly string[];
  readonly freeIngredientCount?: number;
}

export interface MenuCatalog {
  readonly catalogVersion: string;
  readonly currency: string;
  readonly modifierGroups?: readonly { readonly active: boolean; readonly groupId: string; readonly maximumQuantity: number; readonly minimumQuantity: number; readonly name: string; readonly options: readonly { readonly active: boolean; readonly name: string; readonly optionId: string; readonly unitPriceMinor: number }[]; readonly productId?: string | null }[];
  readonly products: readonly MenuProduct[];
}

export interface CaptureTrayItem {
  readonly captureDraftId: string;
  readonly version: number;
  readonly status: "draft" | "confirmed" | "no_sale";
  readonly customer?: { readonly displayName: string; readonly phone: string } | null;
  readonly fulfillmentChannel?: string | null;
  readonly sourceChannel?: string;
}

export interface CaptureWorkspaceDetail {
  readonly captureDraftId: string;
  readonly status: "draft" | "confirmed" | "no_sale";
  readonly version: number;
  readonly attentionLeaseExpiresAt: string | null;
  readonly attentionLeaseId: string | null;
}

export interface CaptureWorkspace {
  readonly detail: CaptureWorkspaceDetail;
}

export interface SeededCustomer {
  readonly addressId: string;
  readonly addressVersion: number;
  readonly contactId: string;
  readonly customerId: string;
  readonly customerVersion: number;
  readonly name: string;
  readonly phone: string;
  readonly postalCode: string;
}

export interface OpenRegisterHandle {
  readonly cashRegisterSessionId: string;
  readonly deviceId: string;
  readonly registerId: string;
  readonly shiftId: string;
}

export interface OrderPayment {
  readonly paymentId: string;
  readonly method: "cash" | "card_manual" | "transfer";
  readonly amountMinor: number;
  readonly tipMinor: number;
  readonly capturedAt: string;
}

export interface OrderDetailItem {
  readonly orderItemId: string;
  readonly status: string;
  readonly name: string;
  readonly quantity: number;
  readonly lineTotalMinor: number;
}

export interface OrderDetail {
  readonly orderId: string;
  readonly status: string;
  readonly version: number;
  readonly items?: readonly OrderDetailItem[];
  readonly payments?: readonly OrderPayment[];
  readonly totals: { readonly totalMinor: number; readonly currency?: string };
}

export interface CashRegisterSummary {
  readonly cashRegisterSessionId: string;
  readonly status: "open" | "closed";
  readonly version: number;
  readonly currency: string;
  readonly expectedCashBalanceMinor: number;
  readonly openingFloatMinor: number;
  readonly countedClosingBalanceMinor: number | null;
  readonly differenceMinor: number | null;
}

export interface CashRegisterReport {
  readonly cashCapturedMinor: number;
  readonly cashTipsMinor: number;
  readonly cardManualCapturedMinor: number;
  readonly paymentCount: number;
  readonly register: CashRegisterSummary;
  readonly transferCapturedMinor?: number;
}

export interface BranchCourier {
  readonly displayName: string | null;
  readonly roles: readonly string[];
  readonly userId: string;
}

export interface DeliveryListItem {
  readonly delivery: { readonly orderId: string; readonly state: string; readonly version: number };
}

export type InventoryUnit = "g" | "ml" | "piece";

export interface InventoryItem {
  readonly id: string;
  readonly restaurantId: string;
  readonly sku: string | null;
  readonly name: string;
  readonly unitCode: InventoryUnit;
  readonly purchaseUnitFactor: number;
  readonly minQuantity: number;
  readonly active: boolean;
}

export interface InventoryWarehouse {
  readonly id: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly name: string;
  readonly active: boolean;
  readonly isDefault: boolean;
}

export interface InventoryBalance {
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly updatedAt: string;
}

export interface InventoryMovement {
  readonly id: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly kind: "receipt" | "sale_consumption" | "sale_reversal" | "waste" | "adjustment"
    | "transfer_out" | "transfer_in" | "count_adjustment";
  readonly quantityDelta: number;
  readonly unitCode: InventoryUnit;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly reason: string | null;
  readonly idempotencyKey: string;
  readonly compensatesMovementId: string | null;
  readonly transferPairId: string | null;
  readonly unitCostMinor: number | null;
  readonly currency: string | null;
  readonly recipeVersionId: string | null;
  readonly roundingRemainder: number;
}

export interface InventoryStockAlert {
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: InventoryUnit;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly quantity: number;
  readonly minQuantity: number;
  readonly deficit: number;
}

export interface InventoryProductMargin {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly productId: string;
  readonly priceMinor: number;
  readonly costMinor: number;
  readonly marginMinor: number;
  readonly currency: string;
}

export interface InventorySupplier {
  readonly id: string;
  readonly restaurantId: string;
  readonly name: string;
  readonly contact: string | null;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface InventoryPurchaseOrderCreated {
  readonly orderId: string;
  readonly status: "draft" | "sent" | "received" | "cancelled";
  readonly replayed: boolean;
}

export interface InventoryPurchaseReceipt {
  readonly status: "received";
  readonly movements: readonly { readonly lineId: string; readonly movementId: string }[];
}

export interface InventoryRecipeLine {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitCode: InventoryUnit;
}

export interface InventoryRecipeVersion {
  readonly restaurantId: string;
  readonly recipeId: string;
  readonly productId: string;
  readonly version: number;
  readonly lines: readonly InventoryRecipeLine[];
}

export interface InventoryRecipeSummary {
  readonly recipeId: string;
  readonly restaurantId: string;
  readonly productId: string;
  readonly modifierId: string | null;
  readonly version: number;
  readonly active: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface InventoryRecipeList {
  readonly schemaVersion: 1;
  readonly restaurantId: string;
  readonly productId: string;
  readonly recipes: readonly InventoryRecipeSummary[];
}

export interface CreateInventoryItemInput {
  readonly name: string;
  readonly unitCode: InventoryUnit;
  readonly sku?: string | null;
  readonly purchaseUnitFactor?: number;
  readonly minQuantity?: number;
  readonly active?: boolean;
}

export interface InventoryModifierGroup {
  readonly groupId: string;
  readonly selections: readonly { readonly optionId: string; readonly quantity: number }[];
}

export interface InventoryPizzaHalf {
  readonly fraction: "half-a" | "half-b";
  readonly productId: string;
  readonly variantId: string | null;
  readonly ingredientOptionIds: readonly string[];
  readonly extraOptionIds: readonly string[];
  readonly removedIngredientOptionIds: readonly string[];
}

export interface InventoryPizzaLine {
  readonly ruleVersion: "pizza-halves-v2";
  readonly halves: readonly [InventoryPizzaHalf, InventoryPizzaHalf];
}

export interface CounterSaleInput {
  readonly catalogVersion: string;
  readonly currency: string;
  readonly fraction?: InventoryLineFraction | null;
  readonly modifierGroups: readonly InventoryModifierGroup[];
  readonly orderId: string;
  readonly pizza?: InventoryPizzaLine | null;
  readonly productId: string;
  readonly shiftId: string;
  readonly variantId: string | null;
}

/** Half-and-half line payload (fraction model); mirrors `LineFractionV1`. */
export interface InventoryLineFraction {
  readonly geometry: "halves";
  readonly slots: readonly {
    readonly fraction: "half-a" | "half-b";
    readonly flavorOptionId: string | null;
    readonly extraOptionIds: readonly string[];
    readonly excludedIngredientIds: readonly string[];
  }[];
}

export interface CounterSaleResult {
  readonly inventory: { readonly status?: string; readonly reason?: string } | undefined;
  readonly orderId: string;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

export class JourneyApi {
  public readonly apiUrl: string;
  public readonly deviceId: string;
  public readonly scope: BranchScope;
  public readonly token: string;
  private readonly runId: string;

  public constructor(apiUrl: string, token: string, scope: BranchScope, runId: string) {
    this.apiUrl = apiUrl;
    this.deviceId = randomUUID();
    this.runId = runId;
    this.scope = scope;
    this.token = token;
  }

  public audit(): JourneyAudit {
    return {
      deviceId: this.deviceId,
      eventId: randomUUID(),
      idempotencyKey: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
  }

  public menuCatalog(): Promise<{ readonly catalog: MenuCatalog | null }> {
    return this.request("GET", `/catalog/menu?${new URLSearchParams({ branchId: this.scope.branchId, restaurantId: this.scope.restaurantId })}`);
  }

  public listTray(): Promise<{ readonly items: readonly CaptureTrayItem[] }> {
    return this.request("POST", "/captures/tray", { limit: 50, schemaVersion: 2, scope: this.scope });
  }

  public readWorkspace(captureDraftId: string): Promise<CaptureWorkspace> {
    return this.request("POST", "/captures/workspace", { captureDraftId, schemaVersion: 3, scope: this.scope });
  }

  public listActiveShifts(): Promise<{ readonly shifts: readonly { readonly shiftId: string; readonly status: string; readonly name: string }[] }> {
    return this.request("GET", `/shifts/active?${new URLSearchParams({ branchId: this.scope.branchId, restaurantId: this.scope.restaurantId })}`);
  }

  /** Creates a customer with one validated address; every field is deterministic for the run. */
  public async seedCustomer(runId: string, postalCode: string): Promise<SeededCustomer> {
    const customerId = randomUUID();
    const contactId = randomUUID();
    const addressId = randomUUID();
    const name = `E2E ${runId}`;
    const phone = `644 ${runId.replace(/\D/gu, "").slice(-7).padStart(7, "0")}`;
    const base = { customerId, schemaVersion: 1, scope: this.scope };
    await this.request("POST", "/customers/profile", {
      ...this.audit(), ...base, expectedVersion: 0, displayName: name,
      phones: [{ contactId, displayValue: phone, label: "Celular" }],
    });
    await this.request("POST", "/customers/address", {
      ...this.audit(), ...base, expectedVersion: 0, addressId,
      address: {
        countryCode: "MX", coordinates: null, instructions: null, label: "Casa",
        locality: "Hermosillo", neighborhood: null, postalCode, references: `Portón ${runId}`,
        region: "Sonora", streetLine: `Calle E2E ${runId}`, unit: null,
      },
    });
    await this.request("POST", "/customers/address/validate", {
      ...this.audit(), ...base, addressId, expectedVersion: 1,
    });
    return { addressId, addressVersion: 2, contactId, customerId, customerVersion: 1, name, phone, postalCode };
  }

  /**
   * Seeds a draft counter order with the branch's first configured product (its active size and
   * first mandatory modifier). It exercises the same Order endpoints the backoffice uses and never
   * publishes or edits the catalog.
   */
  public async seedOrder(
    options: { readonly channel?: "counter" | "delivery" } = {},
  ): Promise<{ readonly orderId: string; readonly productName: string; readonly totalMinor: number }> {
    const catalog = (await this.menuCatalog()).catalog;
    if (catalog === null) throw new Error("La sucursal no tiene catálogo publicado");
    const product = catalog.products.find((candidate) => candidate.active
      && (candidate.variants ?? []).some((variant) => variant.active));
    if (product === undefined) throw new Error("El catálogo no tiene un producto vendible con tamaño");
    const variant = (product.variants ?? []).find((candidate) => candidate.active);
    if (variant === undefined) throw new Error("El producto no tiene un tamaño activo");
    const groups = (catalog.modifierGroups ?? []).filter((group) => group.active && group.productId === product.productId);
    const mandatory = groups.find((group) => group.minimumQuantity > 0) ?? groups[0];
    const option = mandatory?.options.find((candidate) => candidate.active);
    const shift = (await this.listActiveShifts()).shifts.find((candidate) => candidate.status === "open");
    if (shift === undefined) throw new Error("No hay turno operativo abierto");
    const orderId = randomUUID();
    await this.request("POST", "/orders", {
      ...this.audit(), channel: options.channel ?? "counter", currency: catalog.currency, orderId, schemaVersion: 2,
      scope: this.scope, shiftId: shift.shiftId, tableId: null, timeZone: "America/Hermosillo",
    });
    await this.request("POST", "/orders/items", {
      ...this.audit(), expectedVersion: 1, modifierGroups: mandatory === undefined || option === undefined ? []
        : [{ groupId: mandatory.groupId, selections: [{ optionId: option.optionId, quantity: 1 }] }],
      orderId, orderItemId: randomUUID(), productId: product.productId, quantity: 1,
      schemaVersion: 1, scope: this.scope, variantId: variant.variantId,
    });
    const detail = await this.request<OrderDetail>("POST", "/orders/detail", { orderId, schemaVersion: 1, scope: this.scope });
    return { orderId, productName: product.name, totalMinor: detail.totals.totalMinor };
  }

  public async openRegister(shiftId: string, openingFloatMinor: number): Promise<OpenRegisterHandle> {
    const cashRegisterSessionId = randomUUID();
    const registerId = randomUUID();
    await this.request("POST", "/cash-registers/open", {
      ...this.audit(), cashRegisterSessionId, currency: "MXN", openingFloatMinor, registerId,
      schemaVersion: 1, scope: this.scope, shiftId,
    });
    return { cashRegisterSessionId, deviceId: this.deviceId, registerId, shiftId };
  }

  /** Reads the authoritative register report of the handle's session. */
  public async readRegister(handle: OpenRegisterHandle): Promise<CashRegisterReport> {
    const query = new URLSearchParams({
      branchId: this.scope.branchId, cashRegisterSessionId: handle.cashRegisterSessionId,
      deviceId: handle.deviceId, registerId: handle.registerId, restaurantId: this.scope.restaurantId,
    });
    return this.request("GET", `/cash-registers/report?${query}`);
  }

  /** Closes the register with counted === expected; a no-op when there is no register or it is closed. */
  public async closeRegister(handle: OpenRegisterHandle): Promise<void> {
    let report: CashRegisterReport;
    try {
      report = await this.readRegister(handle);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // A test that failed before the server persisted the opening leaves no register to close.
      if (message.includes("HTTP 404")) return;
      throw error;
    }
    if (report.register.status === "closed") return;
    await this.request("POST", "/cash-registers/close", {
      ...this.audit(), cashRegisterExpectedVersion: report.register.version,
      cashRegisterSessionId: handle.cashRegisterSessionId,
      countedClosingBalanceMinor: report.register.expectedCashBalanceMinor, reason: null,
      schemaVersion: 1, scope: this.scope,
    });
  }

  /** Active couriers of the branch; an empty list is a precondition gap for assigning a delivery. */
  public async listCouriers(): Promise<readonly BranchCourier[]> {
    const members = await this.request<{ readonly members: readonly BranchCourier[] }>("POST", "/access/branch-members", {
      roles: ["courier"], schemaVersion: 1, scope: this.scope,
    });
    return members.members;
  }

  /** Delivery rows of the branch, used to locate a run's delivery and its version. */
  public listDeliveries(): Promise<{ readonly items: readonly DeliveryListItem[] }> {
    return this.request("POST", "/deliveries/list", { schemaVersion: 1, scope: this.scope });
  }

  /**
   * Best-effort cleanup of a delivery this run assigned or dispatched: marks it failed so the Order
   * is no longer blocked by an active delivery and `cancelIfUnpaid` can close it. Never fails the run
   * for a delivery that another actor already moved; the reason stays in the log.
   */
  public async failActiveDelivery(orderId: string): Promise<void> {
    let item: DeliveryListItem | undefined;
    try {
      item = (await this.listDeliveries()).items.find((candidate) => candidate.delivery.orderId === orderId);
    } catch (error: unknown) {
      console.warn(`No se pudo leer la entrega ${orderId} en cleanup:`, error instanceof Error ? error.message : error);
      return;
    }
    if (item === undefined || (item.delivery.state !== "assigned" && item.delivery.state !== "en_route")) return;
    try {
      await this.request("POST", "/deliveries/fail", {
        ...this.audit(), expectedVersion: item.delivery.version, orderId,
        reason: `E2E cleanup ${this.runId}`, schemaVersion: 1, scope: this.scope,
      });
    } catch (error: unknown) {
      console.warn(`No se pudo marcar fallida la entrega ${orderId} en cleanup:`, error instanceof Error ? error.message : error);
    }
  }

  public readOrder(orderId: string): Promise<OrderDetail> {
    return this.request("POST", "/orders/detail", { orderId, schemaVersion: 1, scope: this.scope });
  }

  /** Cancels only an order that still has no money captured; paid/partially paid orders are left intact. */
  public async cancelIfUnpaid(orderId: string): Promise<void> {
    let detail: OrderDetail;
    try {
      detail = await this.readOrder(orderId);
    } catch {
      return;
    }
    if (detail.status !== "draft" && detail.status !== "open") return;
    if ((detail.payments ?? []).length > 0) return;
    try {
      await this.request("POST", "/orders/cancel", {
        ...this.audit(), expectedVersion: detail.version, orderId,
        reason: `E2E cleanup ${this.runId}`, schemaVersion: 1, scope: this.scope,
      });
    } catch (error: unknown) {
      // A concurrent state change (already sent/cancelled) is not a leak worth failing the run on,
      // but it must stay visible in the log instead of disappearing silently.
      console.warn(`No se pudo cancelar la orden ${orderId} en cleanup:`, error instanceof Error ? error.message : error);
    }
  }

  /**
   * Closes a capture draft created by the run. A held draft without a lease is claimed first so the
   * no-sale command is always authorized; confirmed/cancelled drafts are ignored.
   */
  public async closeDraft(captureDraftId: string): Promise<void> {
    const workspace = await this.readWorkspace(captureDraftId).catch(() => undefined);
    if (workspace === undefined || workspace.detail.status !== "draft") return;
    let detail = workspace.detail;
    if (detail.attentionLeaseId === null) {
      const claimed = await this.request<CaptureWorkspace>("POST", "/captures/claim", {
        ...this.audit(), captureDraftId, expectedVersion: detail.version, schemaVersion: 1, scope: this.scope,
      });
      detail = claimed.detail;
    }
    const attentionLeaseId = detail.attentionLeaseId;
    if (attentionLeaseId === null) return;
    await this.request("POST", "/captures/no-sale", {
      ...this.audit(), attentionLeaseId, captureDraftId, expectedVersion: detail.version,
      reason: `E2E cleanup ${this.runId}`, schemaVersion: 1, scope: this.scope,
    });
  }

  /** Inserts a run-scoped item; the ledger is immutable and the API has no delete. */
  public createInventoryItem(input: CreateInventoryItemInput): Promise<InventoryItem> {
    return this.request("POST", "/inventory/items", { ...input, restaurantId: this.scope.restaurantId });
  }

  public updateInventoryItem(id: string, patch: { readonly active: boolean }): Promise<InventoryItem> {
    return this.request("PATCH", `/inventory/items/${encodeURIComponent(id)}`, patch);
  }

  public listInventoryItems(): Promise<{ readonly items: readonly InventoryItem[] }> {
    return this.request("GET", `/inventory/items?${new URLSearchParams({ restaurantId: this.scope.restaurantId })}`);
  }

  public listInventoryWarehouses(): Promise<{ readonly warehouses: readonly InventoryWarehouse[] }> {
    return this.request("GET", `/inventory/warehouses?${new URLSearchParams({
      branchId: this.scope.branchId, restaurantId: this.scope.restaurantId,
    })}`);
  }

  public createInventoryWarehouse(input: {
    readonly name: string;
    readonly active?: boolean;
    readonly isDefault?: boolean;
  }): Promise<InventoryWarehouse> {
    return this.request("POST", "/inventory/warehouses", {
      ...input, branchId: this.scope.branchId, restaurantId: this.scope.restaurantId,
    });
  }

  public updateInventoryWarehouse(
    id: string,
    patch: { readonly name?: string; readonly active?: boolean; readonly isDefault?: boolean },
  ): Promise<InventoryWarehouse> {
    return this.request("PATCH", `/inventory/warehouses/${encodeURIComponent(id)}`, patch);
  }

  public listInventorySuppliers(): Promise<{ readonly suppliers: readonly InventorySupplier[] }> {
    return this.request("GET", `/inventory/suppliers?${new URLSearchParams({ restaurantId: this.scope.restaurantId })}`);
  }

  public createInventorySupplier(input: { readonly contact: string | null; readonly name: string }): Promise<InventorySupplier> {
    return this.request("POST", "/inventory/suppliers", {
      ...input, active: true, restaurantId: this.scope.restaurantId,
    });
  }

  public updateInventorySupplier(id: string, patch: { readonly active: boolean }): Promise<InventorySupplier> {
    return this.request("PATCH", `/inventory/suppliers/${encodeURIComponent(id)}`, patch);
  }

  /** Creates a purchase order; receiving it writes one receipt movement and the integer average cost. */
  public createInventoryPurchaseOrder(input: {
    readonly currency: string;
    readonly idempotencyKey: string;
    readonly lines: readonly { readonly itemId: string; readonly quantity: number; readonly unitCode: InventoryUnit; readonly unitCostMinor: number }[];
    readonly supplierId: string;
  }): Promise<InventoryPurchaseOrderCreated> {
    return this.request("POST", "/inventory/purchase-orders", {
      ...input, branchId: this.scope.branchId, restaurantId: this.scope.restaurantId,
    });
  }

  public receiveInventoryPurchaseOrder(orderId: string, warehouseId: string): Promise<InventoryPurchaseReceipt> {
    return this.request("POST", `/inventory/purchase-orders/${encodeURIComponent(orderId)}/receive`, {
      deviceId: this.deviceId, warehouseId,
    });
  }

  public publishInventoryRecipe(
    productId: string,
    lines: readonly InventoryRecipeLine[],
  ): Promise<InventoryRecipeVersion> {
    return this.request("POST", "/inventory/recipes", { lines, productId, restaurantId: this.scope.restaurantId });
  }

  public listInventoryRecipes(
    productId: string,
    includeInactive = false,
  ): Promise<InventoryRecipeList> {
    return this.request("GET", `/inventory/recipes?${new URLSearchParams({
      includeInactive: String(includeInactive), productId, restaurantId: this.scope.restaurantId,
    })}`);
  }

  public readInventoryRecipe(recipeId: string): Promise<InventoryRecipeVersion> {
    return this.request("GET", `/inventory/recipes/${encodeURIComponent(recipeId)}?${new URLSearchParams({
      restaurantId: this.scope.restaurantId,
    })}`);
  }

  public listInventoryBalances(): Promise<{ readonly balances: readonly InventoryBalance[] }> {
    return this.request("GET", `/inventory/balances?${new URLSearchParams({
      branchId: this.scope.branchId, restaurantId: this.scope.restaurantId,
    })}`);
  }

  public listInventoryMovements(
    filter: { readonly itemId?: string; readonly warehouseId?: string } = {},
  ): Promise<{ readonly movements: readonly InventoryMovement[] }> {
    const query = new URLSearchParams({
      branchId: this.scope.branchId, limit: "200", restaurantId: this.scope.restaurantId,
    });
    if (filter.itemId !== undefined) query.set("itemId", filter.itemId);
    if (filter.warehouseId !== undefined) query.set("warehouseId", filter.warehouseId);
    return this.request("GET", `/inventory/movements?${query}`);
  }

  public listInventoryAlerts(): Promise<{ readonly alerts: readonly InventoryStockAlert[] }> {
    return this.request("GET", `/inventory/alerts?${new URLSearchParams({
      branchId: this.scope.branchId, restaurantId: this.scope.restaurantId,
    })}`);
  }

  public readInventoryMargin(productId: string): Promise<InventoryProductMargin> {
    return this.request("GET", `/inventory/margins?${new URLSearchParams({
      branchId: this.scope.branchId, productId, restaurantId: this.scope.restaurantId,
    })}`);
  }

  /**
   * Confirms a counter capture through the capture endpoints, the only path that runs sale-driven
   * inventory consumption. The caller supplies `orderId` so cleanup can cancel the order even when
   * the confirmation response is lost.
   */
  public async confirmCounterSale(input: CounterSaleInput): Promise<CounterSaleResult> {
    const captureDraftId = randomUUID();
    const created = await this.request<CaptureWorkspace>("POST", "/captures", {
      ...this.audit(), schemaVersion: 1, scope: this.scope, captureDraftId, expectedVersion: 0,
      sourceChannel: "counter", fulfillmentChannel: "counter",
    });
    const attentionLeaseId = created.detail.attentionLeaseId;
    if (attentionLeaseId === null) throw new Error("La captura no expuso un lease de atención");
    const pizza = input.pizza ?? undefined;
    const fraction = input.fraction ?? undefined;
    const planned = await this.request<CaptureWorkspace>("POST", "/captures/selection-plan", {
      ...this.audit(), schemaVersion: 1, scope: this.scope, captureDraftId,
      expectedVersion: created.detail.version, attentionLeaseId,
      plan: {
        schemaVersion: pizza === undefined ? 1 : 2, catalogVersion: input.catalogVersion,
        lines: [{
          lineId: randomUUID(), productId: input.productId, variantId: input.variantId,
          quantity: 1, modifierGroups: input.modifierGroups, note: null,
          ...(fraction === undefined ? {} : { fraction }),
          ...(pizza === undefined ? {} : { pizza }),
        }],
      },
    });
    const confirmed = await this.request<{
      readonly detail: { readonly confirmedOrderId?: string };
      readonly inventory?: { readonly status?: string; readonly reason?: string };
    }>("POST", "/captures/confirm", {
      ...this.audit(), schemaVersion: 2, scope: this.scope, captureDraftId,
      expectedVersion: planned.detail.version, attentionLeaseId, orderId: input.orderId,
      shiftId: input.shiftId, tableId: null, currency: input.currency, timeZone: "America/Hermosillo",
    });
    if (confirmed.detail.confirmedOrderId !== input.orderId) {
      throw new Error(`La confirmación no devolvió la orden ${input.orderId}`);
    }
    return { inventory: confirmed.inventory, orderId: input.orderId };
  }

  public cancelOrderItem(
    orderId: string,
    orderItemId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<{ readonly replayed: boolean }> {
    return this.request("POST", "/orders/items/cancel", {
      ...this.audit(), schemaVersion: 1, scope: this.scope, orderId, orderItemId, expectedVersion, reason,
    });
  }

  private async request<T = JsonObject>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const init: RequestInit = {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      method,
      signal: AbortSignal.timeout(20_000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${this.apiUrl}${path}`, init);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 400)}`);
    }
    if (text === "") return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${method} ${path} -> respuesta no JSON: ${text.slice(0, 200)}`);
    }
  }
}

/** The API client, or undefined when there is no saved operator session. */
export function createJourneyApi(runId: string): JourneyApi | undefined {
  const state = readAuthState();
  if (state === undefined) return undefined;
  const token = accessTokenFrom(state);
  const scope = scopeFrom(state);
  if (token === undefined || scope === undefined) return undefined;
  return new JourneyApi(process.env.E2E_API_URL ?? DEFAULT_API_URL, token, scope, runId);
}
