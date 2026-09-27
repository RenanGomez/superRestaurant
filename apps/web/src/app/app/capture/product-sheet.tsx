"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { validateModifierSelection, type SelectionPlanModifierGroupDraft } from "../../../lib/capture-selection";

const button = "min-h-11 min-w-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const optionButton = "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent";
const optionSelected = "border-accent bg-accent-soft font-semibold text-accent";

interface ProductSheetProps {
  readonly product: MenuProductV1;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onAdd: (quantity: number, modifierGroups: readonly SelectionPlanModifierGroupDraft[]) => void;
}

/** In-app "hoja" for choosing a product's modifier groups; never uses `window.prompt`. */
export function ProductSheet({ product, groups, currency, busy, onClose, onAdd }: ProductSheetProps) {
  const [quantity, setQuantity] = useState(1);
  const [selections, setSelections] = useState<Record<string, readonly string[]>>({});
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
              return <button key={option.optionId} type="button" disabled={!option.active}
                className={`${optionButton} ${isSelected ? optionSelected : ""} ${!option.active ? "opacity-50" : ""}`}
                onClick={() => toggleOption(group, option.optionId)}>
                <span>{option.name}</span>
                {option.unitPriceMinor > 0 && <span className="text-xs text-text-muted">+{money(option.unitPriceMinor, currency)}</span>}
              </button>;
            })}
          </div>
        </fieldset>)}
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-border p-4">
        <div className="flex items-center gap-2">
          <button type="button" className={`${button} text-xl`} aria-label="Menos" disabled={busy || quantity <= 1}
            onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
          <span className="min-w-9 text-center text-lg font-bold">{quantity}</span>
          <button type="button" className={`${button} text-xl`} aria-label="Más" disabled={busy}
            onClick={() => setQuantity((current) => current + 1)}>+</button>
        </div>
        <span className="grow" />
        <button type="button" className={`${button} bg-accent text-white`} disabled={busy || !allValid}
          onClick={() => onAdd(quantity, groupDrafts)}>
          {busy ? "Calculando…" : !allValid ? "Completa lo obligatorio" : "Agregar"}
        </button>
      </footer>
    </div>
  </div>;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("es-MX", { currency, style: "currency" }).format(amountMinor / 100);
}
