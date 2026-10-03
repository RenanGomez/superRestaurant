"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { validateModifierSelection, type SelectionPlanModifierGroupDraft } from "../../../lib/capture-selection";
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
  /** `undefined` while nothing was just confirmed; `null` once added if no matching server line
   * was found; a minor-unit amount taken directly from the server's `selectionProjection` line. */
  readonly confirmedTotalMinor?: number | null | undefined;
  readonly onClose: () => void;
  readonly onAdd: (quantity: number, modifierGroups: readonly SelectionPlanModifierGroupDraft[], note: string | null) => void;
}

const MAX_NOTE_LENGTH = 200;

/** In-app "hoja" for choosing a product's modifier groups; never uses `window.prompt`. */
export function ProductSheet({ product, groups, currency, busy, confirmedTotalMinor, onClose, onAdd }: ProductSheetProps) {
  const supabaseUrl = useMenuImageBaseUrl();
  const confirmed = confirmedTotalMinor !== undefined;
  const [quantity, setQuantity] = useState(1);
  const [selections, setSelections] = useState<Record<string, readonly string[]>>({});
  const [note, setNote] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggleOption(group: MenuModifierGroupV1, optionId: string): void {
    setSelections((current) => {
      const chosen = current[group.groupId] ?? [];
      if (chosen.includes(optionId)) {
        return { ...current, [group.groupId]: chosen.filter((id) => id !== optionId) };
      }
      if (group.maximumQuantity === 1) return { ...current, [group.groupId]: [optionId] };
      if (chosen.length >= group.maximumQuantity) return current;
      return { ...current, [group.groupId]: [...chosen, optionId] };
    });
  }

  const groupDrafts: readonly SelectionPlanModifierGroupDraft[] = groups.map((group) => ({
    groupId: group.groupId,
    selections: (selections[group.groupId] ?? []).map((optionId) => ({ optionId, quantity: 1 })),
  })).filter((group) => group.selections.length > 0);

  const validations = groups.map((group) => ({
    group,
    validation: validateModifierSelection(group, selections[group.groupId]?.map((optionId) => ({ optionId, quantity: 1 })) ?? []),
  }));
  const allValid = validations.every((entry) => entry.validation.valid);

  return <div className="fixed inset-0 z-20 flex items-end justify-center bg-[oklch(10%_0.02_250_/_.45)] sm:items-center"
    role="dialog" aria-modal="true" aria-labelledby="product-sheet-title"
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
      <header className="flex items-center gap-2 border-b border-border p-4">
        <h2 id="product-sheet-title" className="font-heading text-lg font-semibold">{product.name}</h2>
        <span className="grow" />
        <button ref={closeRef} type="button" className={`${button}`} aria-label="Cerrar (Esc)" onClick={onClose}>✕</button>
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
              const isSelected = (selections[group.groupId] ?? []).includes(option.optionId);
              return <button key={option.optionId} type="button" disabled={!option.active || confirmed}
                className={`${optionButton} ${isSelected ? optionSelected : ""} ${!option.active ? "opacity-50" : ""}`}
                onClick={() => toggleOption(group, option.optionId)}>
                <span className="flex min-w-0 items-center gap-2">
                  <OptionPhoto imagePath={option.imagePath} name={option.name} supabaseUrl={supabaseUrl} />
                  <span>{option.name}</span>
                </span>
                {option.unitPriceMinor > 0 && <span className="text-xs text-text-muted">+{formatMinorUnits(option.unitPriceMinor, currency)}</span>}
              </button>;
            })}
          </div>
        </fieldset>)}
        <div className="grid gap-1">
          <label htmlFor="product-sheet-note" className="text-sm font-semibold">Nota para cocina</label>
          <textarea id="product-sheet-note" className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
            rows={2} maxLength={MAX_NOTE_LENGTH} disabled={confirmed} placeholder="Ej. sin cebolla, bien cocida"
            value={note} onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_LENGTH))} />
          <span className="text-xs text-text-muted">{note.length}/{MAX_NOTE_LENGTH}</span>
        </div>
      </div>
      {confirmed && <p role="status" aria-live="polite" className="mx-4 rounded-lg bg-success-bg px-3 py-2 text-sm font-semibold text-success">
        {confirmedTotalMinor === null ? "Agregado" : `Agregado · ${formatMinorUnits(confirmedTotalMinor, currency)}`}
      </p>}
      <footer className="flex flex-wrap items-center gap-3 border-t border-border p-4">
        <div className="flex items-center gap-2">
          <button type="button" className={`${button} text-xl`} aria-label="Menos" disabled={busy || confirmed || quantity <= 1}
            onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
          <span className="min-w-9 text-center text-lg font-bold">{quantity}</span>
          <button type="button" className={`${button} text-xl`} aria-label="Más" disabled={busy || confirmed}
            onClick={() => setQuantity((current) => current + 1)}>+</button>
        </div>
        <span className="grow" />
        <button type="button" className={`${button} bg-accent text-white`} disabled={busy || confirmed || !allValid}
          onClick={() => onAdd(quantity, groupDrafts, note.trim().length === 0 ? null : note.trim())}>
          {busy ? "Calculando…" : confirmed ? (confirmedTotalMinor === null ? "Agregado" : `Agregado · ${formatMinorUnits(confirmedTotalMinor, currency)}`)
            : !allValid ? "Completa lo obligatorio" : "Agregar"}
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
