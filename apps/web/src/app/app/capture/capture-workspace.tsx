"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type {
  BranchScope,
  CaptureCustomerSnapshotV1,
  CaptureDraftDetailV1,
  CaptureDraftDetailV2,
  CaptureDraftSummaryV1,
  CaptureFulfillmentChannelV1,
  CaptureFulfillmentSnapshotV1,
  CaptureMutationResultV1,
  CaptureSourceChannelV1,
  CaptureWorkspaceV2,
  CaptureWorkTrayResultV1,
  CustomerDirectoryDetailV1,
  CustomerDirectorySearchResultV1,
} from "@super-restaurant/shared-types";

import { captureDeviceId, clearPendingCaptureAutosave, persistPendingCaptureAutosave, readPendingCaptureAutosave,
  rehydrateCaptureWorkspace } from "../../../lib/capture-workspace";
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

interface CaptureWorkspaceParameters {
  readonly scope: BranchScope;
  readonly action: (operation: CaptureWorkspaceOperation, input: unknown) => Promise<CaptureWorkspaceResult>;
}
type ActionReply = Awaited<ReturnType<CaptureWorkspaceParameters["action"]>>;

export function CaptureWorkspace({ scope, action }: CaptureWorkspaceParameters): ReactNode {
  const [deviceId] = useState(() => captureDeviceId(typeof window === "undefined" ? undefined : window.localStorage,
    () => crypto.randomUUID()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof messages>();
  const [pending, setPending] = useState<{ operation: CaptureWorkspaceOperation; command: unknown }>();
  const [capture, setCapture] = useState<CaptureDraftDetailV1 | CaptureDraftDetailV2>();
  const [tray, setTray] = useState<readonly CaptureDraftSummaryV1[]>([]);
  const [results, setResults] = useState<CustomerDirectorySearchResultV1>();
  const [customer, setCustomer] = useState<CustomerDirectoryDetailV1>();
  const [customerSnapshot, setCustomerSnapshot] = useState<CaptureCustomerSnapshotV1 | null>(null);
  const [fulfillmentSnapshot, setFulfillmentSnapshot] = useState<CaptureFulfillmentSnapshotV1 | null>(null);
  const [selectedContact, setSelectedContact] = useState<string>();
  const [selectedAddress, setSelectedAddress] = useState<string>();
  const [sourceChannel, setSourceChannel] = useState<CaptureSourceChannelV1>("phone");
  const [fulfillmentChannel, setFulfillmentChannel] = useState<CaptureFulfillmentChannelV1 | null>("delivery");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");

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
    if ("items" in value) setTray((value as CaptureWorkTrayResultV1).items);
    else if ("customerSnapshot" in value) applyWorkspace(value as CaptureWorkspaceV2);
    else if ("replayed" in value) {
      const mutation = value as CaptureMutationResultV1;
      setCapture(mutation.detail);
      if ("deliveryInstructions" in value) {
        setDeliveryInstructions(typeof value.deliveryInstructions === "string" ? value.deliveryInstructions : "");
      }
      setCustomerSnapshot(current => current?.snapshotRef === mutation.detail.customerSnapshotRef ? current : null);
      setFulfillmentSnapshot(current => current?.snapshotRef === mutation.detail.fulfillmentSnapshotRef ? current : null);
      if (mutation.detail.customerSnapshotRef === null) setSelectedContact(undefined);
      if (mutation.detail.fulfillmentSnapshotRef === null) setSelectedAddress(undefined);
      setSourceChannel(mutation.detail.sourceChannel);
      setFulfillmentChannel(mutation.detail.fulfillmentChannel);
    } else if ("candidates" in value) setResults(value as CustomerDirectorySearchResultV1);
    else setCustomer(value as CustomerDirectoryDetailV1);
    return reply;
  }

  function applyWorkspace(value: CaptureWorkspaceV2): void {
    const hydrated = rehydrateCaptureWorkspace(value);
    if (hydrated === undefined) {
      setError("unavailable");
      return;
    }
    setCapture(hydrated.detail);
    setCustomerSnapshot(hydrated.customerSnapshot);
    setFulfillmentSnapshot(hydrated.fulfillmentSnapshot);
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
    await run("workspace", { schemaVersion: 2, scope, captureDraftId });
  }

  function recover(item: CaptureDraftSummaryV1): void {
    const command = { schemaVersion: 1, scope, captureDraftId: item.captureDraftId, expectedVersion: item.version,
      eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId, occurredAt: new Date().toISOString() };
    void (async () => {
      const reply = await run("claim", command);
      if (reply?.ok) await refreshWorkspace(item.captureDraftId);
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
    autosave(sourceChannel, next);
  }

  function saveDeliveryInstructions(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (capture === undefined || fulfillmentChannel !== "delivery") return;
    const normalized = deliveryInstructions.trim();
    const command = { ...base(), deliveryInstructions: normalized === "" ? null : normalized };
    void run("deliveryInstructions", command);
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

  function retryPending(): void {
    if (pending === undefined) return;
    void (async () => {
      const reply = await run(pending.operation, pending.command);
      if (reply?.ok && ["autosave", "claim", "customer", "deliveryInstructions", "fulfillment"].includes(pending.operation)) {
        const target = typeof pending.command === "object" && pending.command !== null && "captureDraftId" in pending.command
          ? pending.command.captureDraftId : undefined;
        if (typeof target === "string") await refreshWorkspace(target);
      }
    })();
  }

  function reset(): void {
    setCapture(undefined); setResults(undefined); setCustomer(undefined); setCustomerSnapshot(null);
    setFulfillmentSnapshot(null); setSelectedContact(undefined); setSelectedAddress(undefined); setPending(undefined);
    setError(undefined); setSourceChannel("phone"); setFulfillmentChannel("delivery");
    setDeliveryInstructions("");
  }

  const locked = busy || error === "denied" || error === "conflict";
  return <div className="flex flex-col gap-4" aria-busy={busy}>
    <div role={error === undefined ? "status" : "alert"} aria-live="polite"
      className={error === undefined ? "text-sm text-text-muted" : "rounded-lg border border-border bg-error-bg p-4 text-sm"}>
      {busy ? "Guardando en el servidor…" : error === undefined ? capture === undefined ? "Crea o recupera un borrador para comenzar."
        : `Borrador ${capture.folio} · versión ${capture.version}` : messages[error]}
      {pending !== undefined && <button className={`${button} ml-3`} onClick={retryPending}>Reintentar misma operación</button>}
      {error === "conflict" && <button className={`${button} ml-3`} onClick={reset}>Volver a la bandeja</button>}
    </div>
    {capture === undefined ? <>
      <section className={panel}><h2 className="font-heading text-lg font-semibold">Abrir captura</h2>
        <p className="my-2 text-sm text-text-muted">Crea un borrador durable para una llamada con entrega a domicilio.</p>
        <button className={button} onClick={create} disabled={busy}>Nueva captura telefónica</button></section>
      {tray.length > 0 && <section className={panel}><h2 className="font-heading text-lg font-semibold">Borradores recuperables</h2>
        <p className="my-2 text-sm text-text-muted">Retoma una captura de esta sucursal. El servidor asignará un lease nuevo antes de editar.</p>
        <div className="grid gap-2">{tray.map((item) => <button key={item.captureDraftId} className={`${button} text-left`}
          disabled={busy} onClick={() => recover(item)}><strong className="block">{item.folio}</strong>
          <span className="text-xs text-text-muted">{item.sourceChannel} · {item.fulfillmentChannel} · versión {item.version}</span></button>)}</div>
      </section>}
    </> : <>
      <section className={panel}><h2 className="font-heading text-lg font-semibold">Canal y cumplimiento</h2>
        <div className="mt-3 flex flex-wrap gap-3"><label className="text-sm">Origen <select value={sourceChannel} onChange={changeSource}
          className={`${input} ml-2`} disabled={locked}><option value="phone">Teléfono</option><option value="whatsapp_manual">WhatsApp manual</option>
          <option value="counter">Mostrador</option><option value="table">Mesa</option><option value="self_service">Autoservicio</option></select></label>
        <label className="text-sm">Cumplimiento <select value={fulfillmentChannel ?? ""} onChange={changeFulfillment}
          className={`${input} ml-2`} disabled={locked || fulfillmentSnapshot !== null}><option value="">Sin definir</option><option value="delivery">Domicilio</option>
          <option value="pickup" disabled={fulfillmentSnapshot !== null}>Recoger</option><option value="counter" disabled={fulfillmentSnapshot !== null}>Mostrador</option>
          <option value="dine_in" disabled={fulfillmentSnapshot !== null}>Mesa</option></select></label></div>
      </section>
      {customerSnapshot !== null && <section className={panel} data-testid="rehydrated-customer-snapshot">
        <h2 className="font-heading text-lg font-semibold">Cliente guardado</h2><p className="mt-2"><strong>{customerSnapshot.displayName}</strong><br />
          {customerSnapshot.phoneDisplayValue}</p>{fulfillmentSnapshot !== null && <p className="mt-2 text-sm">
          <strong>{fulfillmentSnapshot.label}</strong><br />{[fulfillmentSnapshot.streetLine, fulfillmentSnapshot.unit,
            fulfillmentSnapshot.neighborhood, fulfillmentSnapshot.locality].filter(Boolean).join(", ")}</p>}
        <p className="mt-2 text-xs text-text-muted">Datos congelados al guardar esta captura.</p></section>}
      {fulfillmentChannel === "delivery" && <section className={panel}>
        <h2 className="font-heading text-lg font-semibold">Instrucciones para esta entrega</h2>
        <p className="mt-1 text-sm text-text-muted">Se guardan en esta captura; nunca modifican la dirección del cliente ni se heredan automáticamente.</p>
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
        <form onSubmit={search} className="mt-3 flex flex-wrap gap-3"><select name="mode" className={input} disabled={locked}>
          <option value="phone">Teléfono</option><option value="name">Nombre</option><option value="address">Dirección</option></select>
          <input name="query" required maxLength={200} className={`${input} min-w-48 flex-1`} placeholder="Teléfono, nombre o dirección" disabled={locked}/>
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
      <aside className="rounded-xl border border-[oklch(80%_0.08_75)] bg-[oklch(96%_0.03_75)] p-4 text-sm"><strong>Captura abierta.</strong> Los cambios guardados incrementan una versión; recargar exige recuperar un lease nuevo.</aside>
    </>}
  </div>;
}
