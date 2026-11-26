/**
 * Pure helpers for the inventory screen: tab selection, URL building, readable
 * units, search matching and whole-number parsing. No React, no network.
 */

import { INVENTORY_UNITS, type InventoryUnitV1, type RecipeLineV1 } from "@super-restaurant/shared-types";

export const INVENTORY_TABS = ["insumos", "recetas", "almacenes", "movimientos", "compras", "alertas"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export const DEFAULT_INVENTORY_TAB: InventoryTab = "insumos";

export const INVENTORY_TAB_LABELS: Readonly<Record<InventoryTab, string>> = {
  alertas: "Alertas",
  almacenes: "Almacenes",
  compras: "Compras",
  insumos: "Insumos",
  movimientos: "Movimientos",
  recetas: "Recetas",
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

/** Badge text for the branch default warehouse, or null when the warehouse is not the default. */
export function warehouseDefaultLabel(isDefault: boolean): string | null {
  return isDefault ? "Predeterminado" : null;
}

const NUMBER_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** Formats a whole quantity for display (thousands separated with es-MX rules). */
export function formatInventoryNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/**
 * Presentation-only percentage between two exact minor-unit integers (`part / total`), with one
 * decimal at most and a neutral dash when the total is zero or the input is not a safe integer.
 * It never recomputes a price or a cost; the caller passes the server's own integers.
 */
export function formatPercentFromMinor(part: number, total: number): string {
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || total === 0) return "—";
  const tenths = divideRounded(BigInt(part) * 1_000n, BigInt(total));
  const negative = tenths < 0n;
  const absolute = negative ? -tenths : tenths;
  const whole = absolute / 10n;
  const fraction = absolute % 10n;
  const text = fraction === 0n
    ? formatInventoryNumber(Number(whole))
    : `${formatInventoryNumber(Number(whole))}.${fraction.toString()}`;
  return `${negative ? "-" : ""}${text}%`;
}

/** Integer division rounded half away from zero, so the percentage never leaks a float. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const rounded = (absoluteNumerator * 2n + absoluteDenominator) / (absoluteDenominator * 2n);
  return negative ? -rounded : rounded;
}

export interface StockAlertSummaryInput {
  readonly deficit: number;
  readonly unitCode: string;
}

/** Operator-facing shortfall text for a low-stock alert, without internal codes. */
export function stockAlertSummary(alert: StockAlertSummaryInput): string {
  const deficit = Number.isSafeInteger(alert.deficit) && alert.deficit > 0 ? alert.deficit : 0;
  if (deficit === 0) return "Sin déficit";
  const unit = inventoryUnitLabel(alert.unitCode);
  let label = unit;
  if (deficit !== 1) {
    if (unit === "pieza") label = "piezas";
    else if (unit === "unidad") label = "unidades";
  }
  return `Faltan ${formatInventoryNumber(deficit)} ${label}`;
}

/**
 * Currencies this runtime knows. `Intl` happily formats an invented code such as `ZZZ` using the
 * code itself as the symbol, so the list is the only reliable way to reject an unknown ISO code
 * instead of printing an amount that looks valid.
 */
const KNOWN_CURRENCIES: ReadonlySet<string> = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [],
);

/**
 * Presentation-only money formatter for purchase totals the server already froze. It splits the
 * exact minor-unit integer with BigInt (never a float division), derives the decimal scale from the
 * currency and reuses the locale's own symbol, grouping and sign placement. It never adds or
 * recomputes anything: the number passed in is the server's own `totalMinor`.
 *
 * The scale comes from `Intl` itself, so every ISO code the runtime knows works; a code the runtime
 * does not know is reported instead of printing a wrong amount.
 */
