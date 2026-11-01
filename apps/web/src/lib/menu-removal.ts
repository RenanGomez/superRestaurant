import type { MenuCategoryV1, MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";
import { groupsForProduct, withLegacyOwners } from "./menu-groups.js";

/** One pending removal from the menu draft. For a variant, groupId carries the owning product id. */
export type Removal = Readonly<{
  groupId?: string;
  id: string;
  /**
   * `groups` unassigns every modifier group from the product whose id is `id` (the groups stay in the
   * catalog). `group` deletes a group from the catalog and unassigns it from every product.
   */
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

type FractionLike = { readonly extraGroupId: string | null; readonly flavorGroupId: string | null };

/** Halves that pointed at a removed assignment would be invalid; leave the setup empty instead of dangling. */
function cleanProduct(product: MenuProductV1, gone: ReadonlySet<string>): MenuProductV1 {
  const dangling = (id: string | null): boolean => id !== null && gone.has(id);
  const clean = <T extends FractionLike>(fraction: T): T => ({
    ...fraction,
    extraGroupId: dangling(fraction.extraGroupId) ? null : fraction.extraGroupId,
    flavorGroupId: dangling(fraction.flavorGroupId) ? null : fraction.flavorGroupId,
  });
  return {
    ...product,
    ...(product.fraction === null || product.fraction === undefined ? {} : { fraction: clean(product.fraction) }),
    variants: (product.variants ?? []).map((variant) => variant.fraction === null || variant.fraction === undefined ? variant : { ...variant, fraction: clean(variant.fraction) }),
  };
}

/** One product without one group, with any halves setup that pointed at it emptied instead of left dangling. */
export function unassignGroup(product: MenuProductV1, groupId: string): MenuProductV1 {
  return cleanProduct({ ...product, modifierGroupIds: (product.modifierGroupIds ?? []).filter((id) => id !== groupId) }, new Set([groupId]));
}

/** Returns the draft without the removed element and its dependents; never mutates the input. */
export function applyRemoval(draft: MenuDraftParts, removal: Removal): MenuDraftParts {
  if (removal.kind === "category") {
    const gone = new Set(draft.products.filter((product) => product.categoryId === removal.id).map((product) => product.productId));
    const products = draft.products.filter((product) => !gone.has(product.productId));
    return {
      categories: draft.categories.filter((category) => category.categoryId !== removal.id),
      groups: withLegacyOwners(products, draft.groups),
      products,
    };
  }
  if (removal.kind === "product") {
    const products = draft.products.filter((product) => product.productId !== removal.id);
    return { ...draft, groups: withLegacyOwners(products, draft.groups), products };
  }
  if (removal.kind === "groups") {
    const target = draft.products.find((product) => product.productId === removal.id);
    const gone = new Set(target === undefined ? [] : groupsForProduct(target, draft.groups).map((group) => group.groupId));
    const products = draft.products.map((product) => (
      product.productId === removal.id ? cleanProduct({ ...product, modifierGroupIds: [] }, gone) : product
    ));
    return { ...draft, groups: withLegacyOwners(products, draft.groups), products };
  }
  if (removal.kind === "group") {
    const gone = new Set([removal.id]);
    const products = draft.products.map((product) => {
      const listed = product.modifierGroupIds?.includes(removal.id) === true;
      const touches = listed || [product.fraction, ...(product.variants ?? []).map((variant) => variant.fraction)]
        .some((fraction) => fraction?.extraGroupId === removal.id || fraction?.flavorGroupId === removal.id);
      if (!touches) return product;
      return cleanProduct({ ...product, modifierGroupIds: (product.modifierGroupIds ?? []).filter((id) => id !== removal.id) }, gone);
    });
    const groups = draft.groups.filter((group) => group.groupId !== removal.id);
    return { ...draft, groups: withLegacyOwners(products, groups), products };
  }
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
