"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import type { BranchScope, CustomerDirectoryDetailV1, CustomerDirectoryDetailAddressV1, CustomerDirectorySearchResultV1, CustomerRecentOrderListV1, CustomerPhoneInputV1, CustomerAddressFieldsV1, CustomerSearchModeV1 } from "@super-restaurant/shared-types";
import { Field } from "../../../components/field-hint";
import { getCustomerAutocompleteRequest, getCustomerDirectorySuggestions, insertCustomerDirectorySuggestion, isCurrentCustomerAutocompleteRequest, type CustomerAutocompleteRequest, type CustomerDirectorySuggestion, type CustomerRequestResult } from "../../../lib/customer-directory";
import { countOrderArticles } from "../../../lib/customer-order-history";
import { formatDeliveryMatch } from "../../../lib/delivery-zones";
import { matchDeliveryAddress } from "../delivery-match-action";
import { uiButton } from "../../../lib/ui-classes";

export type CustomerAction = "search" | "detail" | "profile" | "address" | "validate";
export type CustomerActionResult = CustomerRequestResult<CustomerDirectorySearchResultV1 | CustomerDirectoryDetailV1> & { readonly command?: unknown };
export interface CustomerEditorProps {
  readonly scope: BranchScope;
  readonly branchName: string;
  readonly action: (operation: CustomerAction, input: unknown) => Promise<CustomerActionResult>;
  readonly historyAction: (input: unknown) => Promise<{ ok: true; value: CustomerRecentOrderListV1 } | { ok: false }>;
}
const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const buttonClass = uiButton();
const panelClass = "min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5";
const phoneLabels = ["Principal", "Secundario", "Trabajo"] as const;
const addressLabelOptions = ["Casa", "Trabajo"] as const;
const messages = {
  invalid: "Revisa nombre y teléfonos. Para validar una dirección completa calle, localidad y país.",
  denied: "Tu sesión o permisos ya no permiten esta operación. Vuelve a iniciar sesión o consulta al responsable.",
  conflict: "La ficha cambió en otra estación. Recarga la ficha y revisa los cambios antes de guardar otra vez.",
  missing: "No se encontró la ficha en la sucursal autorizada. Busca y selecciona otro cliente.",
  unavailable: "No se pudo confirmar el resultado. Mantén esta página abierta y reintenta la operación para confirmar su resultado.",
};

