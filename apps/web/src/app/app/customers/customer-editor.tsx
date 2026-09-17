"use client";

import { useState, type ReactNode, type FormEvent } from "react";
import type { BranchScope, CustomerDirectoryDetailV1, CustomerDirectoryDetailAddressV1, CustomerDirectorySearchResultV1, CustomerPhoneInputV1, CustomerAddressFieldsV1 } from "@super-restaurant/shared-types";
import type { CustomerRequestResult } from "../../../lib/customer-directory";

export type CustomerAction = "search" | "detail" | "profile" | "address" | "validate";
export type CustomerActionResult = CustomerRequestResult<CustomerDirectorySearchResultV1 | CustomerDirectoryDetailV1> & { readonly command?: unknown };
export interface CustomerEditorProps {
  readonly scope: BranchScope;
  readonly action: (operation: CustomerAction, input: unknown) => Promise<CustomerActionResult>;
}
const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const buttonClass = "min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const panelClass = "min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5";
const messages = {
  invalid: "Revisa nombre y teléfonos. Para validar una dirección completa calle, localidad y país.",
  denied: "Tu sesión o permisos ya no permiten esta operación. Vuelve a iniciar sesión o consulta al responsable.",
  conflict: "La ficha cambió en otra estación. Recarga la ficha y revisa los cambios antes de guardar otra vez.",
  missing: "No se encontró la ficha en la sucursal autorizada. Busca y selecciona otro cliente.",
  unavailable: "No se pudo confirmar el resultado. Mantén esta página abierta y reintenta la operación para confirmar su resultado.",
};

