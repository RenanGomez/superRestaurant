"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { dropIndicatorSide, hoverIndexAt, parseReorderIndex, reorderListSelector, tentativeOrder, type RowBounds } from "../../../lib/menu-reorder";

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
  const selector = reorderListSelector(listKey);

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

interface DragState {
  readonly from: number;
  readonly grabOffset: number;
  readonly hover: number;
  readonly pointerY: number;
  readonly rect: { readonly height: number; readonly left: number; readonly width: number };
}

interface DragReorderListProps<T> {
  readonly className: string;
  readonly disabled: boolean;
  readonly getKey: (item: T) => string;
  readonly items: readonly T[];
  readonly label: string;
  readonly onMove: (fromIndex: number, toIndex: number) => void;
  /** `handle` is null when the list cannot be reordered (read-only or fewer than two items). */
  readonly renderRow: (item: T, index: number, handle: ReactNode) => ReactNode;
}

/**
 * Vertical list with drag-to-reorder and a live ghost: while dragging, the row follows the pointer
 * (semi-transparent), the other rows make room and a dashed gap of the same height shows where it would land.
 * Releasing over another slot calls `onMove(from, to)`; Escape, right click or pointercancel restore the order.
 * The handle also reorders with ArrowUp/ArrowDown. Rows keep their DOM position (the dragged one just leaves the flow)
 * so pointer capture is never lost.
 */
export function DragReorderList<T>({ className, disabled, getKey, items, label, onMove, renderRow }: DragReorderListProps<T>): ReactNode {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const bounds = useRef<RowBounds[]>([]);
  const captured = useRef<{ readonly element: HTMLElement; readonly pointerId: number } | null>(null);
  const stopListeners = useRef<(() => void) | null>(null);
  const reorderable = !disabled && items.length >= 2;

  const cleanup = (): void => {
    stopListeners.current?.();
    stopListeners.current = null;
    const held = captured.current;
    captured.current = null;
    if (held?.element.hasPointerCapture(held.pointerId) === true) held.element.releasePointerCapture(held.pointerId);
    dragRef.current = null;
    document.body.removeAttribute("data-reorder-dragging");
    setDrag(null);
  };
  useEffect(() => () => { stopListeners.current?.(); document.body.removeAttribute("data-reorder-dragging"); }, []);

  const begin = (event: PointerEvent<HTMLSpanElement>, index: number): void => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const source = items[index];
    const wrapper = source === undefined ? undefined : wrappers.current.get(getKey(source));
    if (wrapper === undefined) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    captured.current = { element: event.currentTarget, pointerId: event.pointerId };
    bounds.current = items.map((item) => {
      const rect = wrappers.current.get(getKey(item))?.getBoundingClientRect();
      return { bottom: (rect?.bottom ?? 0) + window.scrollY, top: (rect?.top ?? 0) + window.scrollY };
    });
    const rect = wrapper.getBoundingClientRect();
    const state: DragState = { from: index, grabOffset: event.clientY - rect.top, hover: index, pointerY: event.clientY, rect: { height: rect.height, left: rect.left, width: rect.width } };
    dragRef.current = state;
    setDrag(state);
    document.body.setAttribute("data-reorder-dragging", "");
    const onKey = (keyEvent: KeyboardEvent): void => { if (keyEvent.key === "Escape") cleanup(); };
    const onContextMenu = (menuEvent: Event): void => { menuEvent.preventDefault(); cleanup(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContextMenu);
    stopListeners.current = () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  };
  const move = (event: PointerEvent<HTMLSpanElement>): void => {
    const current = dragRef.current;
    if (current === null) return;
    const next: DragState = { ...current, hover: hoverIndexAt(bounds.current, event.clientY + window.scrollY), pointerY: event.clientY };
    dragRef.current = next;
    setDrag(next);
  };
  const finish = (): void => {
    const current = dragRef.current;
    if (current === null) return;
    cleanup();
    if (current.hover !== current.from) onMove(current.from, current.hover);
  };
  const keyMove = (event: ReactKeyboardEvent<HTMLSpanElement>, index: number, key: string): void => {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const target = index + delta;
    if (delta === 0 || target < 0 || target >= items.length) return;
    event.preventDefault();
    onMove(index, target);
    const handle = event.currentTarget;
    window.requestAnimationFrame(() => { if (!handle.isConnected) document.querySelector<HTMLElement>(`[data-reorder-handle="${CSS.escape(key)}"]`)?.focus(); });
  };

  const handleFor = (item: T, index: number): ReactNode => {
    if (!reorderable) return null;
    const key = getKey(item);
    const dragging = drag?.from === index;
    return (
      <span role="button" tabIndex={0} aria-label="Arrastrar para reordenar" title="Arrastrar para reordenar (o usa las flechas arriba y abajo)"
        data-reorder-handle={key}
        onPointerDown={(event) => begin(event, index)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cleanup}
        onKeyDown={(event) => keyMove(event, index, key)}
        className={`inline-flex min-h-11 w-6 shrink-0 select-none items-center justify-center self-center rounded-md border [touch-action:none] focus-visible:outline-2 focus-visible:outline-accent ${dragging ? "cursor-grabbing border-accent bg-accent-soft text-accent-hover" : "cursor-grab border-border bg-surface text-text-muted hover:border-accent hover:text-accent"}`}>
        <svg aria-hidden="true" viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
          <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
          <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
          <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
        </svg>
      </span>
    );
  };

  const preview = drag === null ? null : tentativeOrder(items, drag.from, drag.hover);
  const itemAfterGap = drag === null || preview === null ? undefined : preview[drag.hover + 1];
  const afterGapKey = itemAfterGap === undefined ? null : getKey(itemAfterGap);
  const gap = (height: number): ReactNode => (
    <div aria-hidden="true" data-reorder-gap="" style={{ height }} className="rounded-xl border-2 border-dashed border-accent bg-accent-soft/40" />
  );

  const rows: ReactNode[] = [];
  items.forEach((item, index) => {
    const key = getKey(item);
    const gapHere = drag !== null && afterGapKey === key;
    const lifted = drag?.from === index;
    rows.push(
      <div key={key} ref={(element) => { if (element === null) wrappers.current.delete(key); else wrappers.current.set(key, element); }}
        style={lifted && drag !== null ? { height: undefined, left: drag.rect.left, pointerEvents: "none", position: "fixed", top: drag.pointerY - drag.grabOffset, width: drag.rect.width, zIndex: 50 } : undefined}
        className={lifted ? "flex flex-col gap-3 opacity-60 shadow-xl" : "flex flex-col gap-3"}>
        {gapHere && drag !== null ? gap(drag.rect.height) : null}
        {renderRow(item, index, handleFor(item, index))}
      </div>,
    );
  });

  return <div role="group" aria-label={label} className={className}>{rows}{drag !== null && afterGapKey === null ? gap(drag.rect.height) : null}</div>;
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
