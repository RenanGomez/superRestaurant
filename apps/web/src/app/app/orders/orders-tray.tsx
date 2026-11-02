"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { BranchOrderWorkChannelV1, BranchOrderWorkItemV1, BranchOrderWorkTrayV1, BranchScope } from "@super-restaurant/shared-types";
import {
  channelLabel,
  formatOrderWorkTime,
  formatMinorUnits,
  isPayableBranchOrderWorkStatus,
  preparationLabel,
  shouldApplyBranchOrderWorkTrayResponse,
  type BranchOrderTrayRequestResult,
  type BranchOrderWorkFilter,
} from "../../../lib/branch-order-work-tray";
import { CancelledTray } from "./cancelled-tray";
import { OrderDetailPanel, type OrderDetailActions } from "./order-detail-panel";
import type { CancelledTrayRequestResult } from "../../../lib/order-cancellation";
import type { PrintHeader } from "../../../lib/print-documents";
import { ordersHref, ordersOrderId, ordersView, tableLabel } from "../../../lib/orders-view";
import { uiButton, uiChip } from "../../../lib/ui-classes";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = uiButton();
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
  readonly printHeader: PrintHeader;
  readonly detailActions: OrderDetailActions;
  readonly cancelledAction: (input: unknown) => Promise<CancelledTrayRequestResult>;
  /** Read once per page load to name table orders; any failure keeps the generic «Mesa». */
  readonly tableNamesAction: () => Promise<readonly { readonly tableId: string; readonly name: string }[] | undefined>;
}

