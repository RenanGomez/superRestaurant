"use client";

import { useEffect, useRef, useState } from "react";
import type { BranchScope, CancelledWorkCursorV1, CancelledWorkItemV1 } from "@super-restaurant/shared-types";
import { uiButton } from "../../../lib/ui-classes";
import {
  CANCELLED_TRAY_LIMIT,
  cancelledItemKey,
  cancelledItemActorLabel,
  cancelledItemRefundLabel,
  cancelledItemTime,
  cancelledItemTitle,
  cancelledItemTotalLabel,
  mergeCancelledItems,
  type CancelledTrayRequestResult,
} from "../../../lib/order-cancellation";

const button = uiButton();
const errors = {
  denied: "Tu sesión o rol ya no permite ver las canceladas de esta sucursal.",
  invalid: "No se pudo leer la sucursal seleccionada.",
  unavailable: "No se pudo confirmar el resultado. Intenta actualizar.",
} as const;

interface Props {
  readonly scope: BranchScope;
  readonly action: (input: unknown) => Promise<CancelledTrayRequestResult>;
  readonly onOpenDetail: (orderId: string) => void;
}

/** "Canceladas": cancelled orders and closed captures, newest first, paged by the server's cursor. */
export function CancelledTray({ scope, action, onOpenDetail }: Props) {
  const [items, setItems] = useState<readonly CancelledWorkItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<CancelledWorkCursorV1 | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof errors>();
  const seqRef = useRef(0);
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  async function load(cursor: CancelledWorkCursorV1 | null, replace: boolean): Promise<void> {
    const seq = ++seqRef.current;
    if (replace) { setItems([]); setNextCursor(null); setLoaded(false); }
    setBusy(true); setError(undefined);
    let result: CancelledTrayRequestResult;
    try { result = await action({ cursor, limit: CANCELLED_TRAY_LIMIT, schemaVersion: 1, scope }); }
    catch { result = { error: "unavailable", ok: false }; }
    if (seq !== seqRef.current) return;
    if (!result.ok) { setError(result.error); if (replace) setLoaded(true); }
    else {
      setItems((current) => replace ? result.value.items : mergeCancelledItems(current, result.value.items));
      setNextCursor(result.value.nextCursor);
      setLoaded(true);
    }
    setBusy(false);
  }

  useEffect(() => { void load(null, true); }, []);

  return <div>
    <div className="flex justify-end">
      <button type="button" className={button} disabled={busy} onClick={() => void load(null, true)}>Actualizar</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{errors[error]}</p>}
    {!loaded ? <p className="mt-4 text-sm text-text-muted">Cargando canceladas…</p>
      : items.length === 0
        ? error !== undefined
          ? <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-text-muted">No se pudieron cargar las canceladas.</p>
            <button type="button" className={button} onClick={() => void load(null, true)}>Reintentar</button>
          </div>
          : <p className="mt-4 text-sm text-text-muted">No hay órdenes ni capturas canceladas.</p>
        : <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <CancelledCard key={cancelledItemKey(item)}
          item={item} timeZone={timeZone} onOpenDetail={onOpenDetail} />)}</ul>}
    {nextCursor !== null && <div className="mt-4">
      <button type="button" className={button} disabled={busy} onClick={() => void load(nextCursor, false)}>Cargar más</button>
    </div>}
  </div>;
}

function CancelledCard({ item, timeZone, onOpenDetail }: {
  readonly item: CancelledWorkItemV1;
  readonly timeZone: string;
  readonly onOpenDetail: (orderId: string) => void;
}) {
  const refund = cancelledItemRefundLabel(item);
  const total = cancelledItemTotalLabel(item);
  return <li className="rounded-xl border border-border bg-bg p-4">
    <div className="flex items-start justify-between gap-2">
      <div>
        <strong className="block">{cancelledItemTitle(item)}</strong>
        <span className="block text-xs text-text-muted">{cancelledItemTime(item, timeZone)}</span>
      </div>
      {total !== undefined && <span className="text-right font-semibold">{total}</span>}
    </div>
    {item.kind === "order" && item.customerLabel !== null && <p className="mt-2 text-sm">{item.customerLabel}</p>}
    <p className="mt-2 text-sm"><span className="font-semibold">Motivo:</span> {item.reason}</p>
    <p className="mt-1 text-xs text-text-muted">{cancelledItemActorLabel(item)}</p>
    {item.kind === "order" && <p className="mt-1 text-xs text-text-muted">{item.lineCount} {item.lineCount === 1 ? "línea" : "líneas"}</p>}
    {refund !== undefined && <p role="status" className="mt-2 rounded-lg border border-border bg-surface p-2 text-sm font-semibold">{refund}</p>}
    {item.kind === "order" && <div className="mt-3">
      <button type="button" className={button} onClick={() => onOpenDetail(item.orderId)}>Detalle</button>
    </div>}
  </li>;
}