export function formatMinorUnits(amountMinor: number, currency: string, locale = "es-MX"): string {
  if (!Number.isSafeInteger(amountMinor)) return "Monto no válido";
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized)) return "Moneda no admitida";
  if (!KNOWN_CURRENCIES.has(normalized)) return "Moneda no admitida";
  let formatter: Intl.NumberFormat;
  let digits: number;
  try {
    formatter = new Intl.NumberFormat(locale, { currency: normalized, style: "currency" });
    digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return "Moneda no admitida";
  }
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) return "Moneda no admitida";
  const scale = 10n ** BigInt(digits);
  const negative = amountMinor < 0;
  const absoluteMinor = negative ? BigInt(-amountMinor) : BigInt(amountMinor);
  const integerText = new Intl.NumberFormat(locale).format(absoluteMinor / scale);
  const fractionText = (absoluteMinor % scale).toString().padStart(digits, "0");
  let integerUsed = false;
  let fractionUsed = false;
  return formatter.formatToParts(negative ? -1 : 1).map((part) => {
    if (part.type === "integer" || part.type === "group") {
      if (integerUsed) return "";
      integerUsed = true;
      return integerText;
    }
    if (part.type === "fraction") {
      if (fractionUsed) return "";
      fractionUsed = true;
      return fractionText;
    }
    return part.value;
  }).join("");
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

export interface RecipeLineDraft {
  readonly itemId: string;
  readonly quantity: string;
  readonly unitCode: InventoryUnitV1;
}

export type RecipeLinesValidation =
  | { readonly ok: true; readonly lines: readonly RecipeLineV1[] }
  | { readonly ok: false; readonly error: string };

/**
 * Validates the in-app recipe editor before publishing: at least one line, one positive whole
 * quantity per line, a known unit and no repeated ingredient.
 */
export function validateRecipeLineDrafts(drafts: readonly RecipeLineDraft[]): RecipeLinesValidation {
  if (drafts.length === 0) return { error: "Agrega al menos un insumo a la receta.", ok: false };
  const lines: RecipeLineV1[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (draft.itemId.trim() === "") return { error: "Elige un insumo en cada línea de la receta.", ok: false };
    if (!(INVENTORY_UNITS as readonly string[]).includes(draft.unitCode)) {
      return { error: "La unidad del insumo no es válida.", ok: false };
    }
    const quantity = parseInventoryWholeNumber(draft.quantity, 1);
    if (quantity === undefined) {
      return { error: "Cada cantidad debe ser un número entero mayor o igual a 1.", ok: false };
    }
    if (seen.has(draft.itemId)) return { error: "No repitas el mismo insumo en la receta.", ok: false };
    seen.add(draft.itemId);
    lines.push(Object.freeze({ itemId: draft.itemId, quantity, unitCode: draft.unitCode }));
  }
  return { lines: Object.freeze(lines), ok: true };
}

/** Header for a recipe version, e.g. `Versión 2`. */
export function formatRecipeVersionLabel(version: number): string {
  return `Versión ${formatInventoryNumber(version)}`;
}

/** Whether a recipe version is the active one or kept only for history. */
export function recipeVersionStateLabel(active: boolean): string {
  return active ? "Activa" : "Histórica";
}

export interface SupplierDraft {
  readonly name: string;
  readonly contact: string;
}

export type SupplierValidation =
  | { readonly ok: true; readonly name: string; readonly contact: string | null }
  | { readonly ok: false; readonly error: string };

/** Validates the supplier form: name 1..160 characters, contact optional 1..200 or none. */
export function validateSupplierDraft(draft: SupplierDraft): SupplierValidation {
  const name = draft.name.trim();
  if (name.length === 0) return { error: "Escribe el nombre del proveedor.", ok: false };
  if (name.length > 160) return { error: "El nombre no puede pasar de 160 caracteres.", ok: false };
  const contact = draft.contact.trim();
  if (contact.length > 200) return { error: "El contacto no puede pasar de 200 caracteres.", ok: false };
  return { contact: contact === "" ? null : contact, name, ok: true };
}

export interface PurchaseOrderLineDraft {
  readonly itemId: string;
  readonly quantity: string;
  readonly unitCode: InventoryUnitV1;
  readonly unitCostMinor: string;
}

export interface PurchaseOrderDraft {
  readonly supplierId: string;
  readonly currency: string;
  readonly lines: readonly PurchaseOrderLineDraft[];
}

