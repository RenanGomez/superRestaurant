export type CaptureShortcutId = "create" | "search" | "reset";

export interface ShortcutKey {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly targetTag: string | undefined;
  readonly targetIsEditable: boolean;
}

export type ShortcutTable = Readonly<Partial<Record<CaptureShortcutId, string>>>;

/** ARIA `aria-keyshortcuts` strings: Alt+N creates, Ctrl+K or Alt+K searches, Escape or Alt+R resets.
 *  `event.code` is the fallback so Alt+N/Alt+K still match where the layout yields another `key`
 *  (macOS Option+N is a dead key). */
const shortcuts: Readonly<Record<CaptureShortcutId, string>> = {
  create: "Alt+N",
  search: "Control+K Alt+K",
  reset: "Escape Alt+R",
};

export function ariaKeyShortcut(id: CaptureShortcutId): string {
  return shortcuts[id];
}

function matches(id: CaptureShortcutId, event: ShortcutKey): boolean {
  const key = event.key.toLowerCase();
  const onlyAlt = event.altKey && !event.ctrlKey && !event.metaKey;
  const onlyCtrl = event.ctrlKey && !event.altKey && !event.metaKey;
  const bare = !event.altKey && !event.ctrlKey && !event.metaKey;
  if (id === "create") return onlyAlt && (key === "n" || event.code === "KeyN");
  if (id === "search") return (onlyAlt || onlyCtrl) && (key === "k" || event.code === "KeyK");
  return (bare && (event.key === "Escape" || event.code === "Escape")) || (onlyAlt && (key === "r" || event.code === "KeyR"));
}

export function dispatchShortcut(event: ShortcutKey, table: ShortcutTable): CaptureShortcutId | undefined {
  const editable = event.targetIsEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.targetTag?.toUpperCase() ?? "");
  const accelerated = event.altKey || event.ctrlKey || event.metaKey;
  const escape = event.key === "Escape" || event.code === "Escape";
  for (const id of ["create", "search", "reset"] as const) {
    if (table[id] === undefined || (editable && !accelerated && !(id === "reset" && escape))) continue;
    if (matches(id, event)) return id;
  }
  return undefined;
}
