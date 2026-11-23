"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import type { BranchScope, CustomerDirectoryDetailV1, CustomerDirectoryDetailAddressV1, CustomerDirectorySearchResultV1, CustomerRecentOrderListV1, CustomerPhoneInputV1, CustomerAddressFieldsV1, CustomerSearchModeV1, SettlementSearchBranchV1, SettlementSummaryV1 } from "@super-restaurant/shared-types";
import { Field } from "../../../components/field-hint";
import { getCustomerAutocompleteRequest, getCustomerDirectorySuggestions, getCustomerPhoneRemoval, insertCustomerDirectorySuggestion, isCurrentCustomerAutocompleteRequest, isCurrentCustomerSearch, selectCurrentCustomerSearch, type CustomerAutocompleteRequest, type CustomerDirectorySuggestion, type CustomerRequestResult, type CustomerSearchSnapshot } from "../../../lib/customer-directory";
import { trapFocusIndex } from "../../../lib/focus-trap";
import { countOrderArticles } from "../../../lib/customer-order-history";
import { formatDeliveryMatch } from "../../../lib/delivery-zones";
import { matchDeliveryAddress } from "../delivery-match-action";
import { searchSettlements } from "../settlement-search-action";
import { uiButton } from "../../../lib/ui-classes";
import { setUnsavedChanges } from "../../../lib/unsaved-changes";

