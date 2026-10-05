"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrderDetailV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { courierCollectionMessage, paymentMethodLabel } from "../../../lib/delivery-board";
import { halfTicketLines } from "../../../lib/line-halves";
import { nextFocusIndex } from "../../../lib/order-detail";
import { courierOrderDetailAction, type CourierOrderDetailResult } from "./actions";

const focusable = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const errors = {
  conflict: "El pedido cambió. Cierra y vuelve a abrir el detalle.",
  invalid: "No se pudo leer la solicitud.",
  not_found: "No se encontró el pedido.",
  unauthorized: "No tienes acceso a este pedido.",
  unavailable: "No se pudo cargar el pedido. Inténtalo de nuevo.",
} as const;

export function CourierOrderDetail({ orderId }: { readonly orderId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CourierOrderDetailResult>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const titleId = useId();

  function close(): void {
    requestIdRef.current += 1;
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function load(): Promise<void> {
    const requestId = ++requestIdRef.current;
    setOpen(true);
    setLoading(true);
    setResult(undefined);
    try {
      const next = await courierOrderDetailAction(orderId);
      if (requestIdRef.current === requestId) setResult(next);
    } catch {
      if (requestIdRef.current === requestId) setResult({ ok: false, error: "unavailable" });
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog?.querySelectorAll<HTMLElement>(focusable) ?? []);
      event.preventDefault();
      if (elements.length === 0) return;
      const current = elements.indexOf(document.activeElement as HTMLElement);
      elements[current < 0 ? (event.shiftKey ? elements.length - 1 : 0) : nextFocusIndex(elements.length, current, event.shiftKey)]?.focus();
    }
    dialog.addEventListener("keydown", onKeyDown);
    return () => dialog.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" onClick={() => void load()}
      className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      Ver pedido
    </button>
    {open && createPortal(<div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="presentation" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[100dvh] w-full min-w-0 flex-col bg-surface shadow-xl sm:max-w-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
          <h2 id={titleId} className="font-heading text-lg font-bold">Detalle del pedido</h2>
          <button type="button" onClick={close} className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">Cerrar</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && <p role="status">Cargando pedido…</p>}
          {!loading && result !== undefined && (result.ok
            ? <Detail detail={result.detail} capturedMinor={result.capturedMinor} remainingMinor={result.remainingMinor} />
            : <div role="alert" className="grid gap-3"><p>{errors[result.error]}</p><button type="button" onClick={() => void load()}
                className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold">Reintentar</button></div>)}
        </div>
      </div>
    </div>, document.body)}
  </>;
}

function Detail({ detail, capturedMinor, remainingMinor }: {
  readonly detail: OrderDetailV1;
  readonly capturedMinor: number;
  readonly remainingMinor: number;
}) {
  const money = (minor: number) => formatMinorUnits(minor, detail.totals.currency);
  const intent = detail.fulfillment.paymentIntent;
  const collection = courierCollectionMessage(intent?.method ?? null, remainingMinor);
  const deliverableItems = detail.items.filter((item) => item.status !== "cancelled");
  return <div className="grid gap-5 text-sm">
    <section className="grid gap-1 rounded-xl border border-border p-4">
      <h3 className="font-semibold">Entrega</h3>
      <p className="break-words">{detail.fulfillment.customerLabel ?? "Cliente sin nombre"}</p>
      <p className="break-words">{detail.fulfillment.addressLabel ?? "Dirección no disponible"}</p>
      {detail.fulfillment.deliveryInstructions && <p className="break-words text-text-muted">Indicaciones: {detail.fulfillment.deliveryInstructions}</p>}
    </section>
    <section aria-label="Líneas del pedido">
      <h3 className="font-semibold">Productos</h3>
      {deliverableItems.length === 0 ? <p className="mt-2 text-text-muted">Sin productos para entregar.</p> : <ul className="mt-2 grid gap-2">{deliverableItems.map((item) =>
        <li key={item.orderItemId} className="rounded-xl border border-border p-3">
          <div className="flex justify-between gap-3"><p className="font-semibold">{item.quantity} × {item.name}{item.variantName ? ` · ${item.variantName}` : ""}</p><span className="shrink-0">{money(item.lineTotalMinor)}</span></div>
          {(item.fractionBreakdown ?? []).length > 0 && <ul className="mt-1 text-text-muted">{item.fractionBreakdown?.map((half) => {
            const lines = halfTicketLines(half);
            return <li key={half.fraction}>{lines.title}{lines.details.length > 0 ? ` · ${lines.details.join(" · ")}` : ""}</li>;
          })}</ul>}
          {item.modifiers.length > 0 && <ul className="mt-1 text-text-muted">{item.modifiers.map((modifier) => <li key={modifier.modifierId}>{modifier.name} × {modifier.quantity}</li>)}</ul>}
          {item.note && <p className="mt-1 break-words text-text-muted">Nota: {item.note}</p>}
        </li>)}</ul>}
    </section>
    <section className="grid gap-2 rounded-xl border border-border p-4" aria-label="Importes">
      <p className="flex justify-between gap-2"><span>Total</span><strong>{money(detail.totals.totalMinor)}</strong></p>
      <p className="flex justify-between gap-2"><span>Pagado</span><strong>{money(capturedMinor)}</strong></p>
      {collection.kind === "cash"
        ? <p className="flex justify-between gap-2 rounded-lg bg-accent/10 p-3 text-base"><span className="font-bold">{collection.label}</span><strong>{money(remainingMinor)}</strong></p>
        : <p className="font-semibold">{collection.label}</p>}
      <p>Pago previsto: {intent === null ? "Sin definir" : paymentMethodLabel(intent.method)}{intent?.method === "cash" && intent.tenderedAmountMinor !== null ? ` · Recibe ${money(intent.tenderedAmountMinor)}` : ""}</p>
    </section>
  </div>;
}
