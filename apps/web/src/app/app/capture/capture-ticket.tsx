"use client";

import { useEffect, useRef, useState } from "react";
import type { CaptureSelectionPlanProjectionV1, MenuCatalogV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { halfTicketLines } from "../../../lib/line-halves";
import { variantNameFor } from "../../../lib/menu-variants";
import { uiButton } from "../../../lib/ui-classes";

const button = uiButton();
const dangerButton = uiButton("danger");
const qtyButton = "min-h-10 min-w-10 rounded-lg border border-border bg-surface text-lg font-bold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

interface CaptureTicketProps {
  readonly projection: CaptureSelectionPlanProjectionV1 | null;
  readonly catalog: MenuCatalogV1 | null;
  readonly busyLineId: string | undefined;
  readonly locked: boolean;
  readonly onIncrement: (lineId: string) => void;
  readonly onDecrement: (lineId: string) => void;
  readonly onRemove: (lineId: string) => void;
  readonly onEditNote: (lineId: string, currentNote: string | null) => void;
  readonly onEdit: (lineId: string) => void;
  readonly onHold: () => void;
  readonly onNoSale: () => void;
  /** Mobile only: leaves the ticket sheet and continues with the customer step. */
  readonly onContinue?: () => void;
}

/** Fixed ticket (desktop sidebar) / bottom sheet (mobile) painting only server-priced amounts. */
export function CaptureTicket({ projection, catalog, busyLineId, locked, onIncrement, onDecrement, onRemove, onEditNote, onEdit, onHold, onNoSale, onContinue }: CaptureTicketProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lineCount = projection?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
  // Both amounts are server-priced: `subtotalMinor` is tax-exclusive and `itemsTotalMinor` is the
  // tax-inclusive total of the products only -- it never includes the delivery fee, so it is not
  // the order total. Never summed locally.
  const totalMinor = projection?.itemsTotalMinor ?? 0;
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); setMobileOpen(false); return; }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [mobileOpen]);

  const body = <>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {projection === null || projection.lines.length === 0
        ? <p className="p-4 text-center text-sm text-text-muted">Toca un producto del menú para agregarlo.</p>
        : <ul className="grid gap-3">{projection.lines.map((line) => <li key={line.lineId}
          className="grid gap-1 border-b border-dashed border-border pb-3">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{line.productName}{line.variantId === null ? "" : ` · ${variantNameFor(catalog, line.productId, line.variantId)}`}</span>
            <span className="shrink-0 whitespace-nowrap font-semibold">{formatMinorUnits(line.lineTotalMinor, projection.currency)}</span>
          </div>
          {(line.halves ?? []).length > 0 && <ul className="grid gap-1 text-sm" aria-label="Mitades">
            {(line.halves ?? []).map((half) => {
              const lines = halfTicketLines(half);
              return <li key={half.fraction}><span className="font-semibold">{lines.title}</span>
                {lines.details.length > 0 && <ul className="text-xs text-text-muted">{lines.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
              </li>;
            })}
          </ul>}
          {line.modifiers.length > 0 && <span className="text-xs text-text-muted">
            {line.modifiers.map((modifier) => `${modifier.quantity} × ${modifier.name}`).join(" · ")}
          </span>}
          {line.note !== null && <span className="text-xs font-semibold text-accent">Nota: {line.note}</span>}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button type="button" className={button} disabled={locked || busyLineId === line.lineId}
              onClick={() => { setMobileOpen(false); onEdit(line.lineId); }}>Editar</button>
            <button type="button" className={qtyButton} aria-label={`Menos ${line.productName}`}
              disabled={locked || busyLineId === line.lineId} onClick={() => onDecrement(line.lineId)}>−</button>
            <span className="min-w-8 text-center font-semibold">{line.quantity}</span>
            <button type="button" className={qtyButton} aria-label={`Más ${line.productName}`}
              disabled={locked || busyLineId === line.lineId} onClick={() => onIncrement(line.lineId)}>+</button>
            <button type="button" className={button} aria-label={`Nota para ${line.productName}`}
              disabled={locked || busyLineId === line.lineId}
              onClick={() => { setMobileOpen(false); onEditNote(line.lineId, line.note); }}>
              {line.note !== null ? "Editar nota" : "Nota"}
            </button>
            <span className="grow basis-0" />
            <button type="button" className={dangerButton} aria-label={`Quitar línea de ${line.productName}`}
              disabled={locked || busyLineId === line.lineId} onClick={() => onRemove(line.lineId)}>Quitar</button>
          </div>
        </li>)}</ul>}
    </div>
    <div className="grid gap-1 border-t border-border p-3 text-sm">
      <div className="flex justify-between"><span>Subtotal</span><span>{projection === null ? formatMinorUnits(0, "MXN") : formatMinorUnits(projection.subtotalMinor, projection.currency)}</span></div>
      <div className="mt-1 flex justify-between font-heading text-lg font-bold"><span>Total de productos</span>
        <span>{formatMinorUnits(totalMinor, projection === null ? "MXN" : projection.currency)}</span></div>
    </div>
    <div className="grid gap-2 p-3 pt-0">
      <button type="button" className={button} disabled={locked} onClick={onHold}>Guardar para después<span className="block text-xs font-normal">Se conserva para retomarla</span></button>
      <button type="button" className={dangerButton} disabled={locked} onClick={onNoSale}>Cancelar<span className="block text-xs font-normal">Queda registrada como cancelada</span></button>
    </div>
  </>;

  return <>
    <aside aria-label="Resumen del pedido" className="hidden min-h-0 w-full flex-col border-l border-border bg-surface sm:flex sm:w-90 sm:max-w-90 sm:shrink-0">
      {body}
    </aside>
    {/* Floats above the R1 bottom nav (4rem) plus its safe-area inset. */}
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-border bg-surface p-3 shadow-[0_-4px_12px_oklch(10%_0.02_250_/_.12)] sm:hidden">
      <div className="flex flex-1 items-baseline gap-2">
        <span className="text-xs text-text-muted">{lineCount} producto{lineCount === 1 ? "" : "s"}</span>
        <span className="grow basis-0" />
        <span className="text-xs text-text-muted">Total de productos</span>
        <strong className="font-heading text-lg">{formatMinorUnits(totalMinor, projection === null ? "MXN" : projection.currency)}</strong>
      </div>
      <button type="button" className={button} onClick={() => setMobileOpen(true)}>Ver pedido</button>
    </div>
    {mobileOpen && <div ref={dialogRef} className="fixed inset-0 z-40 flex items-end bg-[oklch(10%_0.02_250_/_.45)] sm:hidden"
      role="dialog" aria-modal="true" aria-labelledby="capture-ticket-sheet-title"
      onClick={(event) => { if (event.target === event.currentTarget) setMobileOpen(false); }}>
      <div className="flex max-h-[80dvh] w-full flex-col rounded-t-2xl bg-surface">
        <header className="flex items-center gap-2 border-b border-border p-4">
          <h2 id="capture-ticket-sheet-title" className="font-heading text-lg font-semibold">Pedido</h2>
          <span className="grow basis-0" />
          <button ref={closeButtonRef} type="button" className={button} aria-label="Cerrar" onClick={() => setMobileOpen(false)}>✕</button>
        </header>
        {body}
        {onContinue !== undefined && <div className="border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" className={`${button} w-full`} disabled={locked || lineCount === 0}
            onClick={() => { setMobileOpen(false); onContinue(); }}>Continuar con cliente</button>
        </div>}
      </div>
    </div>}
  </>;
}