export function CustomerEditor({ scope, action }: CustomerEditorProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [deviceId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<keyof typeof messages>();
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<CustomerDirectorySearchResultV1>();
  const [detail, setDetail] = useState<CustomerDirectoryDetailV1>();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ operation: CustomerAction; command: unknown }>();
  const [search, setSearch] = useState<{ mode: string; query: string }>();
  const locked = busy || pending !== undefined || error === "denied";

  async function run(operation: CustomerAction, command: unknown): Promise<void> {
    if (busy) return;
    setBusy(true); setError(undefined); setNotice("");
    let reply: CustomerActionResult;
    try { reply = await action(operation, command); }
    catch { reply = { ok: false, error: "unavailable", command }; }
    setBusy(false);
    if (!reply.ok) {
      setError(reply.error);
      if (reply.error === "unavailable" && ["profile", "address", "validate"].includes(operation)) setPending({ operation, command: reply.command ?? command });
      else setPending(undefined);
      return;
    }
    setPending(undefined);
    if ("candidates" in reply.value) { setResult(reply.value); setDetail(undefined); setCreating(false); }
    else { setDetail(reply.value); setCreating(false); if (operation !== "detail") setNotice(operation === "validate" ? "Dirección validada para esta sucursal." : "Ficha guardada. Las direcciones editadas requieren validación nuevamente."); }
  }
  function base(customerId: string, expectedVersion: number) {
    return { schemaVersion: 1, scope, customerId, expectedVersion, deviceId,
      eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), occurredAt: new Date().toISOString() };
  }
  function read(customerId: string) { void run("detail", { schemaVersion: 1, scope, customerId }); }
  function searchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const query = String(data.get("query") ?? "").trim(); const mode = String(data.get("mode"));
    setSearch({ query, mode });
    void run("search", { schemaVersion: 1, scope, mode, query, limit: 20, cursor: null });
  }
  return <div className="flex min-w-0 flex-col gap-4" aria-busy={busy}>
    <div aria-live="polite" role={error === undefined ? "status" : "alert"} className={error === undefined ? "text-sm text-text-muted" : "rounded-lg border border-border bg-error-bg p-4 text-sm"}>
      {busy ? "Consultando el directorio…" : error === undefined ? notice : messages[error]}
      {pending !== undefined && <button className={`${buttonClass} mt-3 block`} disabled={busy} onClick={() => void run(pending.operation, pending.command)}>Reintentar la misma operación</button>}
      {error === "conflict" && detail !== undefined && <button className={`${buttonClass} mt-3 block`} disabled={busy} onClick={() => read(detail.customer.customerId)}>Recargar ficha</button>}
    </div>
    <section className={panelClass} aria-labelledby="customer-search-title">
      <h2 id="customer-search-title" className="mb-3 font-heading text-lg font-semibold">Buscar cliente</h2>
      <form onSubmit={searchSubmit} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-sm">Buscar por<select name="mode" className={inputClass} disabled={locked}><option value="phone">Teléfono</option><option value="name">Nombre o alias</option><option value="address">Dirección o referencia</option></select></label>
        <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm">Dato de búsqueda<input name="query" required maxLength={200} className={inputClass} disabled={locked} autoComplete="off" /></label>
        <button className={buttonClass} disabled={locked}>Buscar</button>
        <button type="button" className={buttonClass} disabled={locked} onClick={() => { setDetail(undefined); setCreating(true); setNotice(""); setError(undefined); }}>Alta rápida</button>
      </form>
      <p className="mt-3 text-xs text-text-muted">Un teléfono puede pertenecer a varias personas. Revisa nombre y dirección y elige una ficha explícitamente.</p>
      {result !== undefined && <div className="mt-4 flex flex-col gap-2">
        {result.candidates.length === 0 && <p className="text-sm">No hay coincidencias. Puedes registrar un cliente nuevo.</p>}
        {result.candidates.map(candidate => <button key={candidate.customerId} type="button" className={`${buttonClass} text-left`} disabled={locked} onClick={() => read(candidate.customerId)}>
          <span className="block break-words font-semibold">{candidate.displayName}</span>
          <span className="block break-words text-xs text-text-muted">{candidate.phones.map(phone => `${phone.label}: ${phone.displayValue}`).join(" · ") || "Sin teléfono"}</span>
          <span className="block break-words text-xs text-text-muted">{candidate.addresses.map(address => [address.label, address.streetLine, address.neighborhood, address.locality].filter(Boolean).join(", ")).join(" · ") || "Sin direcciones"}</span>
          <span className="mt-1 block text-xs text-accent">Abrir esta ficha</span>
        </button>)}
        {result.nextCursor !== null && search !== undefined && <button className={buttonClass} disabled={locked} onClick={() => void run("search", { schemaVersion: 1, scope, ...search, limit: 20, cursor: result.nextCursor })}>Siguiente página de coincidencias</button>}
      </div>}
    </section>
    {(creating || detail !== undefined) && <ProfileForm key={detail === undefined ? "new" : `${detail.customer.customerId}/${detail.customer.version}`} customer={detail?.customer} disabled={locked} onSave={(name, phones) => {
      const customerId = detail?.customer.customerId ?? crypto.randomUUID();
      void run("profile", { ...base(customerId, detail?.customer.version ?? 0), displayName: name, phones });
    }} />}
    {detail !== undefined && <section className={panelClass} aria-labelledby="customer-address-title">
      <h2 id="customer-address-title" className="font-heading text-lg font-semibold">Direcciones · {detail.customer.displayName}</h2>
      <p className="mt-1 text-sm text-text-muted">Guarda datos incompletos durante la llamada. Validar es una acción separada para esta sucursal; cada edición elimina la validación anterior.</p>
      {detail.addressesTruncated && <p role="status" className="mt-2 text-sm">Se muestran las primeras 20 direcciones. Hay más direcciones en la ficha.</p>}
      <div className="mt-4 flex flex-col gap-4">{detail.addresses.map(address => <AddressForm key={`${address.addressId}/${address.version}`} item={address} disabled={locked}
        onSave={fields => void run("address", { ...base(detail.customer.customerId, address.version), addressId: address.addressId, address: fields })}
        onValidate={() => void run("validate", { ...base(detail.customer.customerId, address.version), addressId: address.addressId })} />)}
        <AddressForm key={`new/${detail.customer.customerId}/${detail.addresses.length}`} disabled={locked}
          onSave={fields => void run("address", { ...base(detail.customer.customerId, 0), addressId: crypto.randomUUID(), address: fields })} />
      </div>
    </section>}
  </div>;
}

