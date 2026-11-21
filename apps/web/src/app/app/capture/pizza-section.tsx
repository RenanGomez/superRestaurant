"use client";

import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import type { ReactNode } from "react";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { emptyPizzaHalf, matchingVariantId, pickHalfProduct, pizzaHalfSetup, togglePizzaOption, type PizzaDraft, type PizzaHalfDraft, type PizzaOptionRole } from "../../../lib/pizza-capture";
import { uiOption } from "../../../lib/ui-classes";

const chip = (selected: boolean) => uiOption(selected, "flex items-center justify-between gap-2 px-3 text-left");

/**
 * Pizza V2 of a product: whole, or two halves (each half its own pizza), with ingredients, removals and extras
 * per half. Amounts are never computed here; the sheet shows the server quote.
 */
export function PizzaSection({ catalogGroups, currency, disabled, draft, otherProducts, product, sizeName, onChange }: {
  readonly catalogGroups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly disabled: boolean;
  readonly draft: PizzaDraft;
  /** Other pizza V2 products that may be the second half. */
  readonly otherProducts: readonly MenuProductV1[];
  readonly product: MenuProductV1;
  readonly sizeName: string | null;
  readonly onChange: (draft: PizzaDraft) => void;
}): ReactNode {
  // The same product may fill both halves with different picks (the contract only ties half A to the line).
  const secondCandidates = otherProducts.filter((candidate) => matchingVariantId(candidate, sizeName) !== undefined);
  const productB = draft.b === null ? undefined : otherProducts.find((candidate) => candidate.productId === draft.b?.productId);
  return <div className="grid gap-3" data-testid="pizza-v2-section">
    <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">¿Cómo la quieres?</legend>
      <div className="grid grid-cols-2 gap-2">
        {([["Entera", false], ["Mitad y mitad", true]] as const).map(([label, split]) => <button key={label} type="button"
          disabled={disabled || (split && secondCandidates.length === 0)} aria-pressed={draft.split === split}
          className={uiOption(draft.split === split, "flex w-full items-center justify-center px-3")}
          onClick={() => onChange({ ...draft, split })}>{label}</button>)}
      </div>
      {secondCandidates.length === 0 && <p className="text-xs text-text-muted">No hay otra pizza disponible en este tamaño para armar mitades.</p>}
    </fieldset>
    <div className={`grid gap-3 ${draft.split ? "sm:grid-cols-2" : ""}`}>
      <HalfPicks title={draft.split ? "Mitad A" : "Tu pizza"} product={product} catalogGroups={catalogGroups} currency={currency}
        half={draft.a} disabled={disabled} onChange={(a) => onChange({ ...draft, a })} />
      {draft.split && <section className="grid content-start gap-3 rounded-xl border border-border p-3" aria-label="Mitad B">
        <h3 className="font-heading text-base font-semibold">Mitad B</h3>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold">Pizza</legend>
          {secondCandidates.map((candidate) => <button key={candidate.productId} type="button" disabled={disabled}
            aria-pressed={draft.b?.productId === candidate.productId} className={chip(draft.b?.productId === candidate.productId)}
            onClick={() => onChange({ ...draft, b: draft.b?.productId === candidate.productId ? draft.b : pickHalfProduct(candidate.productId) })}>
            <span>{candidate.name}</span>
          </button>)}
        </fieldset>
        {productB !== undefined && draft.b !== null && <HalfPicks title="" product={productB} catalogGroups={catalogGroups} currency={currency}
          half={draft.b ?? emptyPizzaHalf(productB.productId)} disabled={disabled} onChange={(b) => onChange({ ...draft, b })} />}
      </section>}
    </div>
  </div>;
}

function HalfPicks({ catalogGroups, currency, disabled, half, product, title, onChange }: {
  readonly catalogGroups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly disabled: boolean;
  readonly half: PizzaHalfDraft;
  readonly product: MenuProductV1;
  readonly title: string;
  readonly onChange: (half: PizzaHalfDraft) => void;
}): ReactNode {
  const setup = pizzaHalfSetup(product, catalogGroups);
  const toggle = (role: PizzaOptionRole, optionId: string): void => onChange(togglePizzaOption(half, role, optionId));
  const free = product.freeIngredientCount ?? 0;
  return <section className="grid content-start gap-3 rounded-xl border border-border p-3" aria-label={title === "" ? product.name : `${title}: ${product.name}`}>
    {title !== "" && <h3 className="font-heading text-base font-semibold">{title}: {product.name}</h3>}
    {product.pizzaMode === "custom" && setup.canChooseIngredients && <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">Ingredientes{free > 0 ? ` · los primeros ${free} van sin cargo` : ""}</legend>
      {setup.baseOptions.map((option) => {
        const chosen = half.ingredientOptionIds.includes(option.optionId);
        return <button key={option.optionId} type="button" aria-pressed={chosen} disabled={disabled} className={chip(chosen)}
          onClick={() => toggle("ingredientOptionIds", option.optionId)}>
          <span>{option.name}</span>
          {option.unitPriceMinor > 0 && <span className="text-xs font-normal">{formatMinorUnits(option.unitPriceMinor, currency)}</span>}
        </button>;
      })}
    </fieldset>}
    {product.pizzaMode === "specialty" && <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">Receta</legend>
      {setup.recipeOptions.length === 0 && <p className="text-xs text-text-muted">Sin ingredientes de receta configurados.</p>}
      <div className="flex flex-wrap gap-2">
        {setup.recipeOptions.map((option) => {
          const removed = half.removedIngredientOptionIds.includes(option.optionId);
          return setup.canRemove
            ? <button key={option.optionId} type="button" aria-pressed={removed} disabled={disabled} className={chip(removed)}
              onClick={() => toggle("removedIngredientOptionIds", option.optionId)}>Sin {option.name}</button>
            : <span key={option.optionId} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm">{option.name}</span>;
        })}
      </div>
    </fieldset>}
    {setup.canAddExtras && setup.extraGroups.map(({ group, options }) => <fieldset key={group.groupId} className="grid gap-2">
      <legend className="text-sm font-semibold">{group.name || "Extras"} · máx {group.maximumQuantity}</legend>
      {options.map((option) => {
        const chosen = half.extraOptionIds.includes(option.optionId);
        return <button key={option.optionId} type="button" aria-pressed={chosen} disabled={disabled} className={chip(chosen)}
          onClick={() => toggle("extraOptionIds", option.optionId)}>
          <span>{option.name}</span>
          {option.unitPriceMinor > 0 && <span className="text-xs font-normal">{formatMinorUnits(option.unitPriceMinor, currency)}</span>}
        </button>;
      })}
    </fieldset>)}
  </section>;
}
