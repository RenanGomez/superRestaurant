/**
 * Pure helpers for the inventory screen: tab selection, URL building, readable
 * units, search matching and whole-number parsing. No React, no network.
 */

export const INVENTORY_TABS = ["insumos", "almacenes", "movimientos"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export const DEFAULT_INVENTORY_TAB: InventoryTab = "insumos";

export const INVENTORY_TAB_LABELS: Readonly<Record<InventoryTab, string>> = {
  almacenes: "Almacenes",
  insumos: "Insumos",
  movimientos: "Movimientos",
};

export function isInventoryTab(value: unknown): value is InventoryTab {
  return typeof value === "string" && (INVENTORY_TABS as readonly string[]).includes(value);
}

/** Parses an untrusted query value such as `?tab=almacenes`. */
export function parseInventoryTab(value: unknown): InventoryTab | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return isInventoryTab(normalized) ? normalized : undefined;
}

/** Builds `/app/inventario?tab=...` while preserving other search parameters. */
export function inventoryTabHref(tab: InventoryTab, search?: string): string {
  const raw = search === undefined ? "" : search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  params.set("tab", tab);
  const query = params.toString();
  return query === "" ? "/app/inventario" : `/app/inventario?${query}`;
}

/** Operator-facing unit name. Falls back to a neutral word for unknown values. */
export function inventoryUnitLabel(unit: string): string {
  switch (unit) {
    case "g":
      return "gramos";
    case "ml":
      return "mililitros";
    case "piece":
      return "pieza";
    default:
      return "unidad";
  }
}

const NUMBER_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** Formats a whole quantity for display (thousands separated with es-MX rules). */
export function formatInventoryNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** True when the term appears in the item name or internal key. */
export function matchesInventoryQuery(
  item: { readonly name: string; readonly sku: string | null },
  query: string,
): boolean {
  const text = query.trim().toLocaleLowerCase("es-MX");
  if (text === "") return true;
  return item.name.toLocaleLowerCase("es-MX").includes(text)
    || (item.sku ?? "").toLocaleLowerCase("es-MX").includes(text);
}

export function filterInventoryItems<T extends { readonly name: string; readonly sku: string | null }>(
  items: readonly T[],
  query: string,
): readonly T[] {
  if (query.trim() === "") return items;
  return items.filter((item) => matchesInventoryQuery(item, query));
}

/** Parses a whole non-negative number typed in a form, rejecting decimals or signs. */
export function parseInventoryWholeNumber(value: string, minimum: number): number | undefined {
  const text = value.trim();
  if (!/^\d+$/u.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

/** Operator-facing name for every ledger movement kind. Unknown kinds fall back to a neutral word. */
export function inventoryMovementKindLabel(kind: string): string {
  switch (kind) {
    case "adjustment":
      return "Ajuste";
    case "waste":
      return "Merma";
    case "count_adjustment":
      return "Conteo";
    case "transfer_in":
    case "transfer_out":
      return "Transferencia";
    case "receipt":
      return "Recepción";
    case "sale_consumption":
      return "Consumo por venta";
    case "sale_reversal":
      return "Reversa de venta";
    default:
      return "Movimiento";
  }
}

/** Kinds the operator can create from the movements tab. */
export const INVENTORY_MOVEMENT_ACTIONS = ["adjustment", "waste", "transfer"] as const;
export type InventoryMovementAction = (typeof INVENTORY_MOVEMENT_ACTIONS)[number];

export const INVENTORY_MOVEMENT_ACTION_LABELS: Readonly<Record<InventoryMovementAction, string>> = {
  adjustment: "Ajustar",
  transfer: "Transferir",
  waste: "Merma",
};

export interface InventoryMovementDraft {
  readonly kind: InventoryMovementAction;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly quantity: string;
  readonly reason: string;
  readonly toWarehouseId?: string | undefined;
}

export type InventoryMovementValidation =
  | {
    readonly ok: true;
    readonly kind: "adjustment" | "waste" | "transfer_out";
    readonly quantityDelta: number;
    readonly reason: string;
  }
  | { readonly ok: false; readonly error: string };

/**
 * Validates the in-app movement form and turns it into the signed delta the API expects:
 * adjustments and counts add stock, waste subtracts and a transfer always leaves the origin.
 */
export function validateInventoryMovementDraft(draft: InventoryMovementDraft): InventoryMovementValidation {
  if (draft.warehouseId.trim() === "") return { error: "Elige el almacén de origen.", ok: false };
  if (draft.itemId.trim() === "") return { error: "Elige el insumo.", ok: false };
  const quantity = parseInventoryWholeNumber(draft.quantity, 1);
  if (quantity === undefined) return { error: "La cantidad debe ser un número entero mayor o igual a 1.", ok: false };
  const reason = draft.reason.trim();
  if (reason.length < 3) return { error: "Escribe un motivo de al menos 3 caracteres.", ok: false };
  if (reason.length > 500) return { error: "El motivo no puede pasar de 500 caracteres.", ok: false };
  if (draft.kind === "transfer") {
    const target = (draft.toWarehouseId ?? "").trim();
    if (target === "") return { error: "Elige el almacén destino.", ok: false };
    if (target === draft.warehouseId) return { error: "El almacén destino debe ser distinto al de origen.", ok: false };
    return { kind: "transfer_out", ok: true, quantityDelta: -quantity, reason };
  }
  if (draft.kind === "waste") return { kind: "waste", ok: true, quantityDelta: -quantity, reason };
  return { kind: "adjustment", ok: true, quantityDelta: quantity, reason };
}

/**
 * Keeps the key generated when the dialog opened, so a retry after a timeout reuses the same
 * idempotency key instead of creating a second movement.
 */
export function ensureInventoryIdempotencyKey(current: string | undefined, generate: () => string): string {
  return current === undefined || current === "" ? generate() : current;
}

/** Quantity with its sign and unit, e.g. `+12 gramos` or `-3 piezas`. */
export function formatInventoryMovementQuantity(quantityDelta: number, unit: string): string {
  const sign = quantityDelta > 0 ? "+" : "-";
  return `${sign}${formatInventoryNumber(Math.abs(quantityDelta))} ${inventoryUnitLabel(unit)}`;
}

/** Reads `MMM d, HH:mm` style dates for the ledger and balances, or a neutral dash for bad input. */
export function formatInventoryTimestamp(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}
