import type {
  CaptureSelectionPlanProjectionLineV1,
  LineFractionHalfV1,
  LineFractionV1,
  FractionHalfProjectionV1,
  MenuCatalogV1,
  MenuModifierGroupV1,
  MenuProductV1,
  MenuProductVariantV1,
  MenuVariantFractionV1,
  OrderDetailFractionHalfV1,
} from "@super-restaurant/shared-types";
import type { SelectionPlanLineDraft } from "./capture-selection";
import { groupsForProduct } from "./menu-groups";

/** What the operator has chosen for one half while arming a "mitad y mitad" line. */
export interface HalfDraft {
  /** Half built ingredient by ingredient: no flavor, `extraOptionIds` are its ingredients. */
  readonly built: boolean;
  readonly excludedIngredientIds: readonly string[];
  readonly extraOptionIds: readonly string[];
  readonly flavorOptionId: string | null;
}

export interface HalvesDraft {
  readonly a: HalfDraft;
  readonly b: HalfDraft;
}

export const HALVES_MISSING_FLAVORS_MESSAGE = "Elige los dos sabores";
export const HALVES_BOTH_BUILT_MESSAGE = "Una mitad debe llevar sabor; no se pueden armar las dos";
export const HALVES_BUILT_EMPTY_MESSAGE = "Elige los ingredientes de la mitad armada";

/** Name the server freezes for a half built ingredient by ingredient. */
export const HALF_BUILT_FLAVOR_NAME = "Armada";

/** The database limits the extras one half can carry. */
export const HALF_MAX_EXTRAS = 5;

/** How many ingredients a built half may carry: the database cap, tightened by the group's own maximum. */
export function builtHalfIngredientLimit(ingredientGroup: MenuModifierGroupV1 | undefined): number {
  const groupMaximum = ingredientGroup?.maximumQuantity ?? 0;
  return groupMaximum >= 1 ? Math.min(HALF_MAX_EXTRAS, groupMaximum) : HALF_MAX_EXTRAS;
}

/**
 * The half-and-half setup that applies to a line: the product's own, or, while the product carries
 * none, the legacy one of the chosen size. `undefined` when halves are not offered.
 */
export function effectiveHalvesSetup(
  product: Pick<MenuProductV1, "fraction">,
  variant: Pick<MenuProductVariantV1, "fraction"> | undefined,
): MenuVariantFractionV1 | undefined {
  const source = product.fraction ?? variant?.fraction;
  return variantAllowsHalves(source) ? source : undefined;
}

/** Half-price shown next to an extra chip: half the price, rounded up to the minor unit. */
export function halfExtraPriceMinor(unitPriceMinor: number): number {
  return Math.floor((unitPriceMinor + 1) / 2);
}

export function emptyHalvesDraft(): HalvesDraft {
  return { a: emptyHalf(), b: emptyHalf() };
}

function emptyHalf(): HalfDraft {
  return { built: false, excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: null };
}

export function halfLabel(fraction: LineFractionHalfV1): string {
  return fraction === "half-a" ? "Mitad A" : "Mitad B";
}

/** Whether a size offers halves and has the flavor group configured. */
export function variantAllowsHalves(fraction: MenuVariantFractionV1 | null | undefined): fraction is MenuVariantFractionV1 {
  return fraction !== null && fraction !== undefined && fraction.enabled && fraction.flavorGroupId !== null;
}

/**
 * Each half is a flavor or a half built ingredient by ingredient (with at least one ingredient);
 * at least one half must carry a flavor. Extras and exclusions of a flavor half are optional.
 */
export function validateHalvesDraft(draft: HalvesDraft): { readonly valid: boolean; readonly message: string | null } {
  if (draft.a.built && draft.b.built) return { valid: false, message: HALVES_BOTH_BUILT_MESSAGE };
  for (const half of [draft.a, draft.b]) {
    if (half.built ? half.extraOptionIds.length === 0 : half.flavorOptionId === null) {
      return { valid: false, message: half.built ? HALVES_BUILT_EMPTY_MESSAGE : HALVES_MISSING_FLAVORS_MESSAGE };
    }
  }
  return { valid: true, message: null };
}

