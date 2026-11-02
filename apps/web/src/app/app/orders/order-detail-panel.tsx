"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { FieldLabel } from "../../../components/field-hint";
import type { AddOrderItemCommandV1, LineFractionV1, MenuCatalogStateV1, MenuModifierGroupV1, MenuProductV1, OrderDetailItemV1, OrderDetailV1 } from "@super-restaurant/shared-types";
import { captureDeviceId } from "../../../lib/capture-workspace";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import type { SelectionPlanModifierGroupDraft } from "../../../lib/capture-selection";
import { halfTicketLines } from "../../../lib/line-halves";
import { buildCustomerTicket, buildKitchenDocuments, type PrintDocument, type PrintHeader } from "../../../lib/print-documents";
import { tableLabel } from "../../../lib/orders-view";
import { PrintPreview } from "../print-preview";
import { actionLabel, buildAddOrderItemCommand, canAddItems, chunkOrderItemIds, groupItemsByStatus, hasAction, hasItemAction, nextFocusIndex, pendingOrderItemIds, resolvePendingAdd, type OrderItemStatusGroup } from "../../../lib/order-detail";
import { cancelOrderErrorMessage, cancelOrderResultMessage, cancelOrderWarning, validCancelReason, type CancelOrderRequestResult } from "../../../lib/order-cancellation";
import { ORDER_CANCELLATION_REASON_MAX_LENGTH } from "@super-restaurant/shared-types";
import { CaptureMenu } from "../capture/capture-menu";
import { ProductSheet } from "../capture/product-sheet";
import { uiButton } from "../../../lib/ui-classes";

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface OrderSelectionDraft {
  readonly quantity: number;
  readonly modifierGroups: readonly SelectionPlanModifierGroupDraft[];
  readonly note: string | null;
  readonly variantId: string | null;
  readonly fraction: LineFractionV1 | null;
}

/**
 * Traps `Tab`/`Shift+Tab` inside `containerRef`'s own subtree (never letting focus escape to the
 * page behind a modal dialog), moves focus into the container on mount, closes on `Escape`, and
 * restores focus to whatever had it before the dialog opened once it unmounts -- the "Detalle"/
 * "Cancelar línea" button that opened it, in `orders-tray.tsx`/the panel itself. `nextFocusIndex` is
 * the pure wraparound rule this applies to the dialog's own currently focused element.
 */
function useFocusTrap(containerRef: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
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
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onEscapeRef.current(); return; }
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

