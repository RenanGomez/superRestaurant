"use client";

import { useState, type PointerEvent, type ReactNode } from "react";

/** Row attributes that make an element a drop target for ReorderControls in the same list. */
export function reorderRowProps(listKey: string, index: number): { readonly "data-reorder-index": number; readonly "data-reorder-list": string } {
  return { "data-reorder-index": index, "data-reorder-list": listKey };
}

/** Drag handle (Pointer Events) plus Subir/Bajar buttons as the keyboard and touch alternative. */
export function ReorderControls({ count, disabled, index, label, listKey, onMove }: {
  readonly count: number;
  readonly disabled: boolean;
  readonly index: number;
  readonly label: string;
  readonly listKey: string;
  readonly onMove: (fromIndex: number, toIndex: number) => void;
}): ReactNode {
  const [dragging, setDragging] = useState(false);
  if (disabled || count < 2) return null;
  const finish = (event: PointerEvent<HTMLSpanElement>): void => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(`[data-reorder-list="${CSS.escape(listKey)}"]`);
    const target = row === null || row === undefined ? Number.NaN : Number(row.getAttribute("data-reorder-index"));
    if (Number.isInteger(target) && target !== index) onMove(index, target);
  };
  const button = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface px-2 text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Posición de ${label}`}>
      <span aria-hidden="true" title="Arrastra para reordenar"
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
        onPointerUp={finish} onPointerCancel={() => setDragging(false)}
        className={`inline-flex min-h-11 min-w-11 cursor-grab select-none items-center justify-center rounded-lg border border-border bg-surface text-[16px] text-text-muted [touch-action:none] ${dragging ? "cursor-grabbing bg-bg" : ""}`}>⋮⋮</span>
      <button type="button" className={button} disabled={index === 0} onClick={() => onMove(index, index - 1)}>Subir</button>
      <button type="button" className={button} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>Bajar</button>
    </div>
  );
}
