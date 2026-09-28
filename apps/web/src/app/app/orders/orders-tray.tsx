"use client";

import { useEffect, useRef, useState } from "react";
import type { BranchOrderWorkChannelV1, BranchOrderWorkItemV1, BranchOrderWorkTrayV1, BranchScope } from "@super-restaurant/shared-types";
import {
  channelLabel,
  formatOrderWorkTime,
  formatOrderWorkTotal,
  isPayableBranchOrderWorkStatus,
  preparationLabel,
  shouldApplyBranchOrderWorkTrayResponse,
  type BranchOrderTrayRequestResult,
  type BranchOrderWorkFilter,
} from "../../../lib/branch-order-work-tray";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const chip = "min-h-11 rounded-full border border-border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent";
const errors = { denied: "Tu sesión o rol ya no permite ver las órdenes de esta sucursal.",
  invalid: "No se pudo leer la sucursal seleccionada.", unavailable: "No se pudo confirmar el resultado. Intenta actualizar." } as const;

const filters: readonly { readonly value: BranchOrderWorkFilter; readonly label: string }[] = [
  { label: "Todas", value: "all" }, { label: "Mesa", value: "table" }, { label: "Mostrador", value: "counter" },
  { label: "Para llevar", value: "takeout" }, { label: "Domicilio", value: "delivery" },
];

const LIMIT = 25;

interface Props {
  readonly scope: BranchScope;
  readonly action: (input: unknown) => Promise<BranchOrderTrayRequestResult>;
  /** Server-computed from the actor's own membership roles; the client never decides this. */
  readonly canCheckout: boolean;
}

export function OrdersTray({ scope, action, canCheckout }: Props) {
  const [items, setItems] = useState<readonly BranchOrderWorkItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<BranchOrderWorkTrayV1["nextCursor"]>(null);
  const [filter, setFilter] = useState<BranchOrderWorkFilter>("all");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof errors>();
  const cursorRef = useRef<BranchOrderWorkTrayV1["nextCursor"]>(null);
  const requestSeqRef = useRef(0);

  async function load(cursor: BranchOrderWorkTrayV1["nextCursor"], replace: boolean, channel: BranchOrderWorkChannelV1 | null) {
    const requestSeq = ++requestSeqRef.current;
    setBusy(true); setError(undefined);
    let result: BranchOrderTrayRequestResult;
    try { result = await action({ channel, cursor, limit: LIMIT, schemaVersion: 1, scope }); }
    catch { result = { error: "unavailable", ok: false }; }
    if (!shouldApplyBranchOrderWorkTrayResponse({ cursor, replace, requestSeq }, requestSeqRef.current, cursorRef.current)) return;
    if (!result.ok) setError(result.error);
    else {
      setItems((current) => replace ? result.value.items : [...current, ...result.value.items]);
      setNextCursor(result.value.nextCursor);
      cursorRef.current = result.value.nextCursor;
      setLoaded(true);
    }
    setBusy(false);
  }

  function refresh(): void { void load(null, true, filter === "all" ? null : filter); }

  useEffect(() => { refresh(); }, [filter]);

  useEffect(() => {
    function onVisibilityChange(): void { if (document.visibilityState === "visible") refresh(); }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [filter]);

  return <section className={panel}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por canal">
        {filters.map((entry) => <button key={entry.value} type="button"
          className={`${chip} ${filter === entry.value ? "border-accent bg-accent text-white" : ""}`}
          aria-pressed={filter === entry.value} onClick={() => setFilter(entry.value)}>{entry.label}</button>)}
      </div>
      <button type="button" className={button} disabled={busy} onClick={refresh}>Actualizar</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{errors[error]}</p>}
    {!loaded ? <p className="mt-4 text-sm text-text-muted">Cargando órdenes…</p> : items.length === 0
      ? <p className="mt-4 text-sm text-text-muted">No hay órdenes activas para este filtro.</p>
      : <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((order) => <OrderCard key={order.orderId} order={order} canCheckout={canCheckout} />)}</ul>}
    {nextCursor !== null && <div className="mt-4">
      <button type="button" className={button} disabled={busy}
        onClick={() => void load(nextCursor, false, filter === "all" ? null : filter)}>Cargar más</button>
    </div>}
  </section>;
}

function OrderCard({ order, canCheckout }: { readonly order: BranchOrderWorkItemV1; readonly canCheckout: boolean }) {
  return <li className="rounded-xl border border-border bg-bg p-4">
    <div className="flex items-start justify-between gap-2">
      <div>
        <strong className="block">{channelLabel(order.channel)}</strong>
        <span className="block text-xs text-text-muted">{formatOrderWorkTime(order.createdAt)} · {preparationLabel(order.preparation)}</span>
      </div>
      <span className="text-right font-semibold">{formatOrderWorkTotal(order.totals.totalMinor, order.totals.currency)}</span>
    </div>
    {order.customerLabel !== null && <p className="mt-2 text-sm">{order.customerLabel}</p>}
    {order.addressLabel !== null && <p className="text-xs text-text-muted">{order.addressLabel}</p>}
    <p className="mt-2 text-xs text-text-muted">
      {order.lineCount} {order.lineCount === 1 ? "línea" : "líneas"}
      {order.hasNotes && " · con nota"}
      {order.paymentIntent !== null && ` · pago ${order.paymentIntent.method === "cash" ? "efectivo" : order.paymentIntent.method === "card_manual" ? "tarjeta" : "transferencia"}`}
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      {canCheckout && isPayableBranchOrderWorkStatus(order.status)
        ? <a href={`/app/caja?orderId=${order.orderId}`} className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent">
          Cobrar en caja
        </a>
        : <span className="flex min-h-11 items-center text-sm text-text-muted">
          {isPayableBranchOrderWorkStatus(order.status) ? "Cuenta abierta" : "Aún en borrador, sin cuenta que cobrar"}
        </span>}
    </div>
  </li>;
}