function OrderMenuDialog({ detail, catalogState, loading, loadError, addSuccess, busy, selectedProduct, addError,
  selectionDraft, confirmingAdd, onRetry, onRetryRead, onClose, onSelect, onBack, onAdd }: {
  readonly detail: OrderDetailV1;
  readonly catalogState: MenuCatalogStateV1 | undefined;
  readonly loading: boolean;
  readonly loadError: boolean;
  readonly addSuccess: boolean;
  readonly busy: boolean;
  readonly selectedProduct: { readonly product: MenuProductV1; readonly groups: readonly MenuModifierGroupV1[] } | undefined;
  readonly addError: string | undefined;
  readonly selectionDraft: OrderSelectionDraft | undefined;
  readonly confirmingAdd: boolean;
  readonly onRetry: () => void;
  readonly onRetryRead: () => void;
  readonly onClose: () => void;
  readonly onSelect: (product: MenuProductV1, groups: readonly MenuModifierGroupV1[]) => void;
  readonly onBack: () => void;
  readonly onAdd: (quantity: number, groups: readonly SelectionPlanModifierGroupDraft[], note: string | null, variantId: string | null, fraction: LineFractionV1 | null) => void;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  // In-page panel (right column on desktop, whole screen on mobile): no overlay and no dialog trap.
  return <section className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby={headingId}>
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-heading text-lg font-bold focus:outline-none">Agregar producto</h2>
        <button type="button" className={button} onClick={onClose} disabled={busy || confirmingAdd} aria-label="Volver a la cuenta">
          <span className="lg:hidden" aria-hidden="true">← Cuenta</span><span className="hidden lg:inline" aria-hidden="true">Volver a la cuenta</span>
        </button>
      </header>
      {confirmingAdd && <div role="status" className="m-4 rounded-lg bg-accent-soft p-4 text-sm">
        <p>Confirmando el último producto…</p>
        <button type="button" className={`${button} mt-2`} disabled={busy} onClick={onRetryRead}>Reintentar lectura</button>
      </div>}
      {addSuccess && <p role="status" className="m-3 rounded-lg bg-success-bg p-3 text-sm">Producto agregado a la cuenta. Puedes seguir agregando.</p>}
      {confirmingAdd ? null : loading ? <p role="status" className="p-4 text-sm">Cargando menú…</p>
        : loadError ? <div role="alert" className="m-4 rounded-lg bg-error-bg p-3 text-sm">No se pudo cargar el menú.
          <button type="button" className={`${button} ml-2`} onClick={onRetry}>Reintentar</button></div>
          : catalogState?.catalog === null ? <p className="p-4 text-sm">No hay productos en el menú de esta sucursal.</p>
            : <CaptureMenu catalog={catalogState?.catalog ?? null} currency={detail.currency}
              lineQuantities={new Map()} busy={busy} onSelectProduct={onSelect} />}
      {selectedProduct !== undefined && !confirmingAdd && createPortal(<OrderProductDialog
        product={selectedProduct.product} groups={selectedProduct.groups} currency={detail.currency}
        busy={busy} error={addError} selectionDraft={selectionDraft} onClose={onBack} onAdd={onAdd}
      />, document.body)}
    </div>
  </section>;
}

function OrderProductDialog({ product, groups, currency, busy, error, selectionDraft, onClose, onAdd }: {
  readonly product: MenuProductV1;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly selectionDraft: OrderSelectionDraft | undefined;
  readonly onClose: () => void;
  readonly onAdd: (quantity: number, groups: readonly SelectionPlanModifierGroupDraft[], note: string | null, variantId: string | null, fraction: LineFractionV1 | null) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);
  return <div ref={dialogRef} className="fixed inset-0 z-[60]" tabIndex={-1}>
    <ProductSheet product={product} groups={groups} currency={currency} busy={busy} busyLabel="Agregando…" addLabel="Agregar" closeDisabled={busy}
      showVariants error={error} onClose={onClose} onAdd={onAdd}
      {...(selectionDraft === undefined ? {} : {
        initialLine: { lineId: product.productId, productId: product.productId,
          variantId: selectionDraft.variantId, quantity: selectionDraft.quantity, modifierGroups: selectionDraft.modifierGroups, note: selectionDraft.note,
          ...(selectionDraft.fraction === null ? {} : { fraction: selectionDraft.fraction }) },
        initialVariantId: selectionDraft.variantId,
      })} />
  </div>;
}

const overlay = "fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 sm:items-center";
const sheet = "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = uiButton();
const primaryButton = uiButton("primary");
const dangerButton = uiButton("danger");

const GROUP_LABELS: Record<OrderItemStatusGroup, string> = {
  cancelled: "Canceladas", delivered: "Entregadas", pending: "Pendientes",
  preparing: "En preparación", ready: "Listas", sent: "Enviadas",
};

type MutationResult = { readonly ok: true; readonly version: number } | { readonly ok: false; readonly error?: string };

export interface OrderDetailActions {
  readonly detail: (orderId: string) => Promise<{ readonly ok: true; readonly value: OrderDetailV1 } | { readonly ok: false; readonly error: string }>;
  readonly menuCatalog: () => Promise<MenuCatalogStateV1 | undefined>;
  readonly addItem: (command: AddOrderItemCommandV1) => Promise<MutationResult>;
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
  /** Whole-order cancellation; resolves to the server's result so the refund obligation can be shown. */
  readonly cancelOrder: (orderId: string, expectedVersion: number, reason: string, eventId: string, idempotencyKey: string, occurredAt: string, deviceId: string) => Promise<CancelOrderRequestResult>;
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

function knownTableName(order: OrderDetailV1, names: ReadonlyMap<string, string> | undefined): string | undefined {
  return order.tableId === null ? undefined : names?.get(order.tableId);
}

interface Props {
  readonly orderId: string;
  /** tableId → configured name, read once per page load; absent or incomplete falls back to «Mesa». */
  readonly tableNames?: ReadonlyMap<string, string> | undefined;
  /** "Agregar producto" is open; owned by the URL (`&addItem=1`), see `orders-view.ts`. */
  readonly adding: boolean;
  readonly onAddingChange: (adding: boolean) => void;
  /** Element in the page layout (right column) that hosts the "Agregar producto" panel. */
  readonly menuSlot: HTMLElement | null;
  readonly actions: OrderDetailActions;
  readonly canCheckout: boolean;
  readonly printHeader: PrintHeader;
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

export function OrderDetailPanel({ orderId, tableNames, adding, onAddingChange, menuSlot, actions, canCheckout, printHeader, onClose, onChanged }: Props) {
  // Same device identity Capture's own workspace and the delivery-zones editor use (one stable id
  // per browser, in localStorage) -- never a second, order-specific device id, or the same browser
  // would be audited under two different identities depending on which screen it used.
  const [deviceId] = useState(() => captureDeviceId(typeof window === "undefined" ? undefined : window.localStorage, () => crypto.randomUUID()));
  const [detail, setDetail] = useState<OrderDetailV1>();
  const [printDocuments, setPrintDocuments] = useState<readonly PrintDocument[]>();
  const lastDetailRef = useRef<OrderDetailV1 | undefined>(undefined);
  const [loadError, setLoadError] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [cancelTarget, setCancelTarget] = useState<OrderDetailItemV1>();
  const [cancelOrderOpen, setCancelOrderOpen] = useState(false);
  const [orderNotice, setOrderNotice] = useState<string>();
  const menuOpen = adding;
  const [catalogState, setCatalogState] = useState<MenuCatalogStateV1>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{ readonly product: MenuProductV1; readonly groups: readonly MenuModifierGroupV1[] }>();
  const [selectionDraft, setSelectionDraft] = useState<OrderSelectionDraft>();
  const [addBusy, setAddBusy] = useState(false);
  const [pendingAddCommand, setPendingAddCommand] = useState<AddOrderItemCommandV1>();
  const [confirmingAdd, setConfirmingAdd] = useState(false);
  const [retryOrderItemId, setRetryOrderItemId] = useState<string>();
  const [addError, setAddError] = useState<string>();
  const [addSuccess, setAddSuccess] = useState(false);
  const headingId = useId();
  const closeAddingRef = useRef<() => void>(() => undefined);
  const escapeBlockedRef = useRef(false);
  escapeBlockedRef.current = printDocuments !== undefined || cancelTarget !== undefined || cancelOrderOpen || selectedProduct !== undefined;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const addingRef = useRef(adding);
  addingRef.current = adding;

  // The panel is no longer a modal dialog, so Escape is wired at document level: the nested dialogs
  // (cancel reason, product sheet, print preview) own it while open; otherwise it closes
  // "Agregar producto" first and the detail second.
  useEffect(() => {
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented || escapeBlockedRef.current) return;
      event.preventDefault();
      if (addingRef.current) closeAddingRef.current(); else onCloseRef.current();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    const onPrintShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "p" || event.altKey || event.ctrlKey || event.metaKey || event.repeat
        || printDocuments !== undefined || menuOpen || detail === undefined || event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
        || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      const documents = buildKitchenDocuments(detail, knownTableName(detail, tableNames));
      if (documents.length > 0) { event.preventDefault(); setPrintDocuments(documents); }
    };
    document.addEventListener("keydown", onPrintShortcut);
    return () => document.removeEventListener("keydown", onPrintShortcut);
  }, [detail, menuOpen, printDocuments, tableNames]);

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
    lastDetailRef.current = result.value;
    setDetail(result.value);
    return result.value;
  }

  useEffect(() => { void load(); }, [orderId]);

  // `adding` comes from the URL: once the detail is known, an order that no longer accepts new lines
  // falls back to the detail view; otherwise the catalog is loaded the first time the panel shows.
  useEffect(() => {
    if (!adding || detail === undefined) return;
    if (!canAddItems(detail)) {
      setSelectedProduct(undefined); setSelectionDraft(undefined); setRetryOrderItemId(undefined);
      setPendingAddCommand(undefined); setConfirmingAdd(false);
      setOrderNotice("La cuenta ya no permite agregar productos; se cerró «Agregar producto».");
      onAddingChange(false);
      return;
    }
    if (catalogState === undefined && !catalogLoading && !catalogError) void loadCatalog(detail);
  }, [adding, detail === undefined, detail !== undefined && canAddItems(detail), catalogState === undefined]);

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

  /** Whole-order cancellation: one attempt, never auto-retried; the detail is always reloaded so the
   * operator sees what the server settled on, and the server's refund obligation is shown verbatim. */
  async function runCancelOrder(current: OrderDetailV1, reason: string): Promise<void> {
    const attempt = nextAttempt();
    setCancelOrderOpen(false);
    setBusyAction("cancelOrder");
    setActionError(undefined);
    setOrderNotice(undefined);
    try {
      let result: CancelOrderRequestResult;
      try {
        result = await actions.cancelOrder(current.orderId, current.version, reason, attempt.eventId, attempt.idempotencyKey, attempt.occurredAt, deviceId);
      } catch { result = { error: "unavailable", ok: false }; }
      if (result.ok) setOrderNotice(cancelOrderResultMessage(result.value));
      else setActionError(cancelOrderErrorMessage(result.error));
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

  function openMenu(): void {
    setAddSuccess(false);
    onAddingChange(true);
  }

  function closeAdding(): void {
    if (addBusy || pendingAddCommand !== undefined) return;
    setSelectedProduct(undefined); setSelectionDraft(undefined); setRetryOrderItemId(undefined);
    onAddingChange(false);
  }
  closeAddingRef.current = closeAdding;

  async function loadCatalog(currentDetail: OrderDetailV1 | undefined = detail): Promise<void> {
    if (catalogState !== undefined) return;
    setCatalogLoading(true);
    setCatalogError(false);
    let result: MenuCatalogStateV1 | undefined;
    try { result = await actions.menuCatalog(); } catch { result = undefined; }
    if (result === undefined || currentDetail === undefined || result.scope.restaurantId !== currentDetail.scope.restaurantId
      || result.scope.branchId !== currentDetail.scope.branchId) setCatalogError(true);
    else setCatalogState(result);
    setCatalogLoading(false);
  }

  function settleAddRead(reloaded: OrderDetailV1 | undefined, command: AddOrderItemCommandV1): void {
    const resolution = resolvePendingAdd(reloaded, command);
    if (resolution === "applied") {
      setPendingAddCommand(undefined);
      setConfirmingAdd(false);
      setRetryOrderItemId(undefined);
      setSelectedProduct(undefined);
      setSelectionDraft(undefined);
      setAddSuccess(true);
      setAddError(undefined);
    } else if (resolution === "retry") {
      setPendingAddCommand(undefined);
      setConfirmingAdd(false);
      setRetryOrderItemId(command.orderItemId);
      setAddError("La cuenta está actualizada y la línea no aparece. Toca Agregar para intentar de nuevo.");
    } else {
      setPendingAddCommand(command);
      setConfirmingAdd(true);
      setAddError(undefined);
    }
  }

  async function retryAddRead(): Promise<void> {
    if (pendingAddCommand === undefined || addBusy) return;
    setAddBusy(true);
    try {
      const reloaded = await load();
      onChanged();
      settleAddRead(reloaded, pendingAddCommand);
    } finally { setAddBusy(false); }
  }

  async function addSelected(quantity: number, modifierGroups: readonly SelectionPlanModifierGroupDraft[], note: string | null, variantId: string | null, fraction: LineFractionV1 | null): Promise<void> {
    if (selectedProduct === undefined || addBusy || pendingAddCommand !== undefined) return;
    if (detail === undefined || !canAddItems(detail)) {
      setAddError("Esta cuenta ya no permite agregar productos. Vuelve al detalle para revisar el estado.");
      return;
    }
    const attempt = nextAttempt();
    const command = buildAddOrderItemCommand({ scope: detail.scope, orderId: detail.orderId,
      expectedVersion: detail.version, orderItemId: retryOrderItemId ?? crypto.randomUUID(), productId: selectedProduct.product.productId,
      quantity, modifierGroups, note, variantId, fraction, ...attempt, deviceId });
    setSelectionDraft({ quantity, modifierGroups, note, variantId, fraction });
    setPendingAddCommand(command);
    setRetryOrderItemId(undefined);
    setAddBusy(true);
    setAddError(undefined);
    try {
      try { await actions.addItem(command); } catch { /* A detail read resolves uncertain transport outcomes. */ }
      const reloaded = await load();
      onChanged();
      settleAddRead(reloaded, command);
    } finally { setAddBusy(false); }
  }

  const groups = detail === undefined ? undefined : groupItemsByStatus(detail.items);

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby={headingId}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
      <h2 id={headingId} className="font-heading text-lg font-bold">Detalle de la orden</h2>
      <button type="button" className={button} onClick={onClose} aria-label="Cerrar detalle">
        <span className="lg:hidden" aria-hidden="true">← Órdenes</span><span className="hidden lg:inline" aria-hidden="true">Cerrar detalle</span>
      </button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {loadError !== undefined && <div role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">
        <p>{loadError}</p>
        <button type="button" className={`${button} mt-2`} onClick={() => void load()}>Reintentar</button>
      </div>}
      {actionError !== undefined && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{actionError}</p>}
      {orderNotice !== undefined && <p role="status" className="mt-3 rounded-lg border border-border bg-bg p-3 text-sm font-semibold">{orderNotice}</p>}
      {detail === undefined && loadError === undefined && <p className="mt-4 text-sm text-text-muted">Cargando…</p>}
      {detail !== undefined && <>
        {detail.channel === "table" && <p className="mt-1 text-sm font-semibold">{tableLabel(detail.tableId, tableNames)}</p>}
        <p className="mt-1 text-sm">Total: <strong>{formatMinorUnits(detail.totals.totalMinor, detail.totals.currency)}</strong></p>
        <div className="mt-4 flex flex-wrap gap-2">
          {canAddItems(detail) && <button type="button" className={primaryButton} disabled={busyAction !== undefined || addBusy}
            onClick={openMenu}>Agregar producto</button>}
          {hasAction(detail, "sendToKitchen") && <button type="button" className={primaryButton} disabled={busyAction !== undefined}
            onClick={() => void runSendToKitchen(detail.orderId, detail.version, pendingOrderItemIds(detail))}>
            {busyAction === "sendToKitchen" ? "Enviando…" : actionLabel("sendToKitchen")}
          </button>}
          {canCheckout && hasAction(detail, "checkout") && <Link href={`/app/caja?orderId=${detail.orderId}`} className={button}>{actionLabel("checkout")}</Link>}
          {hasAction(detail, "cancelOrder") && <button type="button" className={dangerButton} disabled={busyAction !== undefined}
            onClick={() => setCancelOrderOpen(true)}>
            {busyAction === "cancelOrder" ? "Cancelando…" : actionLabel("cancelOrder")}
          </button>}
          <button type="button" className={button} disabled={buildKitchenDocuments(detail, knownTableName(detail, tableNames)).length === 0}
            aria-keyshortcuts="P" onClick={() => setPrintDocuments(buildKitchenDocuments(detail, knownTableName(detail, tableNames)))}>Imprimir comanda</button>
          <button type="button" className={button} onClick={() => setPrintDocuments([buildCustomerTicket(detail, [], printHeader, knownTableName(detail, tableNames))])}>Imprimir ticket</button>
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
                      {(item.fractionBreakdown ?? []).length > 0 && <ul className="mt-1 grid gap-1 text-sm" aria-label="Mitades">
                        {(item.fractionBreakdown ?? []).map((half) => {
                          const lines = halfTicketLines(half);
                          return <li key={half.fraction}><span className="font-semibold">{lines.title}</span>
                            {lines.details.length > 0 && <ul className="text-xs text-text-muted">{lines.details.map((detailLine) => <li key={detailLine}>{detailLine}</li>)}</ul>}
                          </li>;
                        })}
                      </ul>}
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
      {cancelOrderOpen && detail !== undefined && hasAction(detail, "cancelOrder") && <CancelOrderDialog
        warning={cancelOrderWarning(detail)}
        hasSentLines={detail.items.some((item) => item.status === "sent" || item.status === "preparing" || item.status === "ready")}
        busy={busyAction !== undefined}
        onCancel={() => setCancelOrderOpen(false)}
        onConfirm={(reason) => void runCancelOrder(detail, reason)}
      />}
      {menuOpen && menuSlot !== null && (detail ?? (pendingAddCommand === undefined ? undefined : lastDetailRef.current)) !== undefined && createPortal(<OrderMenuDialog
        detail={(detail ?? lastDetailRef.current)!} catalogState={catalogState} loading={catalogLoading} loadError={catalogError}
        addSuccess={addSuccess} busy={addBusy} selectedProduct={selectedProduct} selectionDraft={selectionDraft} addError={addError}
        confirmingAdd={confirmingAdd} onRetryRead={() => void retryAddRead()}
        onRetry={() => void loadCatalog()} onClose={closeAdding}
        onSelect={(product, groups) => { setAddSuccess(false); setAddError(undefined); setSelectionDraft(undefined); setRetryOrderItemId(undefined); setSelectedProduct({ product, groups }); }}
        onBack={() => { if (!addBusy && pendingAddCommand === undefined) { setSelectedProduct(undefined); setSelectionDraft(undefined); setRetryOrderItemId(undefined); setAddError(undefined); } }}
        onAdd={(quantity, groups, note, variantId, fraction) => void addSelected(quantity, groups, note, variantId, fraction)}
      />, menuSlot)}
      {printDocuments !== undefined && <PrintPreview documents={printDocuments} onClose={() => setPrintDocuments(undefined)} />}
    </div>
  </section>;
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
      <FieldLabel className="mt-3 flex text-sm font-semibold" htmlFor={`${headingId}-reason`} hint="Explica por qué se hace esta acción sobre la orden. Queda en la auditoría junto con tu usuario." label="Motivo (obligatorio)" />
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

function CancelOrderDialog({ warning, hasSentLines, busy, onCancel, onConfirm }: {
  readonly warning: string | undefined;
  readonly hasSentLines: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const headingId = useId();
  const valid = validCancelReason(reason);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onCancel);
  return <div className={overlay} role="presentation" onClick={onCancel}>
    <div ref={dialogRef} className={sheet} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <h2 id={headingId} className="font-heading text-lg font-bold">Cancelar orden</h2>
      <p className="mt-2 text-sm text-text-muted">Se cancelan todas las líneas y queda registrada con el motivo. Esta acción no se puede deshacer.{hasSentLines ? " Cocina recibirá el aviso de cancelación de lo ya enviado." : ""}</p>
      {warning !== undefined && <p role="note" className="mt-3 rounded-lg border border-border bg-bg p-3 text-sm font-semibold">{warning}</p>}
      <FieldLabel className="mt-3 flex text-sm font-semibold" htmlFor={`${headingId}-reason`} hint="Explica por qué se hace esta acción sobre la orden. Queda en la auditoría junto con tu usuario." label="Motivo (obligatorio)" />
      <textarea id={`${headingId}-reason`} className="mt-1 min-h-24 w-full rounded-lg border border-border bg-bg p-2 text-sm"
        value={reason} onChange={(event) => setReason(event.target.value)} maxLength={ORDER_CANCELLATION_REASON_MAX_LENGTH} autoFocus />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={button} onClick={onCancel} disabled={busy}>Volver</button>
        <button type="button" className={primaryButton} disabled={busy || valid === undefined} onClick={() => { if (valid !== undefined) onConfirm(valid); }}>
          Cancelar orden
        </button>
      </div>
    </div>
  </div>;
}