function ProfileForm({ customer, disabled, onSave }: {
  readonly customer?: CustomerDirectoryDetailV1["customer"] | undefined; readonly disabled: boolean;
  readonly onSave: (name: string, phones: readonly CustomerPhoneInputV1[]) => void;
}): ReactNode {
  const [phones, setPhones] = useState<readonly CustomerPhoneInputV1[]>(customer?.phones ?? []);
  return <section className={panelClass}><h2 className="mb-3 font-heading text-lg font-semibold">{customer === undefined ? "Alta rápida" : "Ficha del cliente"}</h2>
    <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onSave(String(data.get("displayName") ?? "").trim(), phones.map(phone => ({ ...phone, label: phone.label.trim(), displayValue: phone.displayValue.trim() }))); }}>
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">Nombre o alias<input name="displayName" required maxLength={120} defaultValue={customer?.displayName ?? ""} className={inputClass} autoComplete="off" /></label>
        {phones.map((phone, index) => <div key={phone.contactId} className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 basis-28 flex-col gap-1 text-sm">Etiqueta de teléfono {index + 1}<input required maxLength={40} className={inputClass} value={phone.label} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, label: event.target.value } : item))} /></label>
          <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">Teléfono {index + 1}<input type="tel" required maxLength={80} className={inputClass} value={phone.displayValue} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, displayValue: event.target.value } : item))} /></label>
          <button type="button" className={buttonClass} aria-label={`Quitar teléfono ${index + 1} de la ficha`} onClick={() => setPhones(phones.filter(item => item.contactId !== phone.contactId))}>Quitar</button>
        </div>)}
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={phones.length >= 20} onClick={() => setPhones([...phones, { contactId: crypto.randomUUID(), label: "Principal", displayValue: "" }])}>Añadir teléfono</button>
          <button className={buttonClass}>Guardar ficha</button></div>
      </fieldset>
    </form>
  </section>;
}

const addressLabels = { label: "Etiqueta", streetLine: "Calle y número", unit: "Interior", neighborhood: "Colonia", locality: "Localidad", region: "Estado o región", countryCode: "País (código de dos letras)", postalCode: "Código postal", references: "Referencias", instructions: "Instrucciones de entrega" } as const;
function AddressForm({ item, disabled, onSave, onValidate }: {
  readonly item?: CustomerDirectoryDetailAddressV1; readonly disabled: boolean;
  readonly onSave: (fields: CustomerAddressFieldsV1) => void; readonly onValidate?: () => void;
}): ReactNode {
  const [dirty, setDirty] = useState(false);
  return <form className="rounded-lg border border-border p-3" onChange={() => setDirty(true)} onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const fields = Object.fromEntries(Object.keys(addressLabels).map(key => { const value = String(data.get(key) ?? "").trim(); return [key, value === "" ? null : key === "countryCode" ? value.toUpperCase() : value]; }));
    onSave({ ...fields, coordinates: item?.address.coordinates ?? null } as unknown as CustomerAddressFieldsV1);
  }}>
    <h3 className="mb-2 font-semibold">{item?.address.label ?? "Nueva dirección"}</h3>
    {item !== undefined && <p className="mb-3 text-sm text-text-muted">{dirty ? "Cambios sin guardar. Guarda antes de validar." : item.validatedForRequestedBranch ? "Validada para esta sucursal" : "Pendiente de validación para esta sucursal"}</p>}
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
      {Object.entries(addressLabels).map(([key, label]) => <label key={key} className={`flex min-w-0 flex-col gap-1 text-sm ${key === "references" || key === "instructions" ? "sm:col-span-2" : ""}`}>{label}
        <input name={key} required={key === "label"} maxLength={key === "label" ? 40 : key === "countryCode" ? 2 : key === "references" || key === "instructions" ? 500 : 200} defaultValue={item?.address[key as keyof typeof addressLabels] ?? ""} autoComplete="off" className={inputClass} />
      </label>)}
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button className={buttonClass}>Guardar dirección</button>
        {onValidate !== undefined && <button type="button" className={buttonClass} disabled={dirty || item?.validatedForRequestedBranch === true} onClick={onValidate}>Validar dirección para esta sucursal</button>}</div>
    </fieldset>
  </form>;
}
