import { MENU_PRODUCT_MAX_VARIANTS, type MenuCatalogV1, type MenuProductV1, type MenuProductVariantV1 } from "@super-restaurant/shared-types";

/** Client-side publishing guidance; the API validates the catalog again. */
export function variantValidationError(productId: string, variants: readonly MenuProductVariantV1[]): { readonly productId: string; readonly message: string } | null {
  const message = variantMessage(variants);
  return message === null ? null : { productId, message };
}

function variantMessage(variants: readonly MenuProductVariantV1[]): string | null {
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

/** Display name of a line's size from the current catalog; falls back when it was removed. */
export function variantNameFor(catalog: Pick<MenuCatalogV1, "products"> | null, productId: string, variantId: string | null): string | null {
  if (variantId === null) return null;
  return catalog?.products.find((product) => product.productId === productId)?.variants?.find((variant) => variant.variantId === variantId)?.name ?? "Tamaño seleccionado";
}

export function menuProductPriceLabel(product: MenuProductV1, formatPrice: (amountMinor: number) => string): string {
  const prices = product.variants?.filter((variant) => variant.active).map((variant) => variant.unitPriceMinor) ?? [];
  return prices.length > 0
    ? `desde ${formatPrice(Math.min(...prices))}`
    : formatPrice(product.unitPriceMinor);
}
