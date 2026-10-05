"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { OrderDetailItemV1, OrderDetailV1 } from "@super-restaurant/shared-types";
import { captureDeviceId } from "../../../lib/capture-workspace";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { actionLabel, chunkOrderItemIds, groupItemsByStatus, hasAction, hasItemAction, nextFocusIndex, pendingOrderItemIds, type OrderItemStatusGroup } from "../../../lib/order-detail";

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps `Tab`/`Shift+Tab` inside `containerRef`'s own subtree (never letting focus escape to the
 * page behind a modal dialog), moves focus into the container on mount, closes on `Escape`, and
 * restores focus to whatever had it before the dialog opened once it unmounts -- the "Detalle"/
 * "Cancelar línea" button that opened it, in `orders-tray.tsx`/the panel itself. `nextFocusIndex` is
 * the pure wraparound rule this applies to the dialog's own currently focused element.
 */
function useFocusTrap(containerRef: RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    container.focus();

    function focusableElements(): readonly HTMLElement[] {
      return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
    }

    function onKeyDown(event: KeyboardEvent): void {
      // `stopPropagation` matters when a second dialog (the cancel-reason confirmation) is nested
      // inside this one: without it, a Tab/Escape the inner dialog's own trap already handled would
      // bubble up and be handled a second time by this outer one.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onEscape(); return; }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (elements.length === 0) { event.preventDefault(); return; }
      const currentIndex = elements.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      event.stopPropagation();
      if (currentIndex === -1) { (event.shiftKey ? elements[elements.length - 1] : elements[0])?.focus(); return; }
      elements[nextFocusIndex(elements.length, currentIndex, event.shiftKey)]?.focus();
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
    // Intentionally runs once per mount only: `containerRef` is a stable ref object, and `onEscape`
    // is re-created every render by design (it closes over fresh state) -- re-running this effect
    // for that alone would steal focus back into the dialog on every keystroke elsewhere in it.
  }, []);
}

const overlay = "fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 sm:items-center";
const sheet = "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const primaryButton = `${button} border-accent bg-accent text-white hover:bg-accent`;

const GROUP_LABELS: Record<OrderItemStatusGroup, string> = {
  cancelled: "Canceladas", delivered: "Entregadas", pending: "Pendientes",
  preparing: "En preparación", ready: "Listas", sent: "Enviadas",
};

type MutationResult = { readonly ok: true; readonly version: number } | { readonly ok: false; readonly error?: string };

export interface OrderDetailActions {
  readonly detail: (orderId: string) => Promise<{ readonly ok: true; readonly value: OrderDetailV1 } | { readonly ok: false; readonly error: string }>;
  readonly open: (orderId: string, expectedVersion: number, eventId: string, idempotencyKey: string, occurredAt: string, deviceId: string) => Promise<MutationResult>;
  /** One server-side operation: opens the order first if it is still a draft, then sends exactly
   * `orderItemIds` -- see apps/api's OrderService.sendToKitchen. The client never sequences
   * open + one transition per line itself, so a lost-response retry always resumes correctly, and a
   * line another actor adds to the order after this list was captured is never swept into the
   * resend. The returned `version` chains a batch split into several chunks (see `MAX_SEND_ORDER_TO_
   * KITCHEN_ITEM_IDS`) against the same order without an extra read. */
  readonly sendToKitchen: (orderId: string, expectedVersion: number, orderItemIds: readonly string[], eventId: string, idempotencyKey: string, occurredAt: string, deviceId: string) => Promise<MutationResult>;
  readonly transitionItem: (orderId: string, orderItemId: string, expectedVersion: number, to: "sent" | "preparing" | "ready" | "delivered", eventId: string, idempotencyKey: string, occurredAt: string, deviceId: string) => Promise<MutationResult>;
  readonly cancelItem: (orderId: string, orderItemId: string, expectedVersion: number, reason: string, eventId: string, idempotencyKey: string, occurredAt: string, deviceId: string) => Promise<MutationResult>;
}