export function CustomerEditor({ scope, branchName, action, historyAction }: CustomerEditorProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [busyOperation, setBusyOperation] = useState<CustomerAction>();
  const [validatingAddressId, setValidatingAddressId] = useState<string>();
  const [deviceId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<keyof typeof messages>();
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<CustomerDirectorySearchResultV1>();
  const [detail, setDetail] = useState<CustomerDirectoryDetailV1>();
  const [creating, setCreating] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string>();
  const [addressFeedback, setAddressFeedback] = useState<{ addressId: string; message: string; error: boolean }>();
  const feedbackSequence = useRef(0);
  const [pending, setPending] = useState<{ operation: CustomerAction; command: unknown }>();
  const [search, setSearch] = useState<{ mode: CustomerSearchModeV1; query: string }>();
  const [searchMode, setSearchMode] = useState<CustomerSearchModeV1>("phone");
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [autocompleteResult, setAutocompleteResult] = useState<{ readonly request: CustomerAutocompleteRequest; readonly value: CustomerDirectorySearchResultV1 }>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteSequence = useRef(0);
  const currentSearch = useRef({ mode: searchMode, input: searchQuery });
  currentSearch.current = { mode: searchMode, input: searchQuery };
  const autocompleteRequest = useMemo(() => getCustomerAutocompleteRequest(searchMode, searchQuery), [searchMode, searchQuery]);
  const suggestionResult = autocompleteResult !== undefined
    && isCurrentCustomerAutocompleteRequest(autocompleteResult.request, searchMode, searchQuery) ? autocompleteResult.value : undefined;
  const suggestions = useMemo(() => getCustomerDirectorySuggestions(suggestionResult, searchMode, searchQuery), [suggestionResult, searchMode, searchQuery]);
  const customerOptions = suggestionResult?.candidates ?? [];
  const optionCount = suggestions.length + customerOptions.length;
  const locked = busy || pending !== undefined || error === "denied";

  useEffect(() => {
    autocompleteSequence.current += 1;
    const sequence = autocompleteSequence.current;
    if (autocompleteRequest === undefined || locked) { setAutocompleteLoading(false); return; }
    setAutocompleteLoading(true);
    const timeout = window.setTimeout(() => {
      void action("search", { schemaVersion: 1, scope, ...autocompleteRequest, limit: 10, cursor: null })
        .then(reply => {
          const current = currentSearch.current;
          if (sequence !== autocompleteSequence.current
            || !isCurrentCustomerAutocompleteRequest(autocompleteRequest, current.mode, current.input)
            || !reply.ok || !("candidates" in reply.value)) return;
          setAutocompleteResult({ request: autocompleteRequest, value: reply.value });
          setActiveSuggestion(-1);
          setSuggestionsOpen(document.activeElement === searchInputRef.current);
        })
        .catch(() => undefined)
        .finally(() => { if (sequence === autocompleteSequence.current) setAutocompleteLoading(false); });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [action, autocompleteRequest, locked, scope]);

  async function run(operation: CustomerAction, command: unknown): Promise<void> {
    if (busy) return;
    const sequence = ++feedbackSequence.current;
    setBusy(true); setBusyOperation(operation); setError(undefined); setNotice("");
    if (operation === "validate" && typeof command === "object" && command !== null && "addressId" in command && typeof command.addressId === "string") setValidatingAddressId(command.addressId);
    if (operation === "address" || operation === "detail") setAddressFeedback(undefined);
    let reply: CustomerActionResult;
    try { reply = await action(operation, command); }
    catch { reply = { ok: false, error: "unavailable", command }; }
    setBusy(false); setBusyOperation(undefined); setValidatingAddressId(undefined);
    if (!reply.ok) {
      setError(reply.error);
      if (sequence === feedbackSequence.current && operation === "validate" && typeof command === "object" && command !== null && "addressId" in command && typeof command.addressId === "string")
        setAddressFeedback({ addressId: command.addressId, message: messages[reply.error], error: true });
      setSuggestionsOpen(false);
      if (reply.error === "unavailable" && ["profile", "address", "validate"].includes(operation)) setPending({ operation, command: reply.command ?? command });
      else setPending(undefined);
      return;
    }
    setPending(undefined);
    if ("candidates" in reply.value) { setResult(reply.value); setDetail(undefined); setCreating(false); setCreatedCustomerId(undefined); setAddingAddress(false); setActiveSuggestion(-1); setSuggestionsOpen(document.activeElement === searchInputRef.current); }
    else {
      setDetail(reply.value);
      if (operation === "profile" && creating) setCreatedCustomerId(reply.value.customer.customerId);
      setCreating(false);
      if (operation === "detail" || operation === "address") setAddingAddress(false);
      if (operation === "validate" && typeof command === "object" && command !== null && "addressId" in command && typeof command.addressId === "string") {
        const addressId = command.addressId;
        const address = reply.value.addresses.find(item => item.addressId === addressId);
        let message = `Revisión registrada para ${branchName}. No se pudo consultar la cobertura; cotiza en captura.`;
        if (address !== undefined) {
          try {
            const match = await matchDeliveryAddress({ schemaVersion: 1, ...scope,
              address: { postalCode: address.address.postalCode, locality: address.address.locality } });
            if (match.ok) message = `${formatDeliveryMatch(match.value, "es-MX")}. Consulta informativa; cotiza sobre la captura antes de confirmar.`;
          } catch { /* The address review succeeded even if this read-only lookup failed. */ }
        }
        if (sequence === feedbackSequence.current) setAddressFeedback({ addressId, message, error: false });
      }
      if (operation !== "detail") setNotice(operation === "validate" ? `Revisión registrada para ${branchName}.` : "Ficha guardada. Las direcciones editadas requieren validación nuevamente.");
    }
  }
  function base(customerId: string, expectedVersion: number) {
    return { schemaVersion: 1, scope, customerId, expectedVersion, deviceId,
      eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), occurredAt: new Date().toISOString() };
  }
  function read(customerId: string) { void run("detail", { schemaVersion: 1, scope, customerId }); }
  function searchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    setSearch({ query, mode: searchMode });
    void run("search", { schemaVersion: 1, scope, mode: searchMode, query, limit: 20, cursor: null });
  }
  function acceptSuggestion(suggestion: CustomerDirectorySuggestion): void {
    setSearchQuery(insertCustomerDirectorySuggestion(searchQuery, suggestion.value, searchMode));
    setActiveSuggestion(-1);
    setSuggestionsOpen(true);
    searchInputRef.current?.focus();
  }
  function acceptCustomer(customerId: string): void {
    setActiveSuggestion(-1);
    setSuggestionsOpen(false);
    read(customerId);
  }
  function searchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") { setSuggestionsOpen(false); setActiveSuggestion(-1); return; }
    if (optionCount === 0 || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    if (event.key === "Enter" && (!suggestionsOpen || activeSuggestion < 0)) return;
    event.preventDefault();
    if (event.key === "ArrowDown") {
      setSuggestionsOpen(true);
      setActiveSuggestion(current => current < optionCount - 1 ? current + 1 : 0);
    } else if (event.key === "ArrowUp") {
      setSuggestionsOpen(true);
      setActiveSuggestion(current => current > 0 ? current - 1 : optionCount - 1);
    } else {
      const suggestion = suggestions[activeSuggestion];
      if (suggestion !== undefined) acceptSuggestion(suggestion);
      else {
        const customer = customerOptions[activeSuggestion - suggestions.length];
        if (customer !== undefined) acceptCustomer(customer.customerId);
      }
    }
  }
  return <div className="flex min-w-0 flex-col gap-4" aria-busy={busy}>
    <div aria-live="polite" role={error === undefined ? "status" : "alert"} className={error === undefined ? "text-sm text-text-muted" : "rounded-lg border border-border bg-error-bg p-4 text-sm"}>
      {busy ? busyOperation === "validate" ? "Validando la dirección para esta sucursal…" : busyOperation === "address" ? "Guardando la dirección…" : "Consultando el directorio…" : error === undefined ? notice : messages[error]}
      {pending !== undefined && <button className={`${buttonClass} mt-3 block`} disabled={busy} onClick={() => void run(pending.operation, pending.command)}>Reintentar la misma operación</button>}
      {error === "conflict" && detail !== undefined && <button className={`${buttonClass} mt-3 block`} disabled={busy} onClick={() => read(detail.customer.customerId)}>Recargar ficha</button>}
    </div>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <section className={panelClass} aria-labelledby="customer-search-title">
      <h2 id="customer-search-title" className="mb-3 font-heading text-lg font-semibold">Buscar cliente</h2>
      <form onSubmit={searchSubmit} className="flex flex-wrap items-end gap-3">
        <Field className="flex min-w-0 flex-col gap-1 text-sm" hint="Elige con qué dato quieres encontrar al cliente: teléfono, nombre o alias, o dirección." label="Buscar por">{(id) => <><select id={id} name="mode" className={inputClass} disabled={locked} value={searchMode} onChange={event => { setSearchMode(event.target.value as CustomerSearchModeV1); setActiveSuggestion(-1); setSuggestionsOpen(false); }}><option value="phone">Teléfono</option><option value="name">Nombre o alias</option><option value="address">Dirección o referencia</option></select></>}</Field>
        <Field className="relative flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm" hint="Escribe parte del teléfono, nombre o dirección; aparecen sugerencias mientras escribes." label="Dato de búsqueda">{(id) => <><input id={id} ref={searchInputRef} name="query" required maxLength={200} className={inputClass} disabled={locked} autoComplete="off"
            role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && optionCount > 0} aria-controls="customer-search-suggestions"
            aria-activedescendant={suggestionsOpen && activeSuggestion >= 0 ? activeSuggestion < suggestions.length
              ? `customer-suggestion-${suggestions[activeSuggestion]?.id}` : `customer-option-${customerOptions[activeSuggestion - suggestions.length]?.customerId}` : undefined}
            value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setActiveSuggestion(-1); setSuggestionsOpen(true); }}
            onFocus={() => setSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => { if (document.activeElement !== searchInputRef.current) setSuggestionsOpen(false); }, 0)}
            onKeyDown={searchKeyDown} />
          {suggestionsOpen && optionCount > 0 && <ul id="customer-search-suggestions" role="listbox" aria-label="Sugerencias y clientes autorizados" className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
            {suggestions.length > 0 && <li role="presentation" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Completar búsqueda</li>}
            {suggestions.map((suggestion, index) => <li key={suggestion.id} role="presentation">
              <button id={`customer-suggestion-${suggestion.id}`} type="button" role="option" aria-selected={activeSuggestion === index}
                className={`min-h-11 w-full rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${activeSuggestion === index ? "bg-bg" : "hover:bg-bg"}`}
                onMouseDown={event => event.preventDefault()} onPointerMove={() => setActiveSuggestion(index)} onClick={() => acceptSuggestion(suggestion)}>
                <span className="block font-semibold"><span aria-hidden="true">🔎 </span>Buscar: {suggestion.value}</span><span className="block text-xs text-text-muted">De {suggestion.context}</span>
              </button>
            </li>)}
            {customerOptions.length > 0 && <li role="presentation" className="border-t border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Clientes</li>}
            {customerOptions.map((customer, index) => <li key={customer.customerId} role="presentation">
              <button id={`customer-option-${customer.customerId}`} type="button" role="option" aria-selected={activeSuggestion === suggestions.length + index}
                className={`min-h-11 w-full rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${activeSuggestion === suggestions.length + index ? "bg-bg" : "hover:bg-bg"}`}
                onMouseDown={event => event.preventDefault()} onPointerMove={() => setActiveSuggestion(suggestions.length + index)} onClick={() => acceptCustomer(customer.customerId)}>
                <span className="block font-semibold"><span aria-hidden="true">👤 </span>{customer.displayName}</span>
                <span className="block break-words text-xs text-text-muted">{customer.phones.map(phone => phone.displayValue).join(" · ") || "Sin teléfono"}</span>
                <span className="block break-words text-xs text-text-muted">{customer.addresses.map(address => [address.label, address.streetLine, address.locality].filter(Boolean).join(", ")).join(" · ") || "Sin direcciones"}</span>
              </button>
            </li>)}
          </ul>}
          <span aria-live="polite" className="text-xs text-text-muted">{autocompleteLoading ? "Buscando sugerencias autorizadas…" : ""}</span>
        </>}</Field>
        <button className={buttonClass} disabled={locked}>Buscar</button>
        <button type="button" className={buttonClass} disabled={locked} onClick={() => { setDetail(undefined); setCreating(true); setCreatedCustomerId(undefined); setNotice(""); setError(undefined); }}>Alta rápida</button>
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
    <div className="flex min-w-0 flex-col gap-4">
    {createdCustomerId !== undefined && detail?.customer.customerId === createdCustomerId && <Link href="/app/capture" className={`${buttonClass} inline-flex items-center justify-center`}>Ir a captura telefónica</Link>}
    {(creating || detail !== undefined) && <ProfileForm key={detail === undefined ? "new" : `${detail.customer.customerId}/${detail.customer.version}`} customer={detail?.customer} disabled={locked} onSave={(name, phones) => {
      const customerId = detail?.customer.customerId ?? crypto.randomUUID();
      void run("profile", { ...base(customerId, detail?.customer.version ?? 0), displayName: name, phones });
    }} />}
    {detail !== undefined && <section className={panelClass} aria-labelledby="customer-address-title">
      <h2 id="customer-address-title" className="font-heading text-lg font-semibold">Direcciones · {detail.customer.displayName}</h2>
      <p className="mt-1 text-sm text-text-muted">Guarda datos incompletos durante la llamada. Validar registra que la sucursal revisó esta dirección; no geocodifica ni garantiza por sí solo la zona de reparto. Cada edición elimina la validación anterior.</p>
      {detail.addressesTruncated && <p role="status" className="mt-2 text-sm">Se muestran las primeras 20 direcciones. Hay más direcciones en la ficha.</p>}
      <div className="mt-4 flex flex-col gap-4">{detail.addresses.map(address => <AddressForm key={`${address.addressId}/${address.version}`} item={address} branchName={branchName} feedback={addressFeedback?.addressId === address.addressId ? addressFeedback : undefined} validating={validatingAddressId === address.addressId} disabled={locked}
        onEdit={() => { feedbackSequence.current += 1; setAddressFeedback(current => current?.addressId === address.addressId ? undefined : current); }}
        onSave={fields => void run("address", { ...base(detail.customer.customerId, address.version), addressId: address.addressId, address: fields })}
        onValidate={() => void run("validate", { ...base(detail.customer.customerId, address.version), addressId: address.addressId })} />)}
        {addingAddress && <AddressForm key={`new/${detail.customer.customerId}/${detail.addresses.length}`} disabled={locked} onCancel={() => setAddingAddress(false)}
          onSave={fields => void run("address", { ...base(detail.customer.customerId, 0), addressId: crypto.randomUUID(), address: fields })} />}
      </div>
      {!addingAddress && <button type="button" className={`${buttonClass} mt-4`} disabled={locked} onClick={() => setAddingAddress(true)}>+ Nueva dirección</button>}
    </section>}
    {detail !== undefined && <CustomerHistory key={detail.customer.customerId} customerId={detail.customer.customerId} scope={scope} action={historyAction} />}
    </div></div>
  </div>;
}

