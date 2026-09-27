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
