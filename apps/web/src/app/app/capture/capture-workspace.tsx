"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type {
  BranchScope,
  CaptureAssignmentCandidateV1,
  CaptureDeliveryInstructionSuggestionV1,
  CaptureDeliveryInstructionSuggestionsV1,
  CaptureCustomerSnapshotV1,
  CaptureDraftDetailV1,
  CaptureDraftDetailV2,
  CaptureDraftSummaryV1,
  CaptureFulfillmentChannelV1,
  CaptureFulfillmentSnapshotV1,
  CaptureMutationResultV1,
  CaptureRepeatOrderPlanSummaryV1,
  CaptureSourceChannelV1,
  CaptureWorkspaceV3,
  CaptureWorkTrayResultV1,
  CustomerDirectoryDetailV1,
  CustomerDirectorySearchResultV1,
  CustomerRecentOrderListV1,
  CustomerRepeatOrderCaptureResultV1,
  CustomerRepeatOrderPreviewIssueV1,
  CustomerRepeatOrderPreviewV1,
} from "@super-restaurant/shared-types";

import { captureDeviceId, clearPendingCaptureAutosave, persistPendingCaptureAutosave, readPendingCaptureAutosave,
  rehydrateCaptureWorkspace } from "../../../lib/capture-workspace";
import type { CaptureConfirmationContext } from "../../../lib/capture-confirmation-context";
import { ariaKeyShortcut, dispatchShortcut, type ShortcutTable } from "../../../lib/shortcut-dispatch";
import type { CaptureWorkspaceOperation, CaptureWorkspaceResult } from "./actions";

const panel = "rounded-xl border border-border bg-surface p-4 sm:p-5";
const button = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const input = "min-h-11 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const messages = {
  invalid: "Revisa la selección. La dirección debe estar completa y validada para esta sucursal.",
  denied: "Tu sesión o permisos ya no permiten operar esta captura.",
  conflict: "La captura cambió en otra estación o el lease venció. Recarga la bandeja antes de continuar.",
  missing: "La captura o ficha ya no está disponible.",
  unavailable: "No se pudo confirmar el resultado. Tu selección local sigue visible; reintenta exactamente la misma operación.",
} as const;
const issueLabels: Record<CustomerRepeatOrderPreviewIssueV1["code"], string> = {
  historical_item_cancelled: "La línea histórica estaba cancelada.",
  product_removed: "El producto ya no existe en el catálogo.",
  product_inactive: "El producto está inactivo.",
  category_inactive: "La categoría del producto está inactiva.",
  historical_modifier_unmapped: "Un modificador histórico no se puede relacionar con el catálogo actual.",
  modifier_group_unavailable: "Un grupo de modificadores ya no está disponible para este producto.",
  modifier_group_inactive: "Un grupo de modificadores está inactivo.",
  modifier_option_removed: "Una opción de modificador ya no existe.",
  modifier_option_inactive: "Una opción de modificador está inactiva.",
  modifier_quantity_invalid: "La cantidad de un modificador ya no es válida.",
  modifier_group_requirements_changed: "Cambiaron los requisitos de selección de modificadores.",
  product_price_changed: "Cambió el precio del producto.",
  modifier_price_changed: "Cambió el precio de un modificador.",
};

interface CaptureWorkspaceParameters {
  readonly scope: BranchScope;
  readonly action: (operation: CaptureWorkspaceOperation, input: unknown) => Promise<CaptureWorkspaceResult>;
  readonly confirmationContext?: CaptureConfirmationContext;
  readonly canManageAssignment: boolean;
}
type ActionReply = Awaited<ReturnType<CaptureWorkspaceParameters["action"]>>;

