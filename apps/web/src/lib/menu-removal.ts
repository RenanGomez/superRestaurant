import type { MenuCategoryV1, MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";

/** One pending removal from the menu draft. For a variant, groupId carries the owning product id. */
export type Removal = Readonly<{
  groupId?: string;
  id: string;
  /** `groups` removes every modifier group of the product whose id is `id`. */
  kind: "category" | "group" | "groups" | "option" | "product" | "variant";
  label: string;
  /** A variant that has no name yet (just added) can be dropped without asking. */
  unnamed?: boolean;
}>;

export interface MenuDraftParts {
  readonly categories: readonly MenuCategoryV1[];
  readonly groups: readonly MenuModifierGroupV1[];
  readonly products: readonly MenuProductV1[];
}

export function removalNeedsConfirmation(removal: Removal): boolean {
  return !(removal.kind === "variant" && removal.unnamed === true);
}

/** Returns the draft without the removed element and its dependents; never mutates the input. */
export function applyRemoval(draft: MenuDraftParts, removal: Removal): MenuDraftParts {
  if (removal.kind === "category") {
    const gone = new Set(draft.products.filter((product) => product.categoryId === removal.id).map((product) => product.productId));
    return {
      categories: draft.categories.filter((category) => category.categoryId !== removal.id),
      groups: draft.groups.filter((group) => !gone.has(group.productId)),
      products: draft.products.filter((product) => !gone.has(product.productId)),
    };
  }
  if (removal.kind === "product") {
    return {
      ...draft,
      groups: draft.groups.filter((group) => group.productId !== removal.id),
      products: draft.products.filter((product) => product.productId !== removal.id),
    };
  }
  if (removal.kind === "groups") {
    const gone = new Set(draft.groups.filter((group) => group.productId === removal.id).map((group) => group.groupId));
    const dangling = (id: string | null): boolean => id !== null && gone.has(id);
    return {
      ...draft,
      groups: draft.groups.filter((group) => group.productId !== removal.id),
      // Halves that pointed at a removed group would be invalid; leave the setup empty instead of dangling.
      products: draft.products.map((product) => {
        if (product.productId !== removal.id) return product;
        const clean = <T extends { readonly extraGroupId: string | null; readonly flavorGroupId: string | null }>(fraction: T): T => ({
          ...fraction, extraGroupId: dangling(fraction.extraGroupId) ? null : fraction.extraGroupId, flavorGroupId: dangling(fraction.flavorGroupId) ? null : fraction.flavorGroupId,
        });
        return {
          ...product,
          ...(product.fraction === null || product.fraction === undefined ? {} : { fraction: clean(product.fraction) }),
          variants: (product.variants ?? []).map((variant) => variant.fraction === null || variant.fraction === undefined ? variant : { ...variant, fraction: clean(variant.fraction) }),
        };
      }),
    };
  }
  if (removal.kind === "group") return { ...draft, groups: draft.groups.filter((group) => group.groupId !== removal.id) };
  if (removal.kind === "variant") {
    return {
      ...draft,
      products: draft.products.map((product) => product.productId === removal.groupId
        ? { ...product, variants: (product.variants ?? []).filter((variant) => variant.variantId !== removal.id) } : product),
    };
  }
  return {
    ...draft,
    groups: draft.groups.map((group) => group.groupId === removal.groupId
      ? { ...group, options: group.options.filter((option) => option.optionId !== removal.id) } : group),
  };
}
