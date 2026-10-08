export interface PlanRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface PlanViewBox { readonly x: number; readonly y: number; readonly cols: number; readonly rows: number }

const MIN_COLS = 8;
const MIN_ROWS = 6;

/**
 * Presentation-only window over the saved 24x100 layout grid: the bounding box of the
 * tables plus a one-unit margin, never smaller than a minimum so one table is not zoomed
 * absurdly. Saved coordinates are never changed.
 */
export function planViewBox(rects: readonly PlanRect[], margin = 1): PlanViewBox {
  if (rects.length === 0) return { x: 0, y: 0, cols: 24, rows: MIN_ROWS };
  const minX = Math.min(...rects.map((rect) => rect.x)) - margin;
  const minY = Math.min(...rects.map((rect) => rect.y)) - margin;
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width)) + margin;
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height)) + margin;
  const cols = Math.max(MIN_COLS, maxX - minX);
  const rows = Math.max(MIN_ROWS, maxY - minY);
  return { x: minX - (cols - (maxX - minX)) / 2, y: minY - (rows - (maxY - minY)) / 2, cols, rows };
}

function clampPercent(value: number): number { return Math.max(0, Math.min(100, value)); }

/** Percentage box of a table inside the view box, clamped so it can never leave the canvas. */
export function planPlacement(rect: PlanRect, box: PlanViewBox): { left: string; top: string; width: string; height: string } {
  const left = clampPercent(((rect.x - box.x) / box.cols) * 100);
  const top = clampPercent(((rect.y - box.y) / box.rows) * 100);
  const width = Math.min(100 - left, (rect.width / box.cols) * 100);
  const height = Math.min(100 - top, (rect.height / box.rows) * 100);
  const fmt = (value: number) => `${Math.round(value * 1000) / 1000}%`;
  return { left: fmt(left), top: fmt(top), width: fmt(width), height: fmt(height) };
}

/** Canvas sizing: fills the container width but never grows taller than `maxHeightVh` of the viewport. */
export function planCanvasStyle(box: PlanViewBox, maxHeightVh = 70, minCellPx = 14): { aspectRatio: string; width: string; minWidth: string } {
  const ratio = box.cols / box.rows;
  return { aspectRatio: `${box.cols} / ${box.rows}`, width: `min(100%, ${Math.round(maxHeightVh * ratio * 1000) / 1000}vh)`, minWidth: `${Math.ceil(box.cols * minCellPx)}px` };
}