export function OrdersTray({ scope, action, cancelledAction, tableNamesAction, canCheckout, detailActions, printHeader }: Props) {
  const [items, setItems] = useState<readonly BranchOrderWorkItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<BranchOrderWorkTrayV1["nextCursor"]>(null);
  const [filter, setFilter] = useState<BranchOrderWorkFilter>("all");
  const [view, setView] = useState<"active" | "cancelled">("active");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof errors>();
  // The view lives in the URL (?orderId=…&addItem=1). Changes use history.replaceState, which Next
  // syncs into useSearchParams without a server round trip and without growing the history, so
  // Back still leaves Órdenes.
  const searchParams = useSearchParams();
  const openOrderId = ordersOrderId(searchParams);
  const currentView = ordersView(searchParams);
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);
  const [tableNames, setTableNames] = useState<ReadonlyMap<string, string>>();
  // One read of the floor plan per page load; failure leaves the generic «Mesa».
  useEffect(() => {
    let cancelled = false;
    void tableNamesAction().then((entries) => {
      if (!cancelled && entries !== undefined) setTableNames(new Map(entries.map((entry) => [entry.tableId, entry.name])));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  function navigate(orderId: string | undefined, adding: boolean): void {
    window.history.replaceState(null, "", ordersHref(orderId, adding));
  }
  const open = openOrderId !== undefined;
  const adding = currentView === "adding";
  const cursorRef = useRef<BranchOrderWorkTrayV1["nextCursor"]>(null);
  const requestSeqRef = useRef(0);

  async function load(cursor: BranchOrderWorkTrayV1["nextCursor"], replace: boolean, channel: BranchOrderWorkChannelV1 | null) {
    const requestSeq = ++requestSeqRef.current;
    // A "replace" (filter change or "Actualizar") clears the previous filter's results and cursor
    // immediately, instead of leaving them on screen -- possibly stale or under the wrong filter --
    // until the new page (or an error) arrives.
    if (replace) { setItems([]); setNextCursor(null); cursorRef.current = null; setLoaded(false); }
    setBusy(true); setError(undefined);
    let result: BranchOrderTrayRequestResult;
    try { result = await action({ channel, cursor, limit: LIMIT, schemaVersion: 1, scope }); }
    catch { result = { error: "unavailable", ok: false }; }
    if (!shouldApplyBranchOrderWorkTrayResponse({ cursor, replace, requestSeq }, requestSeqRef.current, cursorRef.current)) return;
    if (!result.ok) { setError(result.error); if (replace) setLoaded(true); }
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

  const listPanel = <section className={`${panel} ${open ? "lg:h-full lg:overflow-y-auto" : ""}`}>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Vista de órdenes">
      {([["active", "Activas"], ["cancelled", "Canceladas"]] as const).map(([value, label]) => <button key={value} type="button"
        className={uiChip(view === value)}
        aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}
    </div>
    {view === "cancelled" && <CancelledTray scope={scope} action={cancelledAction} onOpenDetail={(id) => navigate(id, false)} compact={open} selectedOrderId={openOrderId} />}
    {view === "active" && <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por canal">
        {filters.map((entry) => <button key={entry.value} type="button"
          className={uiChip(filter === entry.value)}
          aria-pressed={filter === entry.value} onClick={() => setFilter(entry.value)}>{entry.label}</button>)}
      </div>
      <button type="button" className={button} disabled={busy} onClick={refresh}>Actualizar</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{errors[error]}</p>}
    {!loaded ? <p className="mt-4 text-sm text-text-muted">Cargando órdenes…</p>
      : items.length === 0 && error !== undefined
        ? <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-muted">No se pudieron cargar las órdenes.</p>
          <button type="button" className={button} onClick={refresh}>Reintentar</button>
        </div>
        : items.length === 0
          ? <p className="mt-4 text-sm text-text-muted">No hay órdenes activas para este filtro.</p>
          : <ul className={`mt-4 grid gap-3 ${open ? "" : "sm:grid-cols-2 xl:grid-cols-3"}`}>{items.map((order) => <OrderCard key={order.orderId} order={order} canCheckout={canCheckout} tableNames={tableNames}
            selected={order.orderId === openOrderId} compact={open} onOpenDetail={() => navigate(order.orderId, false)} />)}</ul>}
    {nextCursor !== null && <div className="mt-4">
      <button type="button" className={button} disabled={busy}
        onClick={() => void load(nextCursor, false, filter === "all" ? null : filter)}>Cargar más</button>
    </div>}
    </>}
  </section>;

  if (!open) return listPanel;
  return <div className="flex flex-col gap-4 lg:grid lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem] lg:grid-cols-[2fr_3fr]">
    <div className={`min-h-0 ${adding ? "hidden lg:block" : ""} lg:h-full`}>
      <OrderDetailPanel
        key={openOrderId}
        orderId={openOrderId}
        tableNames={tableNames}
        adding={adding}
        onAddingChange={(next) => navigate(openOrderId, next)}
        menuSlot={menuSlot}
        actions={detailActions}
        canCheckout={canCheckout}
        printHeader={printHeader}
        onClose={() => navigate(undefined, false)}
        onChanged={refresh}
      />
    </div>
    {adding
      ? <div ref={setMenuSlot} className="h-[calc(100dvh-9rem)] min-h-0 lg:h-full" />
      : <div className="hidden min-h-0 lg:block lg:h-full">{listPanel}</div>}
  </div>;
}

function OrderCard({ order, canCheckout, tableNames, selected, compact, onOpenDetail }: {
  readonly order: BranchOrderWorkItemV1;
  readonly tableNames: ReadonlyMap<string, string> | undefined;
  readonly canCheckout: boolean;
  readonly selected: boolean;
  readonly compact: boolean;
  readonly onOpenDetail: () => void;
}) {
  const headline = order.channel === "table"
    ? tableLabel(order.tableId, tableNames, order.accountLabel)
    : order.accountLabel !== null && order.accountLabel.trim().length > 0
      ? `${channelLabel(order.channel)} · ${order.accountLabel.trim()}`
      : channelLabel(order.channel);

  return <li className={`rounded-xl ${selected ? "border-2 border-selected bg-surface" : "border border-border bg-bg"} ${compact ? "p-3" : "p-4"}`} aria-current={selected ? "true" : undefined}>
    <div className="flex items-start justify-between gap-2">
      <div>
        <strong className="block">{headline}</strong>
        <span className="block text-xs text-text-muted">{formatOrderWorkTime(order.createdAt, order.timeZone)} · {preparationLabel(order.preparation)}</span>
      </div>
      <span className="text-right font-semibold">{formatMinorUnits(order.totals.totalMinor, order.totals.currency)}</span>
    </div>
    {order.customerLabel !== null && <p className="mt-2 text-sm">{order.customerLabel}</p>}
    {order.addressLabel !== null && <p className="text-xs text-text-muted">{order.addressLabel}</p>}
    <p className="mt-2 text-xs text-text-muted">
      {order.lineCount} {order.lineCount === 1 ? "línea" : "líneas"}
      {order.hasNotes && " · con nota"}
      {order.paymentIntent !== null && ` · pago ${order.paymentIntent.method === "cash" ? "efectivo" : order.paymentIntent.method === "card_manual" ? "tarjeta" : "transferencia"}`}
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={uiButton()} onClick={onOpenDetail}>
        Detalle
      </button>
      {canCheckout && isPayableBranchOrderWorkStatus(order.status)
        ? <Link href={`/app/caja?orderId=${order.orderId}`} className={uiButton()}>
          Cobrar en caja
        </Link>
        : <span className="flex min-h-11 items-center text-sm text-text-muted">
          {isPayableBranchOrderWorkStatus(order.status) ? "Cuenta abierta" : "Aún en borrador, sin cuenta que cobrar"}
        </span>}
    </div>
  </li>;
}