function halfKey(half: LineFractionHalfV1): "a" | "b" { return half === "half-a" ? "a" : "b"; }

/** Sets one half's flavor, or clears it when the same flavor is tapped again. A flavor replaces a built half. */
export function pickHalfFlavor(draft: HalvesDraft, half: LineFractionHalfV1, optionId: string): HalvesDraft {
  const key = halfKey(half);
  const current = draft[key];
  if (current.built) return { ...draft, [key]: { ...emptyHalf(), flavorOptionId: optionId } };
  return { ...draft, [key]: { ...current, flavorOptionId: current.flavorOptionId === optionId ? null : optionId } };
}

/**
 * Switches one half between a flavor and "armar con ingredientes". Building clears the flavor,
 * extras and exclusions; it is refused (draft unchanged) when the other half is already built.
 */
export function setHalfBuilt(draft: HalvesDraft, half: LineFractionHalfV1, built: boolean): HalvesDraft {
  const key = halfKey(half);
  const other = draft[key === "a" ? "b" : "a"];
  if (built && other.built) return draft;
  return { ...draft, [key]: { ...emptyHalf(), built } };
}

/** Adds or removes one id from a half's extras (or ingredients) or exclusions. */
export function toggleHalfEntry(
  draft: HalvesDraft, half: LineFractionHalfV1, list: "extraOptionIds" | "excludedIngredientIds", id: string,
  limit: number = HALF_MAX_EXTRAS,
): HalvesDraft {
  const key = halfKey(half);
  const current = draft[key];
  if (current.built && list === "excludedIngredientIds") return draft;
  const present = current[list].includes(id);
  if (!present && list === "extraOptionIds" && current[list].length >= limit) return draft;
  const next = present ? current[list].filter((entry) => entry !== id) : [...current[list], id];
  return { ...draft, [key]: { ...current, [list]: next } };
}

/**
 * Visual estimate of one unit, mirroring the server rule: the greater flavor price (a flavor
 * priced at zero takes the size price) plus each extra at half its price rounded up. Integer
 * minor units only; the server remains the authority for the real amount.
 */
export function estimateHalvesUnitMinor(input: {
  readonly variantPriceMinor: number;
  readonly flavorGroup: MenuModifierGroupV1 | undefined;
  readonly extraGroup: MenuModifierGroupV1 | undefined;
  readonly draft: HalvesDraft;
  /** Unit price of the ordinary modifier groups that apply to the whole line. */
  readonly otherModifiersMinor: number;
}): number | null {
  if (input.flavorGroup === undefined || !validateHalvesDraft(input.draft).valid) return null;
  let greatest = 0;
  let extras = 0;
  for (const half of [input.draft.a, input.draft.b]) {
    if (half.built) {
      // A built half starts from the size (or product) price; its ingredients are charged like extras.
      greatest = Math.max(greatest, input.variantPriceMinor);
    } else {
      const flavor = input.flavorGroup.options.find((option) => option.optionId === half.flavorOptionId);
      if (flavor === undefined) return null;
      greatest = Math.max(greatest, flavor.unitPriceMinor === 0 ? input.variantPriceMinor : flavor.unitPriceMinor);
    }
    for (const extraId of half.extraOptionIds) {
      const extra = input.extraGroup?.options.find((option) => option.optionId === extraId);
      if (extra === undefined) return null;
      extras += halfExtraPriceMinor(extra.unitPriceMinor);
    }
  }
  const total = greatest + extras + input.otherModifiersMinor;
  return Number.isSafeInteger(total) ? total : null;
}

/** The `fraction` payload for a plan line or an add-item command; `null` until both flavors exist. */
export function buildLineFraction(draft: HalvesDraft): LineFractionV1 | null {
  if (!validateHalvesDraft(draft).valid) return null;
  const slot = (half: HalfDraft, fraction: LineFractionHalfV1) => ({
    excludedIngredientIds: [...half.excludedIngredientIds],
    extraOptionIds: [...half.extraOptionIds],
    flavorOptionId: half.built ? null : half.flavorOptionId,
    fraction,
  });
  return { geometry: "halves", slots: [slot(draft.a, "half-a"), slot(draft.b, "half-b")] };
}

