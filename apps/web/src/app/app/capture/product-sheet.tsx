"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { countModifierSelections, estimateSelectionMinor, expandModifierSelections, toggleOrStepOption,
  validateModifierSelection, type SelectionPlanLineDraft, type SelectionPlanModifierGroupDraft } from "../../../lib/capture-selection";
import { useMenuImageBaseUrl } from "../../../lib/menu-image-url-context";
import { menuImagePublicUrl } from "../../../lib/menu-images";

const button = "min-h-11 min-w-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const optionButton = "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent";
const optionSelected = "border-accent bg-accent-soft font-semibold text-accent";

interface ProductSheetProps {
  readonly product: MenuProductV1;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly busy: boolean;
  readonly showNote?: boolean;
  readonly busyLabel?: string;
  readonly addLabel?: string;
  readonly lockSelection?: boolean;
  readonly closeDisabled?: boolean;
  /** `undefined` while nothing was just confirmed; `null` once added if no matching server line
   * was found; a minor-unit amount taken directly from the server's `selectionProjection` line. */
  readonly confirmedTotalMinor?: number | null | undefined;
  readonly initialLine?: SelectionPlanLineDraft | undefined;
  readonly error?: string | undefined;
  readonly onClose: () => void;
  readonly onAdd: (quantity: number, modifierGroups: readonly SelectionPlanModifierGroupDraft[], note: string | null) => void;
}

const MAX_NOTE_LENGTH = 200;

