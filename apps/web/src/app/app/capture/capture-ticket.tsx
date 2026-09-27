"use client";

import { useState } from "react";
import type { CaptureSelectionPlanProjectionV1 } from "@super-restaurant/shared-types";

const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const qtyButton = "min-h-10 min-w-10 rounded-lg border border-border bg-surface text-lg font-bold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

interface CaptureTicketProps {
  readonly projection: CaptureSelectionPlanProjectionV1 | null;
  readonly busyLineId: string | undefined;
  readonly locked: boolean;
  readonly onIncrement: (lineId: string) => void;
  readonly onDecrement: (lineId: string) => void;
  readonly onRemove: (lineId: string) => void;
  readonly onHold: () => void;
  readonly onNoSale: () => void;
}

/** Fixed ticket (desktop sidebar) / bottom sheet (mobile) painting only server-priced amounts. */
export function CaptureTicket({ projection, busyLineId, locked, onIncrement, onDecrement, onRemove, onHold, onNoSale }: CaptureTicketProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const lineCount = projection?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;

  const body = <>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {projection === null || projection.lines.length === 0
        ? <p className="p-4 text-center text-sm text-text-muted">Toca un producto del menú para agregarlo.</p>
        : <ul className="grid gap-3">{projection.lines.map((line) => <li key={line.lineId}
          className="grid gap-1 border-b border-dashed border-border pb-3">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{line.productName}</span>
            <span className="whitespace-nowrap font-semibold">{money(line.lineTotalMinor, projection.currency)}</span>
          </div>
          {line.modifiers.length > 0 && <span className="text-xs text-text-muted">
            {line.modifiers.map((modifier) => `${modifier.quantity} × ${modifier.name}`).join(" · ")}
          </span>}
          {line.note !== null && <span className="text-xs font-semibold text-accent">Nota: {line.note}</span>}
          <div className="mt-1 flex items-center gap-2">
            <button type="button" className={qtyButton} aria-label={`Menos ${line.productName}`}
              disabled={locked || busyLineId === line.lineId} onClick={() => onDecrement(line.lineId)}>−</button>
            <span className="min-w-8 text-center font-semibold">{line.quantity}</span>
            <button type="button" className={qtyButton} aria-label={`Más ${line.productName}`}
              disabled={locked || busyLineId === line.lineId} onClick={() => onIncrement(line.lineId)}>+</button>
            <span className="grow" />
            <button type="button" className={`${button} text-error`} aria-label={`Quitar línea de ${line.productName}`}
              disabled={locked || busyLineId === line.lineId} onClick={() => onRemove(line.lineId)}>Quitar</button>
          </div>
        </li>)}</ul>}
    </div>
    <div className="grid gap-1 border-t border-border p-3 text-sm">
      <div className="flex justify-between"><span>Subtotal</span><span>{projection === null ? money(0, "MXN") : money(projection.subtotalMinor, projection.currency)}</span></div>
      <div className="mt-1 flex justify-between font-heading text-lg font-bold"><span>Total</span>
        <span>{projection === null ? money(0, "MXN") : money(projection.subtotalMinor, projection.currency)}</span></div>
    </div>
    <div className="grid gap-2 p-3 pt-0">
      <button type="button" className={button} disabled={locked} onClick={onHold}>⏸ Dejar en espera</button>
      <button type="button" className={`${button} text-error`} disabled={locked} onClick={onNoSale}>Sin venta</button>
    </div>
  </>;

  return <>
    <aside aria-label="Resumen del pedido" className="hidden min-h-0 w-full flex-col border-l border-border bg-surface sm:flex sm:w-90 sm:max-w-90 sm:shrink-0">
      {body}
    </aside>
    <div className="sticky bottom-0 z-[5] flex items-center gap-3 border-t border-border bg-surface p-3 sm:hidden">
      <div className="grid flex-1">
        <span className="text-xs text-text-muted">{lineCount} producto{lineCount === 1 ? "" : "s"}</span>
        <strong className="font-heading text-lg">{projection === null ? money(0, "MXN") : money(projection.subtotalMinor, projection.currency)}</strong>
      </div>
      <button type="button" className={button} onClick={() => setMobileOpen(true)}>Ver pedido</button>
    </div>
    {mobileOpen && <div className="fixed inset-0 z-20 flex items-end bg-[oklch(10%_0.02_250_/_.45)] sm:hidden"
      role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setMobileOpen(false); }}>
      <div className="flex max-h-[80dvh] w-full flex-col rounded-t-2xl bg-surface">
        <header className="flex items-center gap-2 border-b border-border p-4">
          <h2 className="font-heading text-lg font-semibold">Pedido</h2>
          <span className="grow" />
          <button type="button" className={button} aria-label="Cerrar" onClick={() => setMobileOpen(false)}>✕</button>
        </header>
        {body}
      </div>
    </div>}
  </>;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { currency, style: "currency" }).format(amountMinor / 100);
}
