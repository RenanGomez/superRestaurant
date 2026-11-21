"use client";

import { useId, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { BranchScope, CustomerDirectorySearchResultV1, CustomerSearchModeV1, SaveCustomerProfileCommandV1 } from "@super-restaurant/shared-types";
import { Field } from "../../../components/field-hint";
import {
  getCustomerAutocompleteRequest, getCustomerDirectorySuggestions, insertCustomerDirectorySuggestion,
  isCurrentCustomerAutocompleteRequest, type CustomerAutocompleteRequest,
} from "../../../lib/customer-directory";
import { buildCustomerQuickCreateCommand, normalizeCustomerSearchQuery, shouldOfferCustomerQuickCreate } from "../../../lib/customer-quick-create";
import { ariaKeyShortcut } from "../../../lib/shortcut-dispatch";
import { uiButton } from "../../../lib/ui-classes";
import { customerDirectoryAction } from "../customers/actions";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const buttonClass = uiButton();
const DEBOUNCE_MS = 500;

interface CaptureCustomerSearchProps {
  readonly scope: BranchScope;
  readonly disabled: boolean;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  /** Loads and selects the customer in the capture workspace. */
  readonly onSelect: (customerId: string) => void;
}

/**
 * Customer combobox for capture: debounced directory search, keyboard navigation and a quick-create
 * path that reuses the same profile server action as the Customers screen.
 */
export function CaptureCustomerSearch({ scope, disabled, inputRef, onSelect }: CaptureCustomerSearchProps): ReactNode {
  const baseId = useId();
  const ownInput = useRef<HTMLInputElement>(null);
  const field = inputRef ?? ownInput;
  const [mode, setMode] = useState<CustomerSearchModeV1>("phone");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<{ readonly request: CustomerAutocompleteRequest; readonly value: CustomerDirectorySearchResultV1 }>();
  const [quick, setQuick] = useState<{ readonly mode: CustomerSearchModeV1; readonly query: string }>();
  const sequence = useRef(0);
  const request = useMemo(() => getCustomerAutocompleteRequest(mode, query), [mode, query]);

  useEffect(() => {
    sequence.current += 1;
    const current = sequence.current;
    if (request === undefined || disabled || quick !== undefined) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void customerDirectoryAction("search", { schemaVersion: 1, scope, ...request, limit: 10, cursor: null })
        .then(reply => {
          if (current !== sequence.current) return;
          if (!reply.ok || !("candidates" in reply.value)) { setResult(undefined); setError(true); return; }
          setResult({ request, value: reply.value });
          setError(false);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => { if (current === sequence.current) { setResult(undefined); setError(true); } })
        .finally(() => { if (current === sequence.current) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [request, disabled, quick, scope]);

  const currentResult = result !== undefined && isCurrentCustomerAutocompleteRequest(result.request, mode, query)
    ? result.value : undefined;
  const suggestions = useMemo(() => getCustomerDirectorySuggestions(currentResult, mode, query), [currentResult, mode, query]);
  const candidates = currentResult?.candidates ?? [];
  const offerQuick = currentResult !== undefined && candidates.length === 0 && suggestions.length === 0
    && shouldOfferCustomerQuickCreate(mode, query);
  const optionCount = suggestions.length + candidates.length + (offerQuick ? 1 : 0);
  const listVisible = open && !disabled && quick === undefined && optionCount > 0;

  function close(): void {
    setOpen(false);
    setActive(-1);
  }
  function chooseCustomer(customerId: string): void {
    close();
    setQuery("");
    setResult(undefined);
    setError(false);
    onSelect(customerId);
  }
  function chooseSuggestion(index: number): void {
    const suggestion = suggestions[index];
    if (suggestion === undefined) return;
    setQuery(insertCustomerDirectorySuggestion(query, suggestion.value, mode));
    setResult(undefined);
    setError(false);
    close();
    field.current?.focus();
  }
  function openQuickCreate(): void {
    close();
    setQuick({ mode, query: normalizeCustomerSearchQuery(mode, query) });
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") { close(); return; }
    if (event.key === "Enter" && listVisible && active >= 0) {
      event.preventDefault();
      if (active < suggestions.length) chooseSuggestion(active);
      else if (active < suggestions.length + candidates.length) {
        const candidate = candidates[active - suggestions.length];
        if (candidate !== undefined) chooseCustomer(candidate.customerId);
      } else openQuickCreate();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key) || optionCount === 0) return;
    event.preventDefault();
    setOpen(true);
    setActive(current => event.key === "ArrowDown"
      ? (current < optionCount - 1 ? current + 1 : 0)
      : (current > 0 ? current - 1 : optionCount - 1));
  }

  return <div className="grid min-w-0 gap-3">
    <div className="flex flex-wrap items-end gap-3">
      <Field className="grid gap-1 text-sm" hint="Dato con el que buscas al cliente: teléfono, nombre o dirección." id={`${baseId}-mode`} label="Buscar por">
        {(id) => <select id={id} value={mode} className={inputClass} disabled={disabled} onChange={event => {
          setMode(event.target.value as CustomerSearchModeV1); setResult(undefined); setQuery(""); close(); setQuick(undefined); setError(false);
        }}><option value="phone">Teléfono</option><option value="name">Nombre</option><option value="address">Dirección</option></select>}
      </Field>
      <Field className="relative grid min-w-0 flex-1 gap-1 text-sm" hint="Escribe el teléfono, nombre o dirección; las sugerencias aparecen mientras escribes." id={`${baseId}-query`} label="Consulta">
        {(id) => <>
          <input id={id} ref={field} role="combobox" aria-autocomplete="list" aria-expanded={listVisible}
            aria-controls={`${baseId}-listbox`} aria-label="Buscar cliente"
            aria-activedescendant={listVisible && active >= 0 ? `${baseId}-option-${active}` : undefined}
            aria-keyshortcuts={ariaKeyShortcut("search")} autoComplete="off" maxLength={200} disabled={disabled}
            className={`${inputClass} min-w-48`} placeholder="Teléfono, nombre o dirección" value={query}
            onChange={event => { setQuery(event.target.value); setResult(undefined); setError(false); setActive(-1); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => {
              if (document.activeElement !== field.current) close();
            }, 0)} onKeyDown={onKeyDown} />
          {listVisible && <ul id={`${baseId}-listbox`} role="listbox" aria-label="Sugerencias y clientes autorizados"
            className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
            {suggestions.length > 0 && <li role="presentation" className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Completar búsqueda</li>}
            {suggestions.map((suggestion, index) => <li key={suggestion.id} role="presentation">
              <button id={`${baseId}-option-${index}`} type="button" role="option" aria-selected={active === index}
                className={`min-h-11 w-full rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${active === index ? "bg-bg" : "hover:bg-bg"}`}
                onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => chooseSuggestion(index)}>
                <span className="block font-semibold">Buscar: {suggestion.value}</span>
                <span className="block text-xs text-text-muted">De {suggestion.context}</span>
              </button>
            </li>)}
            {candidates.length > 0 && <li role="presentation" className="border-t border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Clientes</li>}
            {candidates.map((candidate, index) => <li key={candidate.customerId} role="presentation">
              <button id={`${baseId}-option-${suggestions.length + index}`} type="button" role="option"
                aria-selected={active === suggestions.length + index}
                className={`min-h-11 w-full rounded-md px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${active === suggestions.length + index ? "bg-bg" : "hover:bg-bg"}`}
                onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(suggestions.length + index)}
                onClick={() => chooseCustomer(candidate.customerId)}>
                <span className="block break-words font-semibold">{candidate.displayName}</span>
                <span className="block break-words text-xs text-text-muted">{candidate.phones.map(phone => phone.displayValue).join(" · ") || "Sin teléfono"}</span>
                <span className="block break-words text-xs text-text-muted">{candidate.addresses.map(address => [address.label, address.streetLine, address.locality].filter(Boolean).join(", ")).join(" · ") || "Sin direcciones"}</span>
              </button>
            </li>)}
            {offerQuick && <li role="presentation" className={suggestions.length + candidates.length > 0 ? "border-t border-border" : ""}>
              <button id={`${baseId}-option-${suggestions.length + candidates.length}`} type="button" role="option"
                aria-selected={active === suggestions.length + candidates.length}
                className={`min-h-11 w-full rounded-md px-3 py-2 text-left font-semibold focus-visible:outline-2 focus-visible:outline-accent ${active === suggestions.length + candidates.length ? "bg-bg" : "hover:bg-bg"}`}
                onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(suggestions.length + candidates.length)}
                onClick={openQuickCreate}>Crear cliente rápido con {normalizeCustomerSearchQuery(mode, query)}</button>
            </li>}
          </ul>}
          <span aria-live="polite" className="text-xs text-text-muted">{loading ? "Buscando sugerencias autorizadas…" : ""}</span>
          {error && <span role="alert" className="text-xs text-error">No se pudo buscar clientes. Revisa la conexión y reintenta.</span>}
        </>}
      </Field>
    </div>
    {quick !== undefined && <QuickCreateForm scope={scope} seed={quick} disabled={disabled}
      onCancel={() => setQuick(undefined)} onCreated={customerId => { setQuick(undefined); chooseCustomer(customerId); }} />}
  </div>;
}

function QuickCreateForm({ scope, seed, disabled, onCancel, onCreated }: {
  readonly scope: BranchScope;
  readonly seed: { readonly mode: CustomerSearchModeV1; readonly query: string };
  readonly disabled: boolean;
  readonly onCancel: () => void;
  readonly onCreated: (customerId: string) => void;
}): ReactNode {
  const baseId = useId();
  const [name, setName] = useState(seed.mode === "name" ? seed.query : "");
  const [phone, setPhone] = useState(seed.mode === "phone" ? seed.query : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [deviceId] = useState(() => crypto.randomUUID());
  const [occurredAt] = useState(() => new Date().toISOString());
  const attempt = useRef<SaveCustomerProfileCommandV1>(undefined);
  const locked = disabled || busy;

  async function save(): Promise<void> {
    const displayName = name.trim();
    const displayValue = phone.trim();
    if (displayName === "" || displayValue === "" || busy) { setError(true); return; }
    const command = buildCustomerQuickCreateCommand(attempt.current, {
      displayName, phone: displayValue, scope, deviceId, occurredAt,
    }, () => crypto.randomUUID());
    attempt.current = command;
    setBusy(true);
    setError(false);
    try {
      const reply = await customerDirectoryAction("profile", command);
      if (!reply.ok || !("customer" in reply.value)) { setError(true); return; }
      onCreated(reply.value.customer.customerId);
    } catch { setError(true); } finally { setBusy(false); }
  }

  return <form className="grid min-w-0 gap-3 rounded-lg border border-border bg-bg p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p className="text-sm font-semibold">Alta rápida de cliente</p>
    {error && <p role="alert" className="text-sm text-error">No se pudo guardar el cliente. Revisa el nombre y el teléfono y reintenta.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field className="grid gap-1 text-sm" hint="Nombre o alias con el que identificas al cliente." id={`${baseId}-name`} label="Nombre o alias">
        {(id) => <input id={id} required maxLength={120} autoComplete="off" className={inputClass} value={name}
          disabled={locked} onChange={event => { setName(event.target.value); setError(false); }} />}
      </Field>
      <Field className="grid gap-1 text-sm" hint="Teléfono para contactar al cliente; se usa para llamarle en pedidos siguientes." id={`${baseId}-phone`} label="Teléfono">
        {(id) => <input id={id} type="tel" required maxLength={80} autoComplete="off" className={inputClass} value={phone}
          disabled={locked} onChange={event => { setPhone(event.target.value); setError(false); }} />}
      </Field>
    </div>
    <div className="flex flex-wrap gap-2">
      <button className={buttonClass} disabled={locked}>{busy ? "Guardando…" : "Guardar y seleccionar"}</button>
      <button type="button" className={buttonClass} disabled={locked} onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}
