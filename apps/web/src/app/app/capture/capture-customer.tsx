"use client";

import { useState, type ReactNode } from "react";
import type {
  BranchScope,
  CustomerAddressFieldsV1,
  CustomerDirectoryDetailAddressV1,
  CustomerDirectoryDetailV1,
} from "@super-restaurant/shared-types";
import { formatDeliveryMatch } from "../../../lib/delivery-zones";
import { uiButton } from "../../../lib/ui-classes";
import { matchDeliveryAddress } from "../delivery-match-action";
import { AddressForm, type CustomerAction, type CustomerActionResult } from "../customers/customer-editor";

const button = uiButton();

type RowNote = { readonly key: string; readonly text: string; readonly conflict: boolean; readonly blocked: "coverage" | "validation" | false };

const errorTexts = {
  invalid: "Revisa los datos de la dirección.",
  denied: "Tu sesión o permisos ya no permiten editar este cliente.",
  conflict: "Estos datos cambiaron en otra estación. Actualiza antes de continuar.",
  missing: "El cliente o la dirección ya no está disponible.",
  unavailable: "No se pudo confirmar el resultado. Reintenta.",
} as const;

export interface CaptureCustomerCardProps {
  readonly scope: BranchScope;
  readonly deviceId: string;
  readonly locked: boolean;
  readonly detail: CustomerDirectoryDetailV1;
  /** The phone currently saved in the capture for this customer, if any. */
  readonly selectedContact: string | undefined;
  /** True only when the capture already holds a customer snapshot for this very customer. */
  readonly customerSaved: boolean;
  readonly selectedAddress: string | undefined;
  readonly directoryAction: (operation: CustomerAction, input: unknown) => Promise<CustomerActionResult>;
  readonly onDetail: (detail: CustomerDirectoryDetailV1) => void;
  readonly onSelectPhone: (contactId: string) => void;
  readonly onUseAddress: (addressId: string, version: number) => Promise<"ok" | "busy" | "error">;
}

