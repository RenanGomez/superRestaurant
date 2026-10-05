"use client";

import { useEffect, useRef, useState } from "react";
import { CAPTURE_SELECTION_LINE_MAX_QUANTITY, type BranchScope, type CaptureLineQuoteRequestV1, type CaptureLineQuoteResultV1, type LineFractionHalfV1, type LineFractionV1, type MenuModifierGroupV1, type MenuProductV1 } from "@super-restaurant/shared-types";
import { formatMinorUnits } from "../../../lib/branch-order-work-tray";
import { visibleLineEstimate } from "../../../lib/capture-quote";
import type { CaptureRequestResult } from "../../../lib/capture-workspace";
import { buildLineFraction, estimateHalvesUnitMinor, halfExtraPriceMinor, halfLabel, halvesDraftFromFraction,
  HALF_MAX_EXTRAS, pickHalfFlavor, toggleHalfEntry, validateHalvesDraft, variantAllowsHalves,
  type HalvesDraft } from "../../../lib/line-halves";
import { countModifierSelections, estimateSelectionMinor, expandModifierSelections, toggleOrStepOption,
  validateModifierSelection, type SelectionPlanLineDraft, type SelectionPlanModifierGroupDraft } from "../../../lib/capture-selection";
import { useMenuImageBaseUrl } from "../../../lib/menu-image-url-context";
import { menuImagePublicUrl } from "../../../lib/menu-images";

const button = "min-h-11 min-w-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
const optionButton = "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent";
const optionSelected = "border-accent bg-accent-soft font-semibold text-accent";

interface ProductSheetProps {
  readonly product: MenuProductV1;
  readonly scope?: BranchScope;
  readonly catalogVersion?: string | null;
  readonly quoteLine?: (input: CaptureLineQuoteRequestV1) => Promise<CaptureRequestResult<CaptureLineQuoteResultV1>>;
  readonly groups: readonly MenuModifierGroupV1[];
  readonly currency: string;
  readonly busy: boolean;
  readonly showNote?: boolean;
  readonly showVariants?: boolean;
  readonly busyLabel?: string;
  readonly addLabel?: string;
  readonly lockSelection?: boolean;
  readonly closeDisabled?: boolean;
  /** `undefined` while nothing was just confirmed; `null` once added if no matching server line
   * was found; a minor-unit amount taken directly from the server's `selectionProjection` line. */
  readonly confirmedTotalMinor?: number | null | undefined;
  readonly initialLine?: SelectionPlanLineDraft | undefined;
  readonly initialVariantId?: string | null;
  readonly error?: string | undefined;
  readonly onClose: () => void;
  readonly onAdd: (quantity: number, modifierGroups: readonly SelectionPlanModifierGroupDraft[], note: string | null, variantId: string | null, fraction: LineFractionV1 | null) => void;
}

const MAX_NOTE_LENGTH = 200;

