/**
 * Pure helpers for the inventory screen: tab selection, URL building, readable
 * units, search matching and whole-number parsing. No React, no network.
 */

export const INVENTORY_TABS = ["insumos", "almacenes"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];

export const DEFAULT_INVENTORY_TAB: InventoryTab = "insumos";

export const INVENTORY_TAB_LABELS: Readonly<Record<InventoryTab, string>> = {
  almacenes: "Almacenes",
  insumos: "Insumos",
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
