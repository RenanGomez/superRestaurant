import type { MenuModifierGroupV1, MenuProductFractionV1, MenuProductV1, MenuProductVariantV1, MenuVariantFractionV1 } from "@super-restaurant/shared-types";
import { groupsForProduct } from "./menu-groups";

/** A product with halves off: nothing chosen yet. */
export const EMPTY_PRODUCT_FRACTION: MenuProductFractionV1 = Object.freeze({
  enabled: false,
  lockedIngredientOptionIds: [],
  excludableIngredientIds: [],
  extraGroupId: null,
  flavorGroupId: null,
});

function enabledVariants(product: Pick<MenuProductV1, "variants">): readonly MenuProductVariantV1[] {
  return (product.variants ?? []).filter((variant) => variant.fraction?.enabled === true);
}

function sameSetup(left: MenuVariantFractionV1, right: MenuVariantFractionV1): boolean {
  const key = (setup: MenuVariantFractionV1) => JSON.stringify([
    setup.flavorGroupId,
    setup.extraGroupId,
    [...(setup.lockedIngredientOptionIds ?? [])].sort(),
    [...(setup.excludableIngredientIds ?? [])].sort(),
  ]);
  return key(left) === key(right);
}

/**
 * The legacy source of a product that has no `fraction` of its own: the first enabled setup among
 * its sizes (by display order). `differs` is set when other sizes carry a different setup.
 */
export function legacyFractionSource(product: Pick<MenuProductV1, "fraction" | "variants">):
  { readonly differs: boolean; readonly fraction: MenuVariantFractionV1; readonly variantName: string } | null {
  if (product.fraction !== null && product.fraction !== undefined) return null;
  const sources = [...enabledVariants(product)].sort((a, b) => a.displayOrder - b.displayOrder);
  const first = sources[0];
  if (first === undefined || first.fraction === null || first.fraction === undefined) return null;
  const setup = first.fraction;
  return {
    differs: sources.some((entry) => entry.fraction !== null && entry.fraction !== undefined && !sameSetup(setup, entry.fraction)),
    fraction: setup,
    variantName: first.name.trim() === "" ? "tamaño sin nombre" : first.name,
  };
}

/** What the editor shows for the product: its own setup, else the legacy one of its sizes, else empty. */
export function editorProductFraction(product: Pick<MenuProductV1, "fraction" | "variants">): MenuProductFractionV1 {
  return product.fraction ?? legacyFractionSource(product)?.fraction ?? EMPTY_PRODUCT_FRACTION;
}

/** Warning when sizes carry different legacy setups and only one will be kept on save; `null` otherwise. */
export function legacyFractionNotice(product: Pick<MenuProductV1, "fraction" | "variants">): string | null {
  const source = legacyFractionSource(product);
  return source !== null && source.differs
    ? `Los tamaños tienen mitades configuradas distinto; al guardar se usará la de ${source.variantName}.`
    : null;
}

/**
 * Moves a legacy per-size setup to the product and switches the sizes' own setups off, so the server
 * (which rejects a product setup together with an enabled size setup) accepts the draft. Idempotent.
 */
export function migrateLegacyFraction(product: MenuProductV1, groups: readonly MenuModifierGroupV1[]): MenuProductV1 {
  const source = legacyFractionSource(product);
  // A product that carries its own setup (even switched off) is the only authority: sizes' own setups go off.
  const hasOwn = product.fraction !== null && product.fraction !== undefined;
  const assigned = new Set(groupsForProduct(product, groups).map((group) => group.groupId));
  const candidate = source?.fraction ?? product.fraction;
  const fraction = candidate === null || candidate === undefined ? candidate : {
    ...candidate,
    lockedIngredientOptionIds: [...(candidate.lockedIngredientOptionIds ?? [])],
    ...(candidate.excludableIngredientIds ? { excludableIngredientIds: [...candidate.excludableIngredientIds] } : {}),
    extraGroupId: candidate.extraGroupId !== null && assigned.has(candidate.extraGroupId) ? candidate.extraGroupId : null,
    flavorGroupId: candidate.flavorGroupId !== null && assigned.has(candidate.flavorGroupId) ? candidate.flavorGroupId : null,
  };
  if (source === null && !(hasOwn && enabledVariants(product).length > 0)) {
    if (candidate === null || candidate === undefined || fraction === undefined || fraction === candidate) return product;
    return { ...product, fraction };
  }
  return {
    ...product,
    fraction: fraction ?? null,
    variants: (product.variants ?? []).map((variant) => variant.fraction?.enabled === true
      ? { ...variant, fraction: { ...variant.fraction, enabled: false } } : variant),
  };
}
