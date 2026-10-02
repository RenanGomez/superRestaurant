"use client";

import { useEffect, useId, useState } from "react";
import type { OrderDetailItemV1, OrderDetailV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { actionLabel, groupItemsByStatus, hasAction, hasItemAction, pendingOrderItemIds, type OrderItemStatusGroup } from "../../../lib/order-detail";

const overlay = "fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 sm:items-center";
const sheet = "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const primaryButton = `${button} border-accent bg-accent text-white hover:bg-accent`;

const GROUP_LABELS: Record<OrderItemStatusGroup, string> = {
  cancelled: "Canceladas", delivered: "Entregadas", pending: "Pendientes",
  preparing: "En preparación", ready: "Listas", sent: "Enviadas",
};

export interface OrderDetailActions {
  readonly detail: (orderId: string) => Promise<{ readonly ok: true; readonly value: OrderDetailV1 } | { readonly ok: false; readonly error: string }>;
  readonly open: (orderId: string, expectedVersion: number, eventId: string, idempotencyKey: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  /** One server-side operation: opens the order first if it is still a draft, then sends exactly
   * `orderItemIds` -- see apps/api's OrderService.sendToKitchen. The client never sequences
   * open + one transition per line itself, so a lost-response retry always resumes correctly, and a
   * line another actor adds to the order after this list was captured is never swept into the
   * resend. */
  readonly sendToKitchen: (orderId: string, expectedVersion: number, orderItemIds: readonly string[], eventId: string, idempotencyKey: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly transitionItem: (orderId: string, orderItemId: string, expectedVersion: number, to: "sent" | "preparing" | "ready" | "delivered", eventId: string, idempotencyKey: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly cancelItem: (orderId: string, orderItemId: string, expectedVersion: number, reason: string, eventId: string, idempotencyKey: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
}

/** One eventId/idempotencyKey pair per logical operation, minted once by the browser and reused
 * verbatim on the single retry `runAction` performs -- never regenerated per attempt, or a
 * lost-response retry would send a distinct command instead of resending the same one. */
function nextAttempt(): { readonly eventId: string; readonly idempotencyKey: string } {
  return { eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
}

interface Props {
  readonly orderId: string;
  readonly actions: OrderDetailActions;
  readonly canCheckout: boolean;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}

const errorMessages: Record<string, string> = {
  conflict: "La orden cambió mientras tanto. Se actualizó con los datos más recientes.",
  denied: "Tu sesión o rol ya no permite esta acción.",
  invalid: "No se pudo enviar la acción.",
  not_found: "La orden ya no está disponible.",
  unavailable: "No se pudo confirmar el resultado. Intenta de nuevo.",
};

export function OrderDetailPanel({ orderId, actions, canCheckout, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<OrderDetailV1>();
  const [loadError, setLoadError] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [cancelTarget, setCancelTarget] = useState<OrderDetailItemV1>();
  const headingId = useId();

  async function load(): Promise<OrderDetailV1 | undefined> {
    const result = await actions.detail(orderId);
    if (!result.ok) {
      // Clear any previously shown detail: a stale detail with its actions still enabled must never
      // remain visible once a reload (initial or after an action) fails to confirm the current state.
      setDetail(undefined);
      setLoadError(errorMessages[result.error] ?? errorMessages.unavailable);
      return undefined;
    }
    setLoadError(undefined);
    setDetail(result.value);
    return result.value;
  }

  useEffect(() => { void load(); }, [orderId]);

  async function runAction(key: string, run: () => Promise<{ readonly ok: boolean; readonly error?: string }>): Promise<void> {
    setBusyAction(key);
    setActionError(undefined);
    let result = await run();
    // A single retry only for a transient "unavailable"; never for a denied/invalid/conflict outcome.
    if (!result.ok && result.error === "unavailable") result = await run();
    if (!result.ok) setActionError(errorMessages[result.error ?? "unavailable"] ?? errorMessages.unavailable);
    await load();
    onChanged();
    setBusyAction(undefined);
  }

  const groups = detail === undefined ? undefined : groupItemsByStatus(detail.items);

  return <div className={overlay} role="presentation" onClick={onClose}>
    <div className={sheet} role="dialog" aria-modal="true" aria-labelledby={headingId} onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-2">
        <h2 id={headingId} className="font-heading text-lg font-bold">Detalle de la orden</h2>
        <button type="button" className={button} onClick={onClose} aria-label="Cerrar">Cerrar</button>
      </div>
      {loadError !== undefined && <div role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">
        <p>{loadError}</p>
        <button type="button" className={`${button} mt-2`} onClick={() => void load()}>Reintentar</button>
      </div>}
      {actionError !== undefined && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{actionError}</p>}
      {detail === undefined && loadError === undefined && <p className="mt-4 text-sm text-text-muted">Cargando…</p>}
      {detail !== undefined && <>
        <p className="mt-1 text-sm">Total: <strong>{formatMinorUnits(detail.totals.totalMinor, detail.totals.currency)}</strong></p>
        <div className="mt-4 flex flex-wrap gap-2">
          {hasAction(detail, "open") && <button type="button" className={primaryButton} disabled={busyAction !== undefined}
            onClick={() => { const attempt = nextAttempt(); void runAction("open", () => actions.open(detail.orderId, detail.version, attempt.eventId, attempt.idempotencyKey)); }}>
            {busyAction === "open" ? "Abriendo…" : actionLabel("open")}
          </button>}
          {hasAction(detail, "sendToKitchen") && <button type="button" className={primaryButton} disabled={busyAction !== undefined}
            onClick={() => {
              const attempt = nextAttempt();
              const orderItemIds = pendingOrderItemIds(detail);
              void runAction("sendToKitchen", () => actions.sendToKitchen(detail.orderId, detail.version, orderItemIds, attempt.eventId, attempt.idempotencyKey));
            }}>
            {busyAction === "sendToKitchen" ? "Enviando…" : actionLabel("sendToKitchen")}
          </button>}
          {canCheckout && hasAction(detail, "checkout") && <a href={`/app/caja?orderId=${detail.orderId}`} className={button}>{actionLabel("checkout")}</a>}
        </div>
        <div className="mt-4 space-y-4">
          {groups !== undefined && ([...groups.entries()] as readonly [OrderItemStatusGroup, readonly OrderDetailItemV1[]][])
            .filter(([, lines]) => lines.length > 0)
            .map(([status, lines]) => <section key={status}>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted">{GROUP_LABELS[status]}</h3>
              <ul className="mt-2 space-y-2">
                {lines.map((item) => <li key={item.orderItemId} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{item.quantity} × {item.name}</p>
                      {item.modifiers.length > 0 && <ul className="mt-1 text-xs text-text-muted">
                        {item.modifiers.map((modifier) => <li key={modifier.modifierId}>{modifier.name} × {modifier.quantity}</li>)}
                      </ul>}
                      {item.note !== null && <p className="text-xs text-text-muted">Nota: {item.note}</p>}
                    </div>
                    <span className="text-sm font-semibold">{formatMinorUnits(item.lineTotalMinor, detail.totals.currency)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {hasItemAction(item, "markReady")
                      && <button type="button" className={button} disabled={busyAction !== undefined}
                        onClick={() => {
                          const attempt = nextAttempt();
                          const to = item.status === "sent" ? "preparing" : "ready";
                          void runAction(`ready-${item.orderItemId}`, () => actions.transitionItem(detail.orderId, item.orderItemId, detail.version, to, attempt.eventId, attempt.idempotencyKey));
                        }}>
                        {busyAction === `ready-${item.orderItemId}` ? "Guardando…" : item.status === "sent" ? "Marcar en preparación" : actionLabel("markReady")}
                      </button>}
                    {hasItemAction(item, "markDelivered")
                      && <button type="button" className={button} disabled={busyAction !== undefined}
                        onClick={() => {
                          const attempt = nextAttempt();
                          void runAction(`delivered-${item.orderItemId}`, () => actions.transitionItem(detail.orderId, item.orderItemId, detail.version, "delivered", attempt.eventId, attempt.idempotencyKey));
                        }}>
                        {busyAction === `delivered-${item.orderItemId}` ? "Guardando…" : actionLabel("markDelivered")}
                      </button>}
                    {hasItemAction(item, "cancelItem")
                      && <button type="button" className={button} disabled={busyAction !== undefined} onClick={() => setCancelTarget(item)}>
                        {actionLabel("cancelItem")}
                      </button>}
                  </div>
                </li>)}
              </ul>
            </section>)}
        </div>
      </>}
      {cancelTarget !== undefined && detail !== undefined && <CancelReasonDialog
        itemName={cancelTarget.name}
        requiresSupervisor={cancelTarget.status !== "pending"}
        busy={busyAction !== undefined}
        onCancel={() => setCancelTarget(undefined)}
        onConfirm={(reason) => {
          const target = cancelTarget;
          const attempt = nextAttempt();
          setCancelTarget(undefined);
          void runAction(`cancel-${target.orderItemId}`, () => actions.cancelItem(detail.orderId, target.orderItemId, detail.version, reason, attempt.eventId, attempt.idempotencyKey));
        }}
      />}
    </div>
  </div>;
}

function CancelReasonDialog({ itemName, requiresSupervisor, busy, onCancel, onConfirm }: {
  readonly itemName: string;
  readonly requiresSupervisor: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const headingId = useId();
  const trimmed = reason.trim();
  return <div className={overlay} role="presentation" onClick={onCancel}>
    <div className={sheet} role="dialog" aria-modal="true" aria-labelledby={headingId} onClick={(event) => event.stopPropagation()}>
      <h2 id={headingId} className="font-heading text-lg font-bold">Cancelar «{itemName}»</h2>
      {requiresSupervisor && <p className="mt-2 text-sm text-text-muted">Esta línea ya se envió a cocina: el servidor exigirá autorización de un supervisor.</p>}
      <label className="mt-3 block text-sm font-semibold" htmlFor={`${headingId}-reason`}>Motivo (obligatorio)</label>
      <textarea id={`${headingId}-reason`} className="mt-1 min-h-24 w-full rounded-lg border border-border bg-bg p-2 text-sm"
        value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={button} onClick={onCancel} disabled={busy}>Volver</button>
        <button type="button" className={primaryButton} disabled={busy || trimmed.length === 0} onClick={() => onConfirm(trimmed)}>
          Confirmar cancelación
        </button>
      </div>
    </div>
  </div>;
}