function CustomerHistory({ customerId, scope, action }: {
  readonly customerId: string;
  readonly scope: BranchScope;
  readonly action: CustomerEditorProps["historyAction"];
}): ReactNode {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; value: CustomerRecentOrderListV1 }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const requestSequence = useRef(0);
  const selectedCustomerId = useRef(customerId);
  selectedCustomerId.current = customerId;

  useEffect(() => {
    const sequence = ++requestSequence.current;
    setState({ status: "loading" });
    void action({ schemaVersion: 1, scope, customerId, limit: 10 })
      .then(reply => {
        if (sequence !== requestSequence.current || customerId !== selectedCustomerId.current) return;
        setState(reply.ok && reply.value.customerId === customerId
          ? { status: "ready", value: reply.value } : { status: "error" });
      })
      .catch(() => {
        if (sequence === requestSequence.current && customerId === selectedCustomerId.current) setState({ status: "error" });
      });
    return () => { requestSequence.current += 1; };
  }, [action, attempt, customerId, scope]);

  return <section className={panelClass} aria-labelledby="customer-history-title">
    <h2 id="customer-history-title" className="font-heading text-lg font-semibold">Historial reciente</h2>
    {state.status === "loading" && <p role="status" className="mt-2 text-sm text-text-muted">Cargando historial…</p>}
    {state.status === "error" && <div className="mt-2">
      <p role="alert" className="text-sm text-error">No se pudo cargar el historial.</p>
      <button type="button" className={`${buttonClass} mt-2`} onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>Reintentar</button>
    </div>}
    {state.status === "ready" && state.value.orders.length === 0 && <p className="mt-2 text-sm text-text-muted">Sin pedidos recientes en esta sucursal.</p>}
    {state.status === "ready" && state.value.orders.map(order => <div key={order.orderId} className="mt-3 rounded-lg border border-border p-3 text-sm">
      <p className="font-semibold">{new Date(order.confirmedAt).toLocaleString("es-MX")} · {countOrderArticles(order.items)} artículos</p>
      <p className="text-text-muted">{order.items.map(item => item.productName).join(" · ")}</p>
    </div>)}
  </section>;
}

