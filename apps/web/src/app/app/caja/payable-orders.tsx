"use client";

import { useRef, useState } from "react";
import type { BranchOrderWorkItemV1, BranchOrderWorkTrayV1, BranchScope } from "@super-restaurant/shared-types";
import {
  channelLabel, formatMinorUnits, formatOrderWorkTime, isPayableBranchOrderWorkStatus,
  type BranchOrderTrayRequestResult,
} from "../../../lib/branch-order-work-tray";
import { branchOrderWorkTrayAction } from "../orders/actions";

interface Props {
  readonly initial: BranchOrderTrayRequestResult | undefined;
  readonly scope: BranchScope;
  readonly selectedOrderId: string | undefined;
}

export function PayableOrders({ initial, scope, selectedOrderId }: Props) {
  const [items, setItems] = useState<readonly BranchOrderWorkItemV1[]>(initial?.ok ? initial.value.items : []);
  const [cursor, setCursor] = useState<BranchOrderWorkTrayV1["nextCursor"]>(initial?.ok ? initial.value.nextCursor : null);
  const [error, setError] = useState(initial === undefined || !initial.ok);
  const [busy, setBusy] = useState(false);
  const latestRequest = useRef(0);
  const payable = items.filter((item) => isPayableBranchOrderWorkStatus(item.status));

  async function load(replace: boolean) {
    if (busy) return;
    const request = ++latestRequest.current;
    setBusy(true);
    try {
      const result = await branchOrderWorkTrayAction({ channel: null, cursor: replace ? null : cursor, limit: 25, schemaVersion: 1, scope });
      if (request !== latestRequest.current) return;
      if (result.ok) {
        setItems((current) => replace ? result.value.items : [...current, ...result.value.items]);
        setCursor(result.value.nextCursor);
        setError(false);
      } else setError(true);
    } catch { if (request === latestRequest.current) setError(true); }
    finally { if (request === latestRequest.current) setBusy(false); }
  }

  return <div className="mt-4 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[12px] text-text-muted">Órdenes de esta sucursal listas para cobrar</p>
      <button type="button" onClick={() => void load(true)} disabled={busy} className="min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold disabled:opacity-50">Actualizar lista</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-[12px]">No se pudo cargar la lista. Intenta actualizar.</p>}
    {!error && payable.length === 0 && <p className="mt-3 rounded-lg bg-bg p-3 text-[12px] text-text-muted">No hay órdenes cobrables en esta página.</p>}
    <ul className="mt-3 grid min-w-0 gap-2">
      {payable.map((item) => <li key={item.orderId} className={`flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${item.orderId === selectedOrderId ? "border-accent bg-accent-soft" : "border-border bg-bg"}`}>
        <div className="min-w-0">
          <p className="break-words text-[13px] font-semibold">{item.customerLabel ?? `Orden ${item.orderId.slice(0, 8)}`}</p>
          <p className="break-words text-[12px] text-text-muted">{channelLabel(item.channel)} · {formatOrderWorkTime(item.createdAt, item.timeZone)} · {formatMinorUnits(item.totals.totalMinor, item.totals.currency)}</p>
        </div>
        <a href={`/app/caja?orderId=${encodeURIComponent(item.orderId)}`} className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-[13px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Cobrar</a>
      </li>)}
    </ul>
    {cursor !== null && <button type="button" onClick={() => void load(false)} disabled={busy} className="mt-3 min-h-11 rounded-lg border border-border px-4 text-[13px] font-semibold disabled:opacity-50">{busy ? "Cargando…" : "Cargar más"}</button>}
  </div>;
}
