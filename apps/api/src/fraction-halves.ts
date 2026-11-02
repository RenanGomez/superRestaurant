import { FRACTION_CUSTOM_FLAVOR_ID } from "@super-restaurant/domain";
import type { ModifierPriceSnapshot, OrderItemPriceSnapshot } from "@super-restaurant/domain";
import type { FractionHalfProjectionV1, LineFractionV1, OrderDetailFractionHalfV1 } from "@super-restaurant/shared-types";

/** Modifier groups written by the fraction pricing rules; they are shown per half, never as catalog modifiers. */
export function isFractionModifier(modifier: Pick<ModifierPriceSnapshot, "groupId">): boolean {
  return modifier.groupId === "fraction-extra" || modifier.groupId === "fraction-exclusion";
}

/**
 * Per-half view of a frozen half-and-half snapshot: flavor name and price, the extras charged on
 * that half and the ingredients excluded from it. Reads only the snapshot, never the live catalog.
 */
export function describeHalves(snapshot: OrderItemPriceSnapshot): readonly OrderDetailFractionHalfV1[] {
  if (snapshot.geometry !== "halves" || snapshot.fractionBreakdown === undefined) return [];
  const halves: OrderDetailFractionHalfV1[] = [];
  for (const entry of snapshot.fractionBreakdown) {
    if (entry.fraction !== "half-a" && entry.fraction !== "half-b") continue;
    const extras = snapshot.modifiers
      .filter((modifier) => modifier.groupId === "fraction-extra" && modifier.groupName === `extra:${entry.fraction}`)
      .map((modifier) => modifier.name);
    const prefix = `exclude:${entry.fraction}:`;
    const exclusions = snapshot.modifiers
      .filter((modifier) => modifier.groupId === "fraction-exclusion" && modifier.groupName === `exclude:${entry.fraction}`)
      .map((modifier) => {
        if (modifier.name.startsWith("Sin ")) return modifier.name.slice(4);
        return modifier.modifierId.startsWith(prefix) ? modifier.modifierId.slice(prefix.length) : modifier.name;
      });
    halves.push({
      amountMinor: entry.amountMinor,
      exclusions,
      extras,
      flavorName: entry.flavorName ?? entry.flavorOptionId,
      fraction: entry.fraction,
    });
  }
  return halves;
}

/**
 * Per-half view with ids recovered from the frozen snapshot alone (order detail has no stored
 * `fraction`): the flavor id is the breakdown entry's `flavorOptionId`, extra ids come from
 * `extra:<half>:<id>` modifier ids and exclusions come from `exclude:<half>:<id>` modifier ids.
 * A half whose ids cannot be recovered completely is returned without ids.
 */
export function describeHalvesFromSnapshot(snapshot: OrderItemPriceSnapshot): readonly FractionHalfProjectionV1[] {
  // A half built ingredient by ingredient is frozen with the sentinel id; the projection exposes it as null.
  const flavorIds = new Map((snapshot.fractionBreakdown ?? []).map((entry) => [
    entry.fraction,
    entry.flavorOptionId === FRACTION_CUSTOM_FLAVOR_ID ? null : entry.flavorOptionId,
  ] as const));
  return describeHalves(snapshot).map((half) => {
    const flavorOptionId = flavorIds.get(half.fraction);
    const prefix = `extra:${half.fraction}:`;
    const extraOptionIds = snapshot.modifiers
      .filter((modifier) => modifier.groupId === "fraction-extra" && modifier.modifierId.startsWith(prefix))
      .map((modifier) => modifier.modifierId.slice(prefix.length));
    const exclPrefix = `exclude:${half.fraction}:`;
    const excludedIngredientIds = snapshot.modifiers
      .filter((modifier) => modifier.groupId === "fraction-exclusion" && modifier.modifierId.startsWith(exclPrefix))
      .map((modifier) => modifier.modifierId.slice(exclPrefix.length));
    if (flavorOptionId === undefined || extraOptionIds.length !== half.extras.length || excludedIngredientIds.length !== half.exclusions.length) return half;
    return { ...half, excludedIngredientIds, extraOptionIds, flavorOptionId };
  });
}

/**
 * Same per-half view as `describeHalves` plus the ids of each half's flavor, extras and exclusions,
 * taken from the stored `fraction` of the plan line (never resolved from names). Used by the plan
 * projection and the line quote; order detail keeps the id-free `describeHalves`.
 */
export function describeHalvesWithIds(
  snapshot: OrderItemPriceSnapshot,
  fraction: LineFractionV1 | null,
): readonly FractionHalfProjectionV1[] {
  const slots = new Map((fraction?.slots ?? []).map((slot) => [slot.fraction, slot] as const));
  return describeHalves(snapshot).map((half) => {
    const slot = slots.get(half.fraction);
    if (slot === undefined) return half;
    return {
      ...half,
      excludedIngredientIds: [...slot.excludedIngredientIds],
      extraOptionIds: [...slot.extraOptionIds],
      flavorOptionId: slot.flavorOptionId,
    };
  });
}