/** In-app "hoja" for choosing a product's modifier groups; never uses `window.prompt`. */
export function ProductSheet({ product, scope, catalogVersion, quoteLine, groups, currency, busy, busyLabel = "Calculando…", addLabel, lockSelection = false, closeDisabled = false, showNote = true, showVariants = false, confirmedTotalMinor, initialLine, initialVariantId, error, onClose, onAdd }: ProductSheetProps) {
  const supabaseUrl = useMenuImageBaseUrl();
  const confirmed = confirmedTotalMinor !== undefined;
  const [quantity, setQuantity] = useState(initialLine?.quantity ?? 1);
  const activeVariants = showVariants ? (product.variants ?? []).filter((variant) => variant.active).sort((a, b) => a.displayOrder - b.displayOrder) : [];
  const [variantId, setVariantId] = useState<string | null>(() => {
    const wanted = initialVariantId ?? initialLine?.variantId ?? null;
    return activeVariants.some((variant) => variant.variantId === wanted) ? wanted : null;
  });
  const variantRequired = activeVariants.length > 0;
  const sizeMissing = variantRequired && !activeVariants.some((variant) => variant.variantId === variantId);
  const [selections, setSelections] = useState<Record<string, readonly string[]>>(() => Object.fromEntries(
    (initialLine?.modifierGroups ?? []).map((group) => [group.groupId,
      expandModifierSelections(group.selections)])));
  const [note, setNote] = useState(initialLine?.note ?? "");
  const [splitChosen, setSplitChosen] = useState(initialLine?.fraction !== undefined);
  const [halves, setHalves] = useState<HalvesDraft>(() => halvesDraftFromFraction(initialLine?.fraction));
  const closeRef = useRef<HTMLButtonElement>(null);
  const [serverEstimate, setServerEstimate] = useState<{ readonly key: string; readonly value: CaptureLineQuoteResultV1 } | null>(null);
  const [catalogConflictKey, setCatalogConflictKey] = useState<string | null>(null);

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

  function chooseVariant(nextId: string): void {
    const previous = activeVariants.find((variant) => variant.variantId === variantId)?.fraction;
    const next = activeVariants.find((variant) => variant.variantId === nextId)?.fraction;
    // Flavors and extras belong to a size's own groups: another setup invalidates the picks.
    if (previous?.flavorGroupId !== next?.flavorGroupId || previous?.extraGroupId !== next?.extraGroupId) setHalves(halvesDraftFromFraction(undefined));
    setVariantId(nextId);
  }

  const selectedVariant = activeVariants.find((variant) => variant.variantId === variantId);
  const fractionSetup = variantAllowsHalves(selectedVariant?.fraction) ? selectedVariant?.fraction : undefined;
  const halvesActive = fractionSetup !== undefined && splitChosen;
  const flavorGroup = groups.find((group) => group.groupId === fractionSetup?.flavorGroupId);
  const extraGroup = groups.find((group) => group.groupId === fractionSetup?.extraGroupId);
  // With halves the flavor and extra groups live in the two columns, not in the ordinary list.
  const listedGroups = halvesActive ? groups.filter((group) => group.groupId !== flavorGroup?.groupId && group.groupId !== extraGroup?.groupId) : groups;
  const halvesValidation = validateHalvesDraft(halves);
  const lineFraction = halvesActive ? buildLineFraction(halves) : null;

  const groupDrafts: readonly SelectionPlanModifierGroupDraft[] = listedGroups.map((group) => ({
    groupId: group.groupId,
    selections: countModifierSelections(selections[group.groupId] ?? []),
  })).filter((group) => group.selections.length > 0);

  const validations = listedGroups.map((group) => ({
    group,
    validation: validateModifierSelection(group, countModifierSelections(selections[group.groupId] ?? [])),
  }));
  const allValid = validations.every((entry) => entry.validation.valid);
  const wholeEstimateMinor = estimateSelectionMinor(product, listedGroups, selections, quantity, variantId);
  const wholeUnitMinor = estimateSelectionMinor(product, listedGroups, selections, 1, variantId);
  const halvesUnitMinor = halvesActive && selectedVariant !== undefined && wholeUnitMinor !== null
    ? estimateHalvesUnitMinor({ variantPriceMinor: selectedVariant.unitPriceMinor, flavorGroup, extraGroup, draft: halves,
      otherModifiersMinor: wholeUnitMinor - selectedVariant.unitPriceMinor })
    : null;
  const estimatedMinor = halvesActive ? (halvesUnitMinor === null ? null : halvesUnitMinor * quantity) : wholeEstimateMinor;
  const halvesMissing = halvesActive && !halvesValidation.valid;
  const quoteRequest: CaptureLineQuoteRequestV1 | null = scope !== undefined && catalogVersion != null && quoteLine !== undefined && allValid && !sizeMissing && !halvesMissing
    && estimatedMinor !== null && quantity <= CAPTURE_SELECTION_LINE_MAX_QUANTITY
    ? { schemaVersion: 1, scope, catalogVersion, productId: product.productId, variantId,
      modifierGroups: groupDrafts, fraction: lineFraction, quantity }
    : null;
  const quoteKey = quoteRequest === null ? null : JSON.stringify(quoteRequest);
  const visibleEstimate = visibleLineEstimate(estimatedMinor, quoteKey, serverEstimate);

  useEffect(() => {
    if (quoteKey === null || quoteLine === undefined) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const request = JSON.parse(quoteKey) as CaptureLineQuoteRequestV1;
      void quoteLine(request).then((result) => {
        if (!active) return;
        if (result.ok) {
          setServerEstimate({ key: quoteKey, value: result.value });
          setCatalogConflictKey(null);
        } else if (result.error === "conflict" && result.code === "catalog_version_mismatch") {
          setServerEstimate(null);
          setCatalogConflictKey(quoteKey);
        }
      }).catch(() => { /* Local estimate stays visible when the server is unavailable. */ });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [quoteKey, quoteLine]);

  return <div className="fixed inset-0 z-20 flex items-end justify-center bg-[oklch(10%_0.02_250_/_.45)] sm:items-center"
    role="dialog" aria-modal="true" aria-labelledby="product-sheet-title"
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`flex max-h-[92dvh] w-full ${halvesActive ? "max-w-3xl" : "max-w-xl"} flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl`}>
      <header className="flex items-center gap-2 border-b border-border p-4">
        <h2 id="product-sheet-title" className="font-heading text-lg font-semibold">{product.name}</h2>
        <span className="grow" />
        <button ref={closeRef} type="button" className={`${button}`} aria-label="Cerrar (Esc)" disabled={closeDisabled} onClick={onClose}>✕</button>
      </header>
      <div className="grid flex-1 gap-4 overflow-auto p-4">
        {variantRequired && <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold">Tamaño · obligatorio</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {activeVariants.map((variant) => <button key={variant.variantId} type="button"
              disabled={busy || confirmed || lockSelection} aria-pressed={variantId === variant.variantId}
              className={`${optionButton} min-w-0 ${variantId === variant.variantId ? optionSelected : ""}`}
              onClick={() => chooseVariant(variant.variantId)}>
              <span className="min-w-0 break-words">{variant.name}</span><span className="shrink-0">{formatMinorUnits(variant.unitPriceMinor, currency)}</span>
            </button>)}
          </div>
        </fieldset>}
        {fractionSetup !== undefined && <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold">¿Cómo la quieres?</legend>
          <div className="grid grid-cols-2 gap-2">
            {([["Entera", false], ["Mitad y mitad", true]] as const).map(([label, split]) => <button key={label} type="button"
              disabled={busy || confirmed || lockSelection} aria-pressed={splitChosen === split}
              className={`${optionButton} justify-center ${splitChosen === split ? optionSelected : ""}`}
              onClick={() => setSplitChosen(split)}>{label}</button>)}
          </div>
        </fieldset>}
        {halvesActive && <div className="grid gap-3 sm:grid-cols-2" aria-label="Mitad y mitad">
          {(["half-a", "half-b"] as const).map((half) => <HalfColumn key={half} half={half} draft={half === "half-a" ? halves.a : halves.b}
            flavorGroup={flavorGroup} extraGroup={extraGroup} excludable={fractionSetup?.excludableIngredientIds ?? []}
            currency={currency} variantPriceMinor={selectedVariant?.unitPriceMinor ?? 0}
            disabled={busy || confirmed || lockSelection}
            onFlavor={(optionId) => setHalves((current) => pickHalfFlavor(current, half, optionId))}
            onEntry={(list, id) => setHalves((current) => toggleHalfEntry(current, half, list, id))} />)}
        </div>}
        {listedGroups.map((group) => <fieldset key={group.groupId} className="grid gap-2">
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
                    disabled={!option.active || busy || confirmed || lockSelection || selectedCount === 0}
                    onClick={() => changeOption(group, option.optionId, option.maximumQuantity, -1)}>−</button>
                  <span className="min-w-6 text-center font-semibold" aria-label={`${selectedCount} unidades de ${option.name}`}>{selectedCount}</span>
                  <button type="button" className={button} aria-label={`Agregar una unidad de ${option.name}`}
                    disabled={!option.active || busy || confirmed || lockSelection || chosen.length >= group.maximumQuantity
                      || (option.maximumQuantity !== null && selectedCount >= option.maximumQuantity)}
                    onClick={() => changeOption(group, option.optionId, option.maximumQuantity, 1)}>+</button>
                </div>
              </div> : <button key={option.optionId} type="button"
                disabled={!option.active || busy || confirmed || lockSelection || (group.maximumQuantity > 1 && selectedCount === 0 && chosen.length >= group.maximumQuantity)}
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
            rows={2} maxLength={MAX_NOTE_LENGTH} disabled={busy || confirmed || lockSelection} placeholder="Ej. sin cebolla, bien cocida"
            value={note} onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_LENGTH))} />
          <span className="text-xs text-text-muted">{note.length}/{MAX_NOTE_LENGTH}</span>
        </div>}
      </div>
      <div className="px-4 py-2" role="status">
        <p className="text-sm font-semibold">{visibleEstimate.label}: {visibleEstimate.minor === null ? "se confirma al agregar" : formatMinorUnits(visibleEstimate.minor, currency)}</p>
        {visibleEstimate.taxMinor !== null && visibleEstimate.taxMinor > 0 &&
          <p className="text-xs text-text-muted">Incluye IVA {formatMinorUnits(visibleEstimate.taxMinor, currency)}</p>}
        {quoteKey !== null && catalogConflictKey === quoteKey && <p className="text-xs text-error">El menú cambió, recarga.</p>}
      </div>
      {error && <p role="alert" className="mx-4 rounded-lg bg-error-bg p-3 text-sm">{error}</p>}
      {confirmed && <p role="status" aria-live="polite" className="mx-4 rounded-lg bg-success-bg px-3 py-2 text-sm font-semibold text-success">
        {confirmedTotalMinor === null ? (initialLine ? "Guardado" : "Agregado") : `${initialLine ? "Guardado" : "Agregado"} · ${formatMinorUnits(confirmedTotalMinor, currency)}`}
      </p>}
      <footer className="flex flex-wrap items-center gap-3 border-t border-border p-4">
        <div className="flex items-center gap-2">
          <button type="button" className={`${button} text-xl`} aria-label="Menos" disabled={busy || confirmed || lockSelection || quantity <= 1}
            onClick={() => setQuantity((current) => Math.max(1, current - 1))}>−</button>
          <span className="min-w-9 text-center text-lg font-bold">{quantity}</span>
          <button type="button" className={`${button} text-xl`} aria-label="Más" disabled={busy || confirmed || lockSelection || quantity >= CAPTURE_SELECTION_LINE_MAX_QUANTITY}
            onClick={() => setQuantity((current) => Math.min(CAPTURE_SELECTION_LINE_MAX_QUANTITY, current + 1))}>+</button>
        </div>
        <span className="grow" />
        <button type="button" className="min-h-11 min-w-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50" disabled={busy || confirmed || !allValid || sizeMissing || halvesMissing}
          onClick={() => onAdd(quantity, groupDrafts, note.trim().length === 0 ? null : note.trim(), variantId, lineFraction)}>
          {busy ? busyLabel : confirmed ? (confirmedTotalMinor === null ? "Agregado" : `Agregado · ${formatMinorUnits(confirmedTotalMinor, currency)}`)
            : sizeMissing ? "Elige un tamaño" : halvesMissing ? (halvesValidation.message ?? "Elige los dos sabores") : !allValid ? "Completa lo obligatorio" : addLabel ?? (initialLine ? "Guardar cambios" : "Agregar")}
        </button>
      </footer>
    </div>
  </div>;
}

