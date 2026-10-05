import type { ModifierPriceSnapshot, OrderItemPriceSnapshot } from "@super-restaurant/domain";
import type { OrderDetailFractionHalfV1 } from "@super-restaurant/shared-types";

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
      .map((modifier) => modifier.modifierId.startsWith(prefix) ? modifier.modifierId.slice(prefix.length) : modifier.name);
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
