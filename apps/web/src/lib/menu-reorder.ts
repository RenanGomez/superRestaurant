/** Pure reorder helpers for the menu editor. Positions are 1..n; the server stays the authority. */
export interface Positioned { readonly displayOrder: number }

/** Moves one item and renumbers the whole list 1..n. Out-of-range or no-op moves only renumber. */
export function reorder<T extends Positioned>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const valid = Number.isInteger(fromIndex) && Number.isInteger(toIndex)
    && fromIndex >= 0 && fromIndex < next.length && toIndex >= 0 && toIndex < next.length;
  if (valid && fromIndex !== toIndex) {
    const [moved] = next.splice(fromIndex, 1);
    if (moved !== undefined) next.splice(toIndex, 0, moved);
  }
  return next.map((item, index) => ({ ...item, displayOrder: index + 1 }));
}

/** Reads the drop-row index from its data attribute; null when absent or not a non-negative integer. */
export function parseReorderIndex(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^\d+$/u.test(value)) return null;
  return Number(value);
}

/** Where the insertion line shows on the row under the pointer: after it when dragging down, before it when dragging up. */
export function dropIndicatorSide(fromIndex: number, targetIndex: number | null): "after" | "before" | null {
  if (targetIndex === null || targetIndex === fromIndex) return null;
  return targetIndex > fromIndex ? "after" : "before";
}

/** Reorders only the members of a sublist (same category, same product) inside a flat list, keeping other items in place. */
export function reorderSubset<T extends Positioned>(all: readonly T[], isMember: (item: T) => boolean, fromIndex: number, toIndex: number): T[] {
  const members = all.filter(isMember);
  const reordered = reorder(members, fromIndex, toIndex);
  let cursor = 0;
  return all.map((item) => isMember(item) ? (reordered[cursor++] ?? item) : item);
}

/** Attribute selector for a reorder list. Pure (no browser CSS.escape), so it is safe during SSR. */
export function reorderListSelector(listKey: string): string {
  const escaped = listKey.replace(/[\\"\n\r\f]/g, (char) => {
    if (char === "\n") return "\\a ";
    if (char === "\r") return "\\d ";
    if (char === "\f") return "\\c ";
    return `\\${char}`;
  });
  return `[data-reorder-list="${escaped}"]`;
}
