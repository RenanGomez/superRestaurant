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

/** ARIA `aria-keyshortcuts` strings: Alt+N creates, Ctrl+K searches, Escape or Alt+R resets.
 *  Alt+N matches on `event.key`; on macOS Option+N yields a dead key, not "n", so it does not match there. */
const shortcuts: Readonly<Record<CaptureShortcutId, string>> = {
  create: "Alt+N",
  search: "Control+K",
  reset: "Escape Alt+R",
};

export function ariaKeyShortcut(id: CaptureShortcutId): string {
  return shortcuts[id];
}

export type SearchFocusTarget = "customer" | "menu";

/** When the menu step is visible, Ctrl+K should focus the product search instead of the customer search. */
export function searchFocusTarget(menuVisible: boolean): SearchFocusTarget {
  return menuVisible ? "menu" : "customer";
}

function matches(id: CaptureShortcutId, event: ShortcutKey): boolean {
  const key = event.key.toLowerCase();
  const onlyAlt = event.altKey && !event.ctrlKey && !event.metaKey;
  const onlyCtrl = event.ctrlKey && !event.altKey && !event.metaKey;
  const bare = !event.altKey && !event.ctrlKey && !event.metaKey;
  if (id === "create") return onlyAlt && key === "n";
  if (id === "search") return onlyCtrl && key === "k";
  return (bare && event.key === "Escape") || (onlyAlt && key === "r");
}

export function dispatchShortcut(event: ShortcutKey, table: ShortcutTable): CaptureShortcutId | undefined {
  const editable = event.targetIsEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.targetTag?.toUpperCase() ?? "");
  for (const id of ["create", "search", "reset"] as const) {
    if (table[id] === undefined || (editable && event.key !== "Escape")) continue;
    if (matches(id, event)) return id;
  }
  return undefined;
}