function ProfileForm({ customer, disabled, onSave }: {
  readonly customer?: CustomerDirectoryDetailV1["customer"] | undefined; readonly disabled: boolean;
  readonly onSave: (name: string, phones: readonly CustomerPhoneInputV1[]) => void;
}): ReactNode {
  const [phones, setPhones] = useState<readonly CustomerPhoneInputV1[]>(customer?.phones ?? []);
  return <section className={panelClass}><h2 className="mb-3 font-heading text-lg font-semibold">{customer === undefined ? "Alta rápida" : "Ficha del cliente"}</h2>
    <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onSave(String(data.get("displayName") ?? "").trim(), phones.map(phone => ({ ...phone, label: phone.label.trim(), displayValue: phone.displayValue.trim() }))); }}>
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
        <Field className="flex flex-col gap-1 text-sm" hint="Cómo identificas al cliente al tomar el pedido; puede ser su nombre o un apodo." label="Nombre o alias">{(id) => <><input id={id} name="displayName" required maxLength={120} defaultValue={customer?.displayName ?? ""} className={inputClass} autoComplete="off" /></>}</Field>
        {phones.map((phone, index) => <div key={phone.contactId} className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 basis-28 flex-col gap-2"><Field className="flex flex-col gap-1 text-sm" hint="Tipo de teléfono (casa, celular, trabajo) para saber a cuál llamar." label={`Etiqueta de teléfono ${index + 1}`}>{(id) => <><select id={id} className={inputClass} value={phoneLabels.includes(phone.label as typeof phoneLabels[number]) ? phone.label : "Otro"} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, label: event.target.value === "Otro" ? "" : event.target.value } : item))}>{phoneLabels.map(label => <option key={label}>{label}</option>)}<option>Otro</option></select></>}</Field>{!phoneLabels.includes(phone.label as typeof phoneLabels[number]) && <Field className="flex flex-col gap-1 text-sm" hint="Escribe cómo quieres llamar a este teléfono, por ejemplo Oficina." label="Otra etiqueta">{(id) => <><input id={id} required maxLength={40} className={inputClass} value={phone.label} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, label: event.target.value } : item))} /></>}</Field>}</div>
          <Field className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm" hint="Número con el que se encuentra al cliente la próxima vez. Escríbelo tal como lo marcarías." label={`Teléfono ${index + 1}`}>{(id) => <><input id={id} type="tel" required maxLength={80} className={inputClass} value={phone.displayValue} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, displayValue: event.target.value } : item))} /></>}</Field>
          <button type="button" className={buttonClass} aria-label={`Quitar teléfono ${index + 1} de la ficha`} onClick={() => setPhones(phones.filter(item => item.contactId !== phone.contactId))}>Quitar</button>
        </div>)}
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={phones.length >= 20} onClick={() => setPhones([...phones, { contactId: crypto.randomUUID(), label: "Principal", displayValue: "" }])}>Añadir teléfono</button>
          <button className={buttonClass}>Guardar ficha</button></div>
      </fieldset>
    </form>
  </section>;
}

