export type CaptureShortcutId = "create" | "search" | "reset";

export interface ShortcutKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly targetTag: string | undefined;
  readonly targetIsEditable: boolean;
}

export type ShortcutTable = Readonly<Partial<Record<CaptureShortcutId, string>>>;

const shortcuts: Readonly<Record<CaptureShortcutId, string>> = {
  create: "N",
  search: "/",
  reset: "Escape",
};

export function ariaKeyShortcut(id: CaptureShortcutId): string {
  return shortcuts[id];
}

export type SearchFocusTarget = "customer" | "menu";

/** When the menu step is visible, `/` should focus the product search instead of the customer search. */
export function searchFocusTarget(menuVisible: boolean): SearchFocusTarget {
  return menuVisible ? "menu" : "customer";
}

export function dispatchShortcut(event: ShortcutKey, table: ShortcutTable): CaptureShortcutId | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  const editable = event.targetIsEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.targetTag?.toUpperCase() ?? "");
  for (const id of ["create", "search", "reset"] as const) {
    const key = table[id];
    if (key === undefined || (editable && event.key !== "Escape")) continue;
    if (key === "Escape" ? event.key === "Escape" : event.key.toLowerCase() === key.toLowerCase()) return id;
  }
  return undefined;
}
