import type { MenuModifierGroupV1, MenuProductFractionV1, MenuProductV1, MenuProductVariantV1, MenuVariantFractionV1 } from "@super-restaurant/shared-types";

const PRODUCT_NAME_MAX = 120;
const COPY_SUFFIX = " (copia)";

export interface DuplicatedProduct {
  readonly groups: readonly MenuModifierGroupV1[];
  readonly product: MenuProductV1;
}

function copyName(name: string): string {
  return `${name.slice(0, PRODUCT_NAME_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

function remap<T extends MenuVariantFractionV1 | MenuProductFractionV1>(fraction: T, groupIds: ReadonlyMap<string, string>): T {
  const next = (id: string | null): string | null => (id === null ? null : groupIds.get(id) ?? null);
  return { ...fraction, excludableIngredientIds: [...fraction.excludableIngredientIds], extraGroupId: next(fraction.extraGroupId), flavorGroupId: next(fraction.flavorGroupId) };
}

/**
 * Copy of a product for the draft: new product id, «(copia)» name, no internal key, the given display order,
 * sizes and modifier groups/options with fresh ids. The half-and-half setup (product and legacy per-size)
 * points at the copied groups. `groups` may hold groups of other products; only those of `product` are copied.
 * Never mutates its inputs. `newId` is called once per generated id.
 */
export function duplicateProduct(product: MenuProductV1, groups: readonly MenuModifierGroupV1[], newId: () => string, displayOrder: number = product.displayOrder): DuplicatedProduct {
  const productId = newId();
  const source = groups.filter((group) => group.productId === product.productId);
  const groupIds = new Map(source.map((group) => [group.groupId, newId()] as const));
  const copiedGroups = source.map((group): MenuModifierGroupV1 => ({
    ...group,
    groupId: groupIds.get(group.groupId) ?? newId(),
    options: group.options.map((option) => ({ ...option, optionId: newId() })),
    productId,
  }));
  const variants = (product.variants ?? []).map((variant): MenuProductVariantV1 => ({
    ...variant,
    ...(variant.fraction === null || variant.fraction === undefined ? {} : { fraction: remap(variant.fraction, groupIds) }),
    variantId: newId(),
  }));
  const copied: MenuProductV1 = {
    ...product,
    displayOrder,
    ...(product.fraction === null || product.fraction === undefined ? {} : { fraction: remap(product.fraction, groupIds) }),
    name: copyName(product.name),
    productId,
    sku: null,
    tax: product.tax === null ? null : { ...product.tax },
    variants,
  };
  return { groups: copiedGroups, product: copied };
}
