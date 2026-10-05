import type {
  LineFractionHalfV1,
  LineFractionV1,
  MenuModifierGroupV1,
  MenuVariantFractionV1,
  OrderDetailFractionHalfV1,
} from "@super-restaurant/shared-types";

/** What the operator has chosen for one half while arming a "mitad y mitad" line. */
export interface HalfDraft {
  readonly excludedIngredientIds: readonly string[];
  readonly extraOptionIds: readonly string[];
  readonly flavorOptionId: string | null;
}

export interface HalvesDraft {
  readonly a: HalfDraft;
  readonly b: HalfDraft;
}

export const HALVES_MISSING_FLAVORS_MESSAGE = "Elige los dos sabores";

/** The database limits the extras one half can carry. */
export const HALF_MAX_EXTRAS = 5;

/** Half-price shown next to an extra chip: half the price, rounded up to the minor unit. */
export function halfExtraPriceMinor(unitPriceMinor: number): number {
  return Math.floor((unitPriceMinor + 1) / 2);
}

export function emptyHalvesDraft(): HalvesDraft {
  return { a: emptyHalf(), b: emptyHalf() };
}

function emptyHalf(): HalfDraft {
  return { excludedIngredientIds: [], extraOptionIds: [], flavorOptionId: null };
}

export function halfLabel(fraction: LineFractionHalfV1): string {
  return fraction === "half-a" ? "Mitad A" : "Mitad B";
}

/** Whether a size offers halves and has the flavor group configured. */
export function variantAllowsHalves(fraction: MenuVariantFractionV1 | null | undefined): fraction is MenuVariantFractionV1 {
  return fraction !== null && fraction !== undefined && fraction.enabled && fraction.flavorGroupId !== null;
}

/** The two halves need a flavor each; extras and exclusions are optional. */
export function validateHalvesDraft(draft: HalvesDraft): { readonly valid: boolean; readonly message: string | null } {
  return draft.a.flavorOptionId !== null && draft.b.flavorOptionId !== null
    ? { valid: true, message: null }
    : { valid: false, message: HALVES_MISSING_FLAVORS_MESSAGE };
}

/** Sets one half's flavor, or clears it when the same flavor is tapped again. */
export function pickHalfFlavor(draft: HalvesDraft, half: LineFractionHalfV1, optionId: string): HalvesDraft {
  const key = half === "half-a" ? "a" : "b";
  const current = draft[key];
  return { ...draft, [key]: { ...current, flavorOptionId: current.flavorOptionId === optionId ? null : optionId } };
}

/** Adds or removes one id from a half's extras or exclusions. */
export function toggleHalfEntry(
  draft: HalvesDraft, half: LineFractionHalfV1, list: "extraOptionIds" | "excludedIngredientIds", id: string,
): HalvesDraft {
  const key = half === "half-a" ? "a" : "b";
  const current = draft[key];
  const next = current[list].includes(id) ? current[list].filter((entry) => entry !== id) : [...current[list], id];
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
    const flavor = input.flavorGroup.options.find((option) => option.optionId === half.flavorOptionId);
    if (flavor === undefined) return null;
    greatest = Math.max(greatest, flavor.unitPriceMinor === 0 ? input.variantPriceMinor : flavor.unitPriceMinor);
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
    flavorOptionId: half.flavorOptionId as string,
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
      : { excludedIngredientIds: slot.excludedIngredientIds, extraOptionIds: slot.extraOptionIds, flavorOptionId: slot.flavorOptionId };
  };
  return { a: half("half-a"), b: half("half-b") };
}

/**
 * The saved selection projection only names the flavors and extras, so re-sending the plan (to
 * change a quantity or edit another line) needs their ids back. Resolves them by name inside the
 * size's own flavor and extra groups; `undefined` when the catalog no longer matches.
 */
export function restoreLineFraction(
  halves: readonly OrderDetailFractionHalfV1[] | undefined,
  setup: MenuVariantFractionV1 | null | undefined,
  groups: readonly MenuModifierGroupV1[],
): LineFractionV1 | undefined {
  if (halves === undefined || halves.length !== 2 || setup === null || setup === undefined) return undefined;
  const flavorGroup = groups.find((group) => group.groupId === setup.flavorGroupId);
  const extraGroup = groups.find((group) => group.groupId === setup.extraGroupId);
  const slots = (["half-a", "half-b"] as const).map((fractionName) => {
    const half = halves.find((candidate) => candidate.fraction === fractionName);
    const flavor = flavorGroup?.options.find((option) => option.name === half?.flavorName);
    if (half === undefined || flavor === undefined) return undefined;
    const extraOptionIds: string[] = [];
    for (const name of half.extras) {
      const extra = extraGroup?.options.find((option) => option.name === name);
      if (extra === undefined) return undefined;
      extraOptionIds.push(extra.optionId);
    }
    return { excludedIngredientIds: [...half.exclusions], extraOptionIds, flavorOptionId: flavor.optionId, fraction: fractionName };
  });
  const [first, second] = slots;
  return first === undefined || second === undefined ? undefined : { geometry: "halves", slots: [first, second] };
}

/** Ticket and detail text for one frozen half: a headline and the extras/exclusions under it. */
export function halfTicketLines(half: OrderDetailFractionHalfV1): { readonly title: string; readonly details: readonly string[] } {
  return {
    details: [...half.extras.map((name) => `+ ${name}`), ...half.exclusions.map((name) => `Sin ${name}`)],
    title: `${halfLabel(half.fraction)}: ${half.flavorName}`,
  };
}