interface HalfColumnProps {
  readonly half: LineFractionHalfV1;
  readonly draft: HalvesDraft["a"];
  readonly flavorGroup: MenuModifierGroupV1 | undefined;
  readonly extraGroup: MenuModifierGroupV1 | undefined;
  readonly excludable: readonly string[];
  readonly currency: string;
  readonly variantPriceMinor: number;
  readonly disabled: boolean;
  readonly onFlavor: (optionId: string) => void;
  readonly onEntry: (list: "extraOptionIds" | "excludedIngredientIds", id: string) => void;
}

/** One half of a "mitad y mitad" line: flavor buttons first, then optional extras and exclusions. */
function HalfColumn({ half, draft, flavorGroup, extraGroup, excludable, currency, variantPriceMinor, disabled, onFlavor, onEntry }: HalfColumnProps) {
  const title = halfLabel(half);
  const chip = "flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
  return <section className="grid content-start gap-3 rounded-xl border border-border p-3" aria-label={title}>
    <h3 className="font-heading text-base font-semibold">{title}</h3>
    <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">Sabor</legend>
      {(flavorGroup?.options ?? []).filter((option) => option.active).map((option) => <button key={option.optionId} type="button"
        disabled={disabled} aria-pressed={draft.flavorOptionId === option.optionId}
        className={`${chip} text-base ${draft.flavorOptionId === option.optionId ? optionSelected : ""}`}
        onClick={() => onFlavor(option.optionId)}>
        <span>{option.name}</span>
        <span className="text-xs text-text-muted">{formatMinorUnits(option.unitPriceMinor === 0 ? variantPriceMinor : option.unitPriceMinor, currency)}</span>
      </button>)}
    </fieldset>
    {extraGroup !== undefined && extraGroup.options.some((option) => option.active) && <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">Extras · media porción</legend>
      {extraGroup.options.filter((option) => option.active).map((option) => {
        const chosen = draft.extraOptionIds.includes(option.optionId);
        return <button key={option.optionId} type="button" aria-pressed={chosen}
          disabled={disabled || (!chosen && draft.extraOptionIds.length >= HALF_MAX_EXTRAS)}
          className={`${chip} ${chosen ? optionSelected : ""}`} onClick={() => onEntry("extraOptionIds", option.optionId)}>
          <span>{option.name}</span>
          {option.unitPriceMinor > 0 && <span className="text-xs text-text-muted">+{formatMinorUnits(halfExtraPriceMinor(option.unitPriceMinor), currency)}</span>}
        </button>;
      })}
    </fieldset>}
    {excludable.length > 0 && <fieldset className="grid gap-2">
      <legend className="text-sm font-semibold">Quitar ingredientes</legend>
      <div className="flex flex-wrap gap-2">
        {excludable.map((ingredient) => {
          const chosen = draft.excludedIngredientIds.includes(ingredient);
          return <button key={ingredient} type="button" aria-pressed={chosen} disabled={disabled}
            className={`${chip} ${chosen ? optionSelected : ""}`} onClick={() => onEntry("excludedIngredientIds", ingredient)}>
            Sin {ingredient}
          </button>;
        })}
      </div>
    </fieldset>}
  </section>;
}

function OptionPhoto({ imagePath, name, supabaseUrl }: { readonly imagePath: string | null; readonly name: string; readonly supabaseUrl: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = menuImagePublicUrl(supabaseUrl, imagePath);
  return url !== null && failedUrl !== url
    ? <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} className="h-11 w-11 shrink-0 rounded-lg object-cover" />
    : <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-bold text-accent">{name.trim().charAt(0).toLocaleUpperCase("es-MX")}</span>;
}
