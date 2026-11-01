import type { MenuProductV1, MenuProductVariantV1 } from "@super-restaurant/shared-types";

const PRODUCT_NAME_MAX = 120;
const COPY_SUFFIX = " (copia)";

export interface DuplicatedProduct {
  readonly product: MenuProductV1;
}

function copyName(name: string): string {
  return `${name.slice(0, PRODUCT_NAME_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

/**
 * Copy of a product for the draft: new product id, «(copia)» name, no internal key, the given display order,
 * sizes with fresh ids. Modifier groups belong to the restaurant catalog, so the copy lists the SAME group ids
 * (the groups are shared, never cloned) and its half-and-half setup keeps pointing at them. The caller refreshes the
 * legacy group owners afterwards. Never mutates its input. `newId` is called once per generated id.
 */
export function duplicateProduct(product: MenuProductV1, newId: () => string, displayOrder: number = product.displayOrder): DuplicatedProduct {
  const productId = newId();
  const variants = (product.variants ?? []).map((variant): MenuProductVariantV1 => ({
    ...variant,
    ...(variant.fraction === null || variant.fraction === undefined ? {} : { fraction: { ...variant.fraction, excludableIngredientIds: [...variant.fraction.excludableIngredientIds] } }),
    variantId: newId(),
  }));
  const copied: MenuProductV1 = {
    ...product,
    displayOrder,
    imagePath: null,
    ...(product.fraction === null || product.fraction === undefined ? {} : { fraction: { ...product.fraction, excludableIngredientIds: [...product.fraction.excludableIngredientIds] } }),
    modifierGroupIds: [...(product.modifierGroupIds ?? [])],
    name: copyName(product.name),
    productId,
    sku: null,
    tax: product.tax === null ? null : { ...product.tax },
    variants,
  };
  return { product: copied };
}
