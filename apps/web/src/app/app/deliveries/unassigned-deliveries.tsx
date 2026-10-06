"use client";

import { useEffect, useRef, useState } from "react";
import type { BranchMemberV1, BranchOrderWorkItemV1, BranchOrderWorkTrayV1, BranchScope } from "@super-restaurant/shared-types";
import { formatMinorUnits, formatOrderWorkTime, shouldApplyBranchOrderWorkTrayResponse, type BranchOrderTrayRequestResult } from "../../../lib/branch-order-work-tray";
import { courierInitials, mergeUnassignedDeliveryPages, paymentMethodLabel, shouldContinueUnassignedDeliveryLoad } from "../../../lib/delivery-board";
import { CashierSubmitButton } from "../caja/submit-button";

type Cursor = BranchOrderWorkTrayV1["nextCursor"];
const button = "inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

export function UnassignedDeliveries({ action, assignAction, couriers, scope }: {
  readonly action: (input: unknown) => Promise<BranchOrderTrayRequestResult>;
  readonly assignAction: (formData: FormData) => Promise<void>;
  readonly couriers: readonly BranchMemberV1[];
  readonly scope: BranchScope;
}) {
  const [items, setItems] = useState<readonly BranchOrderWorkItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const cursorRef = useRef<Cursor>(null);
  const requestSeqRef = useRef(0);

  async function load(cursor: Cursor, replace: boolean): Promise<void> {
    const requestSeq = ++requestSeqRef.current;
    if (replace) {
      setItems([]); setNextCursor(null); cursorRef.current = null; setLoaded(false);
    }
    setBusy(true); setError(false);
    let visible = replace ? [] as readonly BranchOrderWorkItemV1[] : items;
    let requestedCursor = cursor;
    while (true) {
      let result: BranchOrderTrayRequestResult;
      try { result = await action({ channel: "delivery", cursor: requestedCursor, limit: 100, schemaVersion: 1, scope }); }
      catch { result = { error: "unavailable", ok: false }; }
      if (!shouldApplyBranchOrderWorkTrayResponse({ cursor: requestedCursor, replace, requestSeq }, requestSeqRef.current, cursorRef.current)) return;
      if (!result.ok) { setError(true); setLoaded(true); break; }
      visible = mergeUnassignedDeliveryPages(visible, result.value.items);
      setItems(visible);
      setNextCursor(result.value.nextCursor);
      cursorRef.current = result.value.nextCursor;
      setLoaded(true);
      if (!shouldContinueUnassignedDeliveryLoad(visible.length, result.value.nextCursor, requestedCursor)) break;
      requestedCursor = result.value.nextCursor;
    }
    setBusy(false);
  }

  function refresh(): void { void load(null, true); }
  useEffect(() => {
    refresh();
    function onVisibilityChange(): void { if (document.visibilityState === "visible") refresh(); }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      requestSeqRef.current++;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [scope.restaurantId, scope.branchId]);

  return <section aria-labelledby="col-unassigned" className="grid min-w-0 content-start gap-3 rounded-2xl border border-border bg-bg p-3">
    <h2 id="col-unassigned" className="flex items-center justify-between gap-2 px-1 font-heading text-[15px] font-semibold">
      Por asignar <span className="rounded-full bg-surface px-2.5 py-0.5 text-[12px] font-semibold text-text-muted">{items.length}</span>
    </h2>
    {error && <p role="alert" className="rounded-xl bg-error-bg p-3 text-[13px]">No se pudo cargar toda la lista. Reintenta.</p>}
    {!loaded && <p role="status" className="px-3 text-[13px] text-text-muted">Cargando entregas…</p>}
    {loaded && items.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[13px] text-text-muted">Nada por aquí.</p>}
    {items.map((order) => <article key={order.orderId} className="grid min-w-0 gap-2 rounded-xl border border-border bg-surface p-3.5 shadow-[0_4px_16px_oklch(20%_0.02_250_/_0.04)]">
      <div className="min-w-0"><p className="break-words text-[14px] font-semibold">{order.customerLabel ?? "—"}</p>
        <p className="break-words text-[12px] text-text-muted">{order.addressLabel ?? "—"}</p></div>
      <p className="text-[12px] text-text-muted">Pedido {formatOrderWorkTime(order.createdAt, order.timeZone)} · <span className="font-semibold text-text">{formatMinorUnits(order.totals.totalMinor, order.totals.currency)}</span></p>
      {order.status !== "paid" && order.paymentIntent !== null && <p className="text-[12px]"><span className="font-semibold">Pagará con:</span> {order.paymentIntent.method === "cash" && order.paymentIntent.tenderedAmountMinor !== null && order.paymentIntent.tenderedAmountMinor > 0
        ? `${paymentMethodLabel("cash")} · Recibe ${formatMinorUnits(order.paymentIntent.tenderedAmountMinor, order.totals.currency)}`
        : paymentMethodLabel(order.paymentIntent.method)}</p>}
      {order.status === "paid" && <p className="text-[12px]"><span className="font-semibold">Pagada</span></p>}
      {couriers.length === 0 ? <p className="text-[12px] text-text-muted">No hay repartidores activos; asigna el rol en Accesos.</p> : <div className="grid gap-1.5">
        <p className="text-[12px] font-semibold text-text-muted">Asignar a</p>
        <div className="flex flex-wrap gap-2">{couriers.map((courier) => {
          const name = courier.displayName ?? `Repartidor ${courier.userId.slice(0, 4)}`;
          return <form key={courier.userId} action={assignAction} onSubmit={(event) => {
            const form = event.currentTarget;
            (form.elements.namedItem("eventId") as HTMLInputElement).value = crypto.randomUUID();
            (form.elements.namedItem("idempotencyKey") as HTMLInputElement).value = crypto.randomUUID();
            (form.elements.namedItem("occurredAt") as HTMLInputElement).value = new Date().toISOString();
          }}>
            <input type="hidden" name="eventId" /><input type="hidden" name="idempotencyKey" /><input type="hidden" name="occurredAt" />
            <input type="hidden" name="orderId" value={order.orderId} /><input type="hidden" name="expectedVersion" value="0" />
            <input type="hidden" name="courierUserId" value={courier.userId} />
            <CashierSubmitButton idle={`${courierInitials(name)} · ${name}`} pending="Guardando…" tone="secondary" />
          </form>;
        })}</div></div>}
    </article>)}
    {error && <button type="button" className={button} disabled={busy} onClick={refresh}>Reintentar</button>}
    {nextCursor !== null && !error && <button type="button" className={button} disabled={busy} onClick={() => void load(nextCursor, false)}>Cargar más</button>}
  </section>;
}
