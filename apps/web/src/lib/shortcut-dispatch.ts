export type CaptureShortcutId = "capture" | "search" | "reset" | "dismiss";

export interface ShortcutKey {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly targetTag: string | undefined;
  readonly targetIsEditable: boolean;
}

export type ShortcutTable = Readonly<Partial<Record<CaptureShortcutId, string>>>;

/** ARIA `aria-keyshortcuts` strings: Alt+N opens capture (or focuses its customer search),
 *  Ctrl+K or Alt+K searches, Alt+Shift+R resets and Escape dismisses the open layer.
 *  `event.code` is the fallback so Alt+N/Alt+K/Alt+Shift+R still match where the layout yields another
 *  `key` (macOS Option+N is a dead key). */
const shortcuts: Readonly<Record<CaptureShortcutId, string>> = {
  capture: "Alt+N",
  search: "Control+K Alt+K",
  reset: "Alt+Shift+R",
  dismiss: "Escape",
};

export function ariaKeyShortcut(id: CaptureShortcutId): string {
  return shortcuts[id];
}

function matches(id: CaptureShortcutId, event: ShortcutKey): boolean {
  const key = event.key.toLowerCase();
  const onlyAlt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  const onlyAltShift = event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey;
  const onlyCtrl = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
  const bare = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  if (id === "capture") return onlyAlt && (key === "n" || event.code === "KeyN");
  if (id === "search") return (onlyAlt || onlyCtrl) && (key === "k" || event.code === "KeyK");
  if (id === "reset") return onlyAltShift && (key === "r" || event.code === "KeyR");
  return bare && (key === "escape" || event.code === "Escape");
}

export function dispatchShortcut(event: ShortcutKey, table: ShortcutTable): CaptureShortcutId | undefined {
  const editable = event.targetIsEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.targetTag?.toUpperCase() ?? "");
  const accelerated = event.altKey || event.ctrlKey || event.metaKey;
  const escape = event.key === "Escape" || event.code === "Escape";
  for (const id of ["capture", "search", "reset", "dismiss"] as const) {
    if (table[id] === undefined || (editable && !accelerated && !(id === "dismiss" && escape))) continue;
    if (matches(id, event)) return id;
  }
  return undefined;
}
