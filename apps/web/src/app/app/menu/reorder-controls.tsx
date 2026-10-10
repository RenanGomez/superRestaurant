"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { dropIndicatorSide, parseReorderIndex } from "../../../lib/menu-reorder";

/** Row attributes that make an element a drop target for ReorderHandle in the same list. */
export function reorderRowProps(listKey: string, index: number): { readonly "data-reorder-index": number; readonly "data-reorder-list": string } {
  return { "data-reorder-index": index, "data-reorder-list": listKey };
}

function clearDragMarks(): void {
  for (const element of document.querySelectorAll("[data-reorder-state]")) element.removeAttribute("data-reorder-state");
  document.body.removeAttribute("data-reorder-dragging");
}

interface ReorderProps {
  readonly count: number;
  readonly disabled: boolean;
  readonly index: number;
  readonly onMove: (fromIndex: number, toIndex: number) => void;
}

/**
 * Drag handle (Pointer Events), the first element on the left of the row it drags. It shows only the
 * six-dot icon; `ReorderButtons` is the keyboard and touch alternative.
 * While dragging: the source row is lifted, the row under the pointer shows an insertion line,
 * the cursor is `grabbing`, Escape or pointercancel cancels and releasing reorders.
 */
export function ReorderHandle({ align = "center", count, disabled, index, listKey, onMove }: ReorderProps & { readonly align?: "center" | "start"; readonly listKey: string }): ReactNode {
  const [dragging, setDragging] = useState(false);
  const active = useRef(false);
  const stopKeys = useRef<(() => void) | null>(null);
  const selector = `[data-reorder-list="${CSS.escape(listKey)}"]`;

  useEffect(() => () => { stopKeys.current?.(); clearDragMarks(); }, []);
  if (disabled || count < 2) return null;

  const rowAt = (x: number, y: number): Element | null => document.elementFromPoint(x, y)?.closest(selector) ?? null;
  const end = (): void => {
    active.current = false;
    stopKeys.current?.();
    stopKeys.current = null;
    clearDragMarks();
    setDragging(false);
  };
  const start = (event: PointerEvent<HTMLSpanElement>): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    active.current = true;
    setDragging(true);
    document.body.setAttribute("data-reorder-dragging", "");
    event.currentTarget.closest(selector)?.setAttribute("data-reorder-state", "source");
    const onKey = (keyEvent: KeyboardEvent): void => { if (keyEvent.key === "Escape") end(); };
    window.addEventListener("keydown", onKey);
    stopKeys.current = () => window.removeEventListener("keydown", onKey);
  };
  const move = (event: PointerEvent<HTMLSpanElement>): void => {
    if (!active.current) return;
    const target = parseReorderIndex(rowAt(event.clientX, event.clientY)?.getAttribute("data-reorder-index"));
    const side = dropIndicatorSide(index, target);
    for (const element of document.querySelectorAll(`${selector}[data-reorder-state="before"], ${selector}[data-reorder-state="after"]`)) {
      element.removeAttribute("data-reorder-state");
    }
    if (side !== null) rowAt(event.clientX, event.clientY)?.setAttribute("data-reorder-state", side);
  };
  const finish = (event: PointerEvent<HTMLSpanElement>): void => {
    if (!active.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = parseReorderIndex(rowAt(event.clientX, event.clientY)?.getAttribute("data-reorder-index"));
    end();
    if (target !== null && target !== index) onMove(index, target);
  };
  return (
    <span role="img" aria-label="Arrastrar para reordenar" title="Arrastrar para reordenar"
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={end}
      className={`inline-flex min-h-11 min-w-11 shrink-0 select-none items-center justify-center ${align === "start" ? "self-start" : "self-center"} rounded-lg border [touch-action:none] ${dragging ? "cursor-grabbing border-accent bg-accent-soft text-accent-hover" : "cursor-grab border-border bg-surface text-text-muted hover:border-accent hover:text-accent"}`}>
      <svg aria-hidden="true" viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
        <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
        <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
        <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
      </svg>
    </span>
  );
}

/** Subir/Bajar buttons: the keyboard and touch alternative to dragging. */
export function ReorderButtons({ count, disabled, index, label, onMove }: ReorderProps & { readonly label: string }): ReactNode {
  if (disabled || count < 2) return null;
  const button = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface px-2 text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Posición de ${label}`}>
      <button type="button" className={button} disabled={index === 0} onClick={() => onMove(index, index - 1)}>Subir</button>
      <button type="button" className={button} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>Bajar</button>
    </div>
  );
}