export interface ValidatedPurchaseOrderLine {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitCode: InventoryUnitV1;
  readonly unitCostMinor: number;
}

export type PurchaseOrderValidation =
  | { readonly ok: true; readonly currency: string; readonly lines: readonly ValidatedPurchaseOrderLine[] }
  | { readonly ok: false; readonly error: string };

const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/u;

/**
 * Validates the purchase order draft before sending it: supplier, ISO currency, at least one line,
 * whole positive quantities, a known unit per line, whole non-negative minor costs and no repeated
 * item. The total is never computed here; the server owns it.
 */
export function validatePurchaseOrderDraft(draft: PurchaseOrderDraft): PurchaseOrderValidation {
  if (draft.supplierId.trim() === "") return { error: "Elige el proveedor.", ok: false };
  const currency = draft.currency.trim().toUpperCase();
  if (!ISO_CURRENCY_PATTERN.test(currency)) {
    return { error: "La moneda debe ser un código ISO de 3 letras, por ejemplo MXN.", ok: false };
  }
  if (draft.lines.length === 0) return { error: "Agrega al menos un insumo a la orden.", ok: false };
  const lines: ValidatedPurchaseOrderLine[] = [];
  const seen = new Set<string>();
  for (const line of draft.lines) {
    if (line.itemId.trim() === "") return { error: "Elige un insumo en cada línea de la orden.", ok: false };
    if (!(INVENTORY_UNITS as readonly string[]).includes(line.unitCode)) {
      return { error: "La unidad del insumo no es válida.", ok: false };
    }
    const quantity = parseInventoryWholeNumber(line.quantity, 1);
    if (quantity === undefined) {
      return { error: "Cada cantidad debe ser un número entero mayor o igual a 1.", ok: false };
    }
    const unitCostMinor = parseInventoryWholeNumber(line.unitCostMinor, 0);
    if (unitCostMinor === undefined) {
      return { error: "Cada costo unitario debe ser un entero mayor o igual a 0 en la unidad menor.", ok: false };
    }
    if (seen.has(line.itemId)) return { error: "No repitas el mismo insumo en la orden.", ok: false };
    seen.add(line.itemId);
    lines.push(Object.freeze({ itemId: line.itemId, quantity, unitCode: line.unitCode, unitCostMinor }));
  }
  return { currency, lines: Object.freeze(lines), ok: true };
}

/** Minimal key-value storage the device-id helper needs; a browser `localStorage` matches it. */
export interface InventoryDeviceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Browser key that keeps the inventory device id stable per profile, not per tab. */
export const INVENTORY_DEVICE_ID_KEY = "super-restaurant.inventory.deviceId";

const CANONICAL_DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Resolves the device id sent with inventory writes. It is an audit trace, never an
 * authorization: the server identifies the actor from the session. Reuses a stored canonical
 * UUID, replaces a corrupt value and survives a blocked store (a throwing `getItem`/`setItem`
 * still returns the id generated for this mount, so mounting never fails).
 */
export function ensureInventoryDeviceId(store: InventoryDeviceStore | undefined, create: () => string): string {
  let stored: string | null | undefined;
  try {
    stored = store?.getItem(INVENTORY_DEVICE_ID_KEY);
  } catch {
    stored = undefined;
  }
  if (typeof stored === "string" && CANONICAL_DEVICE_ID.test(stored)) return stored;
  const generated = create();
  if (!CANONICAL_DEVICE_ID.test(generated)) throw new Error("INVENTORY_DEVICE_ID_REJECTED");
  try {
    store?.setItem(INVENTORY_DEVICE_ID_KEY, generated);
  } catch {
    // A blocked store still keeps the generated id for this mount.
  }
  return generated;
}

/** Operator-facing name for every purchase order status. Unknown values fall back to a neutral word. */
export function purchaseOrderStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Borrador";
    case "sent":
      return "Enviada";
    case "received":
      return "Recibida";
    case "cancelled":
      return "Cancelada";
    default:
      return "Orden";
  }
}
