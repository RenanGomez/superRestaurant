/**
 * Pure helpers for menu editor tab navigation, URL query parameter parsing,
 * and safe localStorage persistence.
 */

export const MENU_TABS = ["categorias", "productos", "modificadores", "tamanos"] as const;
export type MenuTab = (typeof MENU_TABS)[number];

export const DEFAULT_MENU_TAB: MenuTab = "categorias";

export const MENU_TAB_STORAGE_KEY = "superrestaurant.menu.tab";

export const MENU_TAB_LABELS: Readonly<Record<MenuTab, string>> = {
  categorias: "Categorías",
  productos: "Productos",
  modificadores: "Modificadores",
  tamanos: "Tamaños y presets",
};

/** Checks whether a value is one of the valid menu tab identifiers. */
export function isMenuTab(value: unknown): value is MenuTab {
  return typeof value === "string" && (MENU_TABS as readonly string[]).includes(value);
}

/** Parses an untrusted value (e.g. search query parameter or stored string) into a MenuTab. */
export function parseMenuTab(value: unknown): MenuTab | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return isMenuTab(normalized) ? normalized : undefined;
}

/** Resolves an untrusted value to a valid tab, falling back to the default tab. */
export function resolveMenuTab(value: unknown, fallback: MenuTab = DEFAULT_MENU_TAB): MenuTab {
  return parseMenuTab(value) ?? fallback;
}

/** Builds an internal menu URL preserving other search parameters while setting or replacing `tab`. */
export function menuTabHref(tab: MenuTab, searchParams?: string | URLSearchParams | Readonly<Record<string, unknown>>): string {
  const params = new URLSearchParams();

  if (typeof searchParams === "string") {
    const raw = searchParams.startsWith("?") ? searchParams.slice(1) : searchParams;
    const existing = new URLSearchParams(raw);
    existing.forEach((val, key) => params.set(key, val));
  } else if (searchParams instanceof URLSearchParams) {
    searchParams.forEach((val, key) => params.set(key, val));
  } else if (searchParams !== undefined && searchParams !== null) {
    for (const [key, val] of Object.entries(searchParams)) {
      if (typeof val === "string") params.set(key, val);
      else if (Array.isArray(val) && typeof val[0] === "string") params.set(key, val[0]);
    }
  }

  params.set("tab", tab);
  const query = params.toString();
  return query === "" ? "/app/menu" : `/app/menu?${query}`;
}

/** Reads the active menu tab from storage, returning null on any error or missing value. */
export function readStoredMenuTab(storage: Pick<Storage, "getItem"> | null | undefined): MenuTab | null {
  if (storage === null || storage === undefined) return null;
  try {
    const raw = storage.getItem(MENU_TAB_STORAGE_KEY);
    return parseMenuTab(raw) ?? null;
  } catch {
    return null;
  }
}

/** Safely writes the active menu tab to storage, ignoring errors (e.g. quota, private mode). */
export function writeStoredMenuTab(storage: Pick<Storage, "setItem"> | null | undefined, tab: MenuTab): void {
  if (storage === null || storage === undefined) return;
  try {
    storage.setItem(MENU_TAB_STORAGE_KEY, tab);
  } catch {
    // Storage access restricted or disabled; fail quietly
  }
}