/** In-app "hoja" for choosing a product's modifier groups; never uses `window.prompt`. */
export function ProductSheet({ product, groups, currency, busy, busyLabel = "Calculando…", addLabel, lockSelection = false, closeDisabled = false, showNote = true, confirmedTotalMinor, initialLine, error, onClose, onAdd }: ProductSheetProps) {
  const supabaseUrl = useMenuImageBaseUrl();
  const confirmed = confirmedTotalMinor !== undefined;
  const [quantity, setQuantity] = useState(initialLine?.quantity ?? 1);
  const [selections, setSelections] = useState<Record<string, readonly string[]>>(() => Object.fromEntries(
    (initialLine?.modifierGroups ?? []).map((group) => [group.groupId,
      expandModifierSelections(group.selections)])));
  const [note, setNote] = useState(initialLine?.note ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function changeOption(group: MenuModifierGroupV1, optionId: string, maximumQuantity: number | null, delta: -1 | 1): void {
    setSelections((current) => {
      const chosen = current[group.groupId] ?? [];
      if (group.maximumQuantity === 1 && delta === 1) {
        return { ...current, [group.groupId]: chosen.includes(optionId) ? [] : [optionId] };
      }
      const next = toggleOrStepOption(chosen, optionId, delta, maximumQuantity);
      return next.length > group.maximumQuantity || next === chosen ? current : { ...current, [group.groupId]: next };
    });
  }

  const groupDrafts: readonly SelectionPlanModifierGroupDraft[] = groups.map((group) => ({
    groupId: group.groupId,
    selections: countModifierSelections(selections[group.groupId] ?? []),
  })).filter((group) => group.selections.length > 0);

  const validations = groups.map((group) => ({
    group,
    validation: validateModifierSelection(group, countModifierSelections(selections[group.groupId] ?? [])),
  }));
  const allValid = validations.every((entry) => entry.validation.valid);
  const estimatedMinor = estimateSelectionMinor(product, groups, selections, quantity);

  return <div className="fixed inset-0 z-20 flex items-end justify-center bg-[oklch(10%_0.02_250_/_.45)] sm:items-center"
    role="dialog" aria-modal="true" aria-labelledby="product-sheet-title"
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
      <header className="flex items-center gap-2 border-b border-border p-4">
        <h2 id="product-sheet-title" className="font-heading text-lg font-semibold">{product.name}</h2>
        <span className="grow" />
        <button ref={closeRef} type="button" className={`${button}`} aria-label="Cerrar (Esc)" disabled={closeDisabled} onClick={onClose}>✕</button>
      </header>
      <div className="grid flex-1 gap-4 overflow-auto p-4">
        {groups.map((group) => <fieldset key={group.groupId} className="grid gap-2">
          <legend className="flex w-full items-center justify-between text-sm font-semibold">
            <span>{group.name}</span>
            <span className="text-xs font-normal text-text-muted">
              {group.minimumQuantity > 0 ? "obligatorio" : "opcional"} · máx {group.maximumQuantity}
            </span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.options.map((option) => {
              const chosen = selections[group.groupId] ?? [];
              const selectedCount = chosen.filter((id) => id === option.optionId).length;
              const repeatable = group.maximumQuantity > 1 && (option.maximumQuantity === null || option.maximumQuantity > 1);
              const label = <><span className="flex min-w-0 items-center gap-2">
                  <OptionPhoto imagePath={option.imagePath} name={option.name} supabaseUrl={supabaseUrl} />
                  <span>{option.name}</span>
                </span>
                {option.unitPriceMinor > 0 && <span className="text-xs text-text-muted">+{formatMinorUnits(option.unitPriceMinor, currency)}</span>}</>;
              return repeatable ? <div key={option.optionId} className={`grid gap-2 rounded-lg border border-border bg-surface p-2 text-sm ${selectedCount > 0 ? optionSelected : ""} ${!option.active ? "opacity-50" : ""}`}>
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-1">{label}</div>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className={button} aria-label={`Quitar una unidad de ${option.name}`}
                    disabled={!option.active || confirmed || lockSelection || selectedCount === 0}
                    onClick={() => changeOption(group, option.optionId, option.maximumQuantity, -1)}>−</button>
                  <span className="min-w-6 text-center font-semibold" aria-label={`${selectedCount} unidades de ${option.name}`}>{selectedCount}</span>
                  <button type="button" className={button} aria-label={`Agregar una unidad de ${option.name}`}
                    disabled={!option.active || confirmed || lockSelection || chosen.length >= group.maximumQuantity
                      || (option.maximumQuantity !== null && selectedCount >= option.maximumQuantity)}
                    onClick={() => changeOption(group, option.optionId, option.maximumQuantity, 1)}>+</button>
                </div>
              </div> : <button key={option.optionId} type="button"
                disabled={!option.active || confirmed || lockSelection || (group.maximumQuantity > 1 && selectedCount === 0 && chosen.length >= group.maximumQuantity)}
                className={`${optionButton} ${selectedCount > 0 ? optionSelected : ""} ${!option.active ? "opacity-50" : ""}`}
                aria-pressed={selectedCount > 0} onClick={() => changeOption(group, option.optionId, option.maximumQuantity, 1)}>
                {label}
              </button>;
            })}
          </div>
        </fieldset>)}
        {showNote && <div className="grid gap-1">
          <label htmlFor="product-sheet-note" className="text-sm font-semibold">Nota para cocina</label>
          <textarea id="product-sheet-note" className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
            rows={2} maxLength={MAX_NOTE_LENGTH} disabled={confirmed} placeholder="Ej. sin cebolla, bien cocida"
            value={note} onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_LENGTH))} />
          <span className="text-xs text-text-muted">{note.length}/{MAX_NOTE_LENGTH}</span>
        </div>}
      </div>
      <p className="px-4 py-2 text-sm font-semibold" role="status">
        Estimado: {estimatedMinor === null ? "se confirma al agregar" : formatMinorUnits(estimatedMinor, currency)}
      </p>
      {error && <p role="alert" className="mx-4 rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
      {confirmed && <p role="status" aria-live="polite" className="mx-4 rounded-lg bg-success-bg px-3 py-2 text-sm font-semibold text-success">
        {confirmedTotalMinor === null ? (initialLine ? "Guardado" : "Agregado") : `${initialLine ? "Guardado" : "Agregado"} · ${formatMinorUnits(confirmedTotalMinor, currency)}`}
      </p>}
      <footer className="flex flex-wrap items-center gap-3 border-t border-border p-4">
        <div className="flex items-center gap-2">
          <button type="button" className={`${button} text-xl`} aria-label="Menos" disabled={busy || confirmed || lockSelection || quantity <= 1}
            onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
          <span className="min-w-9 text-center text-lg font-bold">{quantity}</span>
          <button type="button" className={`${button} text-xl`} aria-label="Más" disabled={busy || confirmed || lockSelection}
            onClick={() => setQuantity((current) => current + 1)}>+</button>
        </div>
        <span className="grow" />
        <button type="button" className="min-h-11 min-w-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50" disabled={busy || confirmed || !allValid}
          onClick={() => onAdd(quantity, groupDrafts, note.trim().length === 0 ? null : note.trim())}>
          {busy ? busyLabel : confirmed ? (confirmedTotalMinor === null ? "Agregado" : `Agregado · ${formatMinorUnits(confirmedTotalMinor, currency)}`)
            : !allValid ? "Completa lo obligatorio" : addLabel ?? (initialLine ? "Guardar cambios" : "Agregar")}
        </button>
      </footer>
    </div>
  </div>;
}

function OptionPhoto({ imagePath, name, supabaseUrl }: { readonly imagePath: string | null; readonly name: string; readonly supabaseUrl: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = menuImagePublicUrl(supabaseUrl, imagePath);
  return url !== null && failedUrl !== url
    ? <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} className="h-11 w-11 shrink-0 rounded-lg object-cover" />
    : <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-bold text-accent">{name.trim().charAt(0).toLocaleUpperCase("es-MX")}</span>;
}
