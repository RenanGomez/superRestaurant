"use client";

import type { CaptureLineQuoteResultV1, MenuModifierGroupV1, MenuModifierOptionV1, MenuProductV1 } from "@super-restaurant/shared-types";
import type { ReactNode } from "react";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { useMenuImageBaseUrl } from "../../../lib/menu-image-url-context";
import { emptyPizzaHalf, matchingVariantId, pickHalfProduct, pizzaHalfSetup, pizzaIngredientCounter, pizzaServerChargesMinor, togglePizzaOption, type PizzaDraft, type PizzaHalfDraft, type PizzaOptionRole } from "../../../lib/pizza-capture";
import { uiOption } from "../../../lib/ui-classes";
import { OptionCheckTile, OptionCheckTileGrid } from "../menu/option-check-tile";

const chip = (selected: boolean) => uiOption(selected, "flex items-center justify-between gap-2 px-3 text-left");

/**
 * Pizza V2 of a product: whole, or two halves (each half its own pizza), with ingredients, removals and extras
 * per half. Amounts are never computed here; the sheet shows the server quote.
 */
export function PizzaSection({ catalogGroups, currency, disabled, draft, otherProducts, product, quantity, serverQuote, sizeName, onChange }: {
  readonly catalogGroups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly disabled: boolean;
  readonly draft: PizzaDraft;
  /** Other pizza V2 products that may be the second half. */
  readonly otherProducts: readonly MenuProductV1[];
  readonly product: MenuProductV1;
  readonly quantity: number;
  /** The line quote for the current selection, only when it matches it; amounts always come from it. */
  readonly serverQuote: CaptureLineQuoteResultV1 | null;
  readonly sizeName: string | null;
  readonly onChange: (draft: PizzaDraft) => void;
}): ReactNode {
  const supabaseUrl = useMenuImageBaseUrl();
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
        half={draft.a} disabled={disabled} quantity={quantity} serverQuote={draft.split ? null : serverQuote} supabaseUrl={supabaseUrl}
        onChange={(a) => onChange({ ...draft, a })} />
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
          half={draft.b ?? emptyPizzaHalf(productB.productId)} disabled={disabled} quantity={quantity} serverQuote={null}
          supabaseUrl={supabaseUrl} onChange={(b) => onChange({ ...draft, b })} />}
      </section>}
    </div>
  </div>;
}

function groupExtras(options: readonly { readonly group: MenuModifierGroupV1; readonly option: MenuModifierOptionV1 }[]
): readonly { readonly group: MenuModifierGroupV1; readonly options: readonly MenuModifierOptionV1[] }[] {
  const byGroup = new Map<string, { group: MenuModifierGroupV1; options: MenuModifierOptionV1[] }>();
  for (const entry of options) {
    const current = byGroup.get(entry.group.groupId);
    if (current === undefined) byGroup.set(entry.group.groupId, { group: entry.group, options: [entry.option] });
    else current.options.push(entry.option);
  }
  return [...byGroup.values()];
}

function HalfPicks({ catalogGroups, currency, disabled, half, product, quantity, serverQuote, supabaseUrl, title, onChange }: {
  readonly catalogGroups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly disabled: boolean;
  readonly half: PizzaHalfDraft;
  readonly product: MenuProductV1;
  readonly quantity: number;
  readonly serverQuote: CaptureLineQuoteResultV1 | null;
  readonly supabaseUrl: string;
  readonly title: string;
  readonly onChange: (half: PizzaHalfDraft) => void;
}): ReactNode {
  const setup = pizzaHalfSetup(product, catalogGroups);
  const toggle = (role: PizzaOptionRole, optionId: string): void => onChange(togglePizzaOption(half, role, optionId));
  const counter = pizzaIngredientCounter(product, half);
  const charged = serverQuote === null ? 0 : pizzaServerChargesMinor(serverQuote, quantity);
  // `+$X` is the server's charge for the line; never a catalog price summed here.
  const chargeText = counter.chosen > counter.free && charged > 0 ? ` · +${formatMinorUnits(charged, currency)}` : "";
  const extras = groupExtras(setup.extraOptions);
  return <section className="grid content-start gap-3 rounded-xl border border-border p-3" aria-label={title === "" ? product.name : `${title}: ${product.name}`}>
    {title !== "" && <h3 className="font-heading text-base font-semibold">{title}: {product.name}</h3>}
    {product.pizzaMode === "custom" && setup.canChooseIngredients && <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">Ingredientes{setup.baseGroups.length > 0 && counter.free > 0 ? ` · ${counter.chosen} de ${counter.free} gratis` : ""}{chargeText}</legend>
      {setup.baseGroups.map(({ group, options }) => <div key={group.groupId} className="grid gap-2">
        {setup.baseGroups.length > 1 && <h4 className="text-xs font-semibold text-text-muted">{group.name || "Ingredientes"}</h4>}
        <OptionCheckTileGrid>
          {options.map((option) => <OptionCheckTile key={option.optionId} option={option} supabaseUrl={supabaseUrl}
            disabled={disabled} checked={half.ingredientOptionIds.includes(option.optionId)}
            onCheckedChange={() => toggle("ingredientOptionIds", option.optionId)} />)}
        </OptionCheckTileGrid>
      </div>)}
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
    {setup.canAddExtras && extras.map(({ group, options }) => <fieldset key={group.groupId} className="grid gap-2">
      <legend className="text-sm font-semibold">{group.name || "Extras"}{group.maximumQuantity > 1 ? ` · máx ${group.maximumQuantity}` : ""}</legend>
      <OptionCheckTileGrid>
        {options.map((option) => <OptionCheckTile key={option.optionId} option={option} supabaseUrl={supabaseUrl} currency={currency}
          disabled={disabled} checked={half.extraOptionIds.includes(option.optionId)}
          onCheckedChange={() => toggle("extraOptionIds", option.optionId)} />)}
      </OptionCheckTileGrid>
    </fieldset>)}
  </section>;
}
