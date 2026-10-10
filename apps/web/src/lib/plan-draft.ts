import type { TableDraft, TableGeometry } from "./dining-editor";
import { clampTablePosition, savedTablePosition, type TablePosition } from "./table-position";

/**
 * The plan draft: pending positions of already-created tables, any number at once. It never holds
 * size or details (those belong to the panel draft of one table). `baseVersion` is the server
 * version the position was started from; saving sends it as `expectedVersion`.
 */
export interface PlanMove { readonly baseVersion: number; readonly x: number; readonly y: number }
export type PlanDraft = Readonly<Record<string, PlanMove>>;

export interface PlanTable { readonly tableId: string; readonly version: number; readonly layout: TableGeometry }

/** Records a pending position (clamped to the grid for the table's current size). The base version is kept once set. */
export function movePlanTable(plan: PlanDraft, table: PlanTable, position: TablePosition, width: number, height: number): PlanDraft {
  const clamped = clampTablePosition(position, width, height);
  return { ...plan, [table.tableId]: { baseVersion: plan[table.tableId]?.baseVersion ?? table.version, x: clamped.x, y: clamped.y } };
}

/** Ends a drag or key press on whole cells; a position equal to the saved one leaves the draft. */
export function commitPlanMove(plan: PlanDraft, table: PlanTable, width: number, height: number): PlanDraft {
  const move = plan[table.tableId];
  if (move === undefined) return plan;
  const rounded = savedTablePosition(move, width, height);
  if (rounded.x === table.layout.x && rounded.y === table.layout.y) return withoutMove(plan, table.tableId);
  return { ...plan, [table.tableId]: { ...move, ...rounded } };
}

export function withoutMove(plan: PlanDraft, tableId: string): PlanDraft {
  if (plan[tableId] === undefined) return plan;
  const next = { ...plan };
  delete next[tableId];
  return next;
}

/** Ids whose pending position really differs from the saved one (and whose table still exists). */
export function pendingMoveIds(plan: PlanDraft, tables: Readonly<Record<string, PlanTable>>): string[] {
  return Object.entries(plan)
    .filter(([id, move]) => { const table = tables[id]; return table !== undefined && (move.x !== table.layout.x || move.y !== table.layout.y); })
    .map(([id]) => id);
}

/** A resize in the panel must not leave a pending position outside the grid. */
export function clampPlanMove(plan: PlanDraft, tableId: string, width: number, height: number): PlanDraft {
  const move = plan[tableId];
  if (move === undefined) return plan;
  const clamped = clampTablePosition(move, width, height);
  return clamped.x === move.x && clamped.y === move.y ? plan : { ...plan, [tableId]: { ...move, ...clamped } };
}

/**
 * After this editor's own save moved a table from `fromVersion` to `toVersion`, a draft that was
 * based on `fromVersion` is carried to the new version. A draft on any other version is a foreign
 * change and is left untouched, so it is still reported as a conflict when saved.
 */
export function rebaseVersion(baseVersion: number, fromVersion: number, toVersion: number): number {
  return baseVersion === fromVersion ? toVersion : baseVersion;
}

export function rebasePlanMove(plan: PlanDraft, tableId: string, fromVersion: number, toVersion: number): PlanDraft {
  const move = plan[tableId];
  if (move === undefined) return plan;
  const baseVersion = rebaseVersion(move.baseVersion, fromVersion, toVersion);
  return baseVersion === move.baseVersion ? plan : { ...plan, [tableId]: { ...move, baseVersion } };
}

/** A pending move is foreign-changed when the server moved past its base by a change this editor did not make. */
export function planMoveIsConflict(move: PlanMove, serverVersion: number): boolean {
  return move.baseVersion !== serverVersion;
}

export interface PlanLayoutCommand { readonly tableId: string; readonly expectedVersion: number; readonly layout: TableGeometry }
export interface PlanSavePlan { readonly commands: readonly PlanLayoutCommand[]; readonly conflicts: readonly string[] }

/**
 * One layout command per moved table, in a stable order: the pending position (rounded, clamped
 * for the SAVED size, which is the size sent) with the version it was based on. Tables whose base
 * no longer matches the server go to `conflicts` and are not sent.
 */
export function planSaveCommands(plan: PlanDraft, tables: Readonly<Record<string, PlanTable>>): PlanSavePlan {
  const commands: PlanLayoutCommand[] = [];
  const conflicts: string[] = [];
  for (const id of pendingMoveIds(plan, tables).sort()) {
    const move = plan[id];
    const table = tables[id];
    if (move === undefined || table === undefined) continue;
    if (planMoveIsConflict(move, table.version)) { conflicts.push(id); continue; }
    const { width, height } = table.layout;
    const position = savedTablePosition(move, width, height);
    if (position.x === table.layout.x && position.y === table.layout.y) continue;
    commands.push({ tableId: id, expectedVersion: move.baseVersion, layout: { x: position.x, y: position.y, width, height } });
  }
  return { commands, conflicts };
}

/** One attempt per (table, version, geometry): a retry after a network error replays the same key. */
export function layoutAttemptKey(command: PlanLayoutCommand): string {
  const { x, y, width, height } = command.layout;
  return `${command.tableId}:${command.expectedVersion}:layout:${x}:${y}:${width}:${height}`;
}

export type PlanCommandOutcome = "saved" | "conflict" | "retry" | "rejected";

/** Applies one command's outcome: saved and conflicting moves leave the draft, the rest stay pending. */
export function applyPlanOutcome(plan: PlanDraft, tableId: string, outcome: PlanCommandOutcome): PlanDraft {
  return outcome === "saved" || outcome === "conflict" ? withoutMove(plan, tableId) : plan;
}

export interface PanelChanges { readonly layout: boolean; readonly details: boolean }
interface PanelSaved { readonly name: string; readonly capacity: number; readonly shape: string; readonly layout: TableGeometry }

/** What the panel draft changes: size (never position) and details. */
export function panelChanges(saved: PanelSaved, draft: TableDraft): PanelChanges {
  return {
    layout: saved.layout.width !== draft.width || saved.layout.height !== draft.height,
    details: saved.name !== draft.name.trim() || String(saved.capacity) !== draft.capacity.trim() || saved.shape !== draft.shape,
  };
}

/** Layout the panel sends: the table's SAVED position (kept inside the grid for the new size) with the drafted size. */
export function panelLayout(saved: TableGeometry, draft: TableDraft): TableGeometry {
  const position = savedTablePosition({ x: saved.x, y: saved.y }, draft.width, draft.height);
  return { x: position.x, y: position.y, width: draft.width, height: draft.height };
}