/** Restores the sheet state of an existing half-and-half line (to edit it). */
export function halvesDraftFromFraction(fraction: LineFractionV1 | undefined): HalvesDraft {
  if (fraction === undefined) return emptyHalvesDraft();
  const half = (fractionName: LineFractionHalfV1): HalfDraft => {
    const slot = fraction.slots.find((candidate) => candidate.fraction === fractionName);
    return slot === undefined ? emptyHalf()
      : { built: slot.flavorOptionId === null, excludedIngredientIds: slot.excludedIngredientIds,
        extraOptionIds: slot.extraOptionIds, flavorOptionId: slot.flavorOptionId };
  };
  return { a: half("half-a"), b: half("half-b") };
}

export type RestoreFractionResult =
  | { readonly ok: true; readonly fraction: LineFractionV1 }
  | { readonly ok: false; readonly reason: "missing-halves" | "no-setup" | "flavor" | "extra" };

/** The single active option with this exact name; `undefined` when absent or ambiguous. */
function uniqueActiveByName(group: MenuModifierGroupV1 | undefined, name: string): string | undefined {
  const matches = (group?.options ?? []).filter((option) => option.active && option.name === name);
  return matches.length === 1 ? matches[0]?.optionId : undefined;
}

/**
 * Restores ids from the saved projection. Older projections carry only names, which are resolved
 * among active options. Every id must still be valid in the current catalog before re-sending.
 * A miss is an error: the caller must not send the line as a whole one.
 */
export function restoreLineFraction(
  halves: readonly FractionHalfProjectionV1[] | undefined,
  setup: MenuVariantFractionV1 | null | undefined,
  groups: readonly MenuModifierGroupV1[],
): RestoreFractionResult {
  if (halves === undefined || halves.length !== 2) return { ok: false, reason: "missing-halves" };
  if (setup === null || setup === undefined) return { ok: false, reason: "no-setup" };
  const flavorGroup = groups.find((group) => group.groupId === setup.flavorGroupId);
  const extraGroup = groups.find((group) => group.groupId === setup.extraGroupId);
  const activeOption = (group: MenuModifierGroupV1 | undefined, id: string) =>
    group?.options.some((option) => option.active && option.optionId === id) ?? false;
  const slots: LineFractionV1["slots"][number][] = [];
  for (const fractionName of ["half-a", "half-b"] as const) {
    const half = halves.find((candidate) => candidate.fraction === fractionName);
    if (half === undefined) return { ok: false, reason: "missing-halves" };
    const hasIds = half.flavorOptionId !== undefined && half.extraOptionIds !== undefined
      && half.excludedIngredientIds !== undefined;
    // A half built ingredient by ingredient has a null id (or, in older projections, the frozen name «Armada»
    // when no active flavor carries it). It needs an ingredient group to be re-sent.
    const namedFlavor = hasIds ? undefined : uniqueActiveByName(flavorGroup, half.flavorName);
    const built = hasIds ? half.flavorOptionId === null : namedFlavor === undefined && half.flavorName === HALF_BUILT_FLAVOR_NAME;
    let flavorOptionId: string | null | undefined = hasIds ? half.flavorOptionId : namedFlavor;
    if (built) {
      if (extraGroup === undefined) return { ok: false, reason: "flavor" };
      flavorOptionId = null;
    } else if (flavorOptionId === undefined || flavorOptionId === null || !activeOption(flavorGroup, flavorOptionId)) {
      return { ok: false, reason: "flavor" };
    }
    const extraOptionIds = hasIds ? [...half.extraOptionIds!] : half.extras.map((name) => uniqueActiveByName(extraGroup, name));
    if (extraOptionIds.some((id) => id === undefined || !activeOption(extraGroup, id))) return { ok: false, reason: "extra" };
    const lockedSet = new Set(setup.lockedIngredientOptionIds ?? []);
    const excludedIngredientIds = hasIds
      ? [...half.excludedIngredientIds!]
      : half.exclusions.map((name) => uniqueActiveByName(extraGroup, name));
    const allowedExclusions = new Set<string>(
      extraGroup?.options
        .filter((option) => option.active && !lockedSet.has(option.optionId))
        .map((option) => option.optionId) ?? [],
    );
    if (excludedIngredientIds.some((id) => id === undefined || !allowedExclusions.has(id))) {
      return { ok: false, reason: "extra" };
    }
    slots.push({ excludedIngredientIds: excludedIngredientIds as string[], extraOptionIds: extraOptionIds as string[], flavorOptionId, fraction: fractionName });
  }
  if (slots.every((slot) => slot.flavorOptionId === null)) return { ok: false, reason: "flavor" };
  return { ok: true, fraction: { geometry: "halves", slots } };
}

