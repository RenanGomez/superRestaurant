/**
 * Splits the draft products into the ones that appear under their category and the archived ones.
 * Archiving only flips `active`; nothing is removed and the archived groups stay reachable.
 */
export interface MenuProductSections<T extends { readonly active: boolean }> {
  readonly active: readonly T[];
  readonly archived: readonly T[];
}

export function splitArchivedProducts<T extends { readonly active: boolean }>(products: readonly T[]): MenuProductSections<T> {
  const active: T[] = [];
  const archived: T[] = [];
  for (const product of products) {
    if (product.active) active.push(product);
    else archived.push(product);
  }
  return { active, archived };
}