/** One eventId/idempotencyKey/occurredAt triple per logical operation, minted once by the browser
 * and reused verbatim on the single retry `runAction`/`runSendToKitchen` performs -- never
 * regenerated per attempt. `occurredAt` must stay fixed across a retry of the same attempt too: the
 * server's `persist_order_mutation` only replays an idempotency key it has already seen when the
 * full submitted payload is byte-identical to the original, so a fresh timestamp on the retry would
 * make it look like a different, conflicting command instead of the same one resuming. `deviceId` is
 * not minted here: it is the browser's single, stable Capture device identity (see
 * `captureDeviceId`), read once per panel instance and reused across every attempt and retry. */
function nextAttempt(): { readonly eventId: string; readonly idempotencyKey: string; readonly occurredAt: string } {
  return { eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), occurredAt: new Date().toISOString() };
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

/**
 * `open`/`transitionItem`/`cancelItem` are never retried automatically on "unavailable": a replay
 * that would make a retry safe requires an idempotency-key lookup in `persist_order_mutation` that
 * runs ahead of its version check -- which exists today, but the *client* can only resend the exact
 * same payload, and these three mutations are reported to the operator as a single, already-settled
 * attempt rather than a resumable batch. Reloading the detail is the safe move instead: it reflects
 * whatever the server actually persisted (applied or not), and the operator's next click starts a
 * fresh attempt against the reloaded version. Only "send to kitchen" retries, because it is
 * explicitly resumable -- a retried step just skips whatever its own prior step already sent.
 */
const UNAVAILABLE_NO_RETRY_MESSAGE = "No se pudo confirmar el resultado. Se recargó la orden; revisa el estado antes de repetir.";

