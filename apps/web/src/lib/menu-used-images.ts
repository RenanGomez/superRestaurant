import type { MenuCategoryV1, MenuModifierGroupV1, MenuProductV1 } from "@super-restaurant/shared-types";

/** Distinct image paths of the products, options and categories in the draft, in first-seen order (products first). */
export function collectUsedImagePaths(products: readonly Pick<MenuProductV1, "imagePath">[], groups: readonly Pick<MenuModifierGroupV1, "options">[], categories: readonly Pick<MenuCategoryV1, "imagePath">[] = []): readonly string[] {
  const seen = new Set<string>();
  for (const product of products) if (product.imagePath !== null) seen.add(product.imagePath);
  for (const group of groups) for (const option of group.options) if (option.imagePath !== null) seen.add(option.imagePath);
  for (const category of categories) if (category.imagePath !== null) seen.add(category.imagePath);
  return [...seen];
}

/**
 * Paths that belong to one product, option or category. The database only accepts `{restaurantId}/products|options|categories/{entityId}/file`
 * with the entity's own id, so a photo of another entity can never be assigned.
 */
export function imagePathsOfEntity(paths: readonly string[], entityId: string): readonly string[] {
  return paths.filter((path) => path.split("/")[2] === entityId);
}

/**
 * Adds the current paths to the ones remembered during the session, so a photo that was removed by mistake
 * stays selectable until the page reloads. Returns `previous` itself when nothing is new.
 */
export function retainImagePaths(previous: readonly string[], current: readonly string[]): readonly string[] {
  const known = new Set(previous);
  const added = current.filter((path) => !known.has(path));
  return added.length === 0 ? previous : [...previous, ...added];
}
