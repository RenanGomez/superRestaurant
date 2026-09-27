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