export function OrderDetailPanel({ orderId, actions, canCheckout, onClose, onChanged }: Props) {
  // Same device identity Capture's own workspace and the delivery-zones editor use (one stable id
  // per browser, in localStorage) -- never a second, order-specific device id, or the same browser
  // would be audited under two different identities depending on which screen it used.
  const [deviceId] = useState(() => captureDeviceId(typeof window === "undefined" ? undefined : window.localStorage, () => crypto.randomUUID()));
  const [detail, setDetail] = useState<OrderDetailV1>();
  const [loadError, setLoadError] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [cancelTarget, setCancelTarget] = useState<OrderDetailItemV1>();
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  async function load(): Promise<OrderDetailV1 | undefined> {
    // `actions.detail` is a Next.js Server Action: a transport failure (e.g. the server process
    // restarting mid-request) rejects the promise instead of resolving to `{ ok: false }`. Treated
    // the same as any other unreachable outcome, never left to bubble up and strand the panel.
    let result: Awaited<ReturnType<typeof actions.detail>>;
    try { result = await actions.detail(orderId); } catch { result = { error: "unavailable", ok: false }; }
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

  /** Used for `open`/`transitionItem`/`cancelItem`: never retries, including on "unavailable" (see
   * `UNAVAILABLE_NO_RETRY_MESSAGE`). Always reloads the detail afterward so the operator's view
   * reflects whatever the server actually settled on, win or lose. */
  async function runAction(key: string, run: () => Promise<MutationResult>): Promise<void> {
    setBusyAction(key);
    setActionError(undefined);
    try {
      // A rejected promise (transport failure, not a typed `{ ok: false }`) is just another
      // "unavailable" outcome: same message, same reload-and-recover path, never left unhandled.
      let result: MutationResult;
      try { result = await run(); } catch { result = { error: "unavailable", ok: false }; }
      if (!result.ok) {
        setActionError(result.error === "unavailable" ? UNAVAILABLE_NO_RETRY_MESSAGE : errorMessages[result.error ?? "unavailable"] ?? errorMessages.unavailable);
      }
      await load();
      onChanged();
    } finally {
      setBusyAction(undefined);
    }
  }

  /** "Send to kitchen" splits `orderItemIds` into chunks bounded by `MAX_SEND_ORDER_TO_KITCHEN_ITEM_
   * IDS` and sends them in sequence, chaining `expectedVersion` from each chunk's own returned
   * `version` instead of re-reading the detail between chunks. Each chunk keeps its own attempt ids,
   * reused verbatim on that chunk's single retry -- resumable because a retried chunk simply skips
   * whatever its own prior attempt already sent (see `OrdersService.sendToKitchen`). Stops at the
   * first chunk that still fails after its retry, reloads the detail and reports the error. */
  async function runSendToKitchen(orderId: string, initialExpectedVersion: number, orderItemIds: readonly string[]): Promise<void> {
    setBusyAction("sendToKitchen");
    setActionError(undefined);
    try {
      let expectedVersion = initialExpectedVersion;
      for (const chunk of chunkOrderItemIds(orderItemIds)) {
        const attempt = nextAttempt();
        // A rejected promise (transport failure) is treated as "unavailable", same as a typed
        // `{ ok: false, error: "unavailable" }" -- both get the chunk's single retry.
        const run = async (): Promise<MutationResult> => {
          try { return await actions.sendToKitchen(orderId, expectedVersion, chunk, attempt.eventId, attempt.idempotencyKey, attempt.occurredAt, deviceId); }
          catch { return { error: "unavailable", ok: false }; }
        };
        let result = await run();
        if (!result.ok && result.error === "unavailable") result = await run();
        if (!result.ok) {
          setActionError(errorMessages[result.error ?? "unavailable"] ?? errorMessages.unavailable);
          break;
        }
        expectedVersion = result.version;
      }
      await load();
      onChanged();
    } finally {
      setBusyAction(undefined);
    }
  }

  const groups = detail === undefined ? undefined : groupItemsByStatus(detail.items);

  return <div className={overlay} role="presentation" onClick={onClose}>
    <div ref={dialogRef} className={sheet} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
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
            onClick={() => { const attempt = nextAttempt(); void runAction("open", () => actions.open(detail.orderId, detail.version, attempt.eventId, attempt.idempotencyKey, attempt.occurredAt, deviceId)); }}>
            {busyAction === "open" ? "Abriendo…" : actionLabel("open")}
          </button>}
          {hasAction(detail, "sendToKitchen") && <button type="button" className={primaryButton} disabled={busyAction !== undefined}
            onClick={() => void runSendToKitchen(detail.orderId, detail.version, pendingOrderItemIds(detail))}>
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
                      <p className="text-sm font-semibold">{item.quantity} × {item.name}{item.variantName ? ` · ${item.variantName}` : ""}</p>
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
                          void runAction(`ready-${item.orderItemId}`, () => actions.transitionItem(detail.orderId, item.orderItemId, detail.version, to, attempt.eventId, attempt.idempotencyKey, attempt.occurredAt, deviceId));
                        }}>
                        {busyAction === `ready-${item.orderItemId}` ? "Guardando…" : item.status === "sent" ? "Marcar en preparación" : actionLabel("markReady")}
                      </button>}
                    {hasItemAction(item, "markDelivered")
                      && <button type="button" className={button} disabled={busyAction !== undefined}
                        onClick={() => {
                          const attempt = nextAttempt();
                          void runAction(`delivered-${item.orderItemId}`, () => actions.transitionItem(detail.orderId, item.orderItemId, detail.version, "delivered", attempt.eventId, attempt.idempotencyKey, attempt.occurredAt, deviceId));
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
          void runAction(`cancel-${target.orderItemId}`, () => actions.cancelItem(detail.orderId, target.orderItemId, detail.version, reason, attempt.eventId, attempt.idempotencyKey, attempt.occurredAt, deviceId));
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onCancel);
  return <div className={overlay} role="presentation" onClick={onCancel}>
    <div ref={dialogRef} className={sheet} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
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
