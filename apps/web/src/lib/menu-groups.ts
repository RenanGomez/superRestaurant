import type { MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";

/**
 * The modifier groups a product offers. Groups belong to the restaurant catalog and may be shared;
 * `product.modifierGroupIds` is the relation. A catalog from an older server has no list, then the
 * legacy single owner (`group.productId`) decides. Order follows the catalog's group order.
 */
export function groupsForProduct(
  product: MenuProductV1,
  groups: readonly MenuModifierGroupV1[],
): readonly MenuModifierGroupV1[] {
  const assigned = product.modifierGroupIds;
  if (assigned === undefined) return groups.filter((group) => group.productId === product.productId);
  const ids = new Set(assigned);
  return groups.filter((group) => ids.has(group.groupId));
}

/** Number of products that currently offer a group. */
export function groupAssignmentCount(
  products: readonly MenuProductV1[],
  group: MenuModifierGroupV1,
): number {
  return products.filter((product) => groupsForProduct(product, [group]).length === 1).length;
}

/**
 * Re-derives the legacy single owner after an assignment edit: older clients read `group.productId`,
 * so it is set only while exactly one product offers the group and `null` when shared or unassigned.
 * Lists missing on a product are treated as empty (the editor always writes them).
 */
export function withLegacyOwners(
  products: readonly MenuProductV1[],
  groups: readonly MenuModifierGroupV1[],
): readonly MenuModifierGroupV1[] {
  return groups.map((group) => {
    const owners = products.filter((product) => groupsForProduct(product, [group]).length === 1);
    return { ...group, productId: owners.length === 1 ? owners[0]!.productId : null };
  });
}

/** Gives every product an explicit list (derived from the legacy owner when it has none), e.g. for old local drafts. */
export function withDerivedAssignments(
  products: readonly MenuProductV1[],
  groups: readonly MenuModifierGroupV1[],
): readonly MenuProductV1[] {
  return products.map((product) => product.modifierGroupIds !== undefined ? product : {
    ...product,
    modifierGroupIds: groupsForProduct(product, groups).map((group) => group.groupId),
  });
}

const GROUP_NAME_MAX = 80;
const GROUP_COPY_SUFFIX = " (copia)";

/**
 * Copy of a catalog group: fresh group and option ids, «(copia)» name, unassigned (no legacy owner) and without
 * photos (their path embeds the owner's id). Never mutates its input.
 */
export function duplicateGroup(group: MenuModifierGroupV1, newId: () => string, displayOrder: number): MenuModifierGroupV1 {
  const groupId = newId();
  return {
    ...group,
    displayOrder,
    groupId,
    name: `${group.name.slice(0, GROUP_NAME_MAX - GROUP_COPY_SUFFIX.length)}${GROUP_COPY_SUFFIX}`,
    options: group.options.map((option) => ({ ...option, imagePath: null, optionId: newId() })),
    productId: null,
  };
}

/** Adds or removes a group from one product's ordered list. */
export function toggleGroupAssignment(
  product: MenuProductV1,
  groupId: string,
  assigned: boolean,
  groups: readonly MenuModifierGroupV1[] = [],
): MenuProductV1 {
  // A product without a list still offers its legacy groups: keep them instead of dropping them.
  const current = product.modifierGroupIds ?? groupsForProduct(product, groups).map((group) => group.groupId);
  const next = assigned
    ? (current.includes(groupId) ? current : [...current, groupId])
    : current.filter((id) => id !== groupId);
  return { ...product, modifierGroupIds: next };
}