export function CaptureCustomerCard({ scope, deviceId, locked, detail, selectedContact, customerSaved, selectedAddress,
  directoryAction, onDetail, onSelectPhone, onUseAddress }: CaptureCustomerCardProps): ReactNode {
  const [working, setWorking] = useState<string>();
  const [note, setNote] = useState<RowNote>();
  const [editing, setEditing] = useState<string>();
  const customerId = detail.customer.customerId;
  const phone = detail.customer.phones.find((item) => item.contactId === selectedContact);
  const disabled = locked || working !== undefined;
  const canUse = customerSaved && !disabled;

  function command(expectedVersion: number): Record<string, unknown> {
    return { schemaVersion: 1, scope, customerId, expectedVersion, deviceId, eventId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(), occurredAt: new Date().toISOString() };
  }

  async function refresh(): Promise<void> {
    setWorking("refresh");
    try {
      const reply = await directoryAction("detail", { schemaVersion: 1, scope, customerId });
      if (reply.ok && "customer" in reply.value) { onDetail(reply.value); setNote(undefined); }
      else setNote({ key: "card", text: errorTexts.unavailable, conflict: false, blocked: false });
    } catch { setNote({ key: "card", text: errorTexts.unavailable, conflict: false, blocked: false }); }
    setWorking(undefined);
  }

  function fail(key: string, reply: Extract<CustomerActionResult, { ok: false }>): void {
    setNote({ key, text: errorTexts[reply.error], conflict: reply.error === "conflict", blocked: false });
  }

  /** validate (when needed) -> informational coverage -> select for the capture, all in one tap. */
  async function useAddress(item: CustomerDirectoryDetailAddressV1): Promise<void> {
    const key = item.addressId;
    setNote(undefined);
    let current = item;
    if (!item.validatedForRequestedBranch) {
      let reply: CustomerActionResult;
      try { reply = await directoryAction("validate", { ...command(item.version), addressId: item.addressId }); }
      catch { reply = { ok: false, error: "unavailable" }; }
      if (!reply.ok) { fail(key, reply); return; }
      if (!("customer" in reply.value)) { setNote({ key, text: errorTexts.unavailable, conflict: false, blocked: false }); return; }
      onDetail(reply.value);
      const fresh = reply.value.addresses.find((entry) => entry.addressId === item.addressId);
      if (fresh === undefined || !fresh.validatedForRequestedBranch) {
        setNote({ key, text: "La dirección no quedó validada para esta sucursal.", conflict: false, blocked: "validation" });
        return;
      }
      current = fresh;
    }
    try {
      const match = await matchDeliveryAddress({ schemaVersion: 1, ...scope,
        address: { postalCode: current.address.postalCode, locality: current.address.locality } });
      if (match.ok && match.value.coverageStatus === "not_covered") {
        setNote({ key, text: `${formatDeliveryMatch(match.value, "es-MX")}. Esta sucursal no entrega ahí.`, conflict: false, blocked: "coverage" });
        return;
      }
    } catch { /* Coverage is informational here; the quote step confirms it. */ }
    let saved = await onUseAddress(current.addressId, current.version);
    if (saved === "busy") {
      setNote({ key, text: "Espera a que termine la operación en curso.", conflict: false, blocked: false });
      await new Promise<void>((resolve) => { setTimeout(resolve, 300); });
      saved = await onUseAddress(current.addressId, current.version);
    }
    if (saved === "ok") setNote(undefined);
    else setNote({ key, text: saved === "busy" ? "Espera a que termine la operación en curso." : errorTexts.unavailable, conflict: false, blocked: false });
  }

  async function saveAddress(existing: CustomerDirectoryDetailAddressV1 | undefined, fields: CustomerAddressFieldsV1): Promise<void> {
    const key = existing?.addressId ?? "new";
    const addressId = existing?.addressId ?? crypto.randomUUID();
    setWorking(key); setNote(undefined);
    try {
      let reply: CustomerActionResult;
      try { reply = await directoryAction("address", { ...command(existing?.version ?? 0), addressId, address: fields }); }
      catch { reply = { ok: false, error: "unavailable" }; }
      if (!reply.ok) { fail(key, reply); return; }
      if (!("customer" in reply.value)) { setNote({ key, text: errorTexts.unavailable, conflict: false, blocked: false }); return; }
      onDetail(reply.value);
      setEditing(undefined);
      const saved = reply.value.addresses.find((entry) => entry.addressId === addressId);
      if (saved !== undefined) await useAddress(saved);
    } finally { setWorking(undefined); }
  }

  async function chooseAddress(item: CustomerDirectoryDetailAddressV1): Promise<void> {
    setWorking(item.addressId);
    try { await useAddress(item); } finally { setWorking(undefined); }
  }

  const noteFor = (key: string): ReactNode => note?.key === key && <div role="alert" className="mt-2 text-sm text-error">
    <p>{note.text}</p>
    {note.conflict && <button type="button" className={`${button} mt-2`} disabled={working !== undefined} onClick={() => void refresh()}>Actualizar</button>}
  </div>;

  return <div className="mt-4 rounded-lg border border-border p-3 sm:p-4" data-testid="capture-customer-card">
    <h3 className="font-heading text-base font-semibold">{detail.customer.displayName}</h3>
    {phone !== undefined && customerSaved && <p className="mt-1 text-sm">{phone.label}: {phone.displayValue}</p>}
    {!(customerSaved && phone !== undefined) && <div className="mt-2">
      <p className="text-sm text-text-muted">{detail.customer.phones.length > 1 ? "Elige el teléfono del cliente para este pedido." : "Usa el teléfono del cliente para este pedido."}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{detail.customer.phones.map((item) => <button key={item.contactId} type="button" className={`${button} text-left`}
        disabled={locked || working !== undefined} onClick={() => onSelectPhone(item.contactId)}>{item.label}: {item.displayValue}</button>)}</div>
    </div>}
    <h4 className="mt-4 text-sm font-semibold">Direcciones</h4>
    <p className="mt-1 text-xs text-text-muted">La cobertura se confirma al cotizar la entrega.</p>
    {!customerSaved && detail.addresses.length > 0 && <p className="mt-1 text-xs text-text-muted">Elige primero el teléfono para poder usar una dirección.</p>}
    {detail.addresses.length === 0 && <p className="mt-2 text-sm">Este cliente no tiene direcciones. Agrega una para el domicilio.</p>}
    <div className="mt-2 grid gap-3">{detail.addresses.map((item) => {
      const blocked = note?.key === item.addressId && note.blocked !== false;
      const inUse = selectedAddress === item.addressId;
      return <article key={`${item.addressId}/${item.version}`} className="rounded-lg border border-border p-3">
        <strong className="block">{item.address.label}</strong>
        <span className="block break-words text-sm">{[item.address.streetLine, item.address.unit].filter(Boolean).join(" ")}</span>
        <span className="block break-words text-sm text-text-muted">{[item.address.neighborhood, item.address.locality, item.address.postalCode].filter(Boolean).join(", ")}</span>
        <span className="mt-1 block text-xs font-semibold">{note?.key === item.addressId && note.blocked === "coverage" ? "Fuera de cobertura"
          : item.validatedForRequestedBranch && !(note?.key === item.addressId && note.blocked === "validation") ? "Validada para esta sucursal" : "Sin validar"}{inUse ? " · En uso en esta captura" : ""}</span>
        {editing === item.addressId ? <div className="mt-3"><AddressForm item={item} disabled={disabled}
          onSave={(fields) => void saveAddress(item, fields)} onCancel={() => setEditing(undefined)} /></div>
          : <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={button} disabled={!canUse || blocked} onClick={() => void chooseAddress(item)}>
              {working === item.addressId ? "Validando…" : "Usar esta dirección"}</button>
            <button type="button" className={button} disabled={disabled} onClick={() => { setNote(undefined); setEditing(item.addressId); }}>Editar</button>
          </div>}
        {noteFor(item.addressId)}
      </article>;
    })}</div>
    {detail.addressesTruncated && <p role="status" className="mt-2 text-xs text-text-muted">Se muestran las primeras 20 direcciones.</p>}
    {editing === "new" ? <div className="mt-3"><AddressForm disabled={disabled} onSave={(fields) => void saveAddress(undefined, fields)} onCancel={() => setEditing(undefined)} /></div>
      : <button type="button" className={`${button} mt-3`} disabled={disabled} onClick={() => { setNote(undefined); setEditing("new"); }}>Agregar dirección</button>}
    {noteFor("new")}{noteFor("card")}
    <a href="/app/customers" className="mt-3 block text-sm text-accent underline">Abrir el cliente en Directorio</a>
  </div>;
}
