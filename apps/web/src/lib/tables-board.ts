import type { DiningLayoutV1, TableBoardTableV1, TableBoardV1 } from "@super-restaurant/shared-types";

export function groupBoardByZone(layout: DiningLayoutV1, board: TableBoardV1) {
  const states = new Map(board.tables.map((table) => [table.tableId, table]));
  return layout.zones.map((zone) => ({
    ...zone,
    tables: zone.tables.map((table) => ({ ...table, state: states.get(table.tableId) ?? null })),
  }));
}

export function gridPlacement(layout: { x: number; y: number; width: number; height: number }) {
  return { gridColumn: `${layout.x + 1} / span ${layout.width}`, gridRow: `${layout.y + 1} / span ${layout.height}` };
}

export function tableStatusLabel(state: TableBoardTableV1 | null): string {
  return state === null ? "Sin estado" : state.status === "free" ? "Libre" : "Ocupada";
}

export function waiterInitials(name: string | null): string {
  if (name === null || name.trim() === "") return "Sin mesero";
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("es-MX") ?? "").join("");
}
