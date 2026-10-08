export interface TablePosition { readonly x: number; readonly y: number }

/** Layout v1 is a 24 by 100 unit grid. Fractional units are only a local drag preview. */
export function clampTablePosition(position: TablePosition, width: number, height: number): TablePosition {
  return {
    x: Math.max(0, Math.min(24 - width, position.x)),
    y: Math.max(0, Math.min(100 - height, position.y)),
  };
}

export function savedTablePosition(position: TablePosition, width: number, height: number): TablePosition {
  const clamped = clampTablePosition(position, width, height);
  return { x: Math.round(clamped.x), y: Math.round(clamped.y) };
}

/** Keyboard movement starts from the exact coordinates that Save will submit. */
export function moveTableByKeyboard(position: TablePosition, key: string, shift: boolean, width: number, height: number): TablePosition {
  const current = savedTablePosition(position, width, height);
  const distance = shift ? 4 : 1;
  const delta: Record<string, TablePosition> = {
    ArrowLeft: { x: -distance, y: 0 }, ArrowRight: { x: distance, y: 0 },
    ArrowUp: { x: 0, y: -distance }, ArrowDown: { x: 0, y: distance },
  };
  const movement = delta[key];
  return movement === undefined ? current : clampTablePosition({ x: current.x + movement.x, y: current.y + movement.y }, width, height);
}

export interface TableRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export const MIN_TABLE_CELLS = 2;
export const MAX_TABLE_CELLS = 8;

function clampCells(value: number, limit: number): number {
  return Math.max(MIN_TABLE_CELLS, Math.min(MAX_TABLE_CELLS, limit, Math.round(value)));
}

/**
 * Resizes by whole cells (a drag delta or a button step). Width and height stay in 2..8 and the
 * table never leaves the 24 by 100 grid: the origin does not move, so the far edge is what clamps.
 */
export function resizeTableCells(rect: TableRect, deltaCols: number, deltaRows: number): { width: number; height: number } {
  return {
    width: clampCells(rect.width + deltaCols, 24 - rect.x),
    height: clampCells(rect.height + deltaRows, 100 - rect.y),
  };
}

/** First free spot (row by row, left to right) for a new table, or undefined when the plan is full. */
export function firstFreeSlot(occupied: readonly TableRect[], width = 4, height = 4): TablePosition | undefined {
  for (let y = 0; y <= 100 - height; y += 1) {
    for (let x = 0; x <= 24 - width; x += 1) {
      const free = occupied.every((other) => x + width <= other.x || other.x + other.width <= x || y + height <= other.y || other.y + other.height <= y);
      if (free) return { x, y };
    }
  }
  return undefined;
}
