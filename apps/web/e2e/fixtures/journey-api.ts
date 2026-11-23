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

export interface OrderDetail {
  readonly orderId: string;
  readonly status: string;
  readonly version: number;
  readonly payments?: readonly unknown[];
  readonly totals: { readonly totalMinor: number };
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
  public async seedOrder(): Promise<{ readonly orderId: string; readonly productName: string; readonly totalMinor: number }> {
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
      ...this.audit(), channel: "counter", currency: catalog.currency, orderId, schemaVersion: 2,
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

  /** Closes the register with counted === expected; a no-op when there is no register or it is closed. */
  public async closeRegister(handle: OpenRegisterHandle): Promise<void> {
    const query = new URLSearchParams({
      branchId: this.scope.branchId, cashRegisterSessionId: handle.cashRegisterSessionId,
      deviceId: handle.deviceId, registerId: handle.registerId, restaurantId: this.scope.restaurantId,
    });
    let report: { readonly register: { readonly status: string; readonly version: number; readonly expectedCashBalanceMinor: number } };
    try {
      report = await this.request("GET", `/cash-registers/report?${query}`);
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

  private async request<T = JsonObject>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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