export function CaptureWorkspace({ scope, action, confirmationContext, canManageAssignment }: CaptureWorkspaceParameters): ReactNode {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [deviceId] = useState(() => captureDeviceId(typeof window === "undefined" ? undefined : window.localStorage,
    () => crypto.randomUUID()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof messages>();
  const [pending, setPending] = useState<{ operation: CaptureWorkspaceOperation; command: unknown }>();
  const [capture, setCapture] = useState<CaptureDraftDetailV1 | CaptureDraftDetailV2>();
  const [tray, setTray] = useState<readonly CaptureDraftSummaryV1[]>([]);
  const [assignmentCandidates, setAssignmentCandidates] = useState<readonly CaptureAssignmentCandidateV1[]>([]);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [takeoverDraftId, setTakeoverDraftId] = useState("");
  const [takeoverReason, setTakeoverReason] = useState("");
  const [takeoverConfirmed, setTakeoverConfirmed] = useState(false);
  const [results, setResults] = useState<CustomerDirectorySearchResultV1>();
  const [customer, setCustomer] = useState<CustomerDirectoryDetailV1>();
  const [customerSnapshot, setCustomerSnapshot] = useState<CaptureCustomerSnapshotV1 | null>(null);
  const [fulfillmentSnapshot, setFulfillmentSnapshot] = useState<CaptureFulfillmentSnapshotV1 | null>(null);
  const [repeatOrderPlan, setRepeatOrderPlan] = useState<CaptureRepeatOrderPlanSummaryV1 | null>(null);
  const [recentOrders, setRecentOrders] = useState<CustomerRecentOrderListV1>();
  const [repeatPreview, setRepeatPreview] = useState<CustomerRepeatOrderPreviewV1>();
  const [selectedContact, setSelectedContact] = useState<string>();
  const [selectedAddress, setSelectedAddress] = useState<string>();
  const [sourceChannel, setSourceChannel] = useState<CaptureSourceChannelV1>("phone");
  const [fulfillmentChannel, setFulfillmentChannel] = useState<CaptureFulfillmentChannelV1 | null>("delivery");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [deliveryInstructionSuggestions, setDeliveryInstructionSuggestions] = useState<readonly CaptureDeliveryInstructionSuggestionV1[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [selectedTableId, setSelectedTableId] = useState("");

  async function run(operation: CaptureWorkspaceOperation, command: unknown): Promise<ActionReply | undefined> {
    if (busy) return undefined;
    const persistedAutosave = operation === "autosave"
      ? persistPendingCaptureAutosave(typeof window === "undefined" ? undefined : window.localStorage, command)
      : undefined;
    setBusy(true);
    setError(undefined);
    let reply: ActionReply;
    try { reply = await action(operation, command); }
    catch { reply = { ok: false, error: "unavailable", command }; }
    setBusy(false);
    if (!reply.ok) {
      setError(reply.error);
      setPending(reply.error === "unavailable" ? { operation, command: reply.command ?? command } : undefined);
      if (persistedAutosave !== undefined && reply.error !== "unavailable") {
        clearPendingCaptureAutosave(window.localStorage, persistedAutosave);
      }
      return reply;
    }
    if (persistedAutosave !== undefined) clearPendingCaptureAutosave(window.localStorage, persistedAutosave);
    setPending(undefined);
    const value = reply.value;
    if (operation === "assignmentCandidates") {
      setAssignmentCandidates((value as { candidates: readonly CaptureAssignmentCandidateV1[] }).candidates);
    }
    else if (operation === "recentOrders") setRecentOrders(value as CustomerRecentOrderListV1);
    else if (operation === "repeatPreview") setRepeatPreview(value as CustomerRepeatOrderPreviewV1);
    else if (operation === "repeatOrder") {
      const repeated = value as CustomerRepeatOrderCaptureResultV1;
      setCapture(repeated.capture.detail);
      setRepeatPreview(repeated.preview);
    }
    else if ("items" in value && "captureDraftId" in value) {
      setDeliveryInstructionSuggestions((value as CaptureDeliveryInstructionSuggestionsV1).items);
    }
    else if ("items" in value) setTray((value as CaptureWorkTrayResultV1).items);
    else if ("customerSnapshot" in value) applyWorkspace(value as CaptureWorkspaceV3);
    else if ("replayed" in value) {
      const mutation = value as CaptureMutationResultV1;
      setCapture(mutation.detail);
      if ("deliveryInstructions" in value) {
        setDeliveryInstructions(typeof value.deliveryInstructions === "string" ? value.deliveryInstructions : "");
      }
      setCustomerSnapshot(current => current?.snapshotRef === mutation.detail.customerSnapshotRef ? current : null);
      setFulfillmentSnapshot(current => current?.snapshotRef === mutation.detail.fulfillmentSnapshotRef ? current : null);
      if (mutation.detail.status !== "draft" || mutation.detail.customerSnapshotRef !== customerSnapshot?.snapshotRef) {
        setRepeatOrderPlan(null);
      }
      if (mutation.detail.customerSnapshotRef === null) setSelectedContact(undefined);
      if (mutation.detail.fulfillmentSnapshotRef === null) setSelectedAddress(undefined);
      setSourceChannel(mutation.detail.sourceChannel);
      setFulfillmentChannel(mutation.detail.fulfillmentChannel);
    } else if ("candidates" in value) setResults(value as CustomerDirectorySearchResultV1);
    else setCustomer(value as CustomerDirectoryDetailV1);
    return reply;
  }

  function applyWorkspace(value: CaptureWorkspaceV3): void {
    const hydrated = rehydrateCaptureWorkspace(value);
    if (hydrated === undefined) {
      setError("unavailable");
      return;
    }
    setCapture(hydrated.detail);
    setCustomerSnapshot(hydrated.customerSnapshot);
    setFulfillmentSnapshot(hydrated.fulfillmentSnapshot);
    setRepeatOrderPlan(hydrated.repeatOrderPlan);
    setRecentOrders((current) => current?.customerId === hydrated.customerSnapshot?.customerId ? current : undefined);
    setRepeatPreview((current) => current?.customerId === hydrated.customerSnapshot?.customerId ? current : undefined);
    setSelectedContact(hydrated.customerSnapshot?.contactId);
    setSelectedAddress(hydrated.fulfillmentSnapshot?.addressId);
    setSourceChannel(hydrated.sourceChannel);
    setFulfillmentChannel(hydrated.fulfillmentChannel);
    setDeliveryInstructions(hydrated.deliveryInstructions ?? "");
  }

  useEffect(() => { void (async () => {
    const pendingAutosave = readPendingCaptureAutosave(window.localStorage, scope);
    if (pendingAutosave !== undefined) {
      const replay = await run("autosave", pendingAutosave);
      if (replay?.ok) await refreshWorkspace(pendingAutosave.captureDraftId);
      if (replay === undefined || !replay.ok) return;
    }
    await run("tray", { schemaVersion: 1, scope, limit: 20 });
    if (canManageAssignment) await run("assignmentCandidates", { schemaVersion: 1, scope });
  })(); }, []);

  function base(): Record<string, unknown> {
    if (capture === undefined || capture.attentionLeaseId === null) throw new Error("CAPTURE_NOT_EDITABLE");
    return { schemaVersion: 1, scope, captureDraftId: capture.captureDraftId, expectedVersion: capture.version,
      attentionLeaseId: capture.attentionLeaseId, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      deviceId, occurredAt: new Date().toISOString() };
  }

  function create(): void {
    void run("create", { schemaVersion: 1, scope, captureDraftId: crypto.randomUUID(), expectedVersion: 0,
      sourceChannel, fulfillmentChannel, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId,
      occurredAt: new Date().toISOString() });
  }

  async function refreshWorkspace(captureDraftId: string): Promise<void> {
    const reply = await run("workspace", { schemaVersion: 3, scope, captureDraftId });
    if (!reply?.ok || !("customerSnapshot" in reply.value) || reply.value.customerSnapshot === null) {
      setRecentOrders(undefined);
      setRepeatPreview(undefined);
      setDeliveryInstructionSuggestions([]);
      return;
    }
    await run("recentOrders", { schemaVersion: 1, scope,
      customerId: reply.value.customerSnapshot.customerId, limit: 20 });
    if (reply.value.detail.fulfillmentChannel === "delivery") {
      await run("deliveryInstructionSuggestions", { schemaVersion: 1, scope, captureDraftId });
    } else {
      setDeliveryInstructionSuggestions([]);
    }
  }

  function recover(item: CaptureDraftSummaryV1): void {
    const command = { schemaVersion: 1, scope, captureDraftId: item.captureDraftId, expectedVersion: item.version,
      eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId, occurredAt: new Date().toISOString() };
    void (async () => {
      const reply = await run("claim", command);
      if (reply?.ok) await refreshWorkspace(item.captureDraftId);
    })();
  }

  function transferCapture(): void {
    if (!canManageAssignment || capture === undefined || transferTarget === "" || !transferConfirmed) return;
    void (async () => {
      const reply = await run("transfer", { ...base(), targetMembershipId: transferTarget });
      if (!reply?.ok) return;
      reset();
      await run("tray", { schemaVersion: 1, scope, limit: 20 });
      await run("assignmentCandidates", { schemaVersion: 1, scope });
    })();
  }

  function takeOverCapture(): void {
    const item = tray.find((candidate) => candidate.captureDraftId === takeoverDraftId);
    const reason = takeoverReason.trim();
    if (!canManageAssignment || item === undefined || item.attentionStatus !== "claimed"
      || reason.length === 0 || !takeoverConfirmed) return;
    void (async () => {
      const reply = await run("takeover", { schemaVersion: 1, scope, captureDraftId: item.captureDraftId,
        expectedVersion: item.version, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
        deviceId, occurredAt: new Date().toISOString(), reason });
      if (!reply?.ok) return;
      setTakeoverDraftId(""); setTakeoverReason(""); setTakeoverConfirmed(false);
      await refreshWorkspace(item.captureDraftId);
      await run("tray", { schemaVersion: 1, scope, limit: 20 });
    })();
  }

  function autosave(nextSource: CaptureSourceChannelV1, nextFulfillment: CaptureFulfillmentChannelV1 | null): void {
    if (capture === undefined || capture.attentionLeaseId === null) return;
    const command = { ...base(), sourceChannel: nextSource, fulfillmentChannel: nextFulfillment,
      customerSnapshotRef: capture.customerSnapshotRef, fulfillmentSnapshotRef: capture.fulfillmentSnapshotRef };
    void run("autosave", command);
  }

  function changeSource(event: ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value as CaptureSourceChannelV1;
    setSourceChannel(next);
    autosave(next, fulfillmentChannel);
  }

  function changeFulfillment(event: ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value === "" ? null : event.target.value as CaptureFulfillmentChannelV1;
    setFulfillmentChannel(next);
    if (next !== "delivery") setDeliveryInstructions("");
    if (next !== "delivery") setDeliveryInstructionSuggestions([]);
    autosave(sourceChannel, next);
  }

  function saveDeliveryInstructions(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (capture === undefined || fulfillmentChannel !== "delivery") return;
    const normalized = deliveryInstructions.trim();
    const command = { ...base(), deliveryInstructions: normalized === "" ? null : normalized };
    void run("deliveryInstructions", command);
  }

  function confirmCapture(): void {
    if (capture === undefined || capture.status !== "draft" || capture.attentionLeaseId === null
      || confirmationContext === undefined || fulfillmentChannel === null || selectedShiftId === ""
      || (fulfillmentChannel === "dine_in" && selectedTableId === "")
      || (fulfillmentChannel === "delivery" && (customerSnapshot === null || fulfillmentSnapshot === null))) return;
    void run("confirm", {
      ...base(),
      schemaVersion: 2,
      orderId: crypto.randomUUID(),
      shiftId: selectedShiftId,
      tableId: fulfillmentChannel === "dine_in" ? selectedTableId : null,
      currency: confirmationContext.currency,
      timeZone: confirmationContext.timeZone,
    });
  }

  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run("search", { schemaVersion: 1, scope, mode: String(data.get("mode")),
      query: String(data.get("query") ?? "").trim(), limit: 20, cursor: null });
  }

  function read(customerId: string): void { void run("detail", { schemaVersion: 1, scope, customerId }); }

  function selectCustomer(contactId: string): void {
    if (customer === undefined || capture === undefined) return;
    setRecentOrders(undefined);
    setRepeatPreview(undefined);
    setSelectedContact(contactId);
    setSelectedAddress(undefined);
    const command = { ...base(), customerId: customer.customer.customerId, contactId,
      expectedCustomerVersion: customer.customer.version };
    void (async () => {
      const reply = await run("customer", command);
      if (reply?.ok) await refreshWorkspace(capture.captureDraftId);
    })();
  }

  function selectAddress(addressId: string, version: number): void {
    if (capture?.customerSnapshotRef === null || capture?.customerSnapshotRef === undefined) return;
    setSelectedAddress(addressId);
    const command = { ...base(), customerSnapshotRef: capture.customerSnapshotRef, addressId,
      expectedAddressVersion: version };
    void (async () => {
      const reply = await run("fulfillment", command);
      if (reply?.ok) await refreshWorkspace(capture.captureDraftId);
    })();
  }

  function previewOrder(orderId: string): void {
    if (customerSnapshot === null) return;
    setRepeatPreview(undefined);
    void run("repeatPreview", { schemaVersion: 1, scope, customerId: customerSnapshot.customerId, orderId });
  }

  function repeatOrder(): void {
    if (capture === undefined || customerSnapshot === null || repeatPreview === undefined) return;
    const captureDraftId = capture.captureDraftId;
    void (async () => {
      const reply = await run("repeatOrder", { ...base(), customerId: customerSnapshot.customerId,
        sourceOrderId: repeatPreview.sourceOrderId });
      if (reply?.ok) await refreshWorkspace(captureDraftId);
    })();
  }

  function retryPending(): void {
    if (pending === undefined) return;
    void (async () => {
      const reply = await run(pending.operation, pending.command);
      if (reply?.ok && ["autosave", "claim", "customer", "deliveryInstructions", "fulfillment", "repeatOrder", "takeover"].includes(pending.operation)) {
        const target = typeof pending.command === "object" && pending.command !== null && "captureDraftId" in pending.command
          ? pending.command.captureDraftId : undefined;
        if (typeof target === "string") await refreshWorkspace(target);
      }
      if (reply?.ok && pending.operation === "transfer") {
        reset();
        await run("tray", { schemaVersion: 1, scope, limit: 20 });
        await run("assignmentCandidates", { schemaVersion: 1, scope });
      }
    })();
  }

  function reset(): void {
    setCapture(undefined); setResults(undefined); setCustomer(undefined); setCustomerSnapshot(null);
    setFulfillmentSnapshot(null); setSelectedContact(undefined); setSelectedAddress(undefined); setPending(undefined);
    setRepeatOrderPlan(null);
    setRecentOrders(undefined); setRepeatPreview(undefined);
    setError(undefined); setSourceChannel("phone"); setFulfillmentChannel("delivery");
    setDeliveryInstructions("");
    setDeliveryInstructionSuggestions([]);
    setSelectedShiftId("");
    setSelectedTableId("");
    setTransferTarget("");
    setTransferConfirmed(false);
  }

  const locked = busy || capture?.status !== "draft" || capture?.attentionLeaseId === null
    || error === "denied" || error === "conflict";
  const canConfirm = confirmationContext !== undefined && selectedShiftId !== "" && fulfillmentChannel !== null
    && (fulfillmentChannel !== "dine_in" || selectedTableId !== "")
    && (fulfillmentChannel !== "delivery" || (customerSnapshot !== null && fulfillmentSnapshot !== null));
  useEffect(() => {
    const shortcuts: ShortcutTable = busy ? {} : error === "conflict" || capture?.status === "confirmed"
      ? { reset: ariaKeyShortcut("reset") }
      : capture === undefined ? { create: ariaKeyShortcut("create") }
        : locked ? {} : { search: ariaKeyShortcut("search") };
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.repeat || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const id = dispatchShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
        altKey: event.altKey, targetTag: target?.tagName,
        targetIsEditable: target instanceof HTMLElement && target.isContentEditable }, shortcuts);
      if (id === undefined) return;
      event.preventDefault();
      if (id === "create") create();
      else if (id === "reset") reset();
      else searchInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  return <div className="flex flex-col gap-4" aria-busy={busy}>
    <div role={error === undefined ? "status" : "alert"} aria-live="polite"
      className={error === undefined ? "text-sm text-text-muted" : "rounded-lg border border-border bg-error-bg p-4 text-sm"}>
      {busy ? "Guardando en el servidor…" : error === undefined ? capture === undefined ? "Crea o recupera un borrador para comenzar."
        : `Borrador ${capture.folio} · versión ${capture.version}` : messages[error]}
      {pending !== undefined && <button className={`${button} ml-3`} onClick={retryPending}>Reintentar misma operación</button>}
      {(error === "conflict" || capture?.status === "confirmed") && <button className={`${button} ml-3`}
        aria-keyshortcuts={ariaKeyShortcut("reset")} disabled={busy} onClick={reset}>Volver a la bandeja</button>}
    </div>
    {capture === undefined ? <>
      <section className={panel}><h2 className="font-heading text-lg font-semibold">Abrir captura</h2>
        <p className="my-2 text-sm text-text-muted">Crea un borrador durable para una llamada con entrega a domicilio.</p>
        <button className={button} onClick={create} aria-keyshortcuts={ariaKeyShortcut("create")}
          disabled={busy}>Nueva captura telefónica</button></section>
      {tray.length > 0 && <section className={panel}><h2 className="font-heading text-lg font-semibold">Borradores recuperables</h2>
        <p className="my-2 text-sm text-text-muted">Retoma una captura de esta sucursal. El servidor asignará un lease nuevo antes de editar.</p>
        <div className="grid gap-2">{tray.map((item) => <button key={item.captureDraftId} className={`${button} text-left`}
          disabled={busy} onClick={() => recover(item)}><strong className="block">{item.folio}</strong>
          <span className="text-xs text-text-muted">{item.sourceChannel} · {item.fulfillmentChannel} · versión {item.version}</span>
          {item.ownerMembershipId !== null && <span className="block text-xs text-text-muted">Asignada a {assignmentCandidates.find((candidate) => candidate.membershipId === item.ownerMembershipId)?.displayLabel ?? "otro operador"}</span>}
        </button>)}</div>
        {canManageAssignment && tray.some((item) => item.attentionStatus === "claimed") && <div className="mt-5 border-t border-border pt-4">
          <h3 className="font-heading font-semibold">Apropiación supervisada</h3>
          <p className="mt-1 text-sm text-text-muted">Úsala sólo cuando otro operador no pueda continuar. El motivo queda auditado y el lease cambia.</p>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm" htmlFor="capture-takeover-draft">Captura asignada
              <select id="capture-takeover-draft" className={input} value={takeoverDraftId}
                onChange={(event) => setTakeoverDraftId(event.target.value)} disabled={busy}>
                <option value="">Selecciona una captura</option>
                {tray.filter((item) => item.attentionStatus === "claimed").map((item) => <option
                  key={item.captureDraftId} value={item.captureDraftId}>{item.folio} · versión {item.version}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm" htmlFor="capture-takeover-reason">Motivo obligatorio
              <textarea id="capture-takeover-reason" className={`${input} min-h-24 resize-y`} maxLength={500}
                value={takeoverReason} onChange={(event) => setTakeoverReason(event.target.value)} disabled={busy} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="min-h-5 min-w-5 shrink-0 focus-visible:outline-2 focus-visible:outline-accent"
              checked={takeoverConfirmed} onChange={(event) => setTakeoverConfirmed(event.target.checked)} disabled={busy} />
              Confirmo que el operador actual no puede continuar y que esta reasignación quedará auditada.
            </label>
            <button type="button" className={button} onClick={takeOverCapture}
              disabled={busy || takeoverDraftId === "" || takeoverReason.trim().length === 0 || !takeoverConfirmed}>
              Tomar control de la captura
            </button>
          </div>
        </div>}
      </section>}
    </> : <>
      {capture.status === "confirmed" && <section className={panel} data-testid="confirmed-capture">
        <h2 className="font-heading text-lg font-semibold">Captura convertida en orden</h2>
        <p className="mt-2 text-sm">La captura quedó cerrada y ya no admite cambios.</p>
        <p className="mt-1 break-all text-xs text-text-muted">Orden: {capture.confirmedOrderId}</p>
      </section>}
      <section className={panel}><h2 className="font-heading text-lg font-semibold">Canal y cumplimiento</h2>
        <div className="mt-3 flex flex-wrap gap-3"><label className="text-sm">Origen <select value={sourceChannel} onChange={changeSource}
          className={`${input} ml-2`} disabled={locked}><option value="phone">Teléfono</option><option value="whatsapp_manual">WhatsApp manual</option>
          <option value="counter">Mostrador</option><option value="table">Mesa</option><option value="self_service">Autoservicio</option></select></label>
        <label className="text-sm">Cumplimiento <select value={fulfillmentChannel ?? ""} onChange={changeFulfillment}
          className={`${input} ml-2`} disabled={locked || fulfillmentSnapshot !== null}><option value="">Sin definir</option><option value="delivery">Domicilio</option>
          <option value="pickup" disabled={fulfillmentSnapshot !== null}>Recoger</option><option value="counter" disabled={fulfillmentSnapshot !== null}>Mostrador</option>
          <option value="dine_in" disabled={fulfillmentSnapshot !== null}>Mesa</option></select></label></div>
      </section>
      {capture.status === "draft" && canManageAssignment && <section className={panel} data-testid="capture-transfer">
        <h2 className="font-heading text-lg font-semibold">Transferir captura</h2>
        <p className="mt-1 text-sm text-text-muted">El operador destino recibirá un lease nuevo. Esta estación dejará de editar la captura.</p>
        {assignmentCandidates.length === 0 ? <p className="mt-3 text-sm">No hay otro operador activo elegible en esta sucursal.</p>
          : <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm" htmlFor="capture-transfer-target">Operador destino
              <select id="capture-transfer-target" className={input} value={transferTarget}
                onChange={(event) => { setTransferTarget(event.target.value); setTransferConfirmed(false); }} disabled={locked}>
                <option value="">Selecciona un operador</option>
                {assignmentCandidates.map((candidate) => <option key={candidate.membershipId} value={candidate.membershipId}>
                  {candidate.displayLabel} · {candidate.roles.join(", ")}
                </option>)}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="min-h-5 min-w-5 shrink-0 focus-visible:outline-2 focus-visible:outline-accent"
              checked={transferConfirmed} onChange={(event) => setTransferConfirmed(event.target.checked)} disabled={locked || transferTarget === ""} />
              Confirmo que el operador seleccionado continuará esta captura y que perderé el lease actual.
            </label>
            <button type="button" className={button} onClick={transferCapture}
              disabled={locked || transferTarget === "" || !transferConfirmed}>Transferir de forma segura</button>
          </div>}
      </section>}
      {customerSnapshot !== null && <section className={panel} data-testid="rehydrated-customer-snapshot">
        <h2 className="font-heading text-lg font-semibold">Cliente guardado</h2><p className="mt-2"><strong>{customerSnapshot.displayName}</strong><br />
          {customerSnapshot.phoneDisplayValue}</p>{fulfillmentSnapshot !== null && <p className="mt-2 text-sm">
          <strong>{fulfillmentSnapshot.label}</strong><br />{[fulfillmentSnapshot.streetLine, fulfillmentSnapshot.unit,
            fulfillmentSnapshot.neighborhood, fulfillmentSnapshot.locality].filter(Boolean).join(", ")}</p>}
        <p className="mt-2 text-xs text-text-muted">Datos congelados al guardar esta captura.</p></section>}
      {customerSnapshot !== null && <section className={panel} data-testid="customer-recent-orders">
        <h2 className="font-heading text-lg font-semibold">Pedidos recientes</h2>
        <p className="mt-1 text-sm text-text-muted">Consulta lo que el cliente pidió antes en esta sucursal y revisa los cambios antes de repetirlo.</p>
        {recentOrders === undefined ? <p className="mt-3 text-sm text-text-muted">Cargando historial…</p>
          : recentOrders.orders.length === 0 ? <p className="mt-3 text-sm">Este cliente todavía no tiene pedidos confirmados en la sucursal.</p>
            : <div className="mt-3 grid gap-3">{recentOrders.orders.map((order) => <article key={order.orderId}
              className="rounded-lg border border-border bg-bg p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><strong className="block">{formatDate(order.confirmedAt)}</strong>
                  <span className="text-xs text-text-muted">{fulfillmentLabel(order.fulfillmentChannel)} · {orderStatusLabel(order.status)}</span></div>
                <button type="button" className={button} disabled={locked} onClick={() => previewOrder(order.orderId)}>
                  Revisar para repetir
                </button>
              </div>
              <ul className="mt-3 grid gap-2 text-sm">{order.items.map((item) => <li key={item.orderItemId}>
                <span className={item.status === "cancelled" ? "line-through text-text-muted" : ""}>
                  {item.quantity} × {item.productName} · {money(item.unitPriceMinor, order.currency)} c/u
                </span>
                {item.modifiers.length > 0 && <span className="block pl-4 text-xs text-text-muted">
                  {item.modifiers.map((modifier) => `${modifier.quantity} × ${modifier.name}`).join(" · ")}
                </span>}
              </li>)}</ul>
            </article>)}</div>}
      </section>}
      {repeatPreview !== undefined && <section className={panel} data-testid="repeat-order-preview">
        <h2 className="font-heading text-lg font-semibold">Vista previa para repetir</h2>
        <p className="mt-1 text-sm">
          <strong>{repeatPreview.readyLineCount}</strong> {repeatPreview.readyLineCount === 1 ? "línea disponible" : "líneas disponibles"}
          {repeatPreview.blockedLineCount > 0 && <> · <strong>{repeatPreview.blockedLineCount}</strong> {repeatPreview.blockedLineCount === 1 ? "línea bloqueada" : "líneas bloqueadas"}</>}
        </p>
        <p className="mt-1 text-xs text-text-muted">Los precios y las opciones se comparan con el catálogo vigente. Las líneas bloqueadas no se prepararán.</p>
        <div className="mt-3 grid gap-3">{repeatPreview.lines.map((line) => <article key={line.sourceOrderItemId}
          className={`rounded-lg border p-3 ${line.status === "blocked" ? "border-[oklch(75%_0.13_25)] bg-error-bg" : "border-border bg-bg"}`}>
          <div className="flex flex-wrap justify-between gap-2"><strong>{line.quantity} × {line.currentName ?? line.historicalName}</strong>
            <span className="text-sm">{line.currentUnitPriceMinor === null ? "No disponible" : `${money(line.currentUnitPriceMinor, repeatPreview.currency)} c/u`}</span></div>
          {line.currentName !== null && line.currentName !== line.historicalName && <p className="mt-1 text-xs text-text-muted">Antes: {line.historicalName}</p>}
          {line.issues.length > 0 && <ul className="mt-2 grid gap-1 text-xs">{line.issues.map((issue) => <li
            key={`${issue.code}:${issue.groupId ?? ""}:${issue.modifierId ?? ""}`}
            className={issue.severity === "blocking" ? "font-semibold" : "text-text-muted"}>
            {issueLabels[issue.code]}{issue.historicalAmountMinor !== null && issue.currentAmountMinor !== null
              ? ` ${money(issue.historicalAmountMinor, repeatPreview.currency)} → ${money(issue.currentAmountMinor, repeatPreview.currency)}` : ""}
          </li>)}</ul>}
        </article>)}</div>
        {repeatPreview.blockedLineCount > 0 && <p role="alert" className="mt-3 text-sm">
          Revisa las líneas bloqueadas: no se agregarán a la captura. El resto puede prepararse de forma segura.
        </p>}
        <button type="button" className={`${button} mt-4`} onClick={repeatOrder}
          disabled={locked || repeatPreview.readyLineCount === 0}>
          Preparar {repeatPreview.readyLineCount} {repeatPreview.readyLineCount === 1 ? "línea" : "líneas"} en la captura
        </button>
      </section>}
      {repeatOrderPlan !== null && <section className={panel} data-testid="rehydrated-repeat-order-plan">
        <h2 className="font-heading text-lg font-semibold">Pedido repetido preparado</h2>
        <p className="mt-2 text-sm">{repeatOrderPlan.lineCount} {repeatOrderPlan.lineCount === 1 ? "línea lista" : "líneas listas"} para esta captura.</p>
        <p className="mt-1 text-xs text-text-muted">La preparación se conserva al recargar. Al confirmar, el servidor validará nuevamente cada selección y usará los precios vigentes.</p>
      </section>}
      {fulfillmentChannel === "delivery" && <section className={panel}>
        <h2 className="font-heading text-lg font-semibold">Instrucciones para esta entrega</h2>
        <p className="mt-1 text-sm text-text-muted">Se guardan en esta captura; nunca modifican la dirección del cliente ni se heredan automáticamente.</p>
        {deliveryInstructionSuggestions.length > 0 && <div className="mt-3 rounded-lg border border-border bg-bg p-3">
          <p className="text-sm font-semibold">Usadas antes por este cliente en esta sucursal</p>
          <p className="mt-1 text-xs text-text-muted">Últimos 180 días, máximo cinco. Elige una para copiarla; no se aplica ni guarda sola.</p>
          <ul className="mt-2 grid gap-2">{deliveryInstructionSuggestions.map((suggestion) => <li key={suggestion.deliveryInstructions}>
            <button type="button" className={`${button} w-full text-left`} disabled={locked}
              onClick={() => setDeliveryInstructions(suggestion.deliveryInstructions)}>
              <span className="block">{suggestion.deliveryInstructions}</span>
              <span className="block text-xs text-text-muted">Usada {suggestion.usageCount} {suggestion.usageCount === 1 ? "vez" : "veces"} · última {suggestion.lastUsedAt.slice(0, 10)}</span>
            </button>
          </li>)}</ul>
        </div>}
        <form className="mt-3 grid gap-3" onSubmit={saveDeliveryInstructions}>
          <label className="grid gap-1 text-sm" htmlFor="capture-delivery-instructions">Indicaciones opcionales</label>
          <textarea id="capture-delivery-instructions" maxLength={500} rows={3} className={`${input} min-h-24 resize-y`}
            value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)}
            disabled={locked} placeholder="Ej. Tocar dos veces; no dejar con vigilancia" />
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-text-muted">{deliveryInstructions.length}/500</span>
            <button className={button} disabled={locked}>Guardar instrucciones</button></div>
        </form>
      </section>}
      <section className={panel}><h2 className="font-heading text-lg font-semibold">1. Buscar cliente</h2>
        <form onSubmit={search} className="mt-3 flex flex-wrap gap-3"><label className="grid gap-1 text-sm" htmlFor="capture-search-mode">Buscar por
          <select id="capture-search-mode" name="mode" className={input} disabled={locked}>
          <option value="phone">Teléfono</option><option value="name">Nombre</option><option value="address">Dirección</option></select>
          </label>
          <label className="grid flex-1 gap-1 text-sm" htmlFor="capture-search-query">Consulta
            <input id="capture-search-query" ref={searchInputRef} name="query" required maxLength={200}
              aria-keyshortcuts={ariaKeyShortcut("search")} className={`${input} min-w-48 w-full`}
              placeholder="Teléfono, nombre o dirección" disabled={locked}/>
          </label>
          <button className={button} disabled={locked}>Buscar</button></form>
        {results !== undefined && <div className="mt-3 grid gap-2">{results.candidates.length === 0 ? <p className="text-sm">Sin coincidencias.</p>
          : results.candidates.map((item) => <button key={item.customerId} className={`${button} text-left`} disabled={locked}
            onClick={() => read(item.customerId)}><strong className="block">{item.displayName}</strong>
            <span className="text-xs text-text-muted">{item.phones.map((phone) => phone.displayValue).join(" · ")}</span></button>)}</div>}
      </section>
      {customer !== undefined && <section className={panel}><h2 className="font-heading text-lg font-semibold">2. Elegir teléfono · {customer.customer.displayName}</h2>
        <div className="mt-3 grid gap-2">{customer.customer.phones.map((phone) => <button key={phone.contactId} className={`${button} text-left`}
          disabled={locked} onClick={() => selectCustomer(phone.contactId)}><span>{phone.label}: {phone.displayValue}</span>
          {selectedContact === phone.contactId && <span className="ml-2 text-accent">Selección local</span>}</button>)}</div></section>}
      {customer !== undefined && capture.customerSnapshotRef !== null && <section className={panel}><h2 className="font-heading text-lg font-semibold">3. Elegir dirección validada</h2>
        <div className="mt-3 grid gap-2">{customer.addresses.map((item) => <button key={item.addressId} className={`${button} text-left`}
          disabled={locked || !item.validatedForRequestedBranch} onClick={() => selectAddress(item.addressId, item.version)}><strong className="block">{item.address.label}</strong>
          <span className="block text-xs text-text-muted">{[item.address.streetLine, item.address.neighborhood, item.address.locality].filter(Boolean).join(", ")}</span>
          <span className="text-xs text-accent">{item.validatedForRequestedBranch ? selectedAddress === item.addressId ? "Selección local" : "Validada para esta sucursal" : "Pendiente de validación"}</span>
        </button>)}</div><a href="/app/customers" className="mt-3 inline-block text-sm font-semibold text-accent underline">Editar o validar direcciones en Directorio</a></section>}
      {capture.status === "draft" && <section className={panel} data-testid="capture-confirmation">
        <h2 className="font-heading text-lg font-semibold">4. Convertir en orden</h2>
        {confirmationContext === undefined ? <p role="alert" className="mt-2 text-sm text-text-muted">
          No fue posible leer el turno, moneda o zona horaria de esta sucursal. Recarga antes de confirmar.
        </p> : <>
          <p className="mt-2 text-sm text-text-muted">
            La orden usará {confirmationContext.currency} y {confirmationContext.timeZone}, definidos por el servidor.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm" htmlFor="capture-shift">Turno abierto
              <select id="capture-shift" className={input} value={selectedShiftId}
                onChange={(event) => setSelectedShiftId(event.target.value)} disabled={locked}>
                <option value="">Selecciona un turno</option>
                {confirmationContext.shifts.map((shift) => <option key={shift.shiftId} value={shift.shiftId}>{shift.name}</option>)}
              </select>
            </label>
            {fulfillmentChannel === "dine_in" && <label className="grid gap-1 text-sm" htmlFor="capture-table">Mesa
              <select id="capture-table" className={input} value={selectedTableId}
                onChange={(event) => setSelectedTableId(event.target.value)}
                disabled={locked || confirmationContext.tables === null}>
                <option value="">Selecciona una mesa</option>
                {confirmationContext.tables?.map((table) => <option key={table.tableId} value={table.tableId}>
                  {table.name} · {table.capacity} personas
                </option>)}
              </select>
            </label>}
          </div>
          {confirmationContext.shifts.length === 0 && <p role="alert" className="mt-2 text-sm text-text-muted">
            No hay turnos abiertos para confirmar la orden.
          </p>}
          {fulfillmentChannel === "dine_in" && confirmationContext.tables === null && <p role="alert" className="mt-2 text-sm text-text-muted">
            No fue posible leer el plano de mesas; la confirmación permanece bloqueada.
          </p>}
          {fulfillmentChannel === "delivery" && (customerSnapshot === null || fulfillmentSnapshot === null) && <p className="mt-2 text-sm text-text-muted">
            Guarda un cliente y una dirección validada antes de confirmar el domicilio.
          </p>}
          {repeatOrderPlan !== null && <p role="status" className="mt-2 text-sm text-text-muted">
            El servidor volverá a cotizar este pedido con el catálogo vigente. Si algún producto o modificador ya no es válido, la confirmación se detendrá sin crear una orden parcial.
          </p>}
          <button type="button" className={`${button} mt-4`} onClick={confirmCapture} disabled={locked || !canConfirm}>
            Convertir captura en orden
          </button>
        </>}
      </section>}
      {capture.status === "draft" && <aside className="rounded-xl border border-[oklch(80%_0.08_75)] bg-[oklch(96%_0.03_75)] p-4 text-sm"><strong>Captura abierta.</strong> Los cambios guardados incrementan una versión; recargar exige recuperar un lease nuevo.</aside>}
    </>}
    <details className={panel}>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline-2 focus-visible:outline-accent">Atajos</summary>
      <ul className="mt-2 grid gap-2 text-sm">
        <li><kbd>N</kbd> — Nueva captura desde la bandeja.</li>
        <li><kbd>/</kbd> — Enfocar la búsqueda de cliente en un borrador editable.</li>
        <li><kbd>Esc</kbd> — Volver a la bandeja tras un conflicto o una captura confirmada.</li>
      </ul>
    </details>
  </div>;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { currency, style: "currency" }).format(amountMinor / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function fulfillmentLabel(value: CaptureFulfillmentChannelV1): string {
  return { counter: "Mostrador", delivery: "Domicilio", dine_in: "Mesa", pickup: "Para recoger" }[value];
}

function orderStatusLabel(value: CustomerRecentOrderListV1["orders"][number]["status"]): string {
  return { cancelled: "Cancelado", closed: "Cerrado", draft: "Borrador", open: "Abierto", paid: "Pagado",
    partially_paid: "Pago parcial" }[value];
}
