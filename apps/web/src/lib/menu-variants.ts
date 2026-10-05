import { MENU_PRODUCT_MAX_VARIANTS, type MenuProductV1, type MenuProductVariantV1 } from "@super-restaurant/shared-types";

/** Client-side publishing guidance; the API validates the catalog again. */
export function variantValidationError(variants: readonly MenuProductVariantV1[]): string | null {
  if (variants.length > MENU_PRODUCT_MAX_VARIANTS) return `Máximo ${MENU_PRODUCT_MAX_VARIANTS} tamaños por producto.`;
  const names = new Set<string>();
  for (const variant of variants) {
    const name = variant.name.trim();
    if (name.length === 0 || name.length > 80) return "Escribe un nombre de tamaño (máximo 80 caracteres).";
    const key = name.toLowerCase();
    if (names.has(key)) return "Cada tamaño necesita un nombre distinto.";
    names.add(key);
    if (!Number.isSafeInteger(variant.unitPriceMinor) || variant.unitPriceMinor < 0) return "Escribe un precio válido.";
    if (!Number.isSafeInteger(variant.displayOrder) || variant.displayOrder < 0 || variant.displayOrder > 1_000_000) return "Escribe un orden válido.";
  }
  return null;
}

export function menuProductPriceLabel(product: MenuProductV1, formatPrice: (amountMinor: number) => string): string {
  const prices = product.variants?.filter((variant) => variant.active).map((variant) => variant.unitPriceMinor) ?? [];
  return prices.length > 0
    ? `desde ${formatPrice(Math.min(...prices))}`
    : formatPrice(product.unitPriceMinor);
}
