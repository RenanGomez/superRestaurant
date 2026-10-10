export interface Versioned { readonly tableId: string; readonly version: number }

/**
 * Merges a fresh server snapshot into the locally known tables. A table only replaces the local
 * copy when the server version is newer, so a response already applied locally is never rolled
 * back by an older render. Tables missing from the snapshot are dropped, except the ids in `keep`
 * (tables this editor just created that the snapshot has not caught up with yet). Returns `local`
 * itself when nothing changed.
 */
export function mergeByVersion<T extends Versioned>(local: Readonly<Record<string, T>>, incoming: readonly T[], keep: ReadonlySet<string> = new Set()): Readonly<Record<string, T>> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const table of incoming) {
    const current = local[table.tableId];
    if (current === undefined || table.version > current.version) { next[table.tableId] = table; changed = true; }
    else next[table.tableId] = current;
  }
  for (const [id, table] of Object.entries(local)) {
    if (next[id] === undefined && keep.has(id)) next[id] = table;
  }
  if (Object.keys(next).length !== Object.keys(local).length) changed = true;
  return changed ? next : local;
}

export interface TableDetailsInput { readonly name: string; readonly capacity: string; readonly shape: string }
export type TableDetailsCheck =
  | { readonly ok: true; readonly name: string; readonly capacity: number; readonly shape: "round" | "square" | "rectangle" }
  | { readonly ok: false; readonly message: string };

/** Client-side check only; the server revalidates. Name 1..40 characters, capacity an integer 1..50. */
export function validateTableDetails(input: TableDetailsInput): TableDetailsCheck {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40) return { ok: false, message: "El nombre debe tener entre 1 y 40 caracteres." };
  if (!/^\d{1,3}$/u.test(input.capacity.trim())) return { ok: false, message: "La capacidad debe ser un número entre 1 y 50." };
  const capacity = Number(input.capacity.trim());
  if (capacity < 1 || capacity > 50) return { ok: false, message: "La capacidad debe ser un número entre 1 y 50." };
  if (input.shape !== "round" && input.shape !== "square" && input.shape !== "rectangle") return { ok: false, message: "Elige una forma válida." };
  return { ok: true, name, capacity, shape: input.shape };
}

export interface TableGeometry { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Local draft of one table: everything the panel can change, with text fields as typed. */
export interface TableDraft extends TableGeometry { readonly name: string; readonly capacity: string; readonly shape: string }
interface SavedTable { readonly name: string; readonly capacity: number; readonly shape: string; readonly layout: TableGeometry }

export function draftFromTable(table: SavedTable): TableDraft {
  const { x, y, width, height } = table.layout;
  return { name: table.name, capacity: String(table.capacity), shape: table.shape, x, y, width, height };
}

/** Choosing «Cuadrada» makes the height equal to the width (shrunk only when the grid's bottom edge forces it). */
export function applyDraftShape(draft: TableDraft, shape: string): TableDraft {
  if (shape !== "square") return { ...draft, shape };
  const side = Math.max(2, Math.min(draft.width, 100 - draft.y, 24 - draft.x));
  return { ...draft, shape, width: side, height: side };
}

export interface DraftChanges { readonly layout: boolean; readonly details: boolean }

/** What differs between the saved table and its draft; layout and details are saved by different endpoints. */
export function draftChanges(saved: SavedTable, draft: TableDraft): DraftChanges {
  const layout = saved.layout.x !== draft.x || saved.layout.y !== draft.y || saved.layout.width !== draft.width || saved.layout.height !== draft.height;
  const details = saved.name !== draft.name.trim() || String(saved.capacity) !== draft.capacity.trim() || saved.shape !== draft.shape;
  return { layout, details };
}