const primaryAddressLabels = { streetLine: "Calle y número", unit: "Interior", neighborhood: "Colonia", references: "Referencias" } as const;
const additionalAddressLabels = { locality: "Localidad", region: "Estado o región", countryCode: "País (código de dos letras)", postalCode: "Código postal" } as const;
const addressLabels = { ...primaryAddressLabels, ...additionalAddressLabels } as const;
const addressHints = {
  streetLine: "Calle y número exterior donde se entrega.",
  unit: "Número de departamento, piso o interior, si aplica.",
  neighborhood: "Colonia o barrio; ayuda a validar la zona de entrega.",
  references: "Indicaciones para el repartidor: entre qué calles, color de la casa, portón, etc.",
  locality: "Ciudad o municipio; se usa para validar la zona de entrega.",
  region: "Estado o región de la dirección.",
  countryCode: "Código ISO de dos letras, por ejemplo MX.",
  postalCode: "Código postal; se usa para validar la zona de entrega.",
} as const satisfies Record<keyof typeof addressLabels, string>;
function AddressForm({ item, branchName, feedback, validating = false, disabled, onSave, onValidate, onCancel, onEdit }: {
  readonly item?: CustomerDirectoryDetailAddressV1; readonly disabled: boolean;
  readonly branchName?: string; readonly feedback?: { message: string; error: boolean } | undefined; readonly validating?: boolean;
  readonly onSave: (fields: CustomerAddressFieldsV1) => void; readonly onValidate?: () => void; readonly onCancel?: () => void;
  readonly onEdit?: () => void;
}): ReactNode {
  const [dirty, setDirty] = useState(false);
  const [addressLabel, setAddressLabel] = useState(item?.address.label ?? "Casa");
  return <form className="rounded-lg border border-border p-3" onChange={() => { setDirty(true); onEdit?.(); }} onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const fields = Object.fromEntries(Object.keys(addressLabels).map(key => { const value = String(data.get(key) ?? "").trim(); return [key, value === "" ? null : key === "countryCode" ? value.toUpperCase() : value]; }));
    onSave({ ...fields, label: addressLabel.trim(), instructions: item?.address.instructions ?? null, coordinates: item?.address.coordinates ?? null } as unknown as CustomerAddressFieldsV1);
  }}>
    <h3 className="mb-2 font-semibold">{item?.address.label ?? "Nueva dirección"}</h3>
    {item !== undefined && <div className="mb-3"><span className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${!dirty && item.validatedForRequestedBranch ? "border-success text-text" : "border-border text-text-muted"}`}>{dirty ? "Cambios sin guardar · revalidar al guardar" : item.validatedForRequestedBranch ? `Dirección revisada para ${branchName}` : "Sin revisar en esta sucursal"}</span>{!dirty && item.validatedForRequestedBranch && <p className="mt-2 break-words text-xs text-text-muted">Datos revisados: {[item.address.streetLine, item.address.locality, item.address.postalCode].filter(Boolean).join(", ")}. Cotiza en captura antes de confirmar.</p>}</div>}
    {!dirty && feedback !== undefined && <p role={feedback.error ? "alert" : "status"} className={`mb-3 rounded-lg border p-3 text-sm ${feedback.error ? "border-error bg-error-bg" : "border-success"}`}>{feedback.message}</p>}
    {validating && <p role="status" className="mb-3 text-sm text-text-muted">Validando esta dirección…</p>}
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2"><Field className="flex flex-col gap-1 text-sm" hint="Nombre corto para reconocer la dirección: Casa, Oficina, etc." label="Etiqueta de dirección">{(id) => <><select id={id} className={inputClass} value={addressLabelOptions.includes(addressLabel as typeof addressLabelOptions[number]) ? addressLabel : "Otro"} onChange={event => setAddressLabel(event.target.value === "Otro" ? "" : event.target.value)}>{addressLabelOptions.map(label => <option key={label}>{label}</option>)}<option>Otro</option></select></>}</Field>{!addressLabelOptions.includes(addressLabel as typeof addressLabelOptions[number]) && <Field className="flex flex-col gap-1 text-sm" hint="Escribe cómo quieres llamar a esta dirección." label="Otra etiqueta">{(id) => <><input id={id} required maxLength={40} className={inputClass} value={addressLabel} onChange={event => setAddressLabel(event.target.value)} /></>}</Field>}<span className="text-xs text-text-muted">Nombre corto para reconocer la dirección.</span></div>
      {Object.entries(primaryAddressLabels).map(([key, label]) => <Field key={key} className={`flex min-w-0 flex-col gap-1 text-sm ${key === "references" ? "sm:col-span-2" : ""}`} hint={addressHints[key as keyof typeof addressHints]} label={label}>{(id) => <>
        <input id={id} name={key} maxLength={key === "references" ? 500 : 200} defaultValue={item?.address[key as keyof typeof primaryAddressLabels] ?? ""} autoComplete="off" className={inputClass} />
      </>}</Field>)}
      <details className="sm:col-span-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Datos adicionales</summary>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">{Object.entries(additionalAddressLabels).map(([key, label]) => <Field key={key} className="flex min-w-0 flex-col gap-1 text-sm" hint={addressHints[key as keyof typeof addressHints]} label={label}>{(id) => <>
          <input id={id} name={key} maxLength={key === "countryCode" ? 2 : 200} defaultValue={item?.address[key as keyof typeof additionalAddressLabels] ?? ""} autoComplete="off" className={inputClass} />
        </>}</Field>)}</div>
      </details>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button className={buttonClass}>Guardar dirección</button>
        {onCancel !== undefined && <button type="button" className={buttonClass} onClick={onCancel}>Cancelar</button>}
        {onValidate !== undefined && <button type="button" className={buttonClass} disabled={disabled || dirty || item?.validatedForRequestedBranch === true} onClick={onValidate}>{dirty ? "Validar para esta sucursal" : item?.validatedForRequestedBranch ? `Revisada para ${branchName}` : validating ? "Validando…" : "Validar para esta sucursal"}</button>}</div>
    </fieldset>
  </form>;
}
