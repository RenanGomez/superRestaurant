"use client";

import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import type { BranchOrderWorkItemV1, BranchOrderWorkTrayV1, BranchScope, OrderDetailV1 } from "@super-restaurant/shared-types";
import {
  channelLabel, formatMinorUnits, formatOrderWorkTime, isPayableBranchOrderWorkStatus,
  type BranchOrderTrayRequestResult,
} from "../../../lib/branch-order-work-tray";
import { tableLabel } from "../../../lib/orders-view";
import { branchOrderWorkTrayAction, orderDetailAction } from "../orders/actions";

interface Props {
  readonly initial: BranchOrderTrayRequestResult | undefined;
  readonly scope: BranchScope;
  readonly selectedOrderId: string | undefined;
  readonly tableNames?: Readonly<Record<string, string>> | undefined;
}

export function PayableOrders({ initial, scope, selectedOrderId, tableNames }: Props) {
  const [items, setItems] = useState<readonly BranchOrderWorkItemV1[]>(initial?.ok ? initial.value.items : []);
  const [cursor, setCursor] = useState<BranchOrderWorkTrayV1["nextCursor"]>(initial?.ok ? initial.value.nextCursor : null);
  const [error, setError] = useState(initial === undefined || !initial.ok);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, OrderDetailV1>>({});
  const [detailErrors, setDetailErrors] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const payable = items.filter((item) => isPayableBranchOrderWorkStatus(item.status));
  const namesMap = new Map(Object.entries(tableNames ?? {}));

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

  async function toggleExpand(orderId: string) {
    if (expandedId === orderId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(orderId);
    if (details[orderId] === undefined) {
      setLoadingId(orderId);
      setDetailErrors((current) => {
        const next = new Set(current);
        next.delete(orderId);
        return next;
      });
      try {
        const result = await orderDetailAction(orderId);
        if (result.ok) {
          setDetails((prev) => ({ ...prev, [orderId]: result.value }));
        } else {
          setDetailErrors((current) => new Set(current).add(orderId));
        }
      } catch (error) {
        unstable_rethrow(error);
        setDetailErrors((current) => new Set(current).add(orderId));
      } finally {
        setLoadingId((current) => (current === orderId ? null : current));
      }
    }
  }

  function getTitle(item: BranchOrderWorkItemV1): string {
    if (item.channel === "table") {
      return tableLabel(item.tableId ?? null, namesMap, item.accountLabel);
    }
    const trimmed = item.accountLabel?.trim();
    if (trimmed !== undefined && trimmed.length > 0) {
      return `${channelLabel(item.channel)} · ${trimmed}`;
    }
    return item.customerLabel ?? channelLabel(item.channel);
  }

  return (
    <div className="mt-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-text-muted">Órdenes de esta sucursal listas para cobrar</p>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={busy}
          className="min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
        >
          Actualizar lista
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-[12px]">No se pudo cargar la lista. Intenta actualizar.</p>}
      {!error && payable.length === 0 && <p className="mt-3 rounded-lg bg-bg p-3 text-[12px] text-text-muted">No hay órdenes cobrables en esta página.</p>}
      <ul className="mt-3 grid min-w-0 gap-3">
        {payable.map((item) => {
          const isExpanded = expandedId === item.orderId;
          const detail = details[item.orderId];
          const isLoading = loadingId === item.orderId;
          const detailFailed = detailErrors.has(item.orderId);
          const title = getTitle(item);

          return (
            <li
              key={item.orderId}
              className={`min-w-0 rounded-xl border p-3.5 transition-colors ${
                item.orderId === selectedOrderId ? "border-accent bg-accent-soft" : "border-border bg-bg"
              }`}
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void toggleExpand(item.orderId)}
                  aria-expanded={isExpanded}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-left"
                >
                  <span className="break-words text-[14px] font-semibold text-text">{title}</span>
                  <span className="break-words text-[12px] text-text-muted">
                    {channelLabel(item.channel)} · {formatOrderWorkTime(item.createdAt, item.timeZone)} · {formatMinorUnits(item.totals.totalMinor, item.totals.currency)} · {item.lineCount} {item.lineCount === 1 ? "producto" : "productos"}
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleExpand(item.orderId)}
                    aria-expanded={isExpanded}
                    className="min-h-11 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-text-muted hover:text-text"
                  >
                    {isExpanded ? "Ocultar" : "Ver líneas"}
                  </button>
                  <a
                    href={`/app/caja?orderId=${encodeURIComponent(item.orderId)}#cobrar`}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-[13px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Cobrar
                  </a>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 border-t border-border/80 pt-3">
                  {isLoading && detail === undefined ? (
                    <p className="text-xs text-text-muted">Cargando productos…</p>
                  ) : detail !== undefined ? (
                    <ul className="grid gap-2">
                      {detail.items.filter((line) => line.status !== "cancelled").map((line) => (
                        <li key={line.orderItemId} className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-surface p-2.5 text-xs">
                          <div className="min-w-0">
                            <p className="break-words font-semibold text-text">
                              {line.quantity} × {line.name}{line.variantName ? ` · ${line.variantName}` : ""}
                            </p>
                            {line.note !== null && <p className="break-words text-[11px] text-text-muted">{line.note}</p>}
                          </div>
                          <span className="shrink-0 font-semibold text-text">
                            {formatMinorUnits(line.lineTotalMinor, detail.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : detailFailed ? (
                    <p className="text-xs text-error">No se pudo cargar el detalle de la orden.</p>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {cursor !== null && (
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={busy}
          className="mt-3 min-h-11 rounded-lg border border-border px-4 text-[13px] font-semibold disabled:opacity-50"
        >
          {busy ? "Cargando…" : "Cargar más"}
        </button>
      )}
    </div>
  );
}