export type CustomerAction = "search" | "detail" | "profile" | "address" | "validate";
export type CustomerActionResult = CustomerRequestResult<CustomerDirectorySearchResultV1 | CustomerDirectoryDetailV1> & { readonly command?: unknown };
export interface CustomerEditorProps {
  readonly scope: BranchScope;
  readonly branchName: string;
  readonly action: (operation: CustomerAction, input: unknown) => Promise<CustomerActionResult>;
  readonly historyAction: (input: unknown) => Promise<{ ok: true; value: CustomerRecentOrderListV1 } | { ok: false }>;
  /** Customer opened from a capture or directory deep link. */
  readonly initialCustomerId?: string | undefined;
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

function searchTarget(command: unknown): CustomerAutocompleteRequest | undefined {
  if (typeof command !== "object" || command === null) return undefined;
  const mode = "mode" in command ? command.mode : undefined;
  const query = "query" in command ? command.query : undefined;
  if ((mode !== "phone" && mode !== "name" && mode !== "address") || typeof query !== "string") return undefined;
  return { mode, query: query.trim() };
}

export function CustomerEditor({ scope, branchName, action, historyAction, initialCustomerId }: CustomerEditorProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [busyOperation, setBusyOperation] = useState<CustomerAction>();
  const [validatingAddressId, setValidatingAddressId] = useState<string>();
  const [deviceId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<keyof typeof messages>();
  const [notice, setNotice] = useState("");
  const [searchSnapshot, setSearchSnapshot] = useState<CustomerSearchSnapshot<CustomerDirectorySearchResultV1>>();
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
  const searchRequestSequence = useRef(0);
  const openedInitialCustomer = useRef(false);
  const currentSearch = useRef({ mode: searchMode, input: searchQuery });
  currentSearch.current = { mode: searchMode, input: searchQuery };
  const autocompleteRequest = useMemo(() => getCustomerAutocompleteRequest(searchMode, searchQuery), [searchMode, searchQuery]);
  const visibleSearchResult = selectCurrentCustomerSearch(searchSnapshot, searchMode, searchQuery);
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

  useEffect(() => {
    if (initialCustomerId === undefined || openedInitialCustomer.current) return;
    openedInitialCustomer.current = true;
    void run("detail", { schemaVersion: 1, scope, customerId: initialCustomerId });
  }, [action, initialCustomerId, scope]);

  async function run(operation: CustomerAction, command: unknown): Promise<void> {
    if (busy) return;
    const searchSequence = operation === "search" ? ++searchRequestSequence.current : undefined;
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
    if ("candidates" in reply.value) {
      const target = searchTarget(command);
      const current = currentSearch.current;
      if (searchSequence === undefined || searchSequence !== searchRequestSequence.current
        || target === undefined || !isCurrentCustomerSearch(target, current.mode, current.input)) return;
      setSearchSnapshot({ ...target, value: reply.value });
      setDetail(undefined); setCreating(false); setCreatedCustomerId(undefined); setAddingAddress(false); setActiveSuggestion(-1); setSuggestionsOpen(document.activeElement === searchInputRef.current);
    }
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
    searchRequestSequence.current += 1;
    setSearchSnapshot(undefined);
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
        <Field className="flex min-w-0 flex-col gap-1 text-sm" hint="Elige con qué dato quieres encontrar al cliente: teléfono, nombre o alias, o dirección." label="Buscar por">{(id) => <><select id={id} name="mode" className={inputClass} disabled={locked} value={searchMode} onChange={event => { setSearchMode(event.target.value as CustomerSearchModeV1); searchRequestSequence.current += 1; setSearchSnapshot(undefined); setActiveSuggestion(-1); setSuggestionsOpen(false); }}><option value="phone">Teléfono</option><option value="name">Nombre o alias</option><option value="address">Dirección o referencia</option></select></>}</Field>
        <Field className="relative flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm" hint="Escribe parte del teléfono, nombre o dirección; aparecen sugerencias mientras escribes." label="Dato de búsqueda">{(id) => <><input id={id} ref={searchInputRef} name="query" required maxLength={200} className={inputClass} disabled={locked} autoComplete="off"
            role="combobox" aria-autocomplete="list" aria-expanded={suggestionsOpen && optionCount > 0} aria-controls="customer-search-suggestions"
            aria-activedescendant={suggestionsOpen && activeSuggestion >= 0 ? activeSuggestion < suggestions.length
              ? `customer-suggestion-${suggestions[activeSuggestion]?.id}` : `customer-option-${customerOptions[activeSuggestion - suggestions.length]?.customerId}` : undefined}
            value={searchQuery} onChange={event => { setSearchQuery(event.target.value); searchRequestSequence.current += 1; setSearchSnapshot(undefined); setActiveSuggestion(-1); setSuggestionsOpen(true); }}
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
      {visibleSearchResult !== undefined && <div className="mt-4 flex flex-col gap-2">
        {visibleSearchResult.candidates.length === 0 && <p className="text-sm">No hay coincidencias. Puedes registrar un cliente nuevo.</p>}
        {visibleSearchResult.candidates.map(candidate => <button key={candidate.customerId} type="button" className={`${buttonClass} text-left`} disabled={locked} onClick={() => read(candidate.customerId)}>
          <span className="block break-words font-semibold">{candidate.displayName}</span>
          <span className="block break-words text-xs text-text-muted">{candidate.phones.map(phone => `${phone.label}: ${phone.displayValue}`).join(" · ") || "Sin teléfono"}</span>
          <span className="block break-words text-xs text-text-muted">{candidate.addresses.map(address => [address.label, address.streetLine, address.neighborhood, address.locality].filter(Boolean).join(", ")).join(" · ") || "Sin direcciones"}</span>
          <span className="mt-1 block text-xs text-accent">Abrir esta ficha</span>
        </button>)}
        {visibleSearchResult.nextCursor !== null && search !== undefined && <button className={buttonClass} disabled={locked} onClick={() => void run("search", { schemaVersion: 1, scope, ...search, limit: 20, cursor: visibleSearchResult.nextCursor })}>Siguiente página de coincidencias</button>}
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
      <div className="mt-4 flex flex-col gap-4">{detail.addresses.map(address => <AddressForm key={`${address.addressId}/${address.version}`} item={address} scope={scope} branchName={branchName} feedback={addressFeedback?.addressId === address.addressId ? addressFeedback : undefined} validating={validatingAddressId === address.addressId} disabled={locked}
        onEdit={() => { feedbackSequence.current += 1; setAddressFeedback(current => current?.addressId === address.addressId ? undefined : current); }}
        onSave={fields => void run("address", { ...base(detail.customer.customerId, address.version), addressId: address.addressId, address: fields })}
        onValidate={() => void run("validate", { ...base(detail.customer.customerId, address.version), addressId: address.addressId })} />)}
        {addingAddress && <AddressForm key={`new/${detail.customer.customerId}/${detail.addresses.length}`} scope={scope} disabled={locked} onCancel={() => setAddingAddress(false)}
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

function PhoneRemovalDialog({ phone, customerName, alsoSavesOtherChanges, problem, onCancel, onConfirm }: {
  readonly phone: CustomerPhoneInputV1;
  readonly customerName: string | undefined;
  readonly alsoSavesOtherChanges: boolean;
  readonly problem: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const headingId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => { opener?.focus(); };
  }, []);
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab" || dialogRef.current === null) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]")]
        .filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0);
      const target = trapFocusIndex(focusable.length, focusable.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (target !== null) { event.preventDefault(); focusable[target]?.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[oklch(10%_0.02_250_/_.45)] p-4 sm:items-center"
    role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={`${headingId}-description`}>
    <div ref={dialogRef} className="w-full max-w-md rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 id={headingId} className="font-heading text-lg font-semibold">Quitar teléfono</h2>
      <p id={`${headingId}-description`} className="mt-2 text-sm">¿Quitar el teléfono {phone.label.trim() || "sin etiqueta"}: {phone.displayValue.trim() || "sin número"} de la ficha de {customerName ?? "este cliente"}?</p>
      <p className="mt-2 text-sm text-text-muted">La ficha se guarda de inmediato.</p>
      {alsoSavesOtherChanges && <p role="note" className="mt-3 rounded-lg border border-border bg-bg p-3 text-sm font-semibold">También se guardarán los demás cambios que hiciste en la ficha.</p>}
      {problem !== undefined && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{problem}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button ref={cancelRef} type="button" className={buttonClass} onClick={onCancel}>Cancelar</button>
        <button type="button" className={uiButton("danger")} onClick={onConfirm}>Quitar y guardar</button>
      </div>
    </div>
  </div>;
}

function ProfileForm({ customer, disabled, onSave }: {
  readonly customer?: CustomerDirectoryDetailV1["customer"] | undefined; readonly disabled: boolean;
  readonly onSave: (name: string, phones: readonly CustomerPhoneInputV1[]) => void;
}): ReactNode {
  const [phones, setPhones] = useState<readonly CustomerPhoneInputV1[]>(customer?.phones ?? []);
  const [removal, setRemoval] = useState<{ readonly phone: CustomerPhoneInputV1; readonly phones: readonly CustomerPhoneInputV1[]; readonly alsoSavesOtherChanges: boolean }>();
  const [removalProblem, setRemovalProblem] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);

  function requestRemoval(phone: CustomerPhoneInputV1): void {
    const displayName = formRef.current === null ? "" : String(new FormData(formRef.current).get("displayName") ?? "");
    const plan = getCustomerPhoneRemoval({ phones, contactId: phone.contactId, displayName,
      savedDisplayName: customer?.displayName ?? "", savedPhones: customer?.phones ?? [] });
    if (plan.blocked) { setRemovalProblem(plan.reason); return; }
    setRemovalProblem(undefined);
    setRemoval({ phone, phones: plan.phones, alsoSavesOtherChanges: plan.alsoSavesOtherChanges });
  }
  function confirmRemoval(): void {
    if (removal === undefined || formRef.current === null) return;
    const displayName = String(new FormData(formRef.current).get("displayName") ?? "").trim();
    if (displayName === "") { setRemovalProblem("Escribe el nombre o alias antes de guardar."); return; }
    if (removal.phones.some(phone => phone.label.trim() === "" || phone.displayValue.trim() === "")) {
      setRemovalProblem("Completa la etiqueta y el número de los demás teléfonos antes de guardar.");
      return;
    }
    onSave(displayName, removal.phones.map(phone => ({ ...phone, label: phone.label.trim(), displayValue: phone.displayValue.trim() })));
    setRemoval(undefined);
  }

  return <section className={panelClass}><h2 className="mb-3 font-heading text-lg font-semibold">{customer === undefined ? "Alta rápida" : "Ficha del cliente"}</h2>
    <form ref={formRef} onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onSave(String(data.get("displayName") ?? "").trim(), phones.map(phone => ({ ...phone, label: phone.label.trim(), displayValue: phone.displayValue.trim() }))); }}>
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
        <Field className="flex flex-col gap-1 text-sm" hint="Cómo identificas al cliente al tomar el pedido; puede ser su nombre o un apodo." label="Nombre o alias">{(id) => <><input id={id} name="displayName" required maxLength={120} defaultValue={customer?.displayName ?? ""} className={inputClass} autoComplete="off" /></>}</Field>
        {phones.map((phone, index) => <div key={phone.contactId} className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 basis-28 flex-col gap-2"><Field className="flex flex-col gap-1 text-sm" hint="Tipo de teléfono (casa, celular, trabajo) para saber a cuál llamar." label={`Etiqueta de teléfono ${index + 1}`}>{(id) => <><select id={id} className={inputClass} value={phoneLabels.includes(phone.label as typeof phoneLabels[number]) ? phone.label : "Otro"} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, label: event.target.value === "Otro" ? "" : event.target.value } : item))}>{phoneLabels.map(label => <option key={label}>{label}</option>)}<option>Otro</option></select></>}</Field>{!phoneLabels.includes(phone.label as typeof phoneLabels[number]) && <Field className="flex flex-col gap-1 text-sm" hint="Escribe cómo quieres llamar a este teléfono, por ejemplo Oficina." label="Otra etiqueta">{(id) => <><input id={id} required maxLength={40} className={inputClass} value={phone.label} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, label: event.target.value } : item))} /></>}</Field>}</div>
          <Field className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm" hint="Número con el que se encuentra al cliente la próxima vez. Escríbelo tal como lo marcarías." label={`Teléfono ${index + 1}`}>{(id) => <><input id={id} type="tel" required maxLength={80} className={inputClass} value={phone.displayValue} onChange={event => setPhones(phones.map(item => item.contactId === phone.contactId ? { ...item, displayValue: event.target.value } : item))} /></>}</Field>
          <button type="button" className={buttonClass} aria-label={`Quitar teléfono ${index + 1} de la ficha`} onClick={() => requestRemoval(phone)}>Quitar</button>
        </div>)}
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={phones.length >= 20} onClick={() => setPhones([...phones, { contactId: crypto.randomUUID(), label: "Principal", displayValue: "" }])}>Añadir teléfono</button>
          <button className={buttonClass}>Guardar ficha</button></div>
      </fieldset>
    </form>
    {removal === undefined && removalProblem !== undefined && <p role="alert" className="mt-3 rounded-lg bg-error-bg p-3 text-sm">{removalProblem}</p>}
    {removal !== undefined && <PhoneRemovalDialog phone={removal.phone} customerName={customer?.displayName} alsoSavesOtherChanges={removal.alsoSavesOtherChanges}
      problem={removalProblem} onCancel={() => { setRemoval(undefined); setRemovalProblem(undefined); }} onConfirm={confirmRemoval} />}
  </section>;
}

function sameSettlementName(left: string, right: string): boolean {
  return left.localeCompare(right, "es", { sensitivity: "base" }) === 0;
}
export function AddressForm({ item, scope, branchName, feedback, validating = false, disabled, onSave, onValidate, onCancel, onEdit }: {
  readonly item?: CustomerDirectoryDetailAddressV1; readonly scope: BranchScope; readonly disabled: boolean;
  readonly branchName?: string; readonly feedback?: { message: string; error: boolean } | undefined; readonly validating?: boolean;
  readonly onSave: (fields: CustomerAddressFieldsV1) => void; readonly onValidate?: () => void; readonly onCancel?: () => void;
  readonly onEdit?: () => void;
}): ReactNode {
  const listId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const legacyLookup = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [addressLabel, setAddressLabel] = useState(item?.address.label ?? "Casa");
  const [query, setQuery] = useState(item?.address.neighborhood ?? "");
  const [selected, setSelected] = useState<SettlementSummaryV1>();
  const [branch, setBranch] = useState<SettlementSearchBranchV1>();
  const [options, setOptions] = useState<readonly SettlementSummaryV1[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [outsideMode, setOutsideMode] = useState(item?.address.settlementOutsideCatalog === true);
  const [outsideName, setOutsideName] = useState(item?.address.settlementOutsideCatalog === true ? item.address.neighborhood ?? "" : "");
  const [outsideConfirmed, setOutsideConfirmed] = useState(false);
  const [formError, setFormError] = useState<string>();
  const deliveryScope = useMemo(() => ({ restaurantId: scope.restaurantId, branchId: scope.branchId }),
    [scope.restaurantId, scope.branchId]);

  useEffect(() => {
    setUnsavedChanges("customer-address", dirty);
    return () => setUnsavedChanges("customer-address", false);
  }, [dirty]);

  /** Legacy rows keep only the readable neighborhood/CP; resolve their settlement once without changing the form. */
  useEffect(() => {
    if (legacyLookup.current || outsideMode || selected !== undefined || item === undefined) return;
    const { neighborhood, postalCode } = item.address;
    if (item.address.settlementOutsideCatalog === true || neighborhood === null || postalCode === null) return;
    legacyLookup.current = true;
    let cancelled = false;
    void searchSettlements({ schemaVersion: 1, scope: deliveryScope, query: null, postalCode, limit: 50 })
      .then(reply => {
        if (cancelled || !reply.ok) return;
        setBranch(reply.value.branch);
        const matches = reply.value.settlements.filter(settlement => settlement.postalCode === postalCode
          && sameSettlementName(settlement.name, neighborhood));
        const only = matches.length === 1 ? matches[0] : undefined;
        if (only !== undefined) { setSelected(only); setQuery(only.name); }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [deliveryScope.branchId, deliveryScope.restaurantId, item, outsideMode, selected]);

  useEffect(() => {
    const text = query.trim();
    if (outsideMode || selected !== undefined || text.length < 2) {
      setOptions([]); setSearching(false); setSearchError(undefined); return;
    }
    let cancelled = false;
    setSearching(true); setSearchError(undefined);
    const timeout = window.setTimeout(() => {
      void searchSettlements({ schemaVersion: 1, scope: deliveryScope, query: text, postalCode: null, limit: 20 })
        .then(reply => {
          if (cancelled) return;
          if (!reply.ok) {
            setOptions([]);
            setSearchError(reply.error === "denied" ? "Tu sesión ya no permite buscar colonias." : "No se pudo buscar colonias. Reintenta.");
            return;
          }
          setOptions(reply.value.settlements);
          setBranch(reply.value.branch);
          setOpen(document.activeElement === searchInputRef.current);
        })
        .catch(() => { if (!cancelled) { setOptions([]); setSearchError("No se pudo buscar colonias. Reintenta."); } })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [deliveryScope.branchId, deliveryScope.restaurantId, outsideMode, query, selected]);

  function markDirty(): void { setDirty(true); onEdit?.(); }
  function choose(settlement: SettlementSummaryV1): void {
    setSelected(settlement); setQuery(settlement.name); setOptions([]); setOpen(false); setActive(-1);
    setFormError(undefined); markDirty();
  }
  function clearSelection(): void {
    setSelected(undefined); setQuery(""); setOptions([]); setOpen(true); setFormError(undefined);
    setOutsideMode(false); setOutsideConfirmed(false); markDirty(); searchInputRef.current?.focus();
  }
  function startOutside(): void {
    setSelected(undefined); setOutsideMode(true); setOutsideConfirmed(false);
    setOutsideName(query.trim() || item?.address.neighborhood || "");
    setOptions([]); setOpen(false); setFormError(undefined); markDirty();
  }
  function backToCatalog(): void {
    setOutsideMode(false); setOutsideConfirmed(false); setOutsideName("");
    setQuery(""); setOptions([]); setOpen(true); setFormError(undefined); markDirty();
  }
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") { setOpen(false); setActive(-1); return; }
    if (options.length === 0 || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    if (event.key === "Enter" && (!open || active < 0)) return;
    event.preventDefault();
    if (event.key === "ArrowDown") { setOpen(true); setActive(current => current < options.length - 1 ? current + 1 : 0); return; }
    if (event.key === "ArrowUp") { setOpen(true); setActive(current => current > 0 ? current - 1 : options.length - 1); return; }
    const target = options[active];
    if (target !== undefined) choose(target);
  }

  const postalCode = selected?.postalCode ?? (outsideMode ? null : item?.address.postalCode ?? null);
  const derivedLocality = selected?.municipality ?? branch?.locality ?? item?.address.locality ?? null;
  const derivedRegion = selected?.state ?? branch?.region ?? item?.address.region ?? null;
  const derivedCountry = selected?.countryCode ?? branch?.countryCode ?? item?.address.countryCode ?? null;
  const derivedText = outsideMode ? "La ciudad, el estado y el país se toman de la sucursal."
    : [derivedLocality, derivedRegion, derivedCountry].filter(Boolean).join(", ") || "Se completan al elegir la colonia.";

  return <form className="rounded-lg border border-border p-3" onChange={markDirty} onSubmit={event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string): string | null => {
      const text = String(data.get(key) ?? "").trim();
      return text === "" ? null : text;
    };
    if (!outsideMode && selected === undefined) {
      setFormError("Elige una colonia del catálogo o declara que la colonia está fuera de catálogo.");
      return;
    }
    if (outsideMode && outsideName.trim() === "") {
      setFormError("Escribe el nombre de la colonia.");
      return;
    }
    if (outsideMode && !outsideConfirmed) {
      setFormError("Confirma que la colonia no aparece en el catálogo de la sucursal.");
      return;
    }
    setFormError(undefined);
    onSave({
      label: addressLabel.trim(), streetLine: value("streetLine"), unit: value("unit"),
      neighborhood: outsideMode ? outsideName.trim() : selected?.name ?? null,
      locality: selected?.municipality ?? null, region: selected?.state ?? null,
      countryCode: selected?.countryCode ?? null, postalCode: selected?.postalCode ?? null,
      references: value("references"), instructions: item?.address.instructions ?? null,
      coordinates: item?.address.coordinates ?? null,
      settlementId: selected?.settlementId ?? null, settlementOutsideCatalog: outsideMode,
    });
  }}>
    <h3 className="mb-2 font-semibold">{item?.address.label ?? "Nueva dirección"}</h3>
    {item !== undefined && <div className="mb-3"><span className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${!dirty && item.validatedForRequestedBranch ? "border-success text-text" : "border-border text-text-muted"}`}>{dirty ? "Cambios sin guardar · revalidar al guardar" : item.validatedForRequestedBranch ? `Dirección revisada para ${branchName}` : "Sin revisar en esta sucursal"}</span>{!dirty && item.validatedForRequestedBranch && <p className="mt-2 break-words text-xs text-text-muted">Datos revisados: {[item.address.streetLine, item.address.locality, item.address.postalCode].filter(Boolean).join(", ")}. Cotiza en captura antes de confirmar.</p>}</div>}
    {!dirty && feedback !== undefined && <p role={feedback.error ? "alert" : "status"} className={`mb-3 rounded-lg border p-3 text-sm ${feedback.error ? "border-error bg-error-bg" : "border-success"}`}>{feedback.message}</p>}
    {validating && <p role="status" className="mb-3 text-sm text-text-muted">Validando esta dirección…</p>}
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2"><Field className="flex flex-col gap-1 text-sm" hint="Nombre corto para reconocer la dirección: Casa, Oficina, etc." label="Etiqueta de dirección">{(id) => <><select id={id} className={inputClass} value={addressLabelOptions.includes(addressLabel as typeof addressLabelOptions[number]) ? addressLabel : "Otro"} onChange={event => setAddressLabel(event.target.value === "Otro" ? "" : event.target.value)}>{addressLabelOptions.map(label => <option key={label}>{label}</option>)}<option>Otro</option></select></>}</Field>{!addressLabelOptions.includes(addressLabel as typeof addressLabelOptions[number]) && <Field className="flex flex-col gap-1 text-sm" hint="Escribe cómo quieres llamar a esta dirección." label="Otra etiqueta">{(id) => <><input id={id} required maxLength={40} className={inputClass} value={addressLabel} onChange={event => setAddressLabel(event.target.value)} /></>}</Field>}<span className="text-xs text-text-muted">Nombre corto para reconocer la dirección.</span></div>
      <Field className="flex min-w-0 flex-col gap-1 text-sm" hint="Calle y número exterior donde se entrega." label="Calle y número">{(id) => <input id={id} name="streetLine" maxLength={200} defaultValue={item?.address.streetLine ?? ""} autoComplete="off" className={inputClass} />}</Field>
      <Field className="flex min-w-0 flex-col gap-1 text-sm" hint="Número de departamento, piso o interior, si aplica." label="Interior">{(id) => <input id={id} name="unit" maxLength={200} defaultValue={item?.address.unit ?? ""} autoComplete="off" className={inputClass} />}</Field>
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        {!outsideMode && <>
          <Field className="flex min-w-0 flex-col gap-1 text-sm" hint="Busca la colonia del catálogo de la sucursal; el código postal se completa solo." label="Colonia">{(id) => <div className="relative">
            <input id={id} ref={searchInputRef} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open && (searching || options.length > 0 || searchError !== undefined)} aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} className={inputClass} value={query} autoComplete="off" placeholder="Escribe el nombre de la colonia"
              onChange={event => { setSelected(undefined); setQuery(event.target.value); setOpen(true); setActive(-1); setFormError(undefined); }}
              onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => { if (document.activeElement !== searchInputRef.current) setOpen(false); }, 0)}
              onKeyDown={onSearchKeyDown} />
            {open && (searching || options.length > 0 || searchError !== undefined) && <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
              {searching && <p role="status" className="px-3 py-2 text-sm text-text-muted">Buscando colonias…</p>}
              {searchError !== undefined && <p role="alert" className="px-3 py-2 text-sm">{searchError}</p>}
              {!searching && searchError === undefined && options.length === 0 && query.trim().length >= 2 && <p className="px-3 py-2 text-sm text-text-muted">Sin coincidencias en el catálogo.</p>}
              {options.length > 0 && <ul id={listId} role="listbox" aria-label="Colonias del catálogo">{options.map((option, index) => <li key={option.settlementId} role="presentation">
                <button id={`${listId}-${index}`} type="button" role="option" aria-selected={active === index}
                  className={`min-h-11 w-full rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${active === index ? "bg-bg" : "hover:bg-bg"}`}
                  onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(option)}>
                  <span className="block font-semibold">{option.name}</span>
                  <span className="block break-words text-xs text-text-muted">CP {option.postalCode} · {option.settlementType} · {option.municipality}, {option.state}</span>
                </button>
              </li>)}</ul>}
            </div>}
          </div>}</Field>
          {selected !== undefined && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success p-3 text-sm">
            <span className="min-w-0 break-words"><strong>{selected.name}</strong> · CP {selected.postalCode} · {selected.municipality}, {selected.state}</span>
            <button type="button" className={buttonClass} onClick={clearSelection}>Cambiar colonia</button>
          </div>}
          {selected === undefined && <button type="button" className={buttonClass} onClick={startOutside}>Mi colonia no está en la lista</button>}
        </>}
        {outsideMode && <>
          <p role="note" className="rounded-lg border border-border bg-bg p-3 text-sm">Colonia fuera del catálogo. El domicilio queda sin zona y el envío requiere cuota manual de un supervisor.</p>
          <Field className="flex min-w-0 flex-col gap-1 text-sm" hint="Escribe el nombre tal como lo conoce el cliente." label="Colonia fuera del catálogo">{(id) => <input id={id} name="outsideNeighborhood" maxLength={200} className={inputClass} value={outsideName} autoComplete="off"
            onChange={event => { setOutsideName(event.target.value); setFormError(undefined); }} />}</Field>
          <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-5" checked={outsideConfirmed}
            onChange={event => { setOutsideConfirmed(event.target.checked); setFormError(undefined); }} /><span>Confirmo que esta colonia no aparece en el catálogo de la sucursal.</span></label>
          <button type="button" className={buttonClass} onClick={backToCatalog}>Volver a buscar en el catálogo</button>
        </>}
      </div>
      <Field className="flex min-w-0 flex-col gap-1 text-sm" hint="Se completa desde la colonia elegida; no se edita." label="Código postal">{(id) => <input id={id} className={inputClass} value={postalCode ?? ""} readOnly aria-readonly="true" />}</Field>
      <div className="flex min-w-0 flex-col gap-1 text-sm"><span className="font-semibold">Localidad, estado y país</span><p className="break-words text-text-muted">{derivedText}</p></div>
      <Field className="flex min-w-0 flex-col gap-1 text-sm sm:col-span-2" hint="Indicaciones para el repartidor: entre qué calles, color de la casa, portón, etc." label="Referencias">{(id) => <textarea id={id} name="references" maxLength={500} rows={3} defaultValue={item?.address.references ?? ""} className={`${inputClass} min-h-24 resize-y`} />}</Field>
      {formError !== undefined && <p role="alert" className="rounded-lg bg-error-bg p-3 text-sm sm:col-span-2">{formError}</p>}
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button className={buttonClass}>Guardar dirección</button>
        {onCancel !== undefined && <button type="button" className={buttonClass} onClick={onCancel}>Cancelar</button>}
        {onValidate !== undefined && <button type="button" className={buttonClass} disabled={disabled || dirty || item?.validatedForRequestedBranch === true} onClick={onValidate}>{dirty ? "Validar para esta sucursal" : item?.validatedForRequestedBranch ? `Revisada para ${branchName}` : validating ? "Validando…" : "Validar para esta sucursal"}</button>}</div>
    </fieldset>
  </form>;
}