export type DraftLinesResult =
  | { readonly ok: true; readonly lines: readonly SelectionPlanLineDraft[] }
  | { readonly ok: false; readonly lineName: string };

/**
 * Rebuilds the plan's draft lines from the saved projection. A split line that cannot be restored
 * fails the whole rebuild (naming the line) so it is never re-sent as a whole one.
 */
export function draftLinesFromProjection(
  lines: readonly CaptureSelectionPlanProjectionLineV1[],
  catalog: Pick<MenuCatalogV1, "products" | "modifierGroups"> | null,
): DraftLinesResult {
  const drafts: SelectionPlanLineDraft[] = [];
  for (const line of lines) {
    const byGroup = new Map<string, { optionId: string; quantity: number }[]>();
    for (const modifier of line.modifiers) {
      const existing = byGroup.get(modifier.groupId) ?? [];
      existing.push({ optionId: modifier.optionId, quantity: modifier.quantity });
      byGroup.set(modifier.groupId, existing);
    }
    const modifierGroups = [...byGroup.entries()].map(([groupId, selections]) => ({ groupId, selections }));
    let fraction: LineFractionV1 | undefined;
    if (line.halves !== undefined && line.halves.length > 0) {
      const product = catalog?.products.find((entry) => entry.productId === line.productId);
      const variant = product?.variants?.find((entry) => entry.variantId === line.variantId);
      const restored = restoreLineFraction(line.halves, product?.fraction ?? variant?.fraction,
        product === undefined || catalog === null ? [] : groupsForProduct(product, catalog.modifierGroups));
      if (!restored.ok) return { ok: false, lineName: line.productName };
      fraction = restored.fraction;
    }
    drafts.push({ lineId: line.lineId, productId: line.productId, variantId: line.variantId, quantity: line.quantity,
      modifierGroups, note: line.note, ...(fraction === undefined ? {} : { fraction }) });
  }
  return { ok: true, lines: drafts };
}

/** Message shown in the ticket when a split line cannot be kept; nothing is sent. */
export function splitLostMessage(lineName: string): string {
  return `No se pudo conservar la división de "${lineName}"; recarga el menú`;
}

/** Ticket and detail text for one frozen half: a headline and the extras/exclusions under it. */
export function halfTicketLines(half: OrderDetailFractionHalfV1): { readonly title: string; readonly details: readonly string[] } {
  if (half.flavorName === HALF_BUILT_FLAVOR_NAME) {
    // A half built ingredient by ingredient: its ingredients are the headline, not "extras".
    const ingredients = half.extras.length > 0 ? ` (${half.extras.join(", ")})` : "";
    return {
      details: half.exclusions.map((name) => `Sin ${name}`),
      title: `${halfLabel(half.fraction)}: ${HALF_BUILT_FLAVOR_NAME}${ingredients}`,
    };
  }
  return {
    details: [...half.extras.map((name) => `+ ${name}`), ...half.exclusions.map((name) => `Sin ${name}`)],
    title: `${halfLabel(half.fraction)}: ${half.flavorName}`,
  };
}
